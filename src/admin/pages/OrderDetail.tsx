import { useEffect, useState } from 'react'
import { OWNER_MOVES, ownerStatusLabel, type AdminOrderDetail, type MoveCheckResult } from '../../shared/admin'
import { formatDate, istToday } from '../../shared/dates'
import { rupees } from '../../shared/money'
import { formatWhen, parseDateMove, type OrderStatus } from '../../shared/orders'
import type { Slot } from '../../shared/types'
import { api } from '../api'
import { Button, Card, DateChangedBadge, ErrorBox, go, Loading, Page, StatusBadge, useAction, useLoad, when, slotName } from '../ui'

const REJECT_REASONS = ['Payment not found in UPI app', 'Amount paid is different', 'UTR doesn’t match']

export function OrderDetailPage({ code }: { code: string }) {
  const order = useLoad(() => api.order(code), [code], { refreshMs: 30_000 })
  const { busy, run } = useAction()
  const [rejecting, setRejecting] = useState(false)
  const [changingDate, setChangingDate] = useState(false)

  if (order.error) return <Page title={code}><ErrorBox error={order.error} onRetry={() => order.reload()} /></Page>
  if (!order.data) return <Page title={code}><Loading /></Page>
  const o = order.data

  const move = async (to: OrderStatus, note = '') => {
    if (to === 'cancelled' && !window.confirm(`Cancel order ${o.code}? Its meal portions go back on sale.`)) return
    const fresh = await run(to, () => api.setStatus(o.code, o.status, to, note), `Marked ${ownerStatusLabel(to, o.hasMeals).toLowerCase()}`)
    if (fresh) {
      order.setData(fresh)
      setRejecting(false)
    }
  }

  const moves = OWNER_MOVES[o.status] ?? []
  const firstName = o.customerName.split(' ')[0]

  return (
    <Page
      title={o.code}
      actions={
        <Button tone="plain" className="px-3 py-1.5" onClick={() => (history.length > 1 ? history.back() : go('/orders'))}>
          Back
        </Button>
      }
    >
      <Card>
        <div className="flex items-start justify-between gap-3">
          <div>
            <StatusBadge status={o.status} hasMeals={o.hasMeals} />
            <p className="mt-2 font-serif text-3xl text-forest">{rupees(o.totalPaise)}</p>
            <p className="text-xs">Placed {when(o.createdAt)}</p>
          </div>
          <div className="text-right text-sm font-semibold text-forest">
            {o.deliveryDate && o.deliverySlot ? (
              <>
                {formatDate(o.deliveryDate)}
                <br />
                {slotName(o.deliverySlot)}
                {o.originalDate && (
                  <span className="mt-1 block">
                    <DateChangedBadge />
                    <span className="mt-0.5 block text-xs font-normal">was {formatWhen(o.originalDate)}</span>
                  </span>
                )}
              </>
            ) : (
              'Pickles only'
            )}
          </div>
        </div>

        {(o.status === 'payment_submitted' || o.utr) && (
          <div className="mt-3 rounded-xl bg-cream px-3 py-2 text-sm">
            {o.utr ? (
              <p>
                UPI reference (UTR): <span className="font-mono font-semibold tracking-wide text-forest">{o.utr}</span>
              </p>
            ) : (
              <p className="font-semibold">No reference number: match it by amount, time and “{o.code}” in the note.</p>
            )}
            <p className="text-xs">
              Paid to {o.upiId}
              {o.paidAt && ` · customer said paid ${when(o.paidAt)}`}
            </p>
          </div>
        )}
        {o.status === 'awaiting_payment' && o.expiresAt && <p className="mt-2 text-xs">Expires {when(o.expiresAt)} if not paid.</p>}

        {(moves.length > 0 || o.canChangeDate) && (
          <div className="mt-4 grid gap-2">
            {moves.includes('confirmed') && (
              <Button onClick={() => move('confirmed')} busy={busy === 'confirmed'} className="py-3 text-base">
                {o.status === 'expired' ? 'Paid late: confirm anyway' : 'Payment received ✓'}
              </Button>
            )}
            {moves.includes('preparing') && (
              <Button onClick={() => move('preparing')} busy={busy === 'preparing'}>
                Start preparing
              </Button>
            )}
            {moves.includes('out_for_delivery') && (
              <Button onClick={() => move('out_for_delivery')} busy={busy === 'out_for_delivery'}>
                {o.hasMeals ? 'Out for delivery' : 'Shipped'}
              </Button>
            )}
            {moves.includes('delivered') && (
              <Button tone={moves.includes('out_for_delivery') ? 'plain' : 'primary'} onClick={() => move('delivered')} busy={busy === 'delivered'}>
                Delivered
              </Button>
            )}
            {moves.includes('payment_rejected') &&
              (rejecting ? (
                <div className="space-y-2 rounded-xl border border-spice/30 p-3">
                  <p className="text-sm font-semibold text-spice">Why? The customer is asked to pay again.</p>
                  {REJECT_REASONS.map((r) => (
                    <Button key={r} tone="danger" className="w-full" onClick={() => move('payment_rejected', r)} busy={busy === 'payment_rejected'}>
                      {r}
                    </Button>
                  ))}
                  <Button tone="plain" className="w-full" onClick={() => setRejecting(false)}>
                    Back
                  </Button>
                </div>
              ) : (
                <Button tone="danger" onClick={() => setRejecting(true)}>
                  Not received ✗
                </Button>
              ))}
            {o.canChangeDate &&
              (changingDate ? (
                <ChangeDate
                  o={o}
                  onDone={(fresh) => {
                    if (fresh) order.setData(fresh)
                    setChangingDate(false)
                  }}
                />
              ) : (
                <Button tone="plain" onClick={() => setChangingDate(true)}>
                  Change date
                </Button>
              ))}
            {moves.includes('cancelled') && (
              <button type="button" className="mt-1 text-sm font-semibold text-spice underline" onClick={() => move('cancelled')}>
                Cancel order
              </button>
            )}
          </div>
        )}
      </Card>

      <Card className="mt-3">
        <p className="font-semibold text-forest">{o.customerName}</p>
        <p className="text-sm">
          {o.address}
          {o.landmark && ` (near ${o.landmark})`}, {o.pincode}
        </p>
        <p className="text-xs">Area: {o.zoneName}</p>
        {o.notes && <p className="mt-2 rounded-lg bg-gold/15 px-2 py-1 text-sm">Customer note: {o.notes}</p>}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <a href={`tel:+91${o.phone}`} className="rounded-xl border border-earth/30 px-3 py-2.5 text-center text-sm font-semibold">
            Call {o.phone}
          </a>
          <a href={`https://wa.me/91${o.phone}`} target="_blank" rel="noopener" className="rounded-xl border border-earth/30 px-3 py-2.5 text-center text-sm font-semibold">
            WhatsApp
          </a>
        </div>
        <WhatsAppTemplates o={o} firstName={firstName} />
      </Card>

      <Card className="mt-3">
        <ul className="space-y-1 text-sm">
          {o.items.map((i, n) => (
            <li key={n} className="flex justify-between gap-2">
              <span>
                <b>{i.qty} ×</b> {i.name} <span className="text-xs">({i.label})</span>
              </span>
              <span>{rupees(i.unitPricePaise * i.qty)}</span>
            </li>
          ))}
          <li className="flex justify-between gap-2 text-xs">
            <span>Delivery</span>
            <span>{rupees(o.deliveryFeePaise)}</span>
          </li>
          <li className="flex justify-between gap-2 border-t border-earth/15 pt-1 font-semibold text-forest">
            <span>Total</span>
            <span>{rupees(o.totalPaise)}</span>
          </li>
        </ul>
      </Card>

      <Notes o={o} onSaved={order.setData} />

      <Card className="mt-3">
        <p className="mb-2 text-sm font-semibold text-forest">History</p>
        <ol className="space-y-1.5 text-sm">
          {o.events.map((e, n) => {
            const moved = e.from === e.to ? parseDateMove(e.note) : null
            const note = moved ? moved.reason : e.note
            return (
              <li key={n}>
                <span className="text-xs">{when(e.at)}</span> ·{' '}
                {moved
                  ? `Date changed: ${formatWhen(moved.from)} → ${formatWhen(moved.to)}`
                  : e.from === null
                    ? 'Order placed'
                    : ownerStatusLabel(e.to, o.hasMeals)}
                <span className="text-xs">
                  {' '}
                  by {e.byUser ?? (e.actor === 'customer' ? 'customer' : e.actor === 'system' ? 'system' : 'owner')}
                </span>
                {note && <span className="block text-xs italic">{note}</span>}
              </li>
            )
          })}
        </ol>
      </Card>
    </Page>
  )
}

