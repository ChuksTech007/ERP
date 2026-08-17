import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser, canManage } from '@/lib/auth';
import { getSale } from '@/lib/sales';
import { formatNaira } from '@/lib/money';
import { PaymentForm, RefundForm, VoidForm } from '../InvoiceActions';

export const dynamic = 'force-dynamic';

export default async function InvoicePage({ params }) {
  const user = await requireUser();
  const { id } = await params;

  const sale = getSale(id);
  if (!sale) notFound();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/invoices" className="text-sm text-stone-500 hover:text-stone-900">← Invoices</Link>
          <h1 className="mt-1 flex items-center gap-3 text-xl font-semibold">
            <span className="font-mono text-base text-stone-500">{sale.invoice_number}</span>
            {sale.customer_name}
          </h1>
          <p className="mt-1 text-sm text-stone-600">
            {new Date(sale.sold_at).toLocaleDateString()} · {sale.status} ·{' '}
            {sale.job_id ? (
              <Link href={`/jobs/${sale.job_id}`} className="underline">from a framing job</Link>
            ) : (
              'sold over the counter'
            )}
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-semibold tabular-nums">{formatNaira(sale.total_kobo)}</div>
          <a href={`/receipt/${sale.id}`} target="_blank" rel="noreferrer"
             className="mt-2 inline-block rounded border border-stone-300 px-3 py-1.5 text-xs hover:bg-stone-100">
            Print receipt
          </a>
        </div>
      </div>

      {sale.voided && (
        <p className="rounded-lg border border-stone-300 bg-stone-100 p-4 text-sm text-stone-700">
          Cancelled — {sale.void_reason}. The ledger entry was reversed; the invoice number stays in
          the book so there is no gap.
        </p>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">What was sold</h2>
        <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
          {sale.items.map((item) => (
            <div key={item.id} className="flex justify-between border-b border-stone-100 px-4 py-2 text-sm last:border-0">
              <span>{item.description}{item.quantity > 1 ? ` × ${item.quantity}` : ''}</span>
              <span className="tabular-nums">{formatNaira(item.total_kobo)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <Tile label="Total" value={formatNaira(sale.total_kobo)} />
        <Tile label="Paid" value={formatNaira(sale.paidKobo)} />
        <Tile label="Outstanding" value={formatNaira(sale.balanceKobo)} tone={sale.balanceKobo > 0 ? 'warn' : 'good'} />
      </section>

      {sale.payments.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">Money</h2>
          <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
            {sale.payments.map((payment) => (
              <div key={payment.id} className="flex justify-between border-b border-stone-100 px-4 py-2 text-sm last:border-0">
                <span>{payment.kind}{payment.note ? ` — ${payment.note}` : ''}</span>
                <span className="text-stone-500">{payment.method} · {new Date(payment.received_at).toLocaleDateString()}</span>
                <span className={`tabular-nums ${payment.amount_kobo < 0 ? 'text-amber-700' : ''}`}>
                  {formatNaira(payment.amount_kobo)}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {!sale.voided && sale.balanceKobo > 0 && <PaymentForm sale={sale} />}

      {canManage(user) && !sale.voided && (
        <div className="flex flex-col gap-3 pt-4">
          {sale.paidKobo > 0 && <RefundForm sale={sale} />}
          <VoidForm sale={sale} />
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, tone = 'plain' }) {
  const colour = tone === 'warn' ? 'text-amber-700' : tone === 'good' ? 'text-emerald-700' : '';
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-stone-500">{label}</div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${colour}`}>{value}</div>
    </div>
  );
}
