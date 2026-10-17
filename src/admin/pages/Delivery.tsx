import { useState } from 'react'
import { parsePincodes, PINCODE_LIST_RE, type AdminZone } from '../../shared/admin'
import { rupees } from '../../shared/money'
import { api, type ZoneBody } from '../api'
import { Button, Card, ErrorBox, Label, Loading, Page, paiseToText, toast, toPaise, Toggle, useAction, useLoad } from '../ui'

export function DeliveryPage() {
  const zones = useLoad(() => api.zones(), [])
  const [adding, setAdding] = useState(false)
  const onZones = (z: { zones: AdminZone[] }) => zones.setData(z)

  return (
    <Page title="Delivery">
      <p className="mb-3 text-sm">
        Customers can only order to the pincodes listed here, and pay that area's delivery charge. Each pincode can be in one area only.
      </p>
      {zones.error ? (
        <ErrorBox error={zones.error} onRetry={() => zones.reload()} />
      ) : !zones.data ? (
        <Loading />
      ) : (
        <div className="space-y-3">
          {zones.data.zones.map((z) => (
            <ZoneCard key={z.id} z={z} onSaved={onZones} />
          ))}
          {adding ? (
            <ZoneForm
              initial={{ name: '', pincodes: '', feePaise: 0, allowsMeals: true, isActive: true }}
              title="New delivery area"
              onCancel={() => setAdding(false)}
              onSave={async (body) => {
                const out = await api.addZone(body)
                onZones(out)
                setAdding(false)
              }}
            />
          ) : (
            <Button tone="plain" className="w-full" onClick={() => setAdding(true)}>
              + Add a delivery area
            </Button>
          )}
        </div>
      )}
      <FreeDelivery />
    </Page>
  )
}

function ZoneCard({ z, onSaved }: { z: AdminZone; onSaved: (z: { zones: AdminZone[] }) => void }) {
  const [editing, setEditing] = useState(false)
  const { run } = useAction()
  if (editing) {
    return (
      <ZoneForm
        initial={{ name: z.name, pincodes: z.pincodes.join(', '), feePaise: z.feePaise, allowsMeals: z.allowsMeals, isActive: z.isActive }}
        title={`Edit ${z.name}`}
        onCancel={() => setEditing(false)}
        onSave={async (body) => {
          onSaved(await api.saveZone(z.id, body))
          setEditing(false)
        }}
        onDelete={async () => {
          if (!window.confirm(`Delete ${z.name}? Customers in its pincodes won't be able to order. Old orders aren't affected.`)) return
          const out = await run('delete', () => api.deleteZone(z.id), 'Area deleted')
          if (out) onSaved(out)
        }}
      />
    )
  }
  return (
    <Card className={z.isActive ? '' : 'opacity-60'}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-forest">
            {z.name} {!z.isActive && <span className="text-xs font-normal">(off)</span>}
          </p>
          <p className="font-serif text-xl text-forest">{z.feePaise === 0 ? 'Free delivery' : rupees(z.feePaise)}</p>
          <p className="text-xs">
            {z.pincodes.length} pincode{z.pincodes.length === 1 ? '' : 's'} · {z.allowsMeals ? 'pickles and meals' : 'pickles only'}
          </p>
          <p className="mt-1 line-clamp-2 text-xs break-words">{z.pincodes.join(', ')}</p>
        </div>
        <Button tone="plain" className="px-3 py-1.5" onClick={() => setEditing(true)}>
          Edit
        </Button>
      </div>
    </Card>
  )
}

function ZoneForm({
  initial,
  title,
  onSave,
  onCancel,
  onDelete,
}: {
  initial: Omit<ZoneBody, 'feePaise'> & { feePaise: number }
  title: string
  onSave: (body: ZoneBody) => Promise<void>
  onCancel: () => void
  onDelete?: () => void
}) {
  const [name, setName] = useState(initial.name)
  const [pincodes, setPincodes] = useState(initial.pincodes)
  const [fee, setFee] = useState(paiseToText(initial.feePaise))
  const [allowsMeals, setAllowsMeals] = useState(initial.allowsMeals)
  const [isActive, setIsActive] = useState(initial.isActive)
  const { busy, run } = useAction()

  const list = parsePincodes(pincodes)
  const wrong = list.filter((p) => !PINCODE_LIST_RE.test(p))

  const save = () => {
    const feePaise = toPaise(fee)
    if (feePaise === null) return toast('Enter the delivery charge in rupees (0 for free).', 'error')
    void run('save', () => onSave({ name, pincodes: list.join(','), feePaise, allowsMeals, isActive }), 'Saved')
  }

  return (
    <Card className="border-forest/40">
      <p className="mb-3 font-semibold text-forest">{title}</p>
      <div className="space-y-3">
        <Label label="Area name">
          <input className="field" placeholder="e.g. Kukatpally, Miyapur" value={name} onChange={(e) => setName(e.target.value)} />
        </Label>
        <Label label="Delivery charge ₹">
          <input className="field" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} />
        </Label>
        <Label
          label="Pincodes"
          hint={
            wrong.length ? (
              <span className="text-spice">Not 6-digit pincodes: {wrong.slice(0, 5).join(', ')}</span>
            ) : (
              `${list.length} pincode${list.length === 1 ? '' : 's'}. Separate with commas, spaces or new lines.`
            )
          }
        >
          <textarea className="field min-h-24 font-mono text-sm" value={pincodes} onChange={(e) => setPincodes(e.target.value)} />
        </Label>
        <Toggle checked={allowsMeals} onChange={setAllowsMeals} label={allowsMeals ? 'Delivers meals and pickles' : 'Pickles only (no meals here)'} />
        <Toggle checked={isActive} onChange={setIsActive} label={isActive ? 'On: customers can order here' : 'Off: not delivering here for now'} />
        <div className="flex flex-wrap gap-2">
          <Button onClick={save} busy={busy === 'save'} disabled={wrong.length > 0}>
            Save
          </Button>
          <Button tone="plain" onClick={onCancel}>
            Cancel
          </Button>
          {onDelete && (
            <Button tone="danger" className="ml-auto" onClick={onDelete}>
              Delete
            </Button>
          )}
        </div>
      </div>
    </Card>
  )
}

function FreeDelivery() {
  const s = useLoad(() => api.settings(), [])
  const [value, setValue] = useState<string | null>(null)
  const { busy, run } = useAction()
  if (!s.data) return null
  const saved = s.data.settings.free_delivery_above_paise
  const current = value ?? (saved ? paiseToText(Number(saved)) : '')
  const save = async () => {
    const paise = current.trim() === '' ? '' : toPaise(current)
    if (paise === null) return toast('Enter an amount in rupees, or leave empty for off.', 'error')
    const out = await run('save', () => api.saveSettings({ free_delivery_above_paise: String(paise) }), 'Saved')
    if (out) {
      s.setData(out)
      setValue(null)
    }
  }
  return (
    <Card className="mt-6">
      <Label label="Free delivery above ₹" hint="Orders with food worth at least this much get free delivery. Leave empty to turn it off.">
        <input className="field" inputMode="decimal" placeholder="Off" value={current} onChange={(e) => setValue(e.target.value)} />
      </Label>
      {value !== null && (
        <Button className="mt-2" onClick={save} busy={busy === 'save'}>
          Save
        </Button>
      )}
    </Card>
  )
}
