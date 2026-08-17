'use client';

import { useActionState, useMemo, useState } from 'react';
import { sellOverCounter } from './actions';
import { formatNaira, parseAmount } from '@/lib/money';

const field = 'w-full rounded border border-stone-300 px-2 py-1.5 text-sm focus:border-stone-500 focus:outline-none';
const label = 'block text-xs font-medium uppercase tracking-wide text-stone-500';

const blankLine = () => ({
  key: Math.random().toString(36).slice(2),
  priceItemId: '',
  description: '',
  quantity: '1',
  price: '',
});

/** Naira typed at the counter → integer kobo, or null if it is not a number. */
function toKobo(text) {
  if (text == null || String(text).trim() === '') return null;
  try {
    return parseAmount(text);
  } catch {
    return null;
  }
}

export default function CounterForm({ priceItems, customers }) {
  const [state, action, pending] = useActionState(sellOverCounter, null);
  const [lines, setLines] = useState([blankLine()]);
  const [customerId, setCustomerId] = useState('');
  const [named, setNamed] = useState(false);
  const [discount, setDiscount] = useState('');
  const [paid, setPaid] = useState('');

  const update = (key, patch) =>
    setLines((current) => current.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  /* Picking an item fills in its name and price, and both stay editable. The
   * counter haggles, and a price list that cannot be overridden at the till
   * gets worked around with a calculator and a blank receipt. */
  const choose = (key, priceItemId) => {
    const item = priceItems.find((p) => p.id === priceItemId);
    update(key, {
      priceItemId,
      description: item ? item.name : '',
      price: item ? String(item.price_kobo / 100) : '',
    });
  };

  const priced = useMemo(
    () =>
      lines.map((line) => {
        const quantity = Number(line.quantity);
        const unitKobo = toKobo(line.price);
        const ok = quantity > 0 && unitKobo != null && String(line.description).trim() !== '';
        return { line, quantity, unitKobo, ok, totalKobo: ok ? unitKobo * quantity : 0 };
      }),
    [lines]
  );

  const subtotalKobo = priced.reduce((sum, p) => sum + p.totalKobo, 0);
  const discountKobo = toKobo(discount) ?? 0;
  const totalKobo = Math.max(0, subtotalKobo - discountKobo);
  const paidKobo = toKobo(paid);
  const changeKobo = paidKobo == null ? 0 : paidKobo - totalKobo;

  const payload = priced
    .filter((p) => p.ok)
    .map((p) => ({
      priceItemId: p.line.priceItemId || null,
      description: p.line.description.trim(),
      quantity: p.quantity,
      unitKobo: p.unitKobo,
    }));

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="lines" value={JSON.stringify(payload)} />
      <input type="hidden" name="discount" value={discount} />
      <input type="hidden" name="paid" value={paid} />

      {/* --- what is being bought */}
      <section className="rounded-lg border border-stone-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">Items</h2>

        <div className="space-y-3">
          {priced.map(({ line, totalKobo: lineTotal, ok }) => (
            <div key={line.key} className="grid gap-2 sm:grid-cols-12">
              <div className="sm:col-span-4">
                <label className={label} htmlFor={`item-${line.key}`}>From the price list</label>
                <select
                  id={`item-${line.key}`}
                  className={field}
                  value={line.priceItemId}
                  onChange={(e) => choose(line.key, e.target.value)}
                >
                  <option value="">— type it in below —</option>
                  {priceItems.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {formatNaira(item.price_kobo)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-3">
                <label className={label} htmlFor={`desc-${line.key}`}>What was sold</label>
                <input
                  id={`desc-${line.key}`}
                  className={field}
                  value={line.description}
                  placeholder="Picture hooks, pack of 4"
                  onChange={(e) => update(line.key, { description: e.target.value })}
                />
              </div>

              <div className="sm:col-span-2">
                <label className={label} htmlFor={`qty-${line.key}`}>Quantity</label>
                <input
                  id={`qty-${line.key}`}
                  className={field}
                  value={line.quantity}
                  inputMode="numeric"
                  onChange={(e) => update(line.key, { quantity: e.target.value })}
                />
              </div>

              <div className="sm:col-span-2">
                <label className={label} htmlFor={`price-${line.key}`}>Price each</label>
                <input
                  id={`price-${line.key}`}
                  className={field}
                  value={line.price}
                  inputMode="decimal"
                  placeholder="4,500"
                  onChange={(e) => update(line.key, { price: e.target.value })}
                />
              </div>

              <div className="flex items-end justify-between gap-2 sm:col-span-1">
                <span className="text-sm tabular-nums text-stone-700">
                  {ok ? formatNaira(lineTotal) : '—'}
                </span>
                {lines.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setLines((c) => c.filter((l) => l.key !== line.key))}
                    className="pb-1.5 text-xs text-stone-500 hover:text-red-700"
                    aria-label="Remove this line"
                  >
                    ×
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setLines((c) => [...c, blankLine()])}
          className="mt-4 rounded border border-stone-300 px-4 py-2 text-sm"
        >
          Add another item
        </button>
      </section>

      {/* --- the money */}
      <section className="rounded-lg border border-stone-200 bg-white p-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className={label} htmlFor="discount">Discount</label>
            <input id="discount" className={field} value={discount} inputMode="decimal" placeholder="0"
              onChange={(e) => setDiscount(e.target.value)} />
          </div>
          <div>
            <label className={label} htmlFor="method">Paid by</label>
            <select id="method" name="method" className={field} defaultValue="cash">
              <option value="cash">Cash</option>
              <option value="transfer">Transfer</option>
              <option value="pos">Card / POS</option>
            </select>
          </div>
          <div>
            <label className={label} htmlFor="paid">Amount received</label>
            <input id="paid" className={field} value={paid} inputMode="decimal"
              placeholder={`${totalKobo / 100} — leave blank if paid in full`}
              onChange={(e) => setPaid(e.target.value)} />
          </div>
        </div>

        {/* Change is worked out here and comes out of the drawer; only what the
            sale is worth is ever recorded against it. */}
        {paidKobo != null && changeKobo > 0 && (
          <p className="mt-3 rounded border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-900">
            Change to give: <span className="font-semibold tabular-nums">{formatNaira(changeKobo)}</span>
          </p>
        )}
        {paidKobo != null && changeKobo < 0 && (
          <p className="mt-3 rounded border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900">
            Still owing: <span className="font-semibold tabular-nums">{formatNaira(-changeKobo)}</span>
          </p>
        )}
      </section>

      {/* --- who bought it, if they said */}
      <section className="rounded-lg border border-stone-200 bg-white p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Customer</h2>
          <button type="button" onClick={() => setNamed((n) => !n)} className="text-xs text-stone-600 underline">
            {named ? 'Leave it as a walk-in' : 'Attach a name'}
          </button>
        </div>

        {!named ? (
          <p className="text-sm text-stone-500">Walk-in. No name needed.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className={label} htmlFor="customerId">Known customer</label>
              <select id="customerId" name="customerId" className={field} value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">— new customer —</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ''}</option>
                ))}
              </select>
            </div>
            {!customerId && (
              <>
                <div>
                  <label className={label} htmlFor="customerName">Name</label>
                  <input id="customerName" name="customerName" className={field} />
                </div>
                <div>
                  <label className={label} htmlFor="customerPhone">Phone</label>
                  <input id="customerPhone" name="customerPhone" className={field} inputMode="tel"
                    placeholder="0803 111 2222" />
                </div>
              </>
            )}
          </div>
        )}
      </section>

      <div className="rounded-lg border border-stone-900 bg-stone-900 p-5 text-white">
        {discountKobo > 0 && (
          <div className="mb-2 flex justify-between text-sm text-stone-300">
            <span>Before discount</span>
            <span className="tabular-nums">{formatNaira(subtotalKobo)}</span>
          </div>
        )}
        <div className="flex items-center justify-between">
          <span className="text-sm uppercase tracking-wide text-stone-300">To pay</span>
          <span className="text-2xl font-semibold tabular-nums">{formatNaira(totalKobo)}</span>
        </div>
      </div>

      {state?.errors?.length > 0 && (
        <ul className="space-y-1 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {state.errors.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}

      <button
        type="submit"
        disabled={pending || payload.length === 0}
        className="rounded bg-stone-900 px-6 py-3 font-medium text-white disabled:opacity-40"
      >
        {pending ? 'Ringing up...' : `Take ${formatNaira(totalKobo)}`}
      </button>
      {payload.length === 0 && (
        <p className="text-sm text-stone-500">Add an item to ring up the sale.</p>
      )}
    </form>
  );
}
