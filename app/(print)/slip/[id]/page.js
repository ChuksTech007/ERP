import { notFound } from 'next/navigation';
import { getJob } from '@/lib/jobs';
import { formatNaira } from '@/lib/money';
import { ShopHeader, Line, Rule } from '../../Shop';

export const dynamic = 'force-dynamic';

/**
 * The claim slip.
 *
 * Printed twice per item: one half is tied to the picture, the other goes
 * home with the customer. The tag number is enormous because it is read
 * aloud down a telephone and copied onto a paper tag by hand, often in a
 * hurry, and a misread digit puts somebody else's irreplaceable photograph
 * into the wrong hands.
 *
 * The condition note is on the customer's copy on purpose. A tear the shop
 * recorded at intake is a fact both sides agreed to; a tear only the shop
 * wrote down is the shop's word against theirs.
 */
export default async function ClaimSlip({ params }) {
  const { id } = await params;
  const job = getJob(id);
  if (!job) notFound();

  const held = job.custody.filter((item) => !item.released_at);
  if (held.length === 0) {
    return (
      <p className="text-sm">
        Nothing of this customer&rsquo;s is being held against {job.job_number}, so there is no slip
        to print.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {held.map((item) =>
        ['Shop copy — tie to the item', 'Customer copy'].map((which) => (
          <article key={`${item.id}-${which}`} className="break-inside-avoid border-b-2 border-stone-400 pb-4">
            <ShopHeader title="Claim ticket" />

            <p className="mt-1 text-center text-[9px] uppercase tracking-widest text-stone-500">{which}</p>

            <div className="my-3 border-2 border-stone-900 py-2 text-center">
              <div className="text-[9px] uppercase tracking-widest">Tag number</div>
              <div className="text-3xl font-bold tracking-wider">{item.tag_number}</div>
            </div>

            <Line label="Job" value={job.job_number} />
            <Line label="Customer" value={job.customer_name} />
            {job.customer_phone && <Line label="Phone" value={job.customer_phone} />}
            <Line label="Received" value={new Date(item.received_at).toLocaleDateString()} />
            {job.promised_at && (
              <Line label="Ready by" value={new Date(job.promised_at).toLocaleDateString()} bold />
            )}

            <Rule />

            <p className="text-[11px] font-semibold">{item.description}</p>
            {item.condition_note && (
              <p className="mt-1 text-[10px]">
                <span className="font-semibold">Condition at intake: </span>
                {item.condition_note}
              </p>
            )}

            <Rule />

            <Line label="Job total" value={formatNaira(job.total_kobo)} />
            <Line label="Deposit paid" value={formatNaira(job.paidKobo)} />
            <Line label="Balance on collection" value={formatNaira(job.total_kobo - job.paidKobo)} bold />

            <Rule />

            <p className="text-[9px] leading-tight">
              Please bring this ticket when collecting. Work is released only to the person named
              above or to someone they have sent. Items not collected within three months may
              attract a storage charge.
            </p>
          </article>
        ))
      )}
    </div>
  );
}
