const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 })

/** 40000 → "₹400", 12550 → "₹125.50" */
export function rupees(paise: number): string {
  const r = paise / 100
  return '₹' + (Number.isInteger(r) ? inr.format(r) : r.toFixed(2))
}
