// Per-device conveniences. Everything is wrapped: storage can be blocked or empty.
export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem('s2s.' + key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export function save(key: string, value: unknown): void {
  try {
    localStorage.setItem('s2s.' + key, JSON.stringify(value))
  } catch {
    /* ignore */
  }
}


