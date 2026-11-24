import { getAuthToken } from 'deepspace'

/** Calls a server action with the session bearer token; throws the action's own error text. */
export async function callAction<T = unknown>(name: string, params: Record<string, unknown>): Promise<T> {
  const token = await getAuthToken()
  const res = await fetch(`/api/actions/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(params),
  })
  const body = (await res.json().catch(() => null)) as
    | { success: true; data: T }
    | { success: false; error?: string }
    | { error?: string }
    | null
  if (!res.ok || !body || !('success' in body) || !body.success) {
    throw new Error((body && 'error' in body && body.error) || `Request failed (${res.status})`)
  }
  return body.data
}
