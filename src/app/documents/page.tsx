'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import {
  apiFetch,
  CATEGORIES,
  formatBytes,
  formatDateTime,
  MAX_UPLOAD_BYTES,
  readError,
  type DocSummary,
} from '@/components/api'

type Filters = {
  name: string
  category: string
  owner: string
  from: string
  to: string
}

const EMPTY_FILTERS: Filters = { name: '', category: '', owner: '', from: '', to: '' }

const inputClass =
  'rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-500 focus:outline-none'
const labelClass = 'block text-xs font-medium text-gray-600'
const buttonClass =
  'rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50'
const secondaryButtonClass =
  'rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50'

export default function DocumentsPage() {
  const router = useRouter()
  const [draft, setDraft] = useState<Filters>(EMPTY_FILTERS)
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const [docs, setDocs] = useState<DocSummary[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const params = new URLSearchParams()
    if (filters.name) params.set('name', filters.name)
    if (filters.category) params.set('category', filters.category)
    if (filters.owner) params.set('owner', filters.owner)
    if (filters.from) params.set('from', filters.from)
    if (filters.to) params.set('to', filters.to)

    let cancelled = false
    apiFetch(`/api/documents?${params.toString()}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(await readError(res, 'Failed to load documents'))
        const data = (await res.json()) as { documents: DocSummary[] }
        if (!cancelled) {
          setDocs(data.documents)
          setListError(null)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setDocs(null)
          setListError(err instanceof Error ? err.message : 'Failed to load documents')
        }
      })
    return () => {
      cancelled = true
    }
  }, [filters, reloadKey])

  const refresh = () => setReloadKey((k) => k + 1)

  // datalist for the category filter: presets plus whatever the account uses
  const categoryOptions = Array.from(
    new Set([...CATEGORIES, ...(docs ?? []).map((d) => d.category)]),
  ).sort()

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Documents</h1>
      </div>

      <UploadForm onUploaded={refresh} />

      <form
        className="mt-6 rounded-lg border border-gray-200 bg-white p-4"
        onSubmit={(e) => {
          e.preventDefault()
          setFilters(draft)
        }}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label htmlFor="f-name" className={labelClass}>
              Name
            </label>
            <input
              id="f-name"
              type="search"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Search by name"
              className={`${inputClass} mt-1 w-full`}
            />
          </div>
          <div>
            <label htmlFor="f-category" className={labelClass}>
              Category
            </label>
            <input
              id="f-category"
              list="category-options"
              value={draft.category}
              onChange={(e) => setDraft({ ...draft, category: e.target.value })}
              placeholder="Any category"
              className={`${inputClass} mt-1 w-full`}
            />
            <datalist id="category-options">
              {categoryOptions.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <div>
            <label htmlFor="f-owner" className={labelClass}>
              Owner
            </label>
            <select
              id="f-owner"
              value={draft.owner}
              onChange={(e) => setDraft({ ...draft, owner: e.target.value })}
              className={`${inputClass} mt-1 w-full`}
            >
              <option value="">Anyone</option>
              <option value="me">Me</option>
              <option value="other">Shared with me</option>
            </select>
          </div>
          <div>
            <label htmlFor="f-from" className={labelClass}>
              From
            </label>
            <input
              id="f-from"
              type="date"
              value={draft.from}
              onChange={(e) => setDraft({ ...draft, from: e.target.value })}
              className={`${inputClass} mt-1 w-full`}
            />
          </div>
          <div>
            <label htmlFor="f-to" className={labelClass}>
              To
            </label>
            <input
              id="f-to"
              type="date"
              value={draft.to}
              onChange={(e) => setDraft({ ...draft, to: e.target.value })}
              className={`${inputClass} mt-1 w-full`}
            />
          </div>
        </div>
        <div className="mt-4 flex items-center gap-2">
          <button type="submit" className={buttonClass}>
            Search
          </button>
          <button
            type="button"
            className={secondaryButtonClass}
            onClick={() => {
              setDraft(EMPTY_FILTERS)
              setFilters(EMPTY_FILTERS)
            }}
          >
            Reset
          </button>
        </div>
      </form>

      <div className="mt-6">
        {listError && (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <p>{listError}</p>
            <button type="button" className={`${secondaryButtonClass} mt-2`} onClick={refresh}>
              Retry
            </button>
          </div>
        )}

        {!listError && docs === null && (
          <p className="text-sm text-gray-500">Loading documents…</p>
        )}

        {!listError && docs !== null && docs.length === 0 && (
          <div className="rounded-lg border border-dashed border-gray-300 bg-white px-6 py-12 text-center">
            <p className="text-sm font-medium text-gray-900">No documents found</p>
            <p className="mt-1 text-sm text-gray-500">
              Upload a file or adjust the filters.
            </p>
          </div>
        )}

        {!listError && docs !== null && docs.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-2.5">Name</th>
                  <th className="px-4 py-2.5">Category</th>
                  <th className="px-4 py-2.5">Owner</th>
                  <th className="px-4 py-2.5 text-right">Size</th>
                  <th className="px-4 py-2.5">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {docs.map((doc) => (
                  <tr
                    key={doc.id}
                    onClick={() => router.push(`/documents/${doc.id}`)}
                    className="cursor-pointer hover:bg-gray-50"
                  >
                    <td className="max-w-xs truncate px-4 py-2.5 font-medium text-gray-900">
                      <Link href={`/documents/${doc.id}`} className="hover:underline">
                        {doc.name}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">{doc.category}</td>
                    <td className="px-4 py-2.5 text-gray-600">{doc.users?.email ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right text-gray-600">
                      {formatBytes(doc.size_bytes)}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">
                      {formatDateTime(doc.created_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function UploadForm({ onUploaded }: { onUploaded: () => void }) {
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [category, setCategory] = useState('general')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!file) {
      setMessage({ kind: 'error', text: 'Choose a file first.' })
      return
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setMessage({ kind: 'error', text: 'File exceeds the 4 MB limit.' })
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      const form = new FormData()
      form.append('file', file)
      form.append('category', category)
      // apiFetch redirects to /sign-in on 401
      const res = await apiFetch('/api/documents', { method: 'POST', body: form })
      if (res.status === 201) {
        setMessage({ kind: 'ok', text: `Uploaded ${file.name}.` })
        setFile(null)
        if (inputRef.current) inputRef.current.value = ''
        onUploaded()
      } else {
        setMessage({ kind: 'error', text: await readError(res, 'Upload failed') })
      }
    } catch {
      setMessage({ kind: 'error', text: 'Upload failed. Please try again.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <button type="button" className={buttonClass} onClick={() => setOpen(!open)}>
        {open ? 'Close' : 'Upload'}
      </button>
      {open && (
        <form
          onSubmit={submit}
          className="mt-4 max-w-md rounded-lg border border-gray-200 bg-white p-4"
        >
          <div>
            <label htmlFor="u-file" className={labelClass}>
              File
            </label>
            <input
              id="u-file"
              ref={inputRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.txt,.csv,.zip"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null)
                setMessage(null)
              }}
              className={`${inputClass} mt-1 w-full file:mr-3 file:rounded file:border-0 file:bg-gray-100 file:px-2 file:py-1 file:text-xs file:font-medium`}
            />
            <p className="mt-1 text-xs text-gray-500">
              PDF, image, txt, csv or zip — max 4 MB (also enforced server-side).
            </p>
          </div>
          <div className="mt-3">
            <label htmlFor="u-category" className={labelClass}>
              Category
            </label>
            <select
              id="u-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className={`${inputClass} mt-1 w-full`}
            >
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          {message && (
            <p
              className={
                message.kind === 'error'
                  ? 'mt-3 text-xs text-red-700'
                  : 'mt-3 text-xs text-green-700'
              }
            >
              {message.text}
            </p>
          )}
          <button type="submit" className={`${buttonClass} mt-4 w-full`} disabled={busy}>
            {busy ? 'Uploading…' : 'Upload'}
          </button>
        </form>
      )}
    </div>
  )
}
