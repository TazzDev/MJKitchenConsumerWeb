import { useEffect, useState, type ReactNode } from 'react'
import { SETTING_RULES, type EditableSetting } from '../../shared/admin'
import { rupees } from '../../shared/money'
import { PERSONAL_UPI_LINK_LIMIT_PAISE } from '../../shared/orders'
import { api } from '../api'
import { blockedHelp, currentSubscription, deviceName, pushSupport, subscribe } from '../push'
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
    title: 'Alert emails',
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
  {
    title: 'Bot check (Turnstile)',
    intro:
      'The site key from Cloudflare → Turnstile. Its secret key must be the TURNSTILE_SECRET Worker secret from the same widget, or every order is refused.',
    fields: [{ key: 'turnstile_site_key', label: 'Turnstile site key', placeholder: '0x4AAAA…' }],
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
          <PushAlerts />
          {SECTIONS.map((sec, i) => (
            <div key={sec.title} className="space-y-4">
              <Section title={sec.title} intro={sec.intro} fields={sec.fields} values={s.data!.settings} onSaved={(v) => s.setData({ settings: v })} />
              {i === 0 && <UpiBusiness values={s.data!.settings} onSaved={(v) => s.setData({ settings: v })} />}
            </div>
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

function PushAlerts() {
  const support = pushSupport()
  const server = useLoad(() => api.push(), [])
  const [sub, setSub] = useState<PushSubscription | null | undefined>(undefined)
  const { busy, run } = useAction()

  useEffect(() => {
    currentSubscription().then(setSub, () => setSub(null))
  }, [])

  // This phone is subscribed but the server lost it (e.g. it was turned off elsewhere): sign it up again.
  const mine = sub ? server.data?.devices.find((d) => d.endpoint === sub.endpoint) : undefined
  useEffect(() => {
    if (sub && server.data && !mine) api.pushSubscribe(sub.toJSON(), deviceName()).then(() => server.reload(), console.error)
  }, [sub, server.data, mine])

  const turnOn = async () => {
    const out = await run(
      'on',
      async () => {
        const s = await subscribe(server.data!.publicKey)
        await api.pushSubscribe(s.toJSON(), deviceName())
        return s
      },
      'Alerts on for this phone',
    )
    if (out) {
      setSub(out)
      server.reload()
    }
  }
  const turnOff = async () => {
    if (!sub) return
    const out = await run(
      'off',
      async () => {
        await api.pushUnsubscribe(sub.endpoint)
        await sub.unsubscribe()
        return true
      },
      'Alerts off for this phone',
    )
    if (out) {
      setSub(null)
      server.reload()
    }
  }

  let body: ReactNode
  if (support === 'iphone-needs-home-screen') {
    body = (
      <p className="text-sm">
        On iPhone, alerts only work in the home-screen app (iOS 16.4 or later). In <b>Safari</b>, tap Share → <b>Add to Home Screen</b>, open <b>MJ Admin</b>{' '}
        from the icon, sign in, and come back here.
      </p>
    )
  } else if (support === 'unsupported') {
    body = <p className="text-sm">This browser can’t show alerts. Use Chrome on Android, or the home-screen app on iPhone.</p>
  } else if (server.error) {
    body = <ErrorBox error={server.error} onRetry={() => server.reload()} />
  } else if (sub === undefined || !server.data) {
    body = <Loading />
  } else if (sub) {
    body = (
      <>
        <p className="text-sm">
          <b>On for this phone.</b> You’ll get a notification for every new order and every “I’ve paid”.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button busy={busy === 'test'} onClick={() => run('test', () => api.pushTest(sub.endpoint), 'Test sent: it should pop up in a few seconds')}>
            Send a test
          </Button>
          <Button tone="plain" busy={busy === 'off'} onClick={turnOff}>
            Turn off
          </Button>
        </div>
      </>
    )
  } else if (Notification.permission === 'denied') {
    body = <p className="text-sm">{blockedHelp()}</p>
  } else {
    body = (
      <>
        <p className="text-sm">Get a notification on this phone for every new order and every “I’ve paid”, even when the app is closed.</p>
        <Button className="mt-3" busy={busy === 'on'} onClick={turnOn}>
          Turn on alerts
        </Button>
      </>
    )
  }

  const devices = server.data?.devices ?? []
  return (
    <Card>
      <h2 className="mb-1 font-serif text-xl text-forest">Order alerts on this phone</h2>
      {body}
      {devices.length > 0 && (
        <div className="mt-4 border-t border-earth/15 pt-3">
          <p className="mb-1 text-xs font-semibold text-forest">Getting alerts</p>
          <ul className="space-y-1 text-sm">
            {devices.map((d) => (
              <li key={d.endpoint}>
                <b className="font-semibold">{d.user}</b> · {d.device || 'a phone'}
                {d.endpoint === sub?.endpoint ? ' (this phone)' : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}

function UpiBusiness({ values, onSaved }: { values: Values; onSaved: (v: Values) => void }) {
  const { run } = useAction()
  const business = values.upi_is_business === '1'
  const save = async (on: boolean) => {
    const out = await run('save', () => api.saveSettings({ upi_is_business: on ? '1' : '0' }), 'Saved')
    if (out) onSaved(out.settings)
  }
  return (
    <Card>
      <Toggle checked={business} onChange={save} label="This is a business (merchant) UPI ID" />
      <p className="mt-2 text-sm">
        {business
          ? 'The payment page leads with the GPay, PhonePe and Paytm buttons.'
          : `Payment apps often refuse the GPay, PhonePe and Paytm buttons for a personal UPI ID, so the payment page leads with paying by UPI ID and hides the buttons above ${rupees(PERSONAL_UPI_LINK_LIMIT_PAISE)}. Turn this on once the UPI ID above is a business one (GPay, PhonePe or Paytm for Business).`}
      </p>
    </Card>
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
