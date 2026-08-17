import { listPriceItems, CATEGORY_LABELS, MODE_LABELS } from '@/lib/price-items';
import { formatNaira } from '@/lib/money';
import { retire, restore } from './actions';
import PriceForm from './PriceForm';

export const dynamic = 'force-dynamic';

export default async function PriceListPage({ searchParams }) {
  const params = await searchParams;
  const showRetired = params?.retired === '1';

  const items = listPriceItems({ includeRetired: showRetired });

  // Grouped for reading, because staff look for "the mouldings" rather than
  // scanning one long alphabetical list.
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.category)) groups.set(item.category, []);
    groups.get(item.category).push(item);
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Price list</h1>
        <p className="mt-1 text-sm text-stone-600">
          What the shop charges, and how each rate is worked out. Everything quoted comes from here.
        </p>
      </div>

      {items.length === 0 && !showRetired && (
        <div className="rounded-lg border border-dashed border-stone-300 p-6 text-sm text-stone-600">
          <p className="font-medium text-stone-800">Nothing on the price list yet.</p>
          <p className="mt-1">
            Add the mouldings, glass, mount board and labour rates the shop actually uses. Quoting
            cannot work until they are here — and nothing has been invented on your behalf.
          </p>
        </div>
      )}

      <PriceForm />

      {[...groups.entries()].map(([category, rows]) => (
        <section key={category}>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
            {CATEGORY_LABELS[category]}
          </h2>
          <div className="overflow-x-auto rounded-lg border border-stone-200 bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-stone-200 bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Charged</th>
                  <th className="px-4 py-2 text-right font-medium">Price</th>
                  <th className="px-4 py-2 text-right font-medium">Cost</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((item) => (
                  <tr
                    key={item.id}
                    className={`border-b border-stone-100 last:border-0 ${item.deleted_at ? 'opacity-50' : ''}`}
                  >
                    <td className="px-4 py-2">
                      {item.name}
                      {item.category === 'moulding' && item.moulding_width_mm > 0 && (
                        <span className="ml-2 text-xs text-stone-500">
                          {item.moulding_width_mm} mm face
                        </span>
                      )}
                      {item.deleted_at && <span className="ml-2 text-xs text-stone-500">retired</span>}
                    </td>
                    <td className="px-4 py-2 text-stone-600">{MODE_LABELS[item.mode]}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{formatNaira(item.price_kobo)}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-stone-500">
                      {item.cost_kobo ? formatNaira(item.cost_kobo) : '—'}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <form action={item.deleted_at ? restore : retire}>
                        <input type="hidden" name="id" value={item.id} />
                        <button className="text-xs text-stone-500 hover:text-stone-900">
                          {item.deleted_at ? 'Restore' : 'Retire'}
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <p className="text-sm">
        <a
          href={showRetired ? '/pricelist' : '/pricelist?retired=1'}
          className="text-stone-500 underline hover:text-stone-900"
        >
          {showRetired ? 'Hide retired items' : 'Show retired items'}
        </a>
      </p>
    </div>
  );
}
