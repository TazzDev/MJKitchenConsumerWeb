import { useState, type ReactNode } from 'react'
import { SETTING_RULES, type EditableSetting } from '../../shared/admin'
import { api } from '../api'
import { Button, Card, ErrorBox, Label, Loading, Page, Toggle, toast, useAction, useLoad, when } from '../ui'

type Values = Record<EditableSetting, string>

interface FieldDef {
  key: EditableSetting
  label: string
  hint?: string
  placeholder?: string
  inputMode?: 'numeric' | 'email' | 'tel' | 'text'
  long?: boolean
}

const SECTIONS: { title: string; intro?: string; fields: FieldDef[] }[] = [
  {
    title: 'Payment',
    intro: 'Customers pay to this UPI ID. A change shows up straight away, also on unpaid orders. Clearing the UPI ID turns online ordering off.',
    fields: [
      { key: 'upi_id', label: 'UPI ID', placeholder: 'name@oksbi' },
      { key: 'upi_payee_name', label: 'Payee name', hint: 'Exactly as your UPI app shows it.' },
    ],
  },
  {
    title: 'Order alerts',
    fields: [{ key: 'alert_email', label: 'Alert email', inputMode: 'email', hint: 'New orders and "I’ve paid" emails go here. Separate more than one with commas.' }],
  },
  {
    title: 'Meal ordering',
    fields: [
      { key: 'meal_cutoff_time', label: 'Orders close at', placeholder: '20:00', hint: 'Hyderabad time, 24-hour clock.' },
      { key: 'meal_min_days_ahead', label: 'Days before the meal date', inputMode: 'numeric', hint: '1 = orders for Saturday close on Friday at the time above.' },
      { key: 'meal_max_days_ahead', label: 'Book up to (days ahead)', inputMode: 'numeric' },
      { key: 'unpaid_timeout_minutes', label: 'Unpaid orders expire after (minutes)', inputMode: 'numeric', hint: 'Their portions go back on sale.' },
      { key: 'max_open_orders_per_phone', label: 'Unpaid orders allowed per phone', inputMode: 'numeric' },
    ],
  },
  {
    title: 'Contact and legal',
    fields: [
      { key: 'contact_whatsapp', label: 'WhatsApp number', inputMode: 'tel', placeholder: '919876543210', hint: '91 followed by the 10-digit number.' },
      { key: 'contact_phone', label: 'Phone for the call button', inputMode: 'tel', placeholder: '+919876543210' },
      { key: 'instagram_handle', label: 'Instagram handle', placeholder: 'mjkitchen_hyd' },
      { key: 'fssai_number', label: 'FSSAI number', inputMode: 'numeric', hint: '14 digits. Shown in the website footer once filled in; hidden while empty.' },
    ],
  },
]

export function SettingsPage({ name, onSignOut }: { name: string; onSignOut: () => void }) {
  const s = useLoad(() => api.settings(), [])
  return (
    <Page title="Settings">
      {s.error ? (
        <ErrorBox error={s.error} onRetry={() => s.reload()} />
      ) : !s.data ? (
        <Loading />
      ) : (
        <div className="space-y-4">
          <ShopOpen values={s.data.settings} onSaved={(v) => s.setData({ settings: v })} />
          {SECTIONS.map((sec) => (
            <Section key={sec.title} title={sec.title} intro={sec.intro} fields={sec.fields} values={s.data!.settings} onSaved={(v) => s.setData({ settings: v })} />
          ))}
        </div>
      )}
      <InstallHelp />
      <ChangeLog />
      <Card className="mt-4">
        <p className="text-sm">
          Signed in as <b>{name}</b>. Logins are managed in the Cloudflare dashboard (the <code>ADMIN_USERS</code> secret).
        </p>
        <Button
          tone="plain"
          className="mt-3"
          onClick={async () => {
            await api.logout().catch(() => {})
            onSignOut()
          }}
        >
          Sign out
        </Button>
      </Card>
    </Page>
  )
}

