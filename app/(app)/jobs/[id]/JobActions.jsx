'use client';

import { useActionState, useState } from 'react';
import { accept, collect } from '../actions';
import { formatNaira, parseAmount } from '@/lib/money';

const field = 'w-full rounded border border-stone-300 px-3 py-2 text-sm focus:border-stone-500 focus:outline-none';
const label = 'block text-xs font-medium uppercase tracking-wide text-stone-500';
const button = 'rounded bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50';

function Errors({ state }) {
  if (!state?.errors?.length) return null;
  return (
    <ul className="space-y-1 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
      {state.errors.map((e) => <li key={e}>{e}</li>)}
    </ul>
  );
}

/* ------------------------------------------------------- accepting */

export function AcceptForm({ job, depositPercentBp }) {
  const [state, action, pending] = useActionState(accept, null);
  const [deposit, setDeposit] = useState(
    String(Math.round((job.total_kobo * depositPercentBp) / 10000) / 100)
  );
  const [intake, setIntake] = useState([{ key: 'a', description: '', conditionNote: '' }]);

  const items = intake.filter((i) => i.description.trim());

  let depositKobo = 0;
  try { depositKobo = deposit ? parseAmount(deposit) : 0; } catch { depositKobo = 0; }

  return (
    <form action={action} className="space-y-4 rounded-lg border border-stone-200 bg-white p-5">
      <input type="hidden" name="jobId" value={job.id} />
      <input
        type="hidden"
        name="custody"
        value={JSON.stringify(items.map(({ description, conditionNote }) => ({ description, conditionNote })))}
      />

      <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
        Accept the quote
      </h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="deposit">Deposit taken</label>
          <input id="deposit" name="deposit" className={field} value={deposit}
            onChange={(e) => setDeposit(e.target.value)} inputMode="decimal" />
          <p className="mt-1 text-xs text-stone-500">
            Held, not earned — the shop owes a frame or the money back until it is collected.
            Balance {formatNaira(job.total_kobo - depositKobo)}.
          </p>
        </div>
        <div>
          <label className={label} htmlFor="method">Paid by</label>
          <select id="method" name="method" className={field}>
            <option value="cash">Cash</option>
            <option value="transfer">Transfer</option>
            <option value="pos">POS</option>
          </select>
        </div>
      </div>

      {/* Intake of the customer's own property. */}
      <div className="rounded border border-amber-200 bg-amber-50 p-4">
        <h3 className="text-sm font-semibold text-amber-900">What the customer is leaving with the shop</h3>
        <p className="mt-1 text-xs text-amber-800">
          Each item gets its own tag number. Note any damage now — a tear found at collection that
          was not written down at intake is an argument the shop cannot win.
        </p>

        <div className="mt-3 space-y-2">
          {intake.map((item, index) => (
            <div key={item.key} className="grid gap-2 sm:grid-cols-2">
              <input
                className={field}
                placeholder="Wedding portrait, sepia 8x10"
                value={item.description}
                onChange={(e) =>
                  setIntake((c) => c.map((i) => (i.key === item.key ? { ...i, description: e.target.value } : i)))
                }
              />
              <input
                className={field}
                placeholder="Condition — small tear top-left"
                value={item.conditionNote}
                onChange={(e) =>
                  setIntake((c) => c.map((i) => (i.key === item.key ? { ...i, conditionNote: e.target.value } : i)))
                }
              />
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setIntake((c) => [...c, { key: Math.random().toString(36).slice(2), description: '', conditionNote: '' }])}
          className="mt-2 text-xs text-amber-900 underline"
        >
          Another item
        </button>
      </div>

      <Errors state={state} />
      {state?.ok && state.tags?.length > 0 && (
        <p className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          Accepted. Tag{state.tags.length > 1 ? 's' : ''} <strong>{state.tags.join(', ')}</strong> —
          write this on the item and give the customer the slip.
        </p>
      )}

      <button className={button} disabled={pending}>{pending ? 'Saving...' : 'Accept and take deposit'}</button>
    </form>
  );
}

/* ------------------------------------------------------ collecting */

export function CollectForm({ job }) {
  const [state, action, pending] = useActionState(collect, null);
  const balance = job.total_kobo - job.paidKobo;
  const [payment, setPayment] = useState(String(balance / 100));

  const held = job.custody.filter((c) => !c.released_at);

  let paying = 0;
  try { paying = payment ? parseAmount(payment) : 0; } catch { paying = 0; }

  return (
    <form action={action} className="space-y-4 rounded-lg border border-emerald-300 bg-white p-5">
      <input type="hidden" name="jobId" value={job.id} />

      <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Hand over</h2>

      <div className="rounded border border-stone-200 bg-stone-50 p-3 text-sm">
        <div className="flex justify-between"><span>Job total</span><span className="tabular-nums">{formatNaira(job.total_kobo)}</span></div>
        <div className="flex justify-between"><span>Already paid</span><span className="tabular-nums">{formatNaira(job.paidKobo)}</span></div>
        <div className="mt-1 flex justify-between border-t border-stone-200 pt-1 font-medium">
          <span>Balance</span><span className="tabular-nums">{formatNaira(balance)}</span>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="payment">Taking now</label>
          <input id="payment" name="payment" className={field} value={payment}
            onChange={(e) => setPayment(e.target.value)} inputMode="decimal" />
          {paying < balance && (
            <p className="mt-1 text-xs text-amber-700">
              {formatNaira(balance - paying)} will be left owing.
            </p>
          )}
        </div>
        <div>
          <label className={label} htmlFor="collectMethod">Paid by</label>
          <select id="collectMethod" name="method" className={field}>
            <option value="cash">Cash</option>
            <option value="transfer">Transfer</option>
            <option value="pos">POS</option>
          </select>
        </div>
      </div>

      {held.length > 0 && (
        <div className="rounded border border-amber-200 bg-amber-50 p-4">
          <h3 className="text-sm font-semibold text-amber-900">
            Releasing {held.length} item{held.length > 1 ? 's' : ''} back to the customer
          </h3>
          <ul className="mt-1 space-y-0.5 text-xs text-amber-900">
            {held.map((item) => (
              <li key={item.id}><span className="font-mono">{item.tag_number}</span> — {item.description}</li>
            ))}
          </ul>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor="releasedTo">Collected by</label>
              <input id="releasedTo" name="releasedTo" className={field} placeholder="Name of whoever is taking it" required />
              <p className="mt-1 text-xs text-amber-800">
                Required. If a family later disagrees about who collected it, this is the only answer.
              </p>
            </div>
            <div>
              <label className={label} htmlFor="releaseNote">Note</label>
              <input id="releaseNote" name="releaseNote" className={field} placeholder="Sister collected on her behalf" />
            </div>
          </div>
        </div>
      )}

      <Errors state={state} />
      {state?.ok && (
        <p className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          Handed over. Invoice <strong>{state.invoiceNumber}</strong>
          {state.balanceKobo > 0 && ` — ${formatNaira(state.balanceKobo)} still owing.`}
        </p>
      )}

      <button className={button} disabled={pending}>
        {pending ? 'Saving...' : 'Invoice, take payment and hand over'}
      </button>
    </form>
  );
}
