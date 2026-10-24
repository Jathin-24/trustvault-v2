'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import {
  apiFetch,
  formatDateTime,
  jsonHeaders,
  readError,
  shortId,
  type AdminUser,
  type AuditEntry,
  type Me,
} from '@/components/api'

type Tab = 'audit' | 'verify' | 'users'

const inputClass =
  'rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-500 focus:outline-none'
const labelClass = 'block text-xs font-medium text-gray-600'
const buttonClass =
  'rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-700 disabled:opacity-50'

const AUDIT_ACTIONS = [
  'upload',
  'download',
  'update',
  'delete',
  'grant',
  'revoke',
  'role_change',
  'deactivate',
  'admin_access',
] as const

export default function AdminPage() {
  const [me, setMe] = useState<Me | null>(null)
  const [tab, setTab] = useState<Tab>('audit')
  const [accessDenied, setAccessDenied] = useState(false)

  useEffect(() => {
    apiFetch('/api/me')
      .then(async (res) => {
        if (res.ok) {
          const data = (await res.json()) as Me
          setMe(data)
          if (data.role !== 'admin') setAccessDenied(true)
        } else {
          // non-admins get 404 from /api/admin/* — mirror that here
          setAccessDenied(true)
        }
      })
      .catch(() => setAccessDenied(true))
  }, [])

  if (accessDenied) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-24 text-center">
        <h1 className="text-2xl font-bold">Admins only</h1>
        <p className="mt-3 text-gray-600">
          You don&apos;t have admin access. Ask an administrator if you think this is a mistake.
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

  const tabs: { key: Tab; label: string }[] = [
    { key: 'audit', label: 'Audit log' },
    { key: 'verify', label: 'Chain verify' },
    { key: 'users', label: 'Users' },
  ]

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <h1 className="text-2xl font-bold">Admin</h1>

      <div className="mt-4 flex gap-1 border-b border-gray-200">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={
              tab === t.key
                ? 'border-b-2 border-gray-900 px-4 py-2 text-sm font-medium text-gray-900'
                : 'border-b-2 border-transparent px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-900'
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-6">
        {!me && <p className="text-sm text-gray-500">Checking access…</p>}
        {me && tab === 'audit' && <AuditTab />}
        {me && tab === 'verify' && <VerifyTab />}
        {me && tab === 'users' && <UsersTab meId={me.id} />}
      </div>
    </div>
  )
}

