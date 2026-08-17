import Link from 'next/link';
import { requireUser, canSeeCosts } from '@/lib/auth';
import { listMaterials, lowStock, movementsFor, stockValueAtCost } from '@/lib/stock';
import { formatQuantity, CATEGORIES, MOVEMENT_LABELS } from '@/lib/stock-catalog';
import { formatNaira } from '@/lib/money';
import { NewMaterialForm, MovementForms } from './StockForms';

export const dynamic = 'force-dynamic';

export default async function StockPage({ searchParams }) {
  const user = await requireUser();
  const showCosts = canSeeCosts(user);

  const params = await searchParams;
  const adding = params?.new === '1';
  const openId = params?.open || null;

  const materials = listMaterials();
  const low = lowStock();
  const movements = openId ? movementsFor(openId, { limit: 20 }) : [];

  const groups = new Map();
  for (const material of materials) {
    if (!groups.has(material.category)) groups.set(material.category, []);
    groups.get(material.category).push(material);
  }

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Stock</h1>
          <p className="mt-1 text-sm text-stone-600">
            Counted in lengths, sheets and pieces. Used by the millimetre.
          </p>
        </div>
        <Link
          href={adding ? '/stock' : '/stock?new=1'}
          className="rounded bg-stone-900 px-4 py-2 text-sm font-medium text-white"
        >
          {adding ? 'Cancel' : 'New material'}
        </Link>
      </div>

      {adding && <NewMaterialForm />}

      {low.length > 0 && (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <h2 className="text-sm font-semibold text-amber-900">Running low</h2>
          <ul className="mt-2 space-y-1 text-sm text-amber-900">
            {low.map((material) => (
              <li key={material.id}>
                {material.name} — {formatQuantity(material.quantity_base, material)} left
              </li>
            ))}
          </ul>
        </section>
      )}

      {materials.length === 0 ? (
        <p className="rounded-lg border border-dashed border-stone-300 p-6 text-sm text-stone-600">
          No materials yet. Add the mouldings, glass and board the shop keeps, then set what is
          already on the shelf as opening stock.
        </p>
      ) : (
        [...groups.entries()].map(([category, rows]) => (
          <section key={category}>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
              {CATEGORIES[category]}
            </h2>
            <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
              {rows.map((material) => {
                const open = openId === material.id;
                return (
                  <div key={material.id} className="border-b border-stone-100 last:border-0">
                    <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                      <div>
                        <Link
                          href={open ? '/stock' : `/stock?open=${material.id}`}
                          className="font-medium hover:underline"
                        >
                          {material.name}
                        </Link>
                        {material.shelf && <span className="ml-2 text-xs text-stone-500">{material.shelf}</span>}
                        {material.moulding_width_mm > 0 && (
                          <span className="ml-2 text-xs text-stone-500">{material.moulding_width_mm} mm face</span>
                        )}
                      </div>

                      <div className="flex items-center gap-4 text-sm">
                        <span
                          className={`tabular-nums ${material.quantity_base < 0 ? 'font-medium text-red-700' : ''}`}
                        >
                          {formatQuantity(material.quantity_base, material)}
                        </span>
                        {showCosts && (
                          <span className="tabular-nums text-stone-500">
                            {formatNaira(material.cost_per_pack_kobo)}/{material.pack_label}
                          </span>
                        )}
                      </div>
                    </div>

                    {material.quantity_base < 0 && (
                      <p className="px-4 pb-2 text-xs text-red-700">
                        More has been used than was received. Count the shelf and correct it.
                      </p>
                    )}

                    {open && (
                      <div className="space-y-4 border-t border-stone-100 bg-stone-50 px-4 py-4">
                        <MovementForms material={material} />

                        {movements.length > 0 && (
                          <div>
                            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-500">
                              Recent movements
                            </h3>
                            <div className="overflow-hidden rounded border border-stone-200 bg-white">
                              {movements.map((movement) => (
                                <div
                                  key={movement.id}
                                  className="flex items-center justify-between border-b border-stone-100 px-3 py-1.5 text-xs last:border-0"
                                >
                                  <span>{MOVEMENT_LABELS[movement.kind] || movement.kind}</span>
                                  <span className="text-stone-500">{movement.reason}</span>
                                  <span className={`tabular-nums ${movement.delta_base < 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                                    {movement.delta_base > 0 ? '+' : ''}
                                    {movement.delta_base}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        ))
      )}

      {showCosts && materials.length > 0 && (
        <p className="text-sm text-stone-500">
          Stock on the books: <span className="tabular-nums">{formatNaira(stockValueAtCost())}</span>
        </p>
      )}
    </div>
  );
}
