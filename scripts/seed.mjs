// Seed: three demo accounts + a few documents with different grants.
// Usage: node scripts/seed.mjs
// Idempotent-ish: re-running reuses existing users, and skips documents
// whose name already exists for that owner.
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

function env(name) {
  const text = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  const m = text.match(new RegExp(`^${name}=(.*)$`, 'm'))
  return m ? m[1].trim() : null
}

const supabase = createClient(
  env('NEXT_PUBLIC_SUPABASE_URL'),
  env('SERVICE_ROLE'),
  { auth: { persistSession: false } },
)

const ACCOUNTS = [
  { email: 'admin@vaultdemo.com', role: 'admin' },
  { email: 'ravi@vaultdemo.com', role: 'member' },
  { email: 'meena@vaultdemo.com', role: 'member' },
]

async function findOrCreateUsers() {
  const ids = {}
  for (const a of ACCOUNTS) {
    const { data } = await supabase
      .from('users')
      .select('id, role')
      .ilike('email', a.email)
      .maybeSingle()
    if (data) {
      ids[a.email] = data.id
      console.log(`user exists: ${a.email} (${data.role})`)
    } else {
      // clerk_id is not known here; seed users are linked on first sign-in
      const { data: created, error } = await supabase
        .from('users')
        .insert({ clerk_id: `seed:${a.email}`, email: a.email, name: a.email.split('@')[0], role: a.role })
        .select('id')
        .single()
      if (error) throw new Error(`create ${a.email}: ${error.message}`)
      ids[a.email] = created.id
      console.log(`created: ${a.email}`)
    }
  }
  return ids
}

// minimal valid-ish PDF bytes for the seed files
function pdfBytes(text) {
  return new TextEncoder().encode(
    `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n` +
    `2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n` +
    `3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n` +
    `% ${text}\ntrailer<</Root 1 0 R>>\n%%EOF\n`,
  )
}

async function sha256Hex(bytes) {
  const b = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, '0')).join('')
}

async function ensureDocument({ ownerEmail, ids, name, category, bodyText }) {
  const { data: existing } = await supabase
    .from('documents')
    .select('id, name')
    .eq('owner_id', ids[ownerEmail])
    .ilike('name', name)
    .maybeSingle()
  if (existing) {
    console.log(`doc exists: ${name}`)
    return existing.id
  }
  const bytes = pdfBytes(bodyText)
  const key = crypto.randomUUID()
  const { error: upErr } = await supabase.storage
    .from('documents')
    .upload(key, bytes, { contentType: 'application/pdf' })
  if (upErr) throw new Error(`storage ${name}: ${upErr.message}`)
  const { data: doc, error } = await supabase
    .from('documents')
    .insert({
      owner_id: ids[ownerEmail],
      name,
      category,
      storage_key: key,
      mime_type: 'application/pdf',
      size_bytes: bytes.length,
      sha256: await sha256Hex(bytes),
    })
    .select('id')
    .single()
  if (error) throw new Error(`insert ${name}: ${error.message}`)
  console.log(`created doc: ${name} (${ownerEmail})`)
  return doc.id
}

async function ensureGrant({ ids, docId, ownerEmail, granteeEmail, level }) {
  const { data: active } = await supabase
    .from('document_permissions')
    .select('id')
    .eq('document_id', docId)
    .eq('user_id', ids[granteeEmail])
    .is('revoked_at', null)
    .maybeSingle()
  if (active) {
    console.log(`grant exists: ${granteeEmail} -> ${docId} (${level})`)
    return
  }
  const { error } = await supabase.from('document_permissions').insert({
    document_id: docId,
    user_id: ids[granteeEmail],
    level,
    granted_by: ids[ownerEmail],
  })
  if (error) throw new Error(`grant: ${error.message}`)
  console.log(`granted ${level}: ${granteeEmail} on doc of ${ownerEmail}`)
}

const ids = await findOrCreateUsers()

const contract = await ensureDocument({
  ownerEmail: 'ravi@vaultdemo.com',
  ids,
  name: 'rental-agreement.pdf',
  category: 'contracts',
  bodyText: 'seed: rental agreement between ravi and tenant',
})
const notes = await ensureDocument({
  ownerEmail: 'ravi@vaultdemo.com',
  ids,
  name: 'meeting-notes.pdf',
  category: 'notes',
  bodyText: 'seed: private meeting notes, owner only',
})
const invoice = await ensureDocument({
  ownerEmail: 'ravi@vaultdemo.com',
  ids,
  name: 'invoice-october.pdf',
  category: 'finance',
  bodyText: 'seed: october invoice, shared read with meena',
})
await ensureDocument({
  ownerEmail: 'meena@vaultdemo.com',
  ids,
  name: 'meena-draft.pdf',
  category: 'notes',
  bodyText: 'seed: meena owns this one',
})

await ensureGrant({ ids, docId: contract, ownerEmail: 'ravi@vaultdemo.com', granteeEmail: 'meena@vaultdemo.com', level: 'read' })
await ensureGrant({ ids, docId: invoice, ownerEmail: 'ravi@vaultdemo.com', granteeEmail: 'meena@vaultdemo.com', level: 'read' })
// edit grant demo: meena may rename ravi's draft-collab doc
const collab = await ensureDocument({
  ownerEmail: 'ravi@vaultdemo.com',
  ids,
  name: 'collab-draft.pdf',
  category: 'notes',
  bodyText: 'seed: shared edit draft',
})
await ensureGrant({ ids, docId: collab, ownerEmail: 'ravi@vaultdemo.com', granteeEmail: 'meena@vaultdemo.com', level: 'edit' })

console.log('\nseed complete. accounts: admin@vaultdemo.com, ravi@vaultdemo.com, meena@vaultdemo.com')
console.log('NOTE: users created by this script have clerk_id "seed:<email>"; they will')
console.log('      link to their real clerk row only if clerk_id matches on first sign-in.')
console.log('      For the live demo, sign in first so getCurrentUser() creates the row,')
console.log('      then run this script to attach documents to those rows.')