function ShopOpen({ values, onSaved }: { values: Values; onSaved: (v: Values) => void }) {
  const [message, setMessage] = useState(values.shop_closed_message)
  const { busy, run } = useAction()
  const open = values.shop_open !== '0'
  const save = async (patch: Partial<Values>, done: string) => {
    const out = await run('save', () => api.saveSettings(patch), done)
    if (out) onSaved(out.settings)
  }
  return (
    <Card className={open ? '' : 'border-spice/40'}>
      <Toggle
        checked={open}
        onChange={(on) => save({ shop_open: on ? '1' : '0' }, on ? 'Shop open' : 'Shop closed')}
        label={open ? 'Shop is open for orders' : 'Shop is closed: no new orders'}
      />
      {!open && (
        <div className="mt-3">
          <Label label="Message customers see">
            <input className="field" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Back on Monday!" />
          </Label>
          {message !== values.shop_closed_message && (
            <Button className="mt-2" busy={busy === 'save'} onClick={() => save({ shop_closed_message: message }, 'Saved')}>
              Save message
            </Button>
          )}
        </div>
      )}
    </Card>
  )
}

function Section({ title, intro, fields, values, onSaved }: { title: string; intro?: string; fields: FieldDef[]; values: Values; onSaved: (v: Values) => void }) {
  const [draft, setDraft] = useState<Partial<Values>>({})
  const { busy, run } = useAction()
  const changed = Object.entries(draft).filter(([k, v]) => v !== values[k as EditableSetting])
  const save = async () => {
    for (const [k, v] of changed) {
      const problem = SETTING_RULES[k as EditableSetting](v!.trim())
      if (problem) return toast(`${fields.find((f) => f.key === k)?.label} should be ${problem}.`, 'error')
    }
    const out = await run('save', () => api.saveSettings(Object.fromEntries(changed.map(([k, v]) => [k, v!.trim()]))), 'Saved')
    if (out) {
      onSaved(out.settings)
      setDraft({})
    }
  }
  return (
    <Card>
      <h2 className="mb-1 font-serif text-xl text-forest">{title}</h2>
      {intro && <p className="mb-3 text-xs">{intro}</p>}
      <div className="space-y-3">
        {fields.map((f) => (
          <Label key={f.key} label={f.label} hint={f.hint}>
            <input
              className="field"
              inputMode={f.inputMode}
              placeholder={f.placeholder}
              value={draft[f.key] ?? values[f.key]}
              onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
            />
          </Label>
        ))}
      </div>
      {changed.length > 0 && (
        <div className="mt-3 flex gap-2">
          <Button onClick={save} busy={busy === 'save'}>
            Save {title.toLowerCase()}
          </Button>
          <Button tone="plain" onClick={() => setDraft({})}>
            Undo
          </Button>
        </div>
      )}
    </Card>
  )
}

function InstallHelp() {
  const standalone = typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches
  if (standalone) return null
  return (
    <Card className="mt-4">
      <h2 className="mb-1 font-serif text-xl text-forest">Put it on your home screen</h2>
      <Steps>
        <li>
          <b>Android (Chrome):</b> tap the ⋮ menu, then <b>Add to Home screen</b> or <b>Install app</b>.
        </li>
        <li>
          <b>iPhone (Safari):</b> tap the Share button, then <b>Add to Home Screen</b>.
        </li>
      </Steps>
      <p className="mt-2 text-xs">It opens full screen with the green MJ icon, and you stay signed in for 30 days.</p>
    </Card>
  )
}

function Steps({ children }: { children: ReactNode }) {
  return <ul className="list-disc space-y-1 pl-5 text-sm">{children}</ul>
}

function ChangeLog() {
  const log = useLoad(() => api.log(), [])
  const [all, setAll] = useState(false)
  if (!log.data || log.data.entries.length === 0) return null
  const entries = all ? log.data.entries : log.data.entries.slice(0, 8)
  return (
    <Card className="mt-4">
      <h2 className="mb-2 font-serif text-xl text-forest">Recent changes</h2>
      <ul className="space-y-1.5 text-sm">
        {entries.map((e, i) => (
          <li key={i}>
            <span className="text-xs">
              {when(e.at)} · {e.user}
            </span>
            <span className="block">
              <b className="font-semibold">{e.action}:</b> {e.detail}
            </span>
          </li>
        ))}
      </ul>
      {!all && log.data.entries.length > 8 && (
        <button type="button" className="mt-2 text-sm font-semibold underline" onClick={() => setAll(true)}>
          Show more
        </button>
      )}
    </Card>
  )
}
