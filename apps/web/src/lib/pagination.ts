export const PAGE_SIZE = 12

export function pageRange(page: number): [number, number] {
  return [(page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1]
}

export function nextPage(last: { page: number; total: number; items: unknown[] }): number | undefined {
  return last.items.length > 0 && last.page * PAGE_SIZE < last.total ? last.page + 1 : undefined
}
