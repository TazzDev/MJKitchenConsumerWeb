import { useEffect, useState } from 'react'
import { ORDER_VIEWS, type AdminOrderSummary, type AdminSummary, type OrderListView } from '../../shared/admin'
import { formatDate } from '../../shared/dates'
import { rupees } from '../../shared/money'
import { api } from '../api'
import { ago, Button, Card, DateChangedBadge, ErrorBox, go, Loading, Page, StatusBadge, toast, useAction, useLoad, when, slotName } from '../ui'

const VIEW_LABEL: Record<OrderListView, string> = {
  check: 'To check',
  unpaid: 'Not paid',
  ship: 'Pickles to ship',
  meals: 'Meals',
  out: 'On the way',
  all: 'All',
}

const EMPTY: Record<OrderListView, string> = {
  check: 'No payments waiting for a check.',
  unpaid: 'No unpaid orders.',
  ship: 'No pickles waiting to ship.',
  meals: 'No upcoming meal orders.',
  out: 'Nothing out for delivery.',
  all: 'No orders yet.',
}

export function OrdersPage({ view: rawView, counts }: { view?: string; counts: AdminSummary['counts'] | null }) {
  const view: OrderListView = (ORDER_VIEWS as readonly string[]).includes(rawView ?? '') ? (rawView as OrderListView) : 'check'
  const [q, setQ] = useState('')
  const [search, setSearch] = useState('')
  useEffect(() => {
    const t = window.setTimeout(() => setSearch(q.trim()), 350)
    return () => window.clearTimeout(t)
  }, [q])

  const list = useLoad(() => api.orders(view, search), [view, search], { refreshMs: 30_000 })
  const { busy, run } = useAction()

  const confirm = async (o: AdminOrderSummary) => {
    const done = await run(o.code, () => api.setStatus(o.code, o.status, 'confirmed'))
    if (done) {
      toast(`${o.code} confirmed`)
      list.setData((d) => d && { orders: d.orders.filter((x) => x.code !== o.code) })
    }
  }

  return (
    <Page title="Orders">
      <input
        className="field mb-3"
        type="search"
        placeholder="Search name, phone, order no. or UTR"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Search orders"
      />
      {!search && (
        <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1">
          {ORDER_VIEWS.map((v) => {
            const n = counts?.[v] ?? 0
            const on = v === view
            return (
              <button
                key={v}
                type="button"
                onClick={() => go('/orders/' + v)}
                className={
                  'shrink-0 rounded-full border px-3 py-1.5 text-sm font-semibold whitespace-nowrap ' +
                  (on ? 'border-forest bg-forest text-cream' : 'border-earth/25 bg-paper text-earth')
                }
              >
                {VIEW_LABEL[v]}
                {v !== 'all' && n > 0 && (
                  <span className={'ml-1.5 rounded-full px-1.5 text-xs ' + (on ? 'bg-cream text-forest' : v === 'check' ? 'bg-spice text-cream' : 'bg-earth/15')}>{n}</span>
                )}
              </button>
            )
          })}
        </div>
      )}
      {view === 'check' && !search && (
        <p className="mb-3 text-sm">
          Find each amount in your UPI app, with the order number in the note, before you confirm. Orders with no reference number are marked{' '}
          <b>match manually</b>.
        </p>
      )}

      {list.error ? (
        <ErrorBox error={list.error} onRetry={() => list.reload()} />
      ) : !list.data ? (
        <Loading />
      ) : list.data.orders.length === 0 ? (
        <p className="py-10 text-center text-sm">{search ? 'No orders match that search.' : EMPTY[view]}</p>
      ) : (
        <ul className="space-y-3">
          {list.data.orders.map((o) => (
            <li key={o.code}>
              <OrderCard o={o} onConfirm={view === 'check' && !search ? () => confirm(o) : undefined} busy={busy === o.code} />
            </li>
          ))}
        </ul>
      )}
    </Page>
  )
}

function OrderCard({ o, onConfirm, busy }: { o: AdminOrderSummary; onConfirm?: () => void; busy: boolean }) {
  return (
    <Card className="p-0">
      <a href={`#/order/${o.code}`} className="block p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-semibold text-forest">{o.customerName}</p>
            <p className="text-xs">
              {o.code} · {when(o.createdAt)}
            </p>
          </div>
          <div className="text-right">
            <p className="font-serif text-xl leading-tight text-forest">{rupees(o.totalPaise)}</p>
            <StatusBadge status={o.status} hasMeals={o.hasMeals} />
          </div>
        </div>
        <p className="mt-2 line-clamp-2 text-sm">{o.itemsSummary}</p>
        <p className="mt-1 text-xs font-semibold">
          {o.deliveryDate && o.deliverySlot ? `${formatDate(o.deliveryDate)}, ${slotName(o.deliverySlot)}` : 'Pickles: ship once paid'}
          {o.dateChanged && (
            <>
              {' '}
              <DateChangedBadge />
            </>
          )}
        </p>
        {o.status === 'payment_submitted' && (
          <p className="mt-2 text-sm">
            {o.utr ? (
              <>
                UTR <span className="font-mono font-semibold tracking-wide text-forest">{o.utr}</span>
              </>
            ) : (
              <span className="rounded bg-gold/25 px-1.5 py-0.5 text-xs font-semibold text-forest-dark">Match manually: no reference</span>
            )}
            {o.paidAt && <span className="text-xs"> · said paid {ago(o.paidAt)}</span>}
          </p>
        )}
      </a>
      {onConfirm && (
        <div className="flex gap-2 border-t border-earth/10 px-4 py-3">
          <Button className="flex-1" onClick={onConfirm} busy={busy}>
            Payment received ✓
          </Button>
          <Button tone="plain" onClick={() => go('/order/' + o.code)}>
            Open
          </Button>
        </div>
      )}
    </Card>
  )
}
