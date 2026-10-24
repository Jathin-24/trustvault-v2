'use client'

import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { Suspense, useCallback, useEffect, useState } from 'react'
import {
  apiFetch,
  CATEGORIES,
  formatBytes,
  formatDateTime,
  jsonHeaders,
  readError,
  type DocDetail,
  type Grant,
} from '@/components/api'

const inputClass =
  'rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-500 focus:outline-none'
const labelClass = 'block text-xs font-medium text-gray-600'
const buttonClass =
  'rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50'
const secondaryButtonClass =
  'rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50'
const dangerButtonClass =
  'rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50'

/**
 * Cache Components: `useParams()` is request-time URL data, so the detail
 * component has to sit behind a Suspense boundary or the route cannot be
 * prerendered. The fallback is the loading skeleton below.
 */
export default function DocumentDetailPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-3xl px-6 py-10">
          <div className="h-8 w-64 animate-pulse rounded bg-gray-200" />
          <div className="mt-4 h-40 animate-pulse rounded-lg bg-gray-100" />
        </div>
      }
    >
      <DocumentDetail />
    </Suspense>
  )
}

function DocumentDetail() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [doc, setDoc] = useState<DocDetail | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    apiFetch(`/api/documents/${id}`)
      .then(async (res) => {
        if (res.status === 404) {
          if (!cancelled) setNotFound(true)
          return
        }
        if (!res.ok) throw new Error(await readError(res, 'Failed to load document'))
        const data = (await res.json()) as DocDetail
        if (!cancelled) setDoc(data)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load document')
      })
    return () => {
      cancelled = true
    }
  }, [id, reloadKey])

  const refresh = useCallback(() => setReloadKey((k) => k + 1), [])

  if (notFound) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-24 text-center">
        <h1 className="text-2xl font-bold">Document not found or you don&apos;t have access</h1>
        <p className="mt-3 text-gray-600">
          It may have been deleted, or it was never shared with you.
        </p>
        <Link
          href="/documents"
          className="mt-6 inline-block rounded-md bg-gray-900 px-4 py-2 text-sm text-white hover:bg-gray-700"
        >
          Back to documents
        </Link>
      </div>
    )
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16">
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
        <button
          type="button"
          className={`${secondaryButtonClass} mt-4`}
          onClick={refresh}
        >
          Retry
        </button>
      </div>
    )
  }

  if (!doc) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16">
        <p className="text-sm text-gray-500">Loading document…</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Link href="/documents" className="hover:text-gray-900 hover:underline">
          Documents
        </Link>
        <span>/</span>
        <span className="truncate text-gray-900">{doc.name}</span>
      </div>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <h1 className="break-all text-2xl font-bold">{doc.name}</h1>
        <a
          href={`/api/documents/${doc.id}/download`}
          className={`${buttonClass} shrink-0 no-underline`}
        >
          Download
        </a>
      </div>

      <dl className="mt-6 grid grid-cols-1 gap-x-8 gap-y-3 rounded-lg border border-gray-200 bg-white p-6 text-sm sm:grid-cols-2">
        <div>
          <dt className={labelClass}>Category</dt>
          <dd className="mt-0.5 text-gray-900">{doc.category}</dd>
        </div>
        <div>
          <dt className={labelClass}>Type</dt>
          <dd className="mt-0.5 text-gray-900">{doc.mime_type}</dd>
        </div>
        <div>
          <dt className={labelClass}>Size</dt>
          <dd className="mt-0.5 text-gray-900">{formatBytes(doc.size_bytes)}</dd>
        </div>
        <div>
          <dt className={labelClass}>Created</dt>
          <dd className="mt-0.5 text-gray-900">{formatDateTime(doc.created_at)}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className={labelClass}>SHA-256</dt>
          <dd className="mt-0.5 break-all font-mono text-xs text-gray-700">{doc.sha256}</dd>
        </div>
      </dl>

      <RenameForm doc={doc} onSaved={setDoc} />
      <DeleteButton docId={doc.id} onDeleted={() => router.push('/documents')} />
      <SharingPanel docId={doc.id} reloadKey={reloadKey} onChanged={refresh} />
    </div>
  )
}

