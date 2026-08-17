'use client';

import { useActionState, useState } from 'react';
import { saveQuote } from '../actions';
import { priceFramedPiece } from '@/lib/pricing';
import { formatNaira, parseAmount } from '@/lib/money';
import { inchesToMm, cmToMm, glassSize, formatSize } from '@/lib/measure';

const field = 'w-full rounded border border-stone-300 px-2 py-1.5 text-sm focus:border-stone-500 focus:outline-none';
const label = 'block text-xs font-medium uppercase tracking-wide text-stone-500';

/** Sizes are typed in whatever the counter speaks; everything is stored in mm. */
const TO_MM = { in: inchesToMm, cm: cmToMm, mm: (n) => Math.round(n) };

const blankPiece = () => ({
  key: Math.random().toString(36).slice(2),
  description: '',
  width: '',
  height: '',
  unit: 'in',
  mountBorderMm: '50',
  mountApertures: '1',
  quantity: '1',
  mouldingPriceId: '',
  glazingPriceId: '',
  mountPriceId: '',
  backingPriceId: '',
  labour: '',
});

/** Turn what was typed into the shape the pricing engine wants. */
function toSpec(piece, minChargeKobo) {
  const convert = TO_MM[piece.unit] || TO_MM.mm;
  const width = Number(piece.width);
  const height = Number(piece.height);
  if (!(width > 0) || !(height > 0)) return null;

  let labourKobo = 0;
  try {
    labourKobo = piece.labour ? parseAmount(piece.labour) : 0;
  } catch {
    return null;
  }

  return {
    description: piece.description || 'Framed piece',
    artworkWidthMm: convert(width),
    artworkHeightMm: convert(height),
    mountBorderMm: Number(piece.mountBorderMm) || 0,
    mountApertures: Number(piece.mountApertures) || 1,
    quantity: Number(piece.quantity) || 1,
    labourKobo,
    minChargeKobo,
    mouldingPriceId: piece.mouldingPriceId || null,
    glazingPriceId: piece.glazingPriceId || null,
    mountPriceId: piece.mountPriceId || null,
    backingPriceId: piece.backingPriceId || null,
  };
}

