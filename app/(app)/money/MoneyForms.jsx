'use client';

import { useActionState } from 'react';
import { addExpense, saveSettings } from './actions';

const field = 'w-full rounded border border-stone-300 px-3 py-2 text-sm focus:border-stone-500 focus:outline-none';
const label = 'block text-xs font-medium uppercase tracking-wide text-stone-500';
const button = 'rounded bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50';

function Feedback({ state, done = 'Saved.' }) {
  if (!state) return null;
  if (state.errors?.length) {
    return (
      <ul className="space-y-1 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
        {state.errors.map((e) => <li key={e}>{e}</li>)}
      </ul>
    );
  }
  if (state.ok) {
    return <p className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{done}</p>;
  }
  return null;
}

export function ExpenseForm({ accounts }) {
  const [state, action, pending] = useActionState(addExpense, null);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={action} className="space-y-4 rounded-lg border border-stone-200 bg-white p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Record a payment out</h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="description">What was it for</label>
          <input id="description" name="description" className={field} placeholder="August rent" required />
        </div>
        <div>
          <label className={label} htmlFor="amount">Amount</label>
          <input id="amount" name="amount" className={field} inputMode="decimal" placeholder="30,000" required />
        </div>
        <div>
          <label className={label} htmlFor="accountCode">Kind of expense</label>
          <select id="accountCode" name="accountCode" className={field} required>
            {accounts.map((a) => <option key={a.code} value={a.code}>{a.name}</option>)}
          </select>
        </div>
        <div>
          <label className={label} htmlFor="method">Paid by</label>
          <select id="method" name="method" className={field}>
            <option value="cash">Cash</option>
            <option value="transfer">Transfer</option>
            <option value="pos">POS</option>
          </select>
        </div>
        <div>
          <label className={label} htmlFor="spentAt">Date</label>
          <input id="spentAt" name="spentAt" type="date" className={field} defaultValue={today} />
        </div>
        <div>
          <label className={label} htmlFor="reference">Reference</label>
          <input id="reference" name="reference" className={field} placeholder="Receipt number" />
        </div>
      </div>

      <p className="text-xs text-stone-500">
        Materials are not recorded here. Buying moulding is cash turning into stock rather than
        money spent, so it goes through <span className="font-medium">Stock → Receive delivery</span>.
      </p>

      <Feedback state={state} done="Recorded." />
      <button className={button} disabled={pending}>{pending ? 'Saving...' : 'Record it'}</button>
    </form>
  );
}

export function SettingsForm({ settings }) {
  const [state, action, pending] = useActionState(saveSettings, null);
  const naira = (key) => String((Number(settings[key]) || 0) / 100);

  return (
    <form action={action} className="space-y-4 rounded-lg border border-stone-200 bg-white p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Shop settings</h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={label} htmlFor="shopName">Shop name</label>
          <input id="shopName" name="shopName" className={field} defaultValue={settings['shop.name'] || ''} />
        </div>
        <div>
          <label className={label} htmlFor="shopPhone">Phone</label>
          <input id="shopPhone" name="shopPhone" className={field} defaultValue={settings['shop.phone'] || ''} />
        </div>
        <div className="sm:col-span-2">
          <label className={label} htmlFor="shopAddress">Address</label>
          <input id="shopAddress" name="shopAddress" className={field} defaultValue={settings['shop.address'] || ''} />
        </div>

        <div>
          <label className={label} htmlFor="minCharge">Minimum charge per piece</label>
          <input id="minCharge" name="minCharge" className={field} inputMode="decimal"
            defaultValue={naira('pricing.minCharge_kobo')} />
          <p className="mt-1 text-xs text-stone-500">
            Below this nobody works for what the formula says. Left at zero, a very small frame is
            quoted at little more than its materials.
          </p>
        </div>
        <div>
          <label className={label} htmlFor="defaultLabour">Usual labour per piece</label>
          <input id="defaultLabour" name="defaultLabour" className={field} inputMode="decimal"
            defaultValue={naira('pricing.defaultLabour_kobo')} />
        </div>
        <div>
          <label className={label} htmlFor="mountBorder">Usual mount border (mm)</label>
          <input id="mountBorder" name="mountBorder" className={field} inputMode="numeric"
            defaultValue={settings['pricing.defaultMountBorder_mm'] || '50'} />
        </div>
        <div>
          <label className={label} htmlFor="depositPercent">Deposit taken (%)</label>
          <input id="depositPercent" name="depositPercent" className={field} inputMode="decimal"
            defaultValue={String((Number(settings['pricing.depositPercent_bp']) || 0) / 100)} />
        </div>
        <div>
          <label className={label} htmlFor="quoteUnit">Sizes are quoted in</label>
          <select id="quoteUnit" name="quoteUnit" className={field} defaultValue={settings['quote.unit'] || 'in'}>
            <option value="in">inches</option>
            <option value="cm">centimetres</option>
            <option value="mm">millimetres</option>
          </select>
        </div>
      </div>

      <Feedback state={state} />
      <button className={button} disabled={pending}>{pending ? 'Saving...' : 'Save settings'}</button>
    </form>
  );
}