function RenameForm({ doc, onSaved }: { doc: DocDetail; onSaved: (d: DocDetail) => void }) {
  const [name, setName] = useState(doc.name)
  const [category, setCategory] = useState(doc.category)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  // Sync form state when the doc changes (e.g. external reload) — the
  // "adjust state during render" pattern instead of a useEffect.
  const [prevDoc, setPrevDoc] = useState(doc)
  if (prevDoc !== doc) {
    setPrevDoc(doc)
    setName(doc.name)
    setCategory(doc.category)
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setBusy(true)
    setMessage(null)
    try {
      const res = await apiFetch(`/api/documents/${doc.id}`, {
        method: 'PATCH',
        headers: jsonHeaders(),
        body: JSON.stringify({ name, category }),
      })
      if (res.ok) {
        const updated = (await res.json()) as DocDetail
        onSaved({ ...doc, ...updated })
        setMessage({ kind: 'ok', text: 'Saved.' })
      } else {
        // e.g. read-only users get an error from the server — shown verbatim
        setMessage({ kind: 'error', text: await readError(res, 'Update failed') })
      }
    } catch {
      setMessage({ kind: 'error', text: 'Update failed. Please try again.' })
    } finally {
      setBusy(false)
    }
  }

  const dirty = name !== doc.name || category !== doc.category

  return (
    <form onSubmit={submit} className="mt-8 rounded-lg border border-gray-200 bg-white p-6">
      <h2 className="text-sm font-semibold text-gray-900">Rename &amp; recategorize</h2>
      <p className="mt-1 text-xs text-gray-500">
        Requires edit access — the server rejects changes you are not allowed to make.
      </p>
      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="r-name" className={labelClass}>
            Name
          </label>
          <input
            id="r-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={`${inputClass} mt-1 w-full`}
            maxLength={255}
          />
        </div>
        <div>
          <label htmlFor="r-category" className={labelClass}>
            Category
          </label>
          <input
            id="r-category"
            list="r-category-options"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className={`${inputClass} mt-1 w-full`}
            maxLength={100}
          />
          <datalist id="r-category-options">
            {CATEGORIES.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
      </div>
      {message && (
        <p
          className={
            message.kind === 'error' ? 'mt-3 text-xs text-red-700' : 'mt-3 text-xs text-green-700'
          }
        >
          {message.text}
        </p>
      )}
      <button type="submit" className={`${buttonClass} mt-4`} disabled={busy || !dirty}>
        {busy ? 'Saving…' : 'Save changes'}
      </button>
    </form>
  )
}

function DeleteButton({ docId, onDeleted }: { docId: string; onDeleted: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function remove() {
    if (!window.confirm('Delete this document? This cannot be undone.')) return
    setBusy(true)
    setError(null)
    try {
      const res = await apiFetch(`/api/documents/${docId}`, { method: 'DELETE' })
      if (res.ok) onDeleted()
      else setError(await readError(res, 'Delete failed'))
    } catch {
      setError('Delete failed. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-6">
      <button type="button" className={dangerButtonClass} onClick={remove} disabled={busy}>
        {busy ? 'Deleting…' : 'Delete document'}
      </button>
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
    </div>
  )
}

function SharingPanel({
  docId,
  reloadKey,
  onChanged,
}: {
  docId: string
  reloadKey: number
  onChanged: () => void
}) {
  const [grants, setGrants] = useState<Grant[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [level, setLevel] = useState<'read' | 'edit'>('read')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [revokingId, setRevokingId] = useState<string | null>(null)

  const load = useCallback(() => {
    apiFetch(`/api/documents/${docId}/permissions`)
      .then(async (res) => {
        if (!res.ok) throw new Error(await readError(res, 'Failed to load sharing'))
        const data = (await res.json()) as { permissions: Grant[] }
        setGrants(data.permissions)
        setLoadError(null)
      })
      .catch((err: unknown) => {
        setGrants(null)
        setLoadError(err instanceof Error ? err.message : 'Failed to load sharing')
      })
  }, [docId])

  useEffect(() => {
    load()
  }, [load, reloadKey])

  const active = (grants ?? []).filter((g) => !g.revoked_at)

  async function grant(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setBusy(true)
    setMessage(null)
    try {
      const res = await apiFetch(`/api/documents/${docId}/permissions`, {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ email, level }),
      })
      if (res.ok) {
        setMessage({ kind: 'ok', text: `Shared with ${email} (${level}).` })
        setEmail('')
        load()
        onChanged()
      } else {
        // 409 -> "user already has an active grant", plus 400/404 messages
        setMessage({ kind: 'error', text: await readError(res, 'Share failed') })
      }
    } catch {
      setMessage({ kind: 'error', text: 'Share failed. Please try again.' })
    } finally {
      setBusy(false)
    }
  }

  async function revoke(permId: string) {
    setRevokingId(permId)
    setMessage(null)
    try {
      const res = await apiFetch(`/api/documents/${docId}/permissions/${permId}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        setMessage({ kind: 'ok', text: 'Access revoked.' })
        load()
        onChanged()
      } else {
        setMessage({ kind: 'error', text: await readError(res, 'Revoke failed') })
      }
    } catch {
      setMessage({ kind: 'error', text: 'Revoke failed. Please try again.' })
    } finally {
      setRevokingId(null)
    }
  }

  return (
    <section className="mt-8 rounded-lg border border-gray-200 bg-white p-6">
      <h2 className="text-sm font-semibold text-gray-900">Sharing</h2>
      <p className="mt-1 text-xs text-gray-500">
        Owner only — the server rejects sharing changes from anyone else.
      </p>

      {loadError && <p className="mt-3 text-xs text-red-700">{loadError}</p>}

      {grants !== null && (
        <>
          {active.length === 0 ? (
            <p className="mt-3 text-sm text-gray-500">Not shared with anyone.</p>
          ) : (
            <ul className="mt-3 divide-y divide-gray-100">
              {active.map((g) => (
                <li key={g.id} className="flex items-center justify-between gap-4 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-gray-900">
                      {g.users?.email ?? g.user_id}
                    </p>
                    <p className="text-xs text-gray-500">
                      {g.level} · granted {formatDateTime(g.granted_at)}
                    </p>
                  </div>
                  <button
                    type="button"
                    className={secondaryButtonClass}
                    onClick={() => revoke(g.id)}
                    disabled={revokingId === g.id}
                  >
                    {revokingId === g.id ? 'Revoking…' : 'Revoke'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <form onSubmit={grant} className="mt-5 border-t border-gray-100 pt-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <label htmlFor="s-email" className={labelClass}>
              Email
            </label>
            <input
              id="s-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@example.com"
              className={`${inputClass} mt-1 w-full`}
            />
          </div>
          <div>
            <label htmlFor="s-level" className={labelClass}>
              Level
            </label>
            <select
              id="s-level"
              value={level}
              onChange={(e) => setLevel(e.target.value === 'edit' ? 'edit' : 'read')}
              className={`${inputClass} mt-1`}
            >
              <option value="read">read</option>
              <option value="edit">edit</option>
            </select>
          </div>
          <button type="submit" className={buttonClass} disabled={busy}>
            {busy ? 'Sharing…' : 'Share'}
          </button>
        </div>
        {message && (
          <p
            className={
              message.kind === 'error' ? 'mt-3 text-xs text-red-700' : 'mt-3 text-xs text-green-700'
            }
          >
            {message.text}
          </p>
        )}
      </form>
    </section>
  )
}