function WhatsAppTemplates({ o, firstName }: { o: AdminOrderDetail; firstName: string }) {
  const total = rupees(o.totalPaise)
  const when = o.deliveryDate && o.deliverySlot ? ` for ${formatDate(o.deliveryDate)} ${slotName(o.deliverySlot).toLowerCase()}` : ''
  const templates: [string, string][] = []
  if (o.status === 'awaiting_payment' || o.status === 'payment_rejected') {
    templates.push([
      'Payment reminder',
      `Hi ${firstName}, this is MJ Kitchen about your order ${o.code} (${total}). We haven't received the payment yet. You can pay here: ${o.statusUrl}`,
    ])
  }
  if (['confirmed', 'preparing'].includes(o.status)) {
    templates.push(['Confirmed', `Hi ${firstName}, we've received your payment of ${total}. Your MJ Kitchen order ${o.code}${when} is confirmed. Track it here: ${o.statusUrl}`])
  }
  if (o.dateChanged && o.deliveryDate && o.deliverySlot && !['out_for_delivery', 'delivered', 'cancelled'].includes(o.status)) {
    templates.push(['Date changed', `Hi ${firstName}, as we discussed, your MJ Kitchen order ${o.code} is now for ${formatWhen({ date: o.deliveryDate, slot: o.deliverySlot })}. Track it here: ${o.statusUrl}`])
  }
  if (o.status === 'out_for_delivery') {
    templates.push([o.hasMeals ? 'On the way' : 'Shipped', `Hi ${firstName}, your MJ Kitchen order ${o.code} is on its way! Track it here: ${o.statusUrl}`])
  }
  if (o.status === 'delivered') {
    templates.push(['Thank you', `Hi ${firstName}, thank you for ordering from MJ Kitchen! We hope you enjoy it. We'd love to hear what you think.`])
  }
  templates.push(['Order link', `Hi ${firstName}, here's your MJ Kitchen order ${o.code}: ${o.statusUrl}`])
  return (
    <div className="mt-3">
      <p className="mb-1.5 text-xs font-semibold">Send on WhatsApp</p>
      <div className="flex flex-wrap gap-2">
        {templates.map(([label, text]) => (
          <a
            key={label}
            href={`https://wa.me/91${o.phone}?text=${encodeURIComponent(text)}`}
            target="_blank"
            rel="noopener"
            className="rounded-full bg-forest/10 px-3 py-1.5 text-xs font-semibold text-forest"
          >
            {label}
          </a>
        ))}
      </div>
    </div>
  )
}