export default function QuoteBuilder({ priceItems, customers, minChargeKobo = 0, defaultMountBorderMm = 50 }) {
  const [state, action, pending] = useActionState(saveQuote, null);
  const [pieces, setPieces] = useState([{ ...blankPiece(), mountBorderMm: String(defaultMountBorderMm) }]);
  const [customerId, setCustomerId] = useState('');

  const byCategory = (category) => priceItems.filter((p) => p.category === category);

  const update = (key, patch) =>
    setPieces((current) => current.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  /* Priced in the browser as it is typed, with the same engine the server
   * uses. The customer is standing at the counter waiting for a number, and a
   * round trip per keystroke is not an answer. The saved figure is always
   * recomputed on the server from the same inputs. */
  const priced = pieces.map((piece) => {
    const spec = toSpec(piece, minChargeKobo);
    if (!spec) return { piece, quote: null, spec: null };

    const parts = {};
    const attach = (slot, id) => {
      const item = priceItems.find((p) => p.id === id);
      if (item) {
        parts[slot] = {
          id: item.id,
          name: item.name,
          priceKobo: item.price_kobo,
          cuttingKobo: item.cutting_kobo,
          mouldingWidthMm: item.moulding_width_mm,
          wastageMm: item.wastage_mm,
        };
      }
    };
    attach('moulding', piece.mouldingPriceId);
    attach('glazing', piece.glazingPriceId);
    attach('mountBoard', piece.mountPriceId);
    attach('backing', piece.backingPriceId);

    try {
      return { piece, quote: priceFramedPiece(spec, parts), spec };
    } catch {
      return { piece, quote: null, spec };
    }
  });

  const total = priced.reduce((sum, p) => sum + (p.quote?.totalKobo || 0), 0);
  const specs = priced.filter((p) => p.spec && p.quote).map((p) => p.spec);

  return (
    <form action={action} className="space-y-6">
      <input type="hidden" name="items" value={JSON.stringify(specs)} />

      {/* --- who it is for */}
      <section className="rounded-lg border border-stone-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">Customer</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className={label} htmlFor="existing">Known customer</label>
            <select
              id="existing"
              name="customerId"
              className={field}
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
            >
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
                <input id="customerName" name="customerName" className={field} required />
              </div>
              <div>
                <label className={label} htmlFor="customerPhone">Phone</label>
                <input id="customerPhone" name="customerPhone" className={field} inputMode="tel" placeholder="0803 111 2222" />
              </div>
            </>
          )}
        </div>
      </section>

      {/* --- the pieces */}
      {priced.map(({ piece, quote }, index) => (
        <section key={piece.key} className="rounded-lg border border-stone-200 bg-white p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">
              Piece {index + 1}
            </h2>
            {pieces.length > 1 && (
              <button
                type="button"
                onClick={() => setPieces((c) => c.filter((p) => p.key !== piece.key))}
                className="text-xs text-stone-500 hover:text-red-700"
              >
                Remove
              </button>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-6">
            <div className="sm:col-span-6">
              <label className={label} htmlFor={`desc-${piece.key}`}>What is it</label>
              <input
                id={`desc-${piece.key}`}
                className={field}
                value={piece.description}
                onChange={(e) => update(piece.key, { description: e.target.value })}
                placeholder="Wedding portrait, sepia"
              />
            </div>

            <div>
              <label className={label} htmlFor={`width-${piece.key}`}>Width</label>
              <input id={`width-${piece.key}`} className={field} value={piece.width} inputMode="decimal"
                onChange={(e) => update(piece.key, { width: e.target.value })} />
            </div>
            <div>
              <label className={label} htmlFor={`height-${piece.key}`}>Height</label>
              <input id={`height-${piece.key}`} className={field} value={piece.height} inputMode="decimal"
                onChange={(e) => update(piece.key, { height: e.target.value })} />
            </div>
            <div>
              <label className={label} htmlFor={`unit-${piece.key}`}>Unit</label>
              <select id={`unit-${piece.key}`} className={field} value={piece.unit} onChange={(e) => update(piece.key, { unit: e.target.value })}>
                <option value="in">inches</option>
                <option value="cm">cm</option>
                <option value="mm">mm</option>
              </select>
            </div>
            <div>
              <label className={label} htmlFor={`mount-${piece.key}`}>Mount (mm)</label>
              <input id={`mount-${piece.key}`} className={field} value={piece.mountBorderMm} inputMode="numeric"
                onChange={(e) => update(piece.key, { mountBorderMm: e.target.value })} />
            </div>
            <div>
              <label className={label} htmlFor={`apertures-${piece.key}`}>Openings</label>
              <input id={`apertures-${piece.key}`} className={field} value={piece.mountApertures} inputMode="numeric"
                onChange={(e) => update(piece.key, { mountApertures: e.target.value })} />
            </div>
            <div>
              <label className={label} htmlFor={`qty-${piece.key}`}>Quantity</label>
              <input id={`qty-${piece.key}`} className={field} value={piece.quantity} inputMode="numeric"
                onChange={(e) => update(piece.key, { quantity: e.target.value })} />
            </div>

            {[
              ['mouldingPriceId', 'Moulding', 'moulding'],
              ['glazingPriceId', 'Glass', 'glazing'],
              ['mountPriceId', 'Mount board', 'mount_board'],
              ['backingPriceId', 'Backing', 'backing'],
            ].map(([key, text, category]) => (
              <div key={key} className="sm:col-span-3">
                <label className={label} htmlFor={`${key}-${piece.key}`}>{text}</label>
                <select id={`${key}-${piece.key}`} className={field} value={piece[key]}
                  onChange={(e) => update(piece.key, { [key]: e.target.value })}>
                  <option value="">— none —</option>
                  {byCategory(category).map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
              </div>
            ))}

            <div className="sm:col-span-3">
              <label className={label} htmlFor={`labour-${piece.key}`}>Labour</label>
              <input id={`labour-${piece.key}`} className={field} value={piece.labour} inputMode="decimal" placeholder="2,500"
                onChange={(e) => update(piece.key, { labour: e.target.value })} />
            </div>
          </div>

          {/* The worked answer, as it is typed. */}
          {quote && (
            <div className="mt-4 rounded border border-stone-200 bg-stone-50 p-3 text-sm">
              <div className="mb-2 text-xs text-stone-500">
                Glass cut at {formatSize(quote.glassWidthMm, quote.glassHeightMm)}
                {piece.mountBorderMm > 0 && ' — the mount grows it on all four sides'}
              </div>
              {quote.lines.map((line, i) => (
                <div key={i} className="flex justify-between py-0.5">
                  <span className="text-stone-600">
                    {line.name}
                    {line.detail && <span className="text-stone-400"> · {line.detail}</span>}
                  </span>
                  <span className="tabular-nums">{formatNaira(line.amountKobo)}</span>
                </div>
              ))}
              {quote.minimumApplied && (
                <p className="py-1 text-xs text-amber-700">Minimum charge applied.</p>
              )}
              <div className="mt-2 flex justify-between border-t border-stone-200 pt-2 font-medium">
                <span>{quote.quantity > 1 ? `${quote.quantity} × ${formatNaira(quote.unitKobo)}` : 'This piece'}</span>
                <span className="tabular-nums">{formatNaira(quote.totalKobo)}</span>
              </div>
            </div>
          )}
        </section>
      ))}

      <button
        type="button"
        onClick={() => setPieces((c) => [...c, { ...blankPiece(), mountBorderMm: String(defaultMountBorderMm) }])}
        className="rounded border border-stone-300 px-4 py-2 text-sm"
      >
        Add another piece
      </button>

      <section className="rounded-lg border border-stone-200 bg-white p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={label} htmlFor="promisedAt">Promised for</label>
            <input id="promisedAt" name="promisedAt" type="date" className={field} />
          </div>
          <div>
            <label className={label} htmlFor="notes">Notes</label>
            <input id="notes" name="notes" className={field} />
          </div>
        </div>
      </section>

      <div className="flex items-center justify-between rounded-lg border border-stone-900 bg-stone-900 p-5 text-white">
        <span className="text-sm uppercase tracking-wide text-stone-300">Quote total</span>
        <span className="text-2xl font-semibold tabular-nums">{formatNaira(total)}</span>
      </div>

      {state?.errors?.length > 0 && (
        <ul className="space-y-1 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {state.errors.map((e) => <li key={e}>{e}</li>)}
        </ul>
      )}

      <button
        type="submit"
        disabled={pending || specs.length === 0}
        className="rounded bg-stone-900 px-6 py-3 font-medium text-white disabled:opacity-40"
      >
        {pending ? 'Saving...' : 'Save quote'}
      </button>
      {specs.length === 0 && (
        <p className="text-sm text-stone-500">Enter a size to price the piece.</p>
      )}
    </form>
  );
}
