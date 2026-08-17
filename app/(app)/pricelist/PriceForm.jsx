'use client';

import { useActionState, useState } from 'react';
import { savePriceItem } from './actions';
import { CATEGORY_MODES, CATEGORY_LABELS, MODE_LABELS } from '@/lib/price-catalog';
import { formatNaira, parseAmount } from '@/lib/money';
import { mouldingLengthMm, glassSize, areaMm2, inchesToMm } from '@/lib/measure';

/* A reference frame, used only to show what a rate means in practice.
 * 24 x 36 inches is the size customers ask for most, so the example is one
 * staff can sanity-check against what they know the shop charges. */
const EXAMPLE = { widthIn: 24, heightIn: 36, mountBorderMm: 50 };

/**
 * What this rate would charge on a real frame.
 *
 * The gap between "₦8,000" and "₦8,000 per square metre" is where quoting
 * mistakes live. Showing the worked figure as the rate is typed turns an
 * abstract unit into something the shop can recognise as right or wrong
 * before it is saved rather than after it has been quoted to a customer.
 */
function workedExample({ category, mode, price, mouldingWidthMm, wastageMm, cutting }) {
  let priceKobo;
  try {
    priceKobo = price ? parseAmount(price) : 0;
  } catch {
    return null;
  }
  if (!priceKobo) return null;

  const artwork = { w: inchesToMm(EXAMPLE.widthIn), h: inchesToMm(EXAMPLE.heightIn) };
  const glass = glassSize(artwork.w, artwork.h, EXAMPLE.mountBorderMm);

  if (mode === 'per_m') {
    const width = Number(mouldingWidthMm) || 0;
    const lengthMm = mouldingLengthMm(glass.widthMm, glass.heightMm, width, {
      wastageMm: Number(wastageMm) || 0,
    });
    const amount = Math.round((priceKobo * lengthMm) / 1000);
    return {
      detail: `${(lengthMm / 1000).toFixed(2)} m of moulding (perimeter, mitres and wastage)`,
      amount,
    };
  }

  if (mode === 'per_sqm') {
    const mm2 = areaMm2(glass.widthMm, glass.heightMm);
    const amount = Math.round((priceKobo * mm2) / 1_000_000);
    return { detail: `${(mm2 / 1_000_000).toFixed(2)} m² at ${glass.widthMm} × ${glass.heightMm} mm`, amount };
  }

  if (mode === 'per_aperture') {
    return { detail: 'one opening', amount: priceKobo };
  }

  return { detail: 'one piece', amount: priceKobo };
}

const field = 'w-full rounded border border-stone-300 px-3 py-2 text-sm focus:border-stone-500 focus:outline-none';
const label = 'block text-xs font-medium uppercase tracking-wide text-stone-500';

