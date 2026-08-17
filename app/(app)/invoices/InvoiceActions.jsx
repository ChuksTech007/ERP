'use client';

import { useActionState, useState } from 'react';
import { pay, giveRefund, cancelInvoice } from './actions';
import { formatNaira } from '@/lib/money';

const field = 'w-full rounded border border-stone-300 px-3 py-2 text-sm focus:border-stone-500 focus:outline-none';
const label = 'block text-xs font-medium uppercase tracking-wide text-stone-500';

function Feedback({ state, done }) {
  if (!state) return null;
  if (state.errors?.length) {
    return (
      <ul className="space-y-1 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
        {state.errors.map((e) => <li key={e}>{e}</li>)}
      </ul>
    );
  }
  if (state.ok) return <p className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{done}</p>;
  return null;
}

export function PaymentForm({ sale }) {
  const [state, action, pending] = useActionState(pay, null);
  const [amount, setAmount] = useState(String(sale.balanceKobo / 100));

  return (
    <form action={action} className="space-y-3 rounded-lg border border-stone-200 bg-white p-5">
      <input type="hidden" name="saleId" value={sale.id} />
      <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Take a payment</h2>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className={label}>Amount</label>
          <input name="amount" className={field} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" required />
        </div>
        <div>
          <label className={label}>Paid by</label>
          <select name="method" className={field}>
            <option value="cash">Cash</option>
            <option value="transfer">Transfer</option>
            <option value="pos">POS</option>
          </select>
        </div>
        <div>
          <label className={label}>Reference</label>
          <input name="reference" className={field} />
        </div>
      </div>

      <p className="text-xs text-stone-500">Outstanding {formatNaira(sale.balanceKobo)}.</p>
      <Feedback state={state} done="Payment recorded." />
      <button className="rounded bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={pending}>
        {pending ? 'Saving...' : 'Record payment'}
      </button>
    </form>
  );
}

export function RefundForm({ sale }) {
  const [state, action, pending] = useActionState(giveRefund, null);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-sm text-stone-500 hover:text-stone-900">
        Refund money to this customer
      </button>
    );
  }

  return (
    <form action={action} className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-5">
      <input type="hidden" name="saleId" value={sale.id} />
      <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-900">Refund</h2>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className={label}>Amount</label>
          <input name="amount" className={field} inputMode="decimal" required />
        </div>
        <div>
          <label className={label}>Paid out by</label>
          <select name="method" className={field}>
            <option value="cash">Cash</option>
            <option value="transfer">Transfer</option>
            <option value="pos">POS</option>
          </select>
        </div>
        <div>
          <label className={label}>Reason</label>
          <input name="reason" className={field} placeholder="Frame damaged in the workshop" required />
        </div>
      </div>

      <p className="text-xs text-amber-800">
        Recorded as money going back out, not by altering what was taken — otherwise the day&rsquo;s
        takings would look as though the money never arrived. At most {formatNaira(sale.paidKobo)}.
      </p>

      <Feedback state={state} done="Refund recorded." />
      <div className="flex gap-2">
        <button className="rounded bg-amber-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={pending}>
          {pending ? 'Saving...' : 'Refund'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 text-sm text-stone-600">Cancel</button>
      </div>
    </form>
  );
}

export function VoidForm({ sale }) {
  const [state, action, pending] = useActionState(cancelInvoice, null);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="text-sm text-stone-500 hover:text-red-700">
        Cancel this invoice
      </button>
    );
  }

  return (
    <form action={action} className="space-y-3 rounded-lg border border-red-300 bg-red-50 p-5">
      <input type="hidden" name="saleId" value={sale.id} />
      <h2 className="text-sm font-semibold uppercase tracking-wide text-red-900">Cancel invoice</h2>

      <div>
        <label className={label}>Why</label>
        <input name="reason" className={field} placeholder="Raised against the wrong customer" required />
      </div>

      <p className="text-xs text-red-800">
        The invoice stays in the book marked cancelled, and its ledger entry is reversed rather
        than deleted. A missing invoice number looks exactly like a sale somebody pocketed.
        {sale.paidKobo > 0 && (
          <>
            {' '}
            <strong>{formatNaira(sale.paidKobo)} has already been paid</strong> and is not touched
            by this — refund it deliberately if it is going back.
          </>
        )}
      </p>

      <Feedback state={state} done="Invoice cancelled." />
      <div className="flex gap-2">
        <button className="rounded bg-red-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50" disabled={pending}>
          {pending ? 'Cancelling...' : 'Cancel it'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 text-sm text-stone-600">Keep it</button>
      </div>
    </form>
  );
}
