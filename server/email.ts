// Owner alert emails through Resend (https://resend.com, free tier).
// Needs the RESEND_API_KEY Worker secret and the alert_email setting; without
// either, alerts are skipped and the order still goes through.

import type { Env } from './db'

export interface Email {
  subject: string
  text: string
  html: string
}

export async function sendOwnerEmail(env: Env, settings: Record<string, string>, email: Email): Promise<boolean> {
  const to = settings.alert_email?.trim()
  if (!env.RESEND_API_KEY || !to) {
    console.log('email skipped (RESEND_API_KEY or alert_email not set):', email.subject)
    return false
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: settings.alert_from?.trim() || 'MJ Kitchen <onboarding@resend.dev>',
      to: to.split(',').map((s) => s.trim()).filter(Boolean),
      subject: email.subject,
      text: email.text,
      html: email.html,
    }),
  })
  if (!res.ok) console.error('email failed', res.status, await res.text().catch(() => ''))
  return res.ok
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

/** Plain lines → a simple HTML email (each line a paragraph, blank lines kept as gaps). */
export function linesToHtml(lines: string[]): string {
  return (
    '<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#3a2a1e">' +
    lines.map((l) => (l === '' ? '<br>' : `<div>${esc(l).replace(/(https:\/\/\S+)/g, '<a href="$1">$1</a>')}</div>`)).join('') +
    '</div>'
  )
}
