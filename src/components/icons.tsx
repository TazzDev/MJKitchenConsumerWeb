// Small SVG icons rebuilt from the branding kit's social and contact row (green disc, cream glyph).
import type { ReactNode } from 'react'

function Disc({ children, label, size = 40 }: { children: ReactNode; label: string; size?: number }) {
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} role="img" aria-label={label}>
      <circle cx="20" cy="20" r="20" fill="#234734" />
      <g fill="none" stroke="#F2E5C8" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </g>
    </svg>
  )
}

export const InstagramIcon = (p: { size?: number }) => (
  <Disc label="Instagram" {...p}>
    <rect x="11" y="11" width="18" height="18" rx="5.5" />
    <circle cx="20" cy="20" r="4.3" />
    <circle cx="25" cy="15" r="0.6" fill="#F2E5C8" />
  </Disc>
)

export const WhatsAppIcon = (p: { size?: number }) => (
  <Disc label="WhatsApp" {...p}>
    <path d="M12.5 28l1.3-4.4A9 9 0 1 1 17 27z" />
    <path d="M17.3 16.6c.3 2.6 2.9 5.3 5.9 6.1l1.2-1.4-1.9-1-1 .8c-1-.5-1.9-1.4-2.4-2.4l.8-1-1-1.9z" fill="#F2E5C8" strokeWidth="1" />
  </Disc>
)

export const PhoneIcon = (p: { size?: number }) => (
  <Disc label="Phone" {...p}>
    <path
      d="M15.2 11.5l2.4 3.8-1.8 1.8a11 11 0 0 0 7.1 7.1l1.8-1.8 3.8 2.4-1.5 2.8c-.6.5-1.4.7-2.2.5A16 16 0 0 1 12.4 15.7c-.2-.8 0-1.6.5-2.2z"
      fill="#F2E5C8"
      strokeWidth="1"
    />
  </Disc>
)

export const LocationIcon = (p: { size?: number }) => (
  <Disc label="Location" {...p}>
    <path d="M20 29s-6.5-6.4-6.5-11.2a6.5 6.5 0 0 1 13 0C26.5 22.6 20 29 20 29z" />
    <circle cx="20" cy="17.8" r="2.3" />
  </Disc>
)

export function CartIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 8h14l-1.3 10.2a2 2 0 0 1-2 1.8H8.3a2 2 0 0 1-2-1.8z" />
      <path d="M9 8V6.5a3 3 0 0 1 6 0V8" />
    </svg>
  )
}

/** Indian food-type mark: green dot for veg, red triangle for non-veg. */
export function FoodMark({ veg }: { veg: boolean }) {
  const c = veg ? '#2f7a3a' : '#8B2E20'
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" role="img" aria-label={veg ? 'Vegetarian' : 'Non-vegetarian'} className="shrink-0">
      <rect x="1" y="1" width="14" height="14" rx="2" fill="none" stroke={c} strokeWidth="1.6" />
      {veg ? <circle cx="8" cy="8" r="3.6" fill={c} /> : <path d="M8 4l4 7H4z" fill={c} />}
    </svg>
  )
}

const SPICE = ['Not spicy', 'Mild', 'Medium spicy', 'Hot']
export function Spice({ level }: { level: number }) {
  if (level <= 0) return null
  return (
    <span className="inline-flex items-center gap-0.5 text-xs text-spice" title={SPICE[level]}>
      {Array.from({ length: level }, (_, i) => (
        <svg key={i} viewBox="0 0 12 16" width="9" height="12" aria-hidden="true">
          <path d="M7 1c0 2 1.5 2 1.5 3.5C8.5 10 5 15 2 15c-1 0-1-1 0-1.5C4 12 4.5 8 5 4.5 5.3 3 6 2.5 7 1z" fill="#8B2E20" />
        </svg>
      ))}
      <span className="sr-only">{SPICE[level]}</span>
    </span>
  )
}
