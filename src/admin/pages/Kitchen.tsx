import { addDays, formatDate, isIsoDate, istToday } from '../../shared/dates'
import { rupees } from '../../shared/money'
import { api } from '../api'
import { Card, ErrorBox, go, Loading, Page, StatusBadge, useLoad, slotName } from '../ui'

export function KitchenPage({ date: rawDate }: { date?: string }) {
  const today = istToday(new Date())
  const date = isIsoDate(rawDate) ? rawDate : addDays(today, 1)
  const day = useLoad(() => api.kitchen(date), [date], { refreshMs: 60_000 })
  const dates = Array.from({ length: 8 }, (_, i) => addDays(today, i))

  return (
    <Page title="Kitchen">
      <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1">
        {dates.map((d, i) => (
          <button
            key={d}
            type="button"
            onClick={() => go('/kitchen/' + d)}
            className={
              'shrink-0 rounded-xl border px-3 py-1.5 text-sm font-semibold whitespace-nowrap ' +
              (d === date ? 'border-forest bg-forest text-cream' : 'border-earth/25 bg-paper')
            }
          >
            {i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : formatDate(d)}
          </button>
        ))}
        <input
          type="date"
          aria-label="Pick a date"
          className="field w-auto shrink-0 py-1"
          value={date}
          onChange={(e) => isIsoDate(e.target.value) && go('/kitchen/' + e.target.value)}
        />
      </div>

      {day.error ? (
        <ErrorBox error={day.error} onRetry={() => day.reload()} />
      ) : !day.data ? (
        <Loading />
      ) : (
        <>
          <h2 className="mb-2 font-semibold text-forest">{formatDate(date)}</h2>
          {day.data.slots.length === 0 ? (
            <p className="py-6 text-center text-sm">No meals booked for this day.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {day.data.slots.map(({ slot, dishes }) => (
                <Card key={slot}>
                  <p className="caps mb-2 text-xs">{slotName(slot)}</p>
                  <ul className="space-y-1">
                    {dishes.map((d) => (
                      <li key={d.name} className="flex items-baseline justify-between gap-2">
                        <span className="text-sm">{d.name}</span>
                        <span className="font-serif text-2xl text-forest">{d.qty}</span>
                      </li>
                    ))}
                  </ul>
                  {dishes.some((d) => d.unverified > 0) && (
                    <p className="mt-2 text-xs">Includes {dishes.reduce((n, d) => n + d.unverified, 0)} from payments you haven't checked yet.</p>
                  )}
                </Card>
              ))}
            </div>
          )}
          {day.data.orders.length > 0 && (
            <>
              <h2 className="mt-5 mb-2 font-semibold text-forest">Orders ({day.data.orders.length})</h2>
              <ul className="space-y-2">
                {day.data.orders.map((o) => (
                  <li key={o.code}>
                    <a href={`#/order/${o.code}`} className="flex items-center justify-between gap-2 rounded-xl border border-earth/15 bg-paper px-3 py-2">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-forest">{o.customerName}</span>
                        <span className="text-xs">
                          {o.code} · {o.slot ? slotName(o.slot) : ''} · {rupees(o.totalPaise)}
                        </span>
                      </span>
                      <StatusBadge status={o.status} hasMeals={o.hasMeals} />
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </Page>
  )
}