export default function PriceForm({ item = null, onDone, showCosts = false }) {
  const [state, action, pending] = useActionState(savePriceItem, null);

  const [category, setCategory] = useState(item?.category || 'moulding');
  const [mode, setMode] = useState(item?.mode || CATEGORY_MODES[item?.category || 'moulding'][0]);
  const [price, setPrice] = useState(item ? String(item.price_kobo / 100) : '');
  const [mouldingWidthMm, setMouldingWidthMm] = useState(item?.moulding_width_mm || '');
  const [wastageMm, setWastageMm] = useState(item?.wastage_mm || '');
  const [cutting, setCutting] = useState(item ? String(item.cutting_kobo / 100) : '');

  const modes = CATEGORY_MODES[category] || ['per_piece'];
  const example = workedExample({ category, mode, price, mouldingWidthMm, wastageMm, cutting });

  function changeCategory(next) {
    setCategory(next);
    // Keep the mode legal: a glass cannot stay "per metre" because the
    // category was switched from moulding.
    if (!CATEGORY_MODES[next].includes(mode)) setMode(CATEGORY_MODES[next][0]);
  }

  return (
    <form
      action={action}
      className="space-y-4 rounded-lg border border-stone-200 bg-white p-5"
      onSubmit={() => queueMicrotask(() => onDone?.())}
    >
      {item && <input type="hidden" name="id" value={item.id} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={label} htmlFor="name">Name</label>
          <input
            id="name"
            name="name"
            className={field}
            defaultValue={item?.name || ''}
            placeholder="Oak 40mm, Clear glass 2mm, Mount cutting..."
            required
          />
        </div>

        <div>
          <label className={label} htmlFor="category">Kind of item</label>
          <select
            id="category"
            name="category"
            className={field}
            value={category}
            onChange={(e) => changeCategory(e.target.value)}
          >
            {Object.entries(CATEGORY_LABELS).map(([value, text]) => (
              <option key={value} value={value}>{text}</option>
            ))}
          </select>
        </div>

        <div>
          <label className={label} htmlFor="mode">Charged</label>
          <select
            id="mode"
            name="mode"
            className={field}
            value={mode}
            onChange={(e) => setMode(e.target.value)}
          >
            {modes.map((value) => (
              <option key={value} value={value}>{MODE_LABELS[value]}</option>
            ))}
          </select>
          {modes.length === 1 && (
            <p className="mt-1 text-xs text-stone-500">
              {CATEGORY_LABELS[category]} is always charged {MODE_LABELS[modes[0]]}.
            </p>
          )}
        </div>

        <div>
          <label className={label} htmlFor="price">Price ({MODE_LABELS[mode]})</label>
          <input
            id="price"
            name="price"
            className={field}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="3,500"
            inputMode="decimal"
          />
        </div>

        {showCosts && (
          <div>
            <label className={label} htmlFor="cost">
              Cost to us ({MODE_LABELS[mode]})
            </label>
            <input
              id="cost"
              name="cost"
              className={field}
              defaultValue={item ? String(item.cost_kobo / 100) : ''}
              placeholder="Optional"
              inputMode="decimal"
            />
            <p className="mt-1 text-xs text-stone-500">Owner only. Drives the profit figure.</p>
          </div>
        )}

        {category === 'moulding' && (
          <>
            <div>
              <label className={label} htmlFor="mouldingWidthMm">Face width (mm)</label>
              <input
                id="mouldingWidthMm"
                name="mouldingWidthMm"
                className={field}
                value={mouldingWidthMm}
                onChange={(e) => setMouldingWidthMm(e.target.value)}
                placeholder="40"
                inputMode="numeric"
                required
              />
              <p className="mt-1 text-xs text-stone-500">
                How wide the moulding is. Each of the four mitred corners eats twice this, so
                without it every frame is quoted short.
              </p>
            </div>

            <div>
              <label className={label} htmlFor="wastageMm">Offcut allowance (mm)</label>
              <input
                id="wastageMm"
                name="wastageMm"
                className={field}
                value={wastageMm}
                onChange={(e) => setWastageMm(e.target.value)}
                placeholder="150"
                inputMode="numeric"
              />
              <p className="mt-1 text-xs text-stone-500">
                The tail end of a length that is rarely usable on the next job.
              </p>
            </div>
          </>
        )}

        {category === 'mount_board' && (
          <div>
            <label className={label} htmlFor="cutting">Cutting, per opening</label>
            <input
              id="cutting"
              name="cutting"
              className={field}
              value={cutting}
              onChange={(e) => setCutting(e.target.value)}
              placeholder="500"
              inputMode="decimal"
            />
            <p className="mt-1 text-xs text-stone-500">
              Charged once per aperture — a triple mount is three cuts on one board.
            </p>
          </div>
        )}
      </div>

      {example && (
        <div className="rounded border border-stone-200 bg-stone-50 p-3 text-sm">
          <span className="text-stone-500">On a 24 × 36 in frame with a 50 mm mount, this uses </span>
          <span className="text-stone-700">{example.detail}</span>
          <span className="text-stone-500"> and charges </span>
          <span className="font-semibold text-stone-900">{formatNaira(example.amount)}</span>
        </div>
      )}

      {state?.errors?.length > 0 && (
        <ul className="space-y-1 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {state.errors.map((error) => <li key={error}>{error}</li>)}
        </ul>
      )}

      {state?.warnings?.length > 0 && (
        <ul className="space-y-1 rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {state.warnings.map((warning) => <li key={warning}>{warning}</li>)}
        </ul>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? 'Saving...' : item ? 'Save changes' : 'Add to price list'}
        </button>
        {onDone && (
          <button type="button" onClick={onDone} className="rounded px-4 py-2 text-sm text-stone-600">
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
