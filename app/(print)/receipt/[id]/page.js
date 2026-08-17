import { notFound } from 'next/navigation';
import { getSale } from '@/lib/sales';
import { getSetting } from '@/lib/settings';
import { formatNaira } from '@/lib/money';
import { ShopHeader, Line, Rule } from '../../Shop';

export const dynamic = 'force-dynamic';

export default async function Receipt({ params }) {
  const { id } = await params;
  const sale = getSale(id);
  if (!sale) notFound();

  const phone = getSetting('shop.phone', '');

  return (
    <article>
      <ShopHeader title={sale.balanceKobo > 0 ? 'Invoice' : 'Receipt'} />

      <div className="mt-2 space-y-0.5">
        <Line label="Number" value={sale.invoice_number} />
        <Line label="Date" value={new Date(sale.sold_at).toLocaleDateString()} />
        <Line label="Customer" value={sale.customer_name} />
        {sale.job_id && sale.jobNumber && <Line label="Job" value={sale.jobNumber} />}
      </div>

      {sale.voided && (
        <p className="my-2 border-2 border-stone-900 py-1 text-center text-sm font-bold uppercase">
          Cancelled
        </p>
      )}

      <Rule />

      {sale.items.map((item) => (
        <div key={item.id} className="mb-1">
          <div className="flex justify-between gap-2 text-[11px]">
            <span className="flex-1">{item.description}</span>
            <span className="tabular-nums">{formatNaira(item.total_kobo)}</span>
          </div>
          {item.quantity > 1 && (
            <div className="text-[9px] text-stone-500">
              {item.quantity} × {formatNaira(item.unit_kobo)}
            </div>
          )}
        </div>
      ))}

      <Rule />

      <Line label="Total" value={formatNaira(sale.total_kobo)} bold />

      {sale.payments.length > 0 && (
        <>
          <Rule />
          {sale.payments.map((payment) => (
            <Line
              key={payment.id}
              label={`${payment.kind === 'deposit' ? 'Deposit' : payment.kind === 'refund' ? 'Refund' : 'Paid'} · ${payment.method}`}
              value={formatNaira(payment.amount_kobo)}
            />
          ))}
          <Line label="Paid in total" value={formatNaira(sale.paidKobo)} />
        </>
      )}

      <Rule />

      {sale.balanceKobo > 0 ? (
        <Line label="STILL TO PAY" value={formatNaira(sale.balanceKobo)} bold />
      ) : (
        <p className="text-center text-xs font-bold uppercase tracking-widest">Paid in full</p>
      )}

      <p className="mt-4 text-center text-[9px] leading-tight">
        Thank you.
        {phone && <> Any questions, please call {phone}.</>}
        <br />
        Goods remain the property of the shop until paid for in full.
      </p>
    </article>
  );
}
