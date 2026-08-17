import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { searchCustomers, customersOwing } from '@/lib/customers';
import { formatNaira } from '@/lib/money';
import CustomerForm from './CustomerForm';

export const dynamic = 'force-dynamic';

export default async function CustomersPage({ searchParams }) {
  await requireUser();

  const params = await searchParams;
  const query = String(params?.q || '');
  const adding = params?.new === '1';

  const customers = searchCustomers(query);
  const owing = query ? [] : customersOwing({ limit: 5 });

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Customers</h1>
          <p className="mt-1 text-sm text-stone-600">
            Search by phone — it is what is written on the claim ticket.
          </p>
        </div>
        <Link
          href={adding ? '/customers' : '/customers?new=1'}
          className="rounded bg-stone-900 px-4 py-2 text-sm font-medium text-white"
        >
          {adding ? 'Cancel' : 'New customer'}
        </Link>
      </div>

      {adding && <CustomerForm />}

      <form className="flex gap-2">
        <input
          name="q"
          defaultValue={query}
          placeholder="Phone number or name"
          className="w-full max-w-sm rounded border border-stone-300 px-3 py-2 text-sm focus:border-stone-500 focus:outline-none"
        />
        <button className="rounded border border-stone-300 px-4 py-2 text-sm">Search</button>
        {query && (
          <Link href="/customers" className="px-3 py-2 text-sm text-stone-500">
            Clear
          </Link>
        )}
      </form>

      {owing.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
            Owing the most
          </h2>
          <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
            {owing.map((row) => (
              <Link
                key={row.id}
                href={`/customers/${row.id}`}
                className="flex items-center justify-between border-b border-stone-100 px-4 py-2 text-sm last:border-0 hover:bg-stone-50"
              >
                <span>
                  {row.name}
                  {row.phone && <span className="ml-2 text-stone-500">{row.phone}</span>}
                </span>
                <span className="font-medium tabular-nums text-amber-700">
                  {formatNaira(row.outstanding_kobo)}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
          {query ? `Matching “${query}”` : 'All customers'}
        </h2>

        {customers.length === 0 ? (
          <p className="rounded-lg border border-dashed border-stone-300 p-6 text-sm text-stone-600">
            {query ? 'Nobody matches that.' : 'No customers yet.'}
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
            {customers.map((customer) => (
              <Link
                key={customer.id}
                href={`/customers/${customer.id}`}
                className="flex items-center justify-between border-b border-stone-100 px-4 py-3 text-sm last:border-0 hover:bg-stone-50"
              >
                <span className="font-medium">{customer.name}</span>
                <span className="text-stone-500">{customer.phone || '—'}</span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
