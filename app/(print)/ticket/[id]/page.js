import { notFound } from 'next/navigation';
import { getJob } from '@/lib/jobs';
import { formatSize } from '@/lib/measure';
import { ShopHeader, Line, Rule } from '../../Shop';

export const dynamic = 'force-dynamic';

/**
 * The job ticket, for the bench.
 *
 * Deliberately shows CUTTING sizes and no prices. What the framer needs is
 * the glass size, the length of moulding and the mount border; what they do
 * not need, with a customer possibly looking over the counter, is the margin
 * on the job.
 *
 * The sizes come from the frozen breakdown rather than being recalculated, so
 * the workshop cuts exactly what the customer was charged for.
 */
export default async function JobTicket({ params }) {
  const { id } = await params;
  const job = getJob(id);
  if (!job) notFound();

  return (
    <article>
      <ShopHeader title="Job ticket" />

      <div className="my-2 border-2 border-stone-900 py-1.5 text-center">
        <div className="text-2xl font-bold tracking-wider">{job.job_number}</div>
      </div>

      <Line label="Customer" value={job.customer_name} />
      {job.customer_phone && <Line label="Phone" value={job.customer_phone} />}
      {job.promised_at && (
        <Line label="Promised" value={new Date(job.promised_at).toLocaleDateString()} bold />
      )}
      {job.custody.length > 0 && (
        <Line label="Tags held" value={job.custody.map((c) => c.tag_number).join(', ')} />
      )}

      {job.notes && <p className="mt-1 text-[10px] italic">{job.notes}</p>}

      {job.items.map((item) => {
        const moulding = item.breakdown?.lines?.find((l) => l.part === 'moulding');

        return (
          <section key={item.id} className="mt-3 border-t-2 border-stone-900 pt-2">
            <p className="text-[11px] font-bold">
              {item.quantity > 1 ? `${item.quantity} × ` : ''}
              {item.description}
            </p>

            <div className="mt-1 space-y-0.5">
              <Line label="Artwork" value={formatSize(item.artwork_width_mm, item.artwork_height_mm)} />
              {item.mount_border_mm > 0 && (
                <>
                  <Line label="Mount border" value={`${item.mount_border_mm} mm`} />
                  {item.mount_apertures > 1 && <Line label="Openings" value={item.mount_apertures} />}
                </>
              )}

              {/* The two figures the bench works from. */}
              <Line
                label="CUT GLASS / BOARD"
                value={`${item.glass_width_mm} × ${item.glass_height_mm} mm`}
                bold
              />
              {moulding && (
                <Line
                  label="CUT MOULDING"
                  value={`${(moulding.quantityMm / 1000).toFixed(3)} m`}
                  bold
                />
              )}
            </div>

            <Rule />

            {/* What to take off the shelf, in the framer's words. */}
            {item.breakdown?.lines
              ?.filter((line) => line.part !== 'labour' && line.part !== 'extra')
              .map((line, i) => (
                <div key={i} className="flex justify-between text-[10px]">
                  <span className="uppercase text-stone-500">{line.part}</span>
                  <span className="text-right">{line.name}</span>
                </div>
              ))}
          </section>
        );
      })}

      <Rule />
      <div className="mt-3 space-y-3 text-[10px]">
        <p>Cut by ______________________ Date __________</p>
        <p>Checked by __________________ Date __________</p>
      </div>
    </article>
  );
}
