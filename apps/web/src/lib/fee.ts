const PRICE = /\$\s?\d[\d,]*(?:\.\d{1,2})?(?:\s*[–-]\s*\$?\s?\d[\d,]*(?:\.\d{1,2})?)?/

/** Only a clear price: "Free", a dollar amount or range, or "Price varies". Otherwise nothing. */
export function cardFee(event: { is_free: boolean; fee_text: string | null }): string | null {
  if (event.is_free) return 'Free'
  const text = event.fee_text?.trim()
  if (!text) return null
  const price = text.match(PRICE)
  if (price) return price[0].replace(/\s+/g, ' ')
  return /\bvar(?:y|ies|ied|ious)\b/i.test(text) ? 'Price varies' : null
}
