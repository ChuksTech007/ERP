import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { listSales } from '@/lib/sales';
import { formatNaira } from '@/lib/money';

export const dynamic = 'force-dynamic';

export default async function InvoicesPage({ searchParams }) {
  await requireUser();
  const params = await searchParams;
  const unpaidOnly = params?.unpaid === '1';

  const sales = listSales({ limit: 200, unpaidOnly });
  const owed = sales.reduce((sum, s) => sum + Math.max(0, s.balance_kobo), 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Invoices</h1>
        <p className="mt-1 text-sm text-stone-600">
          Raised when work is handed over. {formatNaira(owed)} still outstanding.
        </p>
      </div>

      <nav className="flex gap-2 text-sm">
        <Link href="/invoices" className={`rounded border px-3 py-1.5 ${!unpaidOnly ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-300'}`}>All</Link>
        <Link href="/invoices?unpaid=1" className={`rounded border px-3 py-1.5 ${unpaidOnly ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-300'}`}>Still owing</Link>
      </nav>

      {sales.length === 0 ? (
        <p className="rounded-lg border border-dashed border-stone-300 p-6 text-sm text-stone-600">
          {unpaidOnly ? 'Everything is paid up.' : 'No invoices yet. One is raised when a job is collected.'}
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
          {sales.map((sale) => (
            <Link key={sale.id} href={`/invoices/${sale.id}`}
              className={`flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 px-4 py-3 text-sm last:border-0 hover:bg-stone-50 ${sale.voided ? 'opacity-50' : ''}`}>
              <span className="flex items-center gap-3">
                <span className="font-mono text-xs text-stone-500">{sale.invoice_number}</span>
                <span className="font-medium">{sale.customer_name}</span>
                {sale.voided ? <span className="text-xs text-stone-500">cancelled</span> : null}
              </span>
              <span className="flex items-center gap-4">
                <span className="text-xs text-stone-400">{new Date(sale.sold_at).toLocaleDateString()}</span>
                {sale.balance_kobo > 0 && (
                  <span className="text-xs text-amber-700">{formatNaira(sale.balance_kobo)} owing</span>
                )}
                <span className="tabular-nums">{formatNaira(sale.total_kobo)}</span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
