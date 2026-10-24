// Mint a short-lived Clerk session token for curl testing.
// Usage: node scripts/mint-token.mjs you@example.com
import { readFileSync } from 'node:fs'

function env(name) {
  const text = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
  const m = text.match(new RegExp(`^${name}=(.*)$`, 'm'))
  return m ? m[1].trim() : null
}

const SECRET = env('CLERK_SECRET_KEY')
const email = process.argv[2]
if (!email) {
  console.error('usage: node scripts/mint-token.mjs <email>')
  process.exit(1)
}

const auth = { Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' }

async function findUser(email) {
  const r = await fetch(`https://api.clerk.com/v1/users?email_address=${encodeURIComponent(email)}`, { headers: auth })
  const list = await r.json()
  return Array.isArray(list) ? list[0] : null
}

async function createUser(email) {
  const r = await fetch('https://api.clerk.com/v1/users', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      email_address: [email],
      username: email.split('@')[0].replace(/[^a-z0-9_]/gi, '') + Math.floor(Math.random() * 900 + 100),
      password: 'Vault-Test-2026!',
      skip_password_checks: true,
      skip_password_verification: true,
    }),
  })
  if (!r.ok) throw new Error(`create user: ${r.status} ${await r.text()}`)
  return r.json()
}

const user = (await findUser(email)) ?? (await createUser(email))

const sr = await fetch('https://api.clerk.com/v1/sessions', {
  method: 'POST',
  headers: auth,
  body: JSON.stringify({ user_id: user.id, name: `curl-${Date.now()}` }),
})
if (!sr.ok) throw new Error(`create session: ${sr.status} ${await sr.text()}`)
const session = await sr.json()

const tr = await fetch(`https://api.clerk.com/v1/sessions/${session.id}/tokens`, {
  method: 'POST',
  headers: auth,
})
if (!tr.ok) throw new Error(`token: ${tr.status} ${await tr.text()}`)
const token = await tr.json()

console.log(JSON.stringify({ clerk_user_id: user.id, token: token.jwt }, null, 0))