function AuditTab() {
  const [action, setAction] = useState('')
  const [outcome, setOutcome] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [entries, setEntries] = useState<AuditEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const params = new URLSearchParams()
    if (action) params.set('action', action)
    if (outcome) params.set('outcome', outcome)
    if (from) params.set('from', from)
    if (to) params.set('to', to)

    let cancelled = false
    apiFetch(`/api/admin/audit?${params.toString()}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(await readError(res, 'Failed to load audit log'))
        const data = (await res.json()) as { entries: AuditEntry[] }
        if (!cancelled) {
          setEntries(data.entries)
          setError(null)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setEntries(null)
          setError(err instanceof Error ? err.message : 'Failed to load audit log')
        }
      })
    return () => {
      cancelled = true
    }
  }, [action, outcome, from, to, reloadKey])

  return (
    <div>
      <form
        className="rounded-lg border border-gray-200 bg-white p-4"
        onSubmit={(e) => {
          e.preventDefault()
          setReloadKey((k) => k + 1)
        }}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label htmlFor="a-action" className={labelClass}>
              Action
            </label>
            <select
              id="a-action"
              value={action}
              onChange={(e) => setAction(e.target.value)}
              className={`${inputClass} mt-1 w-full`}
            >
              <option value="">Any</option>
              {AUDIT_ACTIONS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="a-outcome" className={labelClass}>
              Outcome
            </label>
            <select
              id="a-outcome"
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              className={`${inputClass} mt-1 w-full`}
            >
              <option value="">Any</option>
              <option value="allowed">allowed</option>
              <option value="denied">denied</option>
            </select>
          </div>
          <div>
            <label htmlFor="a-from" className={labelClass}>
              From
            </label>
            <input
              id="a-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className={`${inputClass} mt-1 w-full`}
            />
          </div>
          <div>
            <label htmlFor="a-to" className={labelClass}>
              To
            </label>
            <input
              id="a-to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className={`${inputClass} mt-1 w-full`}
            />
          </div>
        </div>
      </form>

      <div className="mt-6">
        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {!error && entries === null && <p className="text-sm text-gray-500">Loading…</p>}

        {!error && entries !== null && entries.length === 0 && (
          <p className="text-sm text-gray-500">No audit entries match these filters.</p>
        )}

        {!error && entries !== null && entries.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-2.5">ID</th>
                  <th className="px-4 py-2.5">When</th>
                  <th className="px-4 py-2.5">Actor</th>
                  <th className="px-4 py-2.5">Action</th>
                  <th className="px-4 py-2.5">Outcome</th>
                  <th className="px-4 py-2.5">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 align-top">
                {entries.map((e) => (
                  <tr key={e.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-mono text-xs text-gray-500">{e.id}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-gray-600">
                      {formatDateTime(e.created_at)}
                    </td>
                    <td className="px-4 py-2.5 font-mono text-xs text-gray-600" title={e.actor_id ?? ''}>
                      {shortId(e.actor_id)}
                    </td>
                    <td className="px-4 py-2.5 font-medium text-gray-900">{e.action}</td>
                    <td className="px-4 py-2.5">
                      <span
                        className={
                          e.outcome === 'denied'
                            ? 'rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800'
                            : 'rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800'
                        }
                      >
                        {e.outcome}
                      </span>
                    </td>
                    <td className="max-w-md px-4 py-2.5">
                      <pre className="whitespace-pre-wrap break-all font-mono text-xs text-gray-600">
                        {e.details === null || e.details === undefined
                          ? '—'
                          : JSON.stringify(e.details, null, 2)}
                      </pre>
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

type VerifyResult = { valid: boolean; first_bad_id: number | null }

function VerifyTab() {
  const [result, setResult] = useState<VerifyResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const verify = useCallback(() => {
    setBusy(true)
    setError(null)
    apiFetch('/api/admin/audit/verify')
      .then(async (res) => {
        if (!res.ok) throw new Error(await readError(res, 'Verify failed'))
        setResult((await res.json()) as VerifyResult)
      })
      .catch((err: unknown) => {
        setResult(null)
        setError(err instanceof Error ? err.message : 'Verify failed')
      })
      .finally(() => setBusy(false))
  }, [])

  return (
    <div className="max-w-xl">
      <p className="text-sm text-gray-600">
        Recomputes the hash chain over the audit log and checks every link.
      </p>
      <button type="button" className={`${buttonClass} mt-4`} onClick={verify} disabled={busy}>
        {busy ? 'Verifying…' : 'Verify chain'}
      </button>

      {error && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {result && result.valid && (
        <div className="mt-4 rounded-md bg-green-100 px-4 py-3 text-lg font-semibold text-green-900">
          Chain valid
        </div>
      )}

      {result && !result.valid && (
        <div className="mt-4 rounded-md bg-red-100 px-4 py-3 text-lg font-semibold text-red-900">
          Chain broken at row {result.first_bad_id ?? '?'}
        </div>
      )}
    </div>
  )
}

function UsersTab({ meId }: { meId: string }) {
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(() => {
    apiFetch('/api/admin/users')
      .then(async (res) => {
        if (!res.ok) throw new Error(await readError(res, 'Failed to load users'))
        const data = (await res.json()) as { users: AdminUser[] }
        setUsers(data.users)
        setError(null)
      })
      .catch((err: unknown) => {
        setUsers(null)
        setError(err instanceof Error ? err.message : 'Failed to load users')
      })
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function patch(user: AdminUser, patchBody: Partial<Pick<AdminUser, 'role' | 'active'>>) {
    setBusyId(user.id)
    setError(null)
    try {
      const res = await apiFetch('/api/admin/users', {
        method: 'PATCH',
        headers: jsonHeaders(),
        body: JSON.stringify({ user_id: user.id, ...patchBody }),
      })
      if (!res.ok) {
        setError(await readError(res, 'Update failed'))
      }
    } catch {
      setError('Update failed. Please try again.')
    } finally {
      setBusyId(null)
      load()
    }
  }

  return (
    <div>
      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {!users && !error && <p className="text-sm text-gray-500">Loading…</p>}

      {users && (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
              <tr>
                <th className="px-4 py-2.5">Email</th>
                <th className="px-4 py-2.5">Name</th>
                <th className="px-4 py-2.5">Role</th>
                <th className="px-4 py-2.5">Active</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {users.map((u) => {
                const self = u.id === meId
                return (
                  <tr key={u.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-medium text-gray-900">
                      {u.email}
                      {self && <span className="ml-2 text-xs text-gray-400">(you)</span>}
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">{u.name ?? '—'}</td>
                    <td className="px-4 py-2.5">
                      <select
                        value={u.role}
                        disabled={self || busyId === u.id}
                        onChange={(e) => {
                          const role = e.target.value === 'admin' ? 'admin' : 'member'
                          patch(u, { role })
                        }}
                        className={inputClass}
                      >
                        <option value="admin">admin</option>
                        <option value="member">member</option>
                      </select>
                    </td>
                    <td className="px-4 py-2.5">
                      <label className="flex items-center gap-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={u.active}
                          disabled={self || busyId === u.id}
                          onChange={(e) => patch(u, { active: e.target.checked })}
                          className="h-4 w-4 rounded border-gray-300"
                        />
                        {busyId === u.id ? 'Saving…' : u.active ? 'Yes' : 'No'}
                      </label>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="border-t border-gray-100 px-4 py-2.5 text-xs text-gray-500">
            You cannot change your own role or deactivate your account (also enforced by the
            server).
          </p>
        </div>
      )}
    </div>
  )
}