function Notes({ o, onSaved }: { o: AdminOrderDetail; onSaved: (o: AdminOrderDetail) => void }) {
  const [notes, setNotes] = useState(o.adminNotes)
  const { busy, run } = useAction()
  const changed = notes.trim() !== o.adminNotes
  return (
    <Card className="mt-3">
      <label className="block">
        <span className="mb-1 block text-sm font-semibold text-forest">Kitchen notes</span>
        <textarea className="field min-h-20" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Only you and your team see this." />
      </label>
      {changed && (
        <Button
          className="mt-2"
          busy={busy === 'notes'}
          onClick={async () => {
            const fresh = await run('notes', () => api.setNotes(o.code, notes), 'Notes saved')
            if (fresh) onSaved(fresh)
          }}
        >
          Save notes
        </Button>
      )}
    </Card>
  )
}

/** Move a meal order to another date and slot, as agreed with the customer. */
function ChangeDate({ o, onDone }: { o: AdminOrderDetail; onDone: (fresh?: AdminOrderDetail) => void }) {
  const today = istToday(new Date())
  const [date, setDate] = useState(o.deliveryDate && o.deliveryDate >= today ? o.deliveryDate : today)
  const [slot, setSlot] = useState<Slot>(o.deliverySlot ?? 'lunch')
  const [reason, setReason] = useState('')
  const [overLimit, setOverLimit] = useState(false)
  const [check, setCheck] = useState<{ key: string; result?: MoveCheckResult; error?: string } | null>(null)
  const { busy, run } = useAction()
  const key = `${date}|${slot}`
  const same = date === o.deliveryDate && slot === o.deliverySlot

  useEffect(() => {
    if (!date || same) return
    let live = true
    setOverLimit(false)
    api.dateCheck(o.code, date, slot).then(
      (result) => live && setCheck({ key, result }),
      (e: Error) => live && setCheck({ key, error: e.message }),
    )
    return () => {
      live = false
    }
  }, [o.code, date, slot, same, key])

  const current = check?.key === key ? check : null
  const plan = current?.result?.plan
  const canSave = !same && !!plan && !plan.error && (plan.short.length === 0 || overLimit)

  const save = async () => {
    const fresh = await run(
      'date',
      () => api.changeDate(o.code, { fromStatus: o.status, fromDate: o.deliveryDate ?? '', fromSlot: o.deliverySlot ?? 'lunch', date, slot, reason, overLimit }),
      `Moved to ${formatWhen({ date, slot })}`,
    )
    if (fresh) onDone(fresh)
  }

  return (
    <div className="space-y-3 rounded-xl border border-earth/30 p-3">
      <p className="text-sm font-semibold text-forest">Move to another date</p>
      <input type="date" className="field" min={today} value={date} onChange={(e) => setDate(e.target.value)} />
      <div className="grid grid-cols-2 gap-2">
        {(['lunch', 'dinner'] as Slot[]).map((s) => (
          <Button key={s} tone={slot === s ? 'primary' : 'plain'} onClick={() => setSlot(s)}>
            {slotName(s)}
          </Button>
        ))}
      </div>
      {same ? (
        <p className="text-xs">That’s the order’s current date. Pick another date or slot.</p>
      ) : !current ? (
        <p className="text-xs">Checking portions…</p>
      ) : current.error ? (
        <p className="text-sm text-spice">{current.error}</p>
      ) : plan?.error ? (
        <p className="text-sm font-semibold text-spice">{plan.error}</p>
      ) : (
        <>
          <ul className="space-y-0.5 text-sm">
            {current.result!.dishes.map((d) => (
              <li key={d.name} className="flex justify-between gap-2">
                <span>
                  <b>{d.qty} ×</b> {d.name}
                </span>
                <span className={'text-xs ' + (d.left !== null && d.left < d.qty ? 'font-semibold text-spice' : '')}>
                  {d.left === null ? 'not on the menu then' : `${d.left} left`}
                </span>
              </li>
            ))}
          </ul>
          {plan!.warnings.map((w) => (
            <p key={w} className="rounded-lg bg-gold/15 px-2 py-1 text-xs">
              {w}
            </p>
          ))}
          {plan!.short.length > 0 && (
            <label className="flex items-start gap-2 rounded-lg bg-spice/10 px-2 py-1.5 text-sm text-spice">
              <input type="checkbox" className="mt-0.5" checked={overLimit} onChange={(e) => setOverLimit(e.target.checked)} />
              <span>
                <b>Go over the limit for this order.</b> Not enough portions left for {plan!.short.map((s) => s.name).join(', ')}. The limit for this date is
                raised just enough, and customers still see it as full.
              </span>
            </label>
          )}
        </>
      )}
      <input className="field" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional), e.g. customer called" />
      <div className="grid grid-cols-2 gap-2">
        <Button tone="plain" onClick={() => onDone()}>
          Back
        </Button>
        <Button onClick={save} busy={busy === 'date'} disabled={!canSave}>
          Move order
        </Button>
      </div>
    </div>
  )
}
