import { useEffect, useState } from 'react'
import { PRODUCT_ICONS, WEEK_ORDER, WEEKDAYS, type AdminMenu, type AdminProduct, type AdminVariant, type DayAvailability, type ScheduleEntry } from '../../shared/admin'
import { formatDate } from '../../shared/dates'
import { rupees } from '../../shared/money'
import { SLOTS, type Category, type Slot } from '../../shared/types'
import { api, type ProductBody, type VariantBody } from '../api'
import { Button, Card, ErrorBox, go, Label, Loading, Page, paiseToText, toast, toPaise, Toggle, useAction, useLoad, slotName } from '../ui'

type Tab = 'dishes' | 'week' | 'dates'

export function MenuPage({ tab }: { tab: Tab }) {
  const menu = useLoad(() => api.menu(), [])
  return (
    <Page title="Menu">
      <div className="mb-4 grid grid-cols-3 rounded-xl border border-earth/20 bg-paper p-1 text-sm font-semibold">
        {(
          [
            ['dishes', 'Dishes & prices'],
            ['week', 'Meal days'],
            ['dates', 'Dates'],
          ] as [Tab, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => go(id === 'dishes' ? '/menu' : '/menu/' + id)}
            className={'rounded-lg py-2 ' + (tab === id ? 'bg-forest text-cream' : '')}
          >
            {label}
          </button>
        ))}
      </div>
      {menu.error ? (
        <ErrorBox error={menu.error} onRetry={() => menu.reload()} />
      ) : !menu.data ? (
        <Loading />
      ) : tab === 'week' ? (
        <WeekTab menu={menu.data} onSaved={menu.setData} />
      ) : tab === 'dates' ? (
        <DatesTab menu={menu.data} />
      ) : (
        <DishesTab menu={menu.data} onSaved={menu.setData} />
      )}
    </Page>
  )
}

// ---------------------------------------------------------------------------
// Dishes and prices

function DishesTab({ menu, onSaved }: { menu: AdminMenu; onSaved: (m: AdminMenu) => void }) {
  const [adding, setAdding] = useState<Category | null>(null)
  return (
    <div className="space-y-6">
      <p className="text-sm">Price changes apply to new orders straight away. Orders already placed keep the price they were placed at.</p>
      {(['pickle', 'meal'] as Category[]).map((cat) => (
        <section key={cat}>
          <h2 className="mb-2 font-serif text-xl text-forest">{cat === 'pickle' ? 'Pickles' : 'Meals'}</h2>
          <div className="space-y-3">
            {menu.products
              .filter((p) => p.category === cat)
              .map((p) => (
                <ProductCard key={p.id} p={p} onSaved={onSaved} />
              ))}
            {adding === cat ? (
              <NewProduct category={cat} onDone={(m) => (m && onSaved(m), setAdding(null))} />
            ) : (
              <Button tone="plain" className="w-full" onClick={() => setAdding(cat)}>
                + Add a {cat === 'pickle' ? 'pickle' : 'meal'}
              </Button>
            )}
          </div>
        </section>
      ))}
    </div>
  )
}

function ProductCard({ p, onSaved }: { p: AdminProduct; onSaved: (m: AdminMenu) => void }) {
  const [open, setOpen] = useState(false)
  const [addingSize, setAddingSize] = useState(false)
  return (
    <Card className={p.isActive ? '' : 'opacity-70'}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-forest">
            {p.name} {!p.isActive && <span className="text-xs font-normal">(hidden)</span>}
          </p>
          <p className="text-xs">{p.variants.map((v) => `${v.label} ${rupees(v.pricePaise)}${v.stock === 0 ? ' (sold out)' : ''}`).join(' · ')}</p>
        </div>
        <Button tone="plain" className="px-3 py-1.5" onClick={() => setOpen(!open)}>
          {open ? 'Close' : 'Edit'}
        </Button>
      </div>
      {open && (
        <div className="mt-3 space-y-4 border-t border-earth/10 pt-3">
          {p.variants.map((v) => (
            <VariantEditor key={v.id} v={v} onSaved={onSaved} />
          ))}
          {addingSize ? (
            <NewVariant productId={p.id} onDone={(m) => (m && onSaved(m), setAddingSize(false))} />
          ) : (
            <button type="button" className="text-sm font-semibold text-forest underline" onClick={() => setAddingSize(true)}>
              + Add another size
            </button>
          )}
          <ProductEditor p={p} onSaved={onSaved} />
        </div>
      )}
    </Card>
  )
}

