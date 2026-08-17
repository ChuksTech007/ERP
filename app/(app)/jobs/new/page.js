import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { listPriceItems } from '@/lib/price-items';
import { searchCustomers } from '@/lib/customers';
import { getDb } from '@/lib/db';
import QuoteBuilder from './QuoteBuilder';

export const dynamic = 'force-dynamic';

function setting(key, fallback) {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export default async function NewQuotePage() {
  await requireUser();

  /* Only what is needed to price a quote goes to the browser. Cost prices are
   * left behind on the server — they play no part in what the customer is
   * charged, so there is no reason for them to travel. */
  const priceItems = listPriceItems().map((item) => ({
    id: item.id,
    name: item.name,
    category: item.category,
    mode: item.mode,
    price_kobo: item.price_kobo,
    cutting_kobo: item.cutting_kobo,
    moulding_width_mm: item.moulding_width_mm,
    wastage_mm: item.wastage_mm,
  }));

  const customers = searchCustomers('', { limit: 200 }).map((c) => ({
    id: c.id, name: c.name, phone: c.phone,
  }));

  const minChargeKobo = Number(setting('pricing.minCharge_kobo', '0')) || 0;
  const defaultMountBorderMm = Number(setting('pricing.defaultMountBorder_mm', '50')) || 0;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/jobs" className="text-sm text-stone-500 hover:text-stone-900">← Jobs</Link>
        <h1 className="mt-1 text-xl font-semibold">New quote</h1>
        <p className="mt-1 text-sm text-stone-600">
          Priced as you type, from the size on the counter.
        </p>
      </div>

      {priceItems.length === 0 ? (
        <div className="rounded-lg border border-dashed border-stone-300 p-6 text-sm text-stone-600">
          <p className="font-medium text-stone-800">There is nothing to quote from yet.</p>
          <p className="mt-1">
            Add the shop&rsquo;s mouldings, glass, mount board and labour rates to the{' '}
            <Link href="/pricelist" className="underline">price list</Link> first. Nothing has been
            invented on your behalf.
          </p>
        </div>
      ) : (
        <QuoteBuilder
          priceItems={priceItems}
          customers={customers}
          minChargeKobo={minChargeKobo}
          defaultMountBorderMm={defaultMountBorderMm}
        />
      )}
    </div>
  );
}
