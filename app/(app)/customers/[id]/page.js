import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser, canManage } from '@/lib/auth';
import { getCustomer, customerAccount, customerHistory } from '@/lib/customers';
import { formatNaira } from '@/lib/money';
import CustomerForm from '../CustomerForm';
import { retire } from '../actions';

export const dynamic = 'force-dynamic';

function Money({ kobo, tone = 'plain' }) {
  const colour =
    tone === 'owed' && kobo > 0 ? 'text-amber-700' : tone === 'owed' && kobo < 0 ? 'text-emerald-700' : '';
  return <span className={`tabular-nums font-medium ${colour}`}>{formatNaira(kobo)}</span>;
}

export default async function CustomerPage({ params, searchParams }) {
  const user = await requireUser();
  const { id } = await params;
  const query = await searchParams;

  const customer = getCustomer(id);
  if (!customer || customer.deleted_at) notFound();

  const account = customerAccount(id);
  const { jobs, sales, payments, holding } = customerHistory(id);
  const editing = query?.edit === '1';

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/customers" className="text-sm text-stone-500 hover:text-stone-900">
            ← Customers
          </Link>
          <h1 className="mt-1 text-xl font-semibold">{customer.name}</h1>
          <p className="mt-1 text-sm text-stone-600">
            {customer.phone || 'No phone'}
            {customer.email && ` · ${customer.email}`}
          </p>
        </div>
        <Link
          href={editing ? `/customers/${id}` : `/customers/${id}?edit=1`}
          className="rounded border border-stone-300 px-4 py-2 text-sm"
        >
          {editing ? 'Cancel' : 'Edit'}
        </Link>
      </div>

      {editing && <CustomerForm customer={customer} />}

      {/* What the shop is holding comes first. The question at the counter is
          almost never about money — it is "have you still got my picture?" */}
      {holding.length > 0 && (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <h2 className="text-sm font-semibold text-amber-900">
            The shop is holding {holding.length} item{holding.length > 1 ? 's' : ''} of theirs
          </h2>
          <ul className="mt-2 space-y-1 text-sm text-amber-900">
            {holding.map((item) => (
              <li key={item.id}>
                <span className="font-mono">{item.tag_number}</span> — {item.description}
                {item.condition_note && (
                  <span className="text-amber-700"> ({item.condition_note})</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-stone-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-stone-500">Billed</div>
          <div className="mt-1 text-lg"><Money kobo={account.billedKobo} /></div>
        </div>
        <div className="rounded-lg border border-stone-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-stone-500">Paid</div>
          <div className="mt-1 text-lg"><Money kobo={account.paidKobo} /></div>
        </div>
        <div className="rounded-lg border border-stone-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-stone-500">
            {account.outstandingKobo < 0 ? 'Deposit held' : 'Outstanding'}
          </div>
          <div className="mt-1 text-lg">
            <Money kobo={Math.abs(account.outstandingKobo)} tone="owed" />
          </div>
          {account.outstandingKobo < 0 && (
            <p className="mt-1 text-xs text-stone-500">Paid in advance for work not yet invoiced.</p>
          )}
        </div>
      </section>

      <Section title="Jobs" empty="No jobs yet.">
        {jobs.map((job) => (
          <Row key={job.id} left={job.job_number} middle={`${job.status} · ${job.stage}`} right={formatNaira(job.total_kobo)} />
        ))}
      </Section>

      <Section title="Invoices" empty="No invoices yet.">
        {sales.map((sale) => (
          <Row
            key={sale.id}
            left={sale.invoice_number}
            middle={new Date(sale.sold_at).toLocaleDateString()}
            right={formatNaira(sale.total_kobo)}
            muted={!!sale.voided}
          />
        ))}
      </Section>

      <Section title="Payments" empty="No payments yet.">
        {payments.map((payment) => (
          <Row
            key={payment.id}
            left={payment.kind}
            middle={`${payment.method} · ${new Date(payment.received_at).toLocaleDateString()}`}
            right={formatNaira(payment.amount_kobo)}
          />
        ))}
      </Section>

      {canManage(user) && account.outstandingKobo <= 0 && (
        <form action={retire}>
          <input type="hidden" name="id" value={customer.id} />
          <button className="text-sm text-stone-500 hover:text-red-700">Remove this customer</button>
        </form>
      )}
    </div>
  );
}

function Section({ title, empty, children }) {
  const rows = Array.isArray(children) ? children : [children];
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">{title}</h2>
      {rows.filter(Boolean).length === 0 ? (
        <p className="rounded-lg border border-dashed border-stone-300 p-4 text-sm text-stone-500">{empty}</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">{children}</div>
      )}
    </section>
  );
}

function Row({ left, middle, right, muted = false }) {
  return (
    <div className={`flex items-center justify-between border-b border-stone-100 px-4 py-2 text-sm last:border-0 ${muted ? 'opacity-50 line-through' : ''}`}>
      <span className="font-medium">{left}</span>
      <span className="text-stone-500">{middle}</span>
      <span className="tabular-nums">{right}</span>
    </div>
  );
}