function VariantEditor({ v, onSaved }: { v: AdminVariant; onSaved: (m: AdminMenu) => void }) {
  const [label, setLabel] = useState(v.label)
  const [price, setPrice] = useState(paiseToText(v.pricePaise))
  const [stock, setStock] = useState(v.stock == null ? '' : String(v.stock))
  const { busy, run } = useAction()

  const save = async (patch: Partial<VariantBody> = {}) => {
    const pricePaise = toPaise(price)
    if (pricePaise === null || pricePaise <= 0) return toast('Enter a price in rupees.', 'error')
    const stockN = stock.trim() === '' ? null : Number(stock)
    if (stockN !== null && (!Number.isInteger(stockN) || stockN < 0)) return toast('Stock is a whole number, or empty.', 'error')
    const body: VariantBody = { label, pricePaise, weightG: v.weightG, stock: stockN, isActive: v.isActive, sortOrder: v.sortOrder, ...patch }
    const m = await run('save', () => api.saveVariant(v.id, body), 'Saved')
    if (m) {
      onSaved(m)
      if (patch.stock !== undefined) setStock(patch.stock == null ? '' : String(patch.stock))
    }
  }

  const changed = label !== v.label || toPaise(price) !== v.pricePaise || stock !== (v.stock == null ? '' : String(v.stock))
  return (
    <div className="rounded-xl bg-cream/60 p-3">
      <div className="grid grid-cols-3 gap-2">
        <Label label="Size">
          <input className="field" value={label} onChange={(e) => setLabel(e.target.value)} />
        </Label>
        <Label label="Price ₹">
          <input className="field" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        </Label>
        <Label label="Stock">
          <input className="field" inputMode="numeric" placeholder="No limit" value={stock} onChange={(e) => setStock(e.target.value)} />
        </Label>
      </div>
      <p className="mt-1 text-xs">Stock: leave empty for no limit. It goes down with each order; 0 shows as sold out.</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {changed && (
          <Button onClick={() => save()} busy={busy === 'save'}>
            Save
          </Button>
        )}
        {v.stock === 0 ? (
          <Button tone="gold" onClick={() => save({ stock: null })}>
            Back in stock
          </Button>
        ) : (
          <Button tone="plain" onClick={() => save({ stock: 0 })}>
            Mark sold out
          </Button>
        )}
        <Toggle checked={v.isActive} onChange={(on) => save({ isActive: on })} label={v.isActive ? 'Shown' : 'Hidden'} />
      </div>
    </div>
  )
}

