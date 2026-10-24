import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { getCurrentUser } from '@/lib/users'
import { createAdminClient } from '@/lib/supabase-admin'
import { logAudit } from '@/lib/audit'
import { sanitizeName, validateUpload, MAX_SIZE_BYTES } from '@/lib/upload'
import { headers } from 'next/headers'

export async function POST(req: NextRequest) {
  const user = await getCurrentUser()
  const hdrs = await headers()
  const ip = hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const userAgent = hdrs.get('user-agent')

  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // owner_id comes from the session, NEVER from the request body.
  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file required' }, { status: 400 })
  }

  if (file.size > MAX_SIZE_BYTES) {
    return NextResponse.json({ error: 'file exceeds 4 MB' }, { status: 413 })
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  const head = bytes.subarray(0, 16)

  const invalid = validateUpload({
    declaredName: file.name,
    declaredMime: file.type,
    size: file.size,
    head,
  })
  if (invalid) {
    return NextResponse.json({ error: invalid }, { status: 400 })
  }

  const name = sanitizeName(file.name)
  const category = String(form.get('category') ?? 'general').slice(0, 100) || 'general'
  const storageKey = randomUUID() // never the user's filename
  const sha256 = await crypto.subtle
    .digest('SHA-256', bytes)
    .then((b) => Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, '0')).join(''))

  const supabase = createAdminClient()

  const { error: storageErr } = await supabase.storage
    .from('documents')
    .upload(storageKey, bytes, { contentType: file.type || 'application/octet-stream' })
  if (storageErr) {
    return NextResponse.json({ error: 'storage upload failed' }, { status: 500 })
  }

  const { data: doc, error: dbErr } = await supabase
    .from('documents')
    .insert({
      owner_id: user.id,
      name,
      category,
      storage_key: storageKey,
      mime_type: file.type || 'application/octet-stream',
      size_bytes: file.size,
      sha256,
    })
    .select('id, name, category, mime_type, size_bytes, created_at')
    .single()

  if (dbErr) {
    // roll the object back so storage doesn't accumulate orphans
    await supabase.storage.from('documents').remove([storageKey])
    return NextResponse.json({ error: 'could not save document' }, { status: 500 })
  }

  await logAudit({
    actorId: user.id,
    action: 'upload',
    documentId: doc.id,
    outcome: 'allowed',
    ip,
    userAgent,
    details: { name, category, size_bytes: file.size },
  })

  return NextResponse.json(doc, { status: 201 })
}

/**
 * List + search. The access filter is inside the query itself:
 * owned by me, OR actively granted to me (revoked_at IS NULL).
 * Applied as an or() filter — not fetched-then-filtered in JS,
 * which would leak other users' documents into the response shape.
 */
export async function GET(req: NextRequest) {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const name = searchParams.get('name')
  const owner = searchParams.get('owner') // 'me' | 'other' | uuid
  const category = searchParams.get('category')
  const from = searchParams.get('from') // ISO date
  const to = searchParams.get('to')

  const supabase = createAdminClient()

  // ids of documents actively shared with me
  const { data: grants } = await supabase
    .from('document_permissions')
    .select('document_id')
    .eq('user_id', user.id)
    .is('revoked_at', null)

  const grantedIds = (grants ?? []).map((g) => g.document_id)

  let query = supabase
    .from('documents')
    .select('id, owner_id, name, category, mime_type, size_bytes, created_at, updated_at, deleted_at, users!documents_owner_id_fkey(email, name)')
    .is('deleted_at', null) // soft-deleted docs are hidden from lists

  // --- access filter, inside the query ---
  if (grantedIds.length > 0) {
    query = query.or(`owner_id.eq.${user.id},id.in.(${grantedIds.join(',')})`)
  } else {
    query = query.eq('owner_id', user.id)
  }

  // --- search filters ---
  // strip %, _ and quotes so a crafted term can't break the like pattern
  // or the PostgREST parser (parameterised already, this keeps errors clean)
  if (name) {
    const clean = name.replace(/[%_'",;()]/g, '').trim().slice(0, 200)
    if (clean) query = query.ilike('name', `%${clean}%`)
  }
  if (category) query = query.eq('category', category.replace(/[%_'",;()]/g, '').slice(0, 100))
  if (owner === 'me') query = query.eq('owner_id', user.id)
  if (owner === 'other') query = query.neq('owner_id', user.id)
  if (owner && owner !== 'me' && owner !== 'other' && /^[0-9a-f-]{36}$/i.test(owner)) {
    query = query.eq('owner_id', owner)
  }
  const isoDate = (v: string | null) => v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v : null
  const fromDate = isoDate(from)
  const toDate = isoDate(to)
  if (fromDate) query = query.gte('created_at', fromDate)
  if (toDate) query = query.lte('created_at', toDate)

  const { data, error } = await query.order('created_at', { ascending: false }).limit(200)

  if (error) {
    // a malformed filter value is the caller's fault, not a server error
    return NextResponse.json({ error: 'invalid filter' }, { status: 400 })
  }

  return NextResponse.json({ documents: data ?? [] })
}
