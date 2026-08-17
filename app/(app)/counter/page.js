import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { listPriceItems } from '@/lib/price-items';
import { searchCustomers } from '@/lib/customers';
import CounterForm from './CounterForm';

export const dynamic = 'force-dynamic';

export default async function CounterPage() {
  await requireUser();

  /* Only fixed-price items can be rung up here. Anything charged by the metre
   * or by area has no price until somebody says how big, and that conversation
   * is a quote — not a queue at the counter. */
  const priceItems = listPriceItems()
    .filter((item) => item.mode === 'per_piece')
    .map((item) => ({ id: item.id, name: item.name, category: item.category, price_kobo: item.price_kobo }));

  const customers = searchCustomers('', { limit: 200 }).map((c) => ({
    id: c.id, name: c.name, phone: c.phone,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Counter sale</h1>
        <p className="mt-1 text-sm text-stone-600">
          Something off the shelf — a ready-made frame, hooks, a reprint. No job, no measuring.
          For anything that has to be cut to size,{' '}
          <Link href="/jobs/new" className="underline">raise a quote</Link> instead.
        </p>
      </div>

      {priceItems.length === 0 ? (
        <div className="rounded-lg border border-dashed border-stone-300 p-6 text-sm text-stone-600">
          <p className="font-medium text-stone-800">Nothing on the price list is sold by the piece yet.</p>
          <p className="mt-1">
            Add ready-made frames, hooks or reprints to the{' '}
            <Link href="/pricelist" className="underline">price list</Link> as{' '}
            <span className="font-medium">each</span> items and they will appear here. You can still
            type an off-list item and its price straight onto the sale below.
          </p>
        </div>
      ) : null}

      <CounterForm priceItems={priceItems} customers={customers} />
    </div>
  );
}
