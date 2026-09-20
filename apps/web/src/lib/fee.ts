const PRICE = /\$\s?\d[\d,]*(?:\.\d{1,2})?(?:\s*[–-]\s*\$?\s?\d[\d,]*(?:\.\d{1,2})?)?/

/** Short fee text for the event card: "Free", a price or price range, or nothing. */
export function cardFee(event: { is_free: boolean; fee_text: string | null }): string | null {
  if (event.is_free) return 'Free'
  const text = event.fee_text?.trim()
  if (!text) return null
  const price = text.match(PRICE)
  if (price) return price[0].replace(/\s+/g, ' ')
  // Long prose ("Varies by workshops and courses.") does not fit on a poster corner.
  return text.length <= 20 ? text : null
}
