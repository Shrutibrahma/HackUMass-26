import { load, save } from './storage'

// Optional access key: opened once as /?key=..., then remembered on this device.
const urlKey = new URLSearchParams(location.search).get('key')
if (urlKey) save('key', urlKey)
const accessKey = (): string => load<string>('key', '')

export function withKey(path: string): string {
  const k = accessKey()
  return k ? `${path}${path.includes('?') ? '&' : '?'}key=${encodeURIComponent(k)}` : path
}

export class ApiError extends Error {}
/** The request never got an answer (it may or may not have reached the server). */
export class NetworkError extends ApiError {}

export function newRequestId(): string {
  try { return crypto.randomUUID() } catch { return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2)}` }
}

export async function post<T = any>(path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(withKey(path), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new NetworkError("Couldn't reach the server. Check your connection.")
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(typeof data.detail === 'string' ? data.detail : 'Something went wrong. Please try again.')
  return data as T
}

/** multipart/form-data POST (file uploads). Same error handling as post(). */
export async function postForm<T = any>(path: string, form: FormData): Promise<T> {
  let res: Response
  try {
    res = await fetch(withKey(path), { method: 'POST', body: form })
  } catch {
    throw new NetworkError("Couldn't reach the server. Check your connection.")
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(typeof data.detail === 'string' ? data.detail : 'Something went wrong. Please try again.')
  return data as T
}

type Handler = (msg: any) => void

/** One socket to the server. Reconnects forever; the server resends live calls on connect. */
export class Live {
  private ws: WebSocket | null = null
  private retry = 0
  private timer: number | undefined
  private hello: () => unknown
  onMessage: Handler = () => {}
  onStatus: (up: boolean) => void = () => {}

  constructor(hello: () => unknown) {
    this.hello = hello
  }

  connect(): void {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(withKey(`${proto}://${location.host}/ws/app`))
    this.ws = ws
    ws.onopen = () => {
      this.retry = 0
      this.onStatus(true)
      this.send(this.hello())
    }
    ws.onmessage = (e) => {
      try {
        this.onMessage(JSON.parse(e.data))
      } catch {
        /* ignore malformed */
      }
    }
    ws.onclose = () => {
      this.onStatus(false)
      const wait = Math.min(5000, 300 * 2 ** this.retry++)
      this.timer = window.setTimeout(() => this.connect(), wait)
    }
    ws.onerror = () => ws.close()
  }

  send(msg: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg))
  }

  close(): void {
    clearTimeout(this.timer)
    if (this.ws) {
      this.ws.onclose = null
      this.ws.close()
    }
  }
}