function NewVariant({ productId, onDone }: { productId: string; onDone: (m: AdminMenu | null) => void }) {
  const [label, setLabel] = useState('')
  const [price, setPrice] = useState('')
  const { busy, run } = useAction()
  const add = async () => {
    const pricePaise = toPaise(price)
    if (pricePaise === null || pricePaise <= 0) return toast('Enter a price in rupees.', 'error')
    const weight = label.match(/^(\d+)\s*g$/i)
    const m = await run('add', () => api.addVariant(productId, { label, pricePaise, weightG: weight ? Number(weight[1]) : null, stock: null }), 'Size added')
    if (m) onDone(m)
  }
  return (
    <div className="rounded-xl border border-forest/30 p-3">
      <div className="grid grid-cols-2 gap-2">
        <Label label="Size">
          <input className="field" placeholder="e.g. 250 g" value={label} onChange={(e) => setLabel(e.target.value)} />
        </Label>
        <Label label="Price ₹">
          <input className="field" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        </Label>
      </div>
      <div className="mt-2 flex gap-2">
        <Button onClick={add} busy={busy === 'add'}>
          Add size
        </Button>
        <Button tone="plain" onClick={() => onDone(null)}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function productBody(p: AdminProduct): ProductBody {
  return { name: p.name, description: p.description, spiceLevel: p.spiceLevel, isVeg: p.isVeg, icon: p.icon, isActive: p.isActive, sortOrder: p.sortOrder }
}

function ProductFields({ value, onChange }: { value: ProductBody; onChange: (v: ProductBody) => void }) {
  const set = (patch: Partial<ProductBody>) => onChange({ ...value, ...patch })
  return (
    <div className="space-y-3">
      <Label label="Name">
        <input className="field" value={value.name} onChange={(e) => set({ name: e.target.value })} />
      </Label>
      <Label label="Description">
        <textarea className="field min-h-16" value={value.description} onChange={(e) => set({ description: e.target.value })} />
      </Label>
      <div className="grid grid-cols-2 gap-2">
        <Label label="Spice">
          <select className="field" value={value.spiceLevel} onChange={(e) => set({ spiceLevel: Number(e.target.value) })}>
            <option value={0}>Not spicy</option>
            <option value={1}>Mild</option>
            <option value={2}>Medium</option>
            <option value={3}>Hot</option>
          </select>
        </Label>
        <Label label="Icon">
          <select className="field" value={value.icon ?? ''} onChange={(e) => set({ icon: e.target.value || null })}>
            <option value="">Default</option>
            {PRODUCT_ICONS.map((i) => (
              <option key={i} value={i}>
                {i[0].toUpperCase() + i.slice(1)}
              </option>
            ))}
          </select>
        </Label>
      </div>
      <Toggle checked={value.isVeg} onChange={(isVeg) => set({ isVeg })} label="Vegetarian" />
    </div>
  )
}

function ProductEditor({ p, onSaved }: { p: AdminProduct; onSaved: (m: AdminMenu) => void }) {
  const [value, setValue] = useState(() => productBody(p))
  const { busy, run } = useAction()
  const save = async (v: ProductBody) => {
    const m = await run('save', () => api.saveProduct(p.id, v), 'Saved')
    if (m) onSaved(m)
  }
  const changed = JSON.stringify(value) !== JSON.stringify(productBody(p))
  return (
    <div className="space-y-3 border-t border-earth/10 pt-3">
      <ProductFields value={value} onChange={setValue} />
      <div className="flex flex-wrap items-center gap-3">
        {changed && (
          <Button onClick={() => save(value)} busy={busy === 'save'}>
            Save dish
          </Button>
        )}
        <Toggle
          checked={p.isActive}
          onChange={(isActive) => {
            setValue({ ...value, isActive })
            void save({ ...productBody(p), isActive })
          }}
          label={p.isActive ? 'Shown on the menu' : 'Hidden from the menu'}
        />
      </div>
    </div>
  )
}

function NewProduct({ category, onDone }: { category: Category; onDone: (m: AdminMenu | null) => void }) {
  const [value, setValue] = useState<ProductBody>({ name: '', description: '', spiceLevel: 2, isVeg: false, icon: null, isActive: true, sortOrder: 100 })
  const [label, setLabel] = useState(category === 'pickle' ? '400 g' : 'Per meal')
  const [price, setPrice] = useState('')
  const { busy, run } = useAction()
  const add = async () => {
    const pricePaise = toPaise(price)
    if (pricePaise === null || pricePaise <= 0) return toast('Enter a price in rupees.', 'error')
    const weight = label.match(/^(\d+)\s*g$/i)
    const m = await run(
      'add',
      () => api.addProduct({ ...value, category, variant: { label, pricePaise, weightG: weight ? Number(weight[1]) : null, stock: null } }),
      category === 'meal' ? 'Added. Now set its days under Meal days.' : 'Added',
    )
    if (m) onDone(m)
  }
  return (
    <Card className="border-forest/40">
      <p className="mb-3 font-semibold text-forest">New {category}</p>
      <ProductFields value={value} onChange={setValue} />
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Label label="Size">
          <input className="field" value={label} onChange={(e) => setLabel(e.target.value)} />
        </Label>
        <Label label="Price ₹">
          <input className="field" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
        </Label>
      </div>
      <div className="mt-3 flex gap-2">
        <Button onClick={add} busy={busy === 'add'}>
          Add {category}
        </Button>
        <Button tone="plain" onClick={() => onDone(null)}>
          Cancel
        </Button>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Weekly meal schedule

function WeekTab({ menu, onSaved }: { menu: AdminMenu; onSaved: (m: AdminMenu) => void }) {
  const meals = menu.products.filter((p) => p.category === 'meal')
  return (
    <div className="space-y-3">
      <p className="text-sm">
        How many portions of each meal you make, for every lunch and dinner of the week. Empty or 0 means not cooked. To change one particular date, use{' '}
        <a href="#/menu/dates" className="font-semibold underline">
          Dates
        </a>
        .
      </p>
      {meals.map((p) => (
        <WeekEditor key={p.id} p={p} entries={menu.schedule[p.id] ?? []} onSaved={onSaved} />
      ))}
    </div>
  )
}

function WeekEditor({ p, entries, onSaved }: { p: AdminProduct; entries: ScheduleEntry[]; onSaved: (m: AdminMenu) => void }) {
  const initial = () => {
    const g: Record<string, string> = {}
    for (const e of entries) g[`${e.weekday}|${e.slot}`] = String(e.maxPortions)
    return g
  }
  const [grid, setGrid] = useState(initial)
  const entriesKey = JSON.stringify(entries)
  useEffect(() => setGrid(initial()), [entriesKey])
  const { busy, run } = useAction()
  const changed = JSON.stringify(grid) !== JSON.stringify(initial())

  const fillAll = () => {
    const first = Object.values(grid).find((v) => Number(v) > 0) ?? '15'
    const g: Record<string, string> = {}
    for (const k of Object.keys(grid)) if (Number(grid[k]) > 0) g[k] = first
    setGrid(g)
  }

  const save = async () => {
    const out: ScheduleEntry[] = []
    for (const [k, v] of Object.entries(grid)) {
      if (v.trim() === '') continue
      const n = Number(v)
      if (!Number.isInteger(n) || n < 0) return toast('Portions are whole numbers.', 'error')
      const [wd, slot] = k.split('|')
      if (n > 0) out.push({ weekday: Number(wd), slot: slot as Slot, maxPortions: n })
    }
    const m = await run('save', () => api.saveSchedule(p.id, out), `${p.name} days saved`)
    if (m) onSaved(m)
  }

  return (
    <Card className={p.isActive ? '' : 'opacity-70'}>
      <p className="mb-2 font-semibold text-forest">
        {p.name} {!p.isActive && <span className="text-xs font-normal">(hidden from the menu)</span>}
      </p>
      <table className="w-full table-fixed text-center text-xs">
        <thead>
          <tr>
            <th className="w-16" />
            {WEEK_ORDER.map((d) => (
              <th key={d} className="pb-1 font-semibold">
                {WEEKDAYS[d]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {SLOTS.map((slot) => (
            <tr key={slot}>
              <th className="pr-1 text-left font-semibold">{slotName(slot)}</th>
              {WEEK_ORDER.map((d) => {
                const k = `${d}|${slot}`
                const on = Number(grid[k]) > 0
                return (
                  <td key={d} className="p-0.5">
                    <input
                      aria-label={`${p.name} ${WEEKDAYS[d]} ${slot}`}
                      inputMode="numeric"
                      className={'w-full rounded-md border px-0 py-1.5 text-center text-sm ' + (on ? 'border-forest bg-forest/10 font-semibold text-forest' : 'border-earth/20 bg-white/60')}
                      value={grid[k] ?? ''}
                      placeholder="–"
                      onChange={(e) => setGrid({ ...grid, [k]: e.target.value.replace(/\D/g, '').slice(0, 3) })}
                    />
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {changed && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={save} busy={busy === 'save'}>
            Save
          </Button>
          <Button tone="plain" onClick={fillAll}>
            Same number everywhere
          </Button>
          <Button tone="plain" onClick={() => setGrid(initial())}>
            Undo
          </Button>
        </div>
      )}
      <p className="mt-2 text-xs">Upcoming dates follow this too, except dates you changed under Dates.</p>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// One-off changes for particular dates

function DatesTab({ menu }: { menu: AdminMenu }) {
  const avail = useLoad(() => api.availability(28), [])
  const [date, setDate] = useState<string | null>(null)
  if (avail.error) return <ErrorBox error={avail.error} onRetry={() => avail.reload()} />
  if (!avail.data) return <Loading />
  const days = avail.data.days
  const selected = days.find((d) => d.date === date) ?? days[0]
  const names = new Map(menu.products.map((p) => [p.id, p.name]))

  return (
    <div>
      <p className="mb-3 text-sm">Turn a meal off for a holiday, or change the portions for one date. Ordering for a date closes at the cutoff in Settings.</p>
      <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1">
        {days.map((d) => {
          const cooking = d.meals.some((m) => m.maxPortions > 0)
          const booked = d.meals.reduce((n, m) => n + m.booked, 0)
          return (
            <button
              key={d.date}
              type="button"
              onClick={() => setDate(d.date)}
              className={
                'shrink-0 rounded-xl border px-3 py-1.5 text-left text-sm whitespace-nowrap ' +
                (d.date === selected.date ? 'border-forest bg-forest text-cream' : cooking ? 'border-earth/25 bg-paper' : 'border-dashed border-earth/25 opacity-60')
              }
            >
              <span className="block font-semibold">{formatDate(d.date)}</span>
              <span className="text-xs">{cooking ? (booked ? `${booked} booked` : 'open') : 'no meals'}</span>
            </button>
          )
        })}
      </div>
      <DayEditor key={selected.date} day={selected} names={names} onChanged={() => avail.reload(true)} />
    </div>
  )
}

function DayEditor({ day, names, onChanged }: { day: DayAvailability; names: Map<string, string>; onChanged: () => void }) {
  return (
    <div className="space-y-3">
      {SLOTS.map((slot) => (
        <Card key={slot}>
          <p className="caps mb-2 text-xs">
            {formatDate(day.date)} · {slotName(slot)}
          </p>
          <ul className="space-y-2">
            {day.meals
              .filter((m) => m.slot === slot)
              .map((m) => (
                <DayCell key={`${m.productId}-${m.maxPortions}-${m.isOverride}`} date={day.date} m={m} name={names.get(m.productId) ?? m.productId} onChanged={onChanged} />
              ))}
          </ul>
        </Card>
      ))}
    </div>
  )
}

function DayCell({ date, m, name, onChanged }: { date: string; m: DayAvailability['meals'][number]; name: string; onChanged: () => void }) {
  const [value, setValue] = useState(String(m.maxPortions))
  const { busy, run } = useAction()
  const save = async (max: number | null) => {
    const ok = await run('save', () => api.setAvailability(m.productId, date, m.slot, max), max === null ? 'Back to the weekly plan' : 'Saved')
    if (ok) onChanged()
  }
  const n = Number(value)
  const changed = value !== String(m.maxPortions)
  return (
    <li className="flex flex-wrap items-center gap-2">
      <span className="min-w-32 flex-1 text-sm">
        <span className="font-semibold text-forest">{name}</span>
        <span className="block text-xs">
          {m.booked} booked{m.isOverride ? ` · changed for this date (weekly: ${m.scheduled || 'off'})` : ''}
        </span>
      </span>
      <input
        aria-label={`${name} portions`}
        inputMode="numeric"
        className="field w-16 py-1.5 text-center"
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/\D/g, '').slice(0, 3))}
      />
      {changed ? (
        <Button className="px-3 py-1.5" busy={busy === 'save'} onClick={() => (Number.isInteger(n) && value !== '' ? save(n) : toast('Enter a number.', 'error'))}>
          Save
        </Button>
      ) : m.maxPortions > 0 ? (
        <Button tone="plain" className="px-3 py-1.5" busy={busy === 'save'} onClick={() => save(0)}>
          Turn off
        </Button>
      ) : null}
      {m.isOverride && !changed && (
        <button type="button" className="text-xs font-semibold underline" onClick={() => save(null)}>
          Reset
        </button>
      )}
      {n < m.booked && <span className="w-full text-xs text-spice">Fewer than already booked. Existing orders stay; no new ones can be taken.</span>}
    </li>
  )
}
