export const PAGE_SIZE = 12

export function parsePage(raw: string | null): number {
  const page = Number(raw)
  return raw && /^\d+$/.test(raw) && Number.isSafeInteger(page * PAGE_SIZE) && page > 0 ? page : 1
}

export function pageRange(page: number): [number, number] {
  return [(page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1]
}

export function pageNumbers(page: number, total: number): number[] {
  return [...new Set([1, page - 1, page, page + 1, total])]
    .filter(n => n >= 1 && n <= total).sort((a, b) => a - b)
}
