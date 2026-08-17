'use client';

import { useActionState, useState } from 'react';
import { addMaterial, receive, breakage, count, opening } from './actions';
import { CATEGORIES, BASE_UNITS, CATEGORY_UNIT, formatQuantity } from '@/lib/stock-catalog';
import { formatNaira } from '@/lib/money';

const field = 'w-full rounded border border-stone-300 px-3 py-2 text-sm focus:border-stone-500 focus:outline-none';
const label = 'block text-xs font-medium uppercase tracking-wide text-stone-500';
const button = 'rounded bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50';

function Messages({ state }) {
  if (!state) return null;
  return (
    <>
      {state.errors?.length > 0 && (
        <ul className="space-y-1 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {state.errors.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}
      {state.ok && <p className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">Saved.</p>}
    </>
  );
}

/* ------------------------------------------------- new material */

export function NewMaterialForm() {
  const [state, action, pending] = useActionState(addMaterial, null);
  const [category, setCategory] = useState('moulding');
  const [baseUnit, setBaseUnit] = useState('mm');

  function changeCategory(next) {
    setCategory(next);
    // Prefill the counting unit — a moulding is a length, glass is a sheet.
    setBaseUnit(CATEGORY_UNIT[next] || 'piece');
  }

  return (
    <form action={action} className="space-y-4 rounded-lg border border-stone-200 bg-white p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={label} htmlFor="name">Name</label>
          <input id="name" name="name" className={field} placeholder="Oak 40mm" required />
        </div>

        <div>
          <label className={label} htmlFor="category">Category</label>
          <select id="category" name="category" className={field} value={category} onChange={(e) => changeCategory(e.target.value)}>
            {Object.entries(CATEGORIES).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
          </select>
        </div>

        <div>
          <label className={label} htmlFor="baseUnit">How it is counted</label>
          <select id="baseUnit" name="baseUnit" className={field} value={baseUnit} onChange={(e) => setBaseUnit(e.target.value)}>
            {Object.entries(BASE_UNITS).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
          </select>
        </div>

        <div>
          <label className={label} htmlFor="packSize">
            {baseUnit === 'mm' ? 'Length of one pack (mm)' : baseUnit === 'mm2' ? 'Area of one sheet (mm²)' : 'Units per pack'}
          </label>
          <input
            id="packSize" name="packSize" className={field} inputMode="numeric" required
            placeholder={baseUnit === 'mm' ? '3000' : baseUnit === 'mm2' ? '1114508' : '1'}
          />
          {baseUnit === 'mm2' && (
            <p className="mt-1 text-xs text-stone-500">A 1220 × 914 sheet is 1,114,508.</p>
          )}
        </div>

        <div>
          <label className={label} htmlFor="packLabel">What a pack is called</label>
          <input id="packLabel" name="packLabel" className={field} placeholder="3 m length" required />
        </div>

        <div>
          <label className={label} htmlFor="costPerPack">Cost per pack</label>
          <input id="costPerPack" name="costPerPack" className={field} placeholder="10,500" inputMode="decimal" />
        </div>

        <div>
          <label className={label} htmlFor="reorderBase">Reorder when below (base units)</label>
          <input id="reorderBase" name="reorderBase" className={field} inputMode="numeric" placeholder="6000" />
        </div>

        {category === 'moulding' && (
          <div>
            <label className={label} htmlFor="mouldingWidthMm">Face width (mm)</label>
            <input id="mouldingWidthMm" name="mouldingWidthMm" className={field} inputMode="numeric" placeholder="40" required />
            <p className="mt-1 text-xs text-stone-500">Decides the mitre allowance when quoting.</p>
          </div>
        )}

        {baseUnit === 'mm2' && (
          <div>
            <label className={label} htmlFor="yieldPct">Usable yield (%)</label>
            <input id="yieldPct" name="yieldPct" className={field} inputMode="numeric" placeholder="70" />
            <p className="mt-1 text-xs text-stone-500">How much of a sheet the shop really gets after offcuts.</p>
          </div>
        )}

        <div>
          <label className={label} htmlFor="shelf">Shelf</label>
          <input id="shelf" name="shelf" className={field} placeholder="Rack B" />
        </div>
      </div>

      <Messages state={state} />
      <button className={button} disabled={pending}>{pending ? 'Saving...' : 'Add material'}</button>
    </form>
  );
}

/* --------------------------------------------- movement dialogs */

export function MovementForms({ material }) {
  const [open, setOpen] = useState(null);
  const has = (kind) => open === kind;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 text-xs">
        {[
          ['receive', 'Receive delivery'],
          ['breakage', 'Record breakage'],
          ['count', 'Stock count'],
          ...(material.quantity_base === 0 ? [['opening', 'Set opening stock']] : []),
        ].map(([kind, text]) => (
          <button
            key={kind}
            onClick={() => setOpen(has(kind) ? null : kind)}
            className={`rounded border px-3 py-1.5 ${has(kind) ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-300'}`}
          >
            {text}
          </button>
        ))}
      </div>

      {has('receive') && <ReceiveForm material={material} />}
      {has('breakage') && <BreakageForm material={material} />}
      {has('count') && <CountForm material={material} />}
      {has('opening') && <OpeningForm material={material} />}
    </div>
  );
}

function ReceiveForm({ material }) {
  const [state, action, pending] = useActionState(receive, null);
  const [packs, setPacks] = useState('');
  const [cost, setCost] = useState(String(material.cost_per_pack_kobo / 100));

  const arriving = Number(packs) > 0 ? Math.round(Number(packs) * material.pack_size) : 0;

  return (
    <form action={action} className="space-y-3 rounded border border-stone-200 bg-stone-50 p-4">
      <input type="hidden" name="materialId" value={material.id} />
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label className={label}>How many {material.pack_label}s</label>
          <input name="packs" className={field} value={packs} onChange={(e) => setPacks(e.target.value)} inputMode="decimal" required />
        </div>
        <div>
          <label className={label}>Cost per {material.pack_label}</label>
          <input name="packCost" className={field} value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" />
        </div>
        <div>
          <label className={label}>Paid by</label>
          <select name="method" className={field}>
            <option value="cash">Cash</option>
            <option value="transfer">Transfer</option>
            <option value="pos">POS</option>
          </select>
          <label className="mt-2 flex items-center gap-2 text-xs text-stone-600">
            <input type="checkbox" name="onCredit" /> On credit — owe the supplier
          </label>
        </div>
      </div>

      {arriving > 0 && (
        <p className="text-sm text-stone-600">
          Adds {formatQuantity(arriving, material)} to the shelf.
        </p>
      )}

      <Messages state={state} />
      <button className={button} disabled={pending}>{pending ? 'Saving...' : 'Receive'}</button>
    </form>
  );
}

function BreakageForm({ material }) {
  const [state, action, pending] = useActionState(breakage, null);

  return (
    <form action={action} className="space-y-3 rounded border border-amber-200 bg-amber-50 p-4">
      <input type="hidden" name="materialId" value={material.id} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label}>How much was lost ({material.base_unit})</label>
          <input name="quantityBase" className={field} inputMode="numeric" required />
        </div>
        <div>
          <label className={label}>What happened</label>
          <input name="reason" className={field} placeholder="Sheet cracked lifting it off the rack" required />
        </div>
      </div>
      <p className="text-xs text-amber-800">
        A reason is required. An unexplained write-off cannot be looked into later.
      </p>
      <Messages state={state} />
      <button className={button} disabled={pending}>{pending ? 'Saving...' : 'Record breakage'}</button>
    </form>
  );
}

function CountForm({ material }) {
  const [state, action, pending] = useActionState(count, null);
  const [counted, setCounted] = useState('');

  const difference = counted === '' ? null : Number(counted) - material.quantity_base;

  return (
    <form action={action} className="space-y-3 rounded border border-stone-200 bg-stone-50 p-4">
      <input type="hidden" name="materialId" value={material.id} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className={label}>Counted on the shelf ({material.base_unit})</label>
          <input name="countedBase" className={field} value={counted} onChange={(e) => setCounted(e.target.value)} inputMode="numeric" required />
        </div>
        <div>
          <label className={label}>Why it differs</label>
          <input name="reason" className={field} placeholder="Monthly count" required />
        </div>
      </div>

      {difference !== null && difference !== 0 && (
        <p className={`text-sm ${difference < 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
          {difference < 0 ? 'Short by' : 'Over by'} {formatQuantity(Math.abs(difference), material)}
          {difference < 0 ? ' — charged to materials.' : ' — put back into stock.'}
        </p>
      )}

      <Messages state={state} />
      <button className={button} disabled={pending}>{pending ? 'Saving...' : 'Save count'}</button>
    </form>
  );
}

function OpeningForm({ material }) {
  const [state, action, pending] = useActionState(opening, null);

  return (
    <form action={action} className="space-y-3 rounded border border-stone-200 bg-stone-50 p-4">
      <input type="hidden" name="materialId" value={material.id} />
      <div>
        <label className={label}>Already on the shelf ({material.base_unit})</label>
        <input name="quantityBase" className={field} inputMode="numeric" required />
        <p className="mt-1 text-xs text-stone-500">
          Stock the shop already owned before using this system. Can only be set once.
        </p>
      </div>
      <Messages state={state} />
      <button className={button} disabled={pending}>{pending ? 'Saving...' : 'Set opening stock'}</button>
    </form>
  );
}
