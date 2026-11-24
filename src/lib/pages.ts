export class IncompleteResultError extends Error {
  constructor() {
    super('incomplete')
    this.name = 'IncompleteResultError'
  }
}

/**
 * Reads fixed-size pages until a short page, which is the end.
 * A full final page at the hard cap is an error: the caller must not treat
 * a truncated list as the directory.
 */
export async function collectPages<T>(
  fetchPage: (from: number, to: number, signal: AbortSignal) => Promise<T[]>,
  signal: AbortSignal,
  pageSize = 1000,
  maxPages = 50,
): Promise<T[]> {
  const all: T[] = []
  for (let page = 0; page < maxPages; page += 1) {
    if (signal.aborted) throw new DOMException('aborted', 'AbortError')
    const from = page * pageSize
    const to = from + pageSize - 1
    const rows = await fetchPage(from, to, signal)
    if (rows.length > pageSize) throw new IncompleteResultError()
    all.push(...rows)
    if (rows.length < pageSize) return all
  }
  throw new IncompleteResultError()
}
