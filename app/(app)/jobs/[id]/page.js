import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUser, canSeeCosts } from '@/lib/auth';
import { getJob } from '@/lib/jobs';
import { STAGES, STATUSES, nextStage } from '@/lib/job-catalog';
import { formatNaira } from '@/lib/money';
import { formatSize } from '@/lib/measure';
import { getDb } from '@/lib/db';
import { getSale } from '@/lib/sales';
import { AcceptForm, CollectForm } from './JobActions';
import { stage, cancel } from '../actions';

export const dynamic = 'force-dynamic';

export default async function JobPage({ params }) {
  const user = await requireUser();
  const { id } = await params;

  const job = getJob(id);
  if (!job || job.deleted_at) notFound();

  const depositPercentBp =
    Number(getDb().prepare("SELECT value FROM settings WHERE key = 'pricing.depositPercent_bp'").get()?.value) || 5000;

  const held = job.custody.filter((c) => !c.released_at);
  const upcoming = nextStage(job.stage);

  const invoiceRow = getDb().prepare('SELECT id FROM sales WHERE job_id = ?').get(job.id);
  const invoice = invoiceRow ? getSale(invoiceRow.id) : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/jobs" className="text-sm text-stone-500 hover:text-stone-900">← Jobs</Link>
          <h1 className="mt-1 flex items-center gap-3 text-xl font-semibold">
            <span className="font-mono text-base text-stone-500">{job.job_number}</span>
            {job.customer_name}
          </h1>
          <p className="mt-1 text-sm text-stone-600">
            {STATUSES[job.status]}
            {job.status !== 'quote' && job.status !== 'collected' && ` · ${STAGES[job.stage]}`}
            {job.promised_at && ` · promised ${new Date(job.promised_at).toLocaleDateString()}`}
          </p>
        </div>

        <div className="text-right">
          <div className="text-2xl font-semibold tabular-nums">{formatNaira(job.total_kobo)}</div>
          {/* Paper the shop actually needs at the counter and on the bench. */}
          <div className="mt-2 flex justify-end gap-2 text-xs">
            {job.status !== 'quote' && (
              <a href={`/ticket/${job.id}`} target="_blank" rel="noreferrer"
                 className="rounded border border-stone-300 px-2 py-1 hover:bg-stone-100">
                Job ticket
              </a>
            )}
            {held.length > 0 && (
              <a href={`/slip/${job.id}`} target="_blank" rel="noreferrer"
                 className="rounded border border-stone-300 px-2 py-1 hover:bg-stone-100">
                Claim slip
              </a>
            )}
          </div>
          {job.paidKobo !== 0 && (
            <div className="text-sm text-stone-600">
              paid {formatNaira(job.paidKobo)} · balance {formatNaira(job.total_kobo - job.paidKobo)}
            </div>
          )}
        </div>
      </div>

      {job.status === 'cancelled' && (
        <p className="rounded-lg border border-stone-300 bg-stone-100 p-4 text-sm text-stone-700">
          Cancelled — {job.cancelled_reason}.
          {job.deposit_kobo > 0 && ` A deposit of ${formatNaira(job.deposit_kobo)} is still held.`}
        </p>
      )}

      {/* What the shop is holding, above everything else. */}
      {held.length > 0 && (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <h2 className="text-sm font-semibold text-amber-900">
            Holding {held.length} item{held.length > 1 ? 's' : ''} belonging to the customer
          </h2>
          <ul className="mt-2 space-y-1 text-sm text-amber-900">
            {held.map((item) => (
              <li key={item.id}>
                <span className="font-mono">{item.tag_number}</span> — {item.description}
                {item.condition_note && <span className="text-amber-700"> · {item.condition_note}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* The pieces, and the frozen breakdown behind each price. */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">The work</h2>
        {job.items.map((item) => (
          <div key={item.id} className="rounded-lg border border-stone-200 bg-white p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-medium">{item.description}</span>
              <span className="tabular-nums font-medium">{formatNaira(item.total_kobo)}</span>
            </div>
            <p className="mt-1 text-xs text-stone-500">
              Artwork {formatSize(item.artwork_width_mm, item.artwork_height_mm)}
              {item.mount_border_mm > 0 && ` · ${item.mount_border_mm} mm mount`}
              {' · glass cut '}
              {formatSize(item.glass_width_mm, item.glass_height_mm)}
              {item.quantity > 1 && ` · ${item.quantity} off`}
            </p>

            {Array.isArray(item.breakdown?.lines) && (
              <div className="mt-3 space-y-0.5 border-t border-stone-100 pt-2 text-sm">
                {item.breakdown.lines.map((line, i) => (
                  <div key={i} className="flex justify-between">
                    <span className="text-stone-600">
                      {line.name}
                      {line.detail && <span className="text-stone-400"> · {line.detail}</span>}
                    </span>
                    <span className="tabular-nums text-stone-600">{formatNaira(line.amountKobo)}</span>
                  </div>
                ))}
              </div>
            )}

            {canSeeCosts(user) && item.cost_kobo > 0 && (
              <p className="mt-2 text-xs text-stone-400">
                Cost {formatNaira(item.cost_kobo)} · margin{' '}
                {Math.round(((item.total_kobo - item.cost_kobo) / item.total_kobo) * 100)}%
              </p>
            )}
          </div>
        ))}
      </section>

      {/* --- what to do next */}
      {job.status === 'quote' && <AcceptForm job={job} depositPercentBp={depositPercentBp} />}

      {(job.status === 'accepted' || job.status === 'in_progress') && (
        <section className="rounded-lg border border-stone-200 bg-white p-5">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">On the bench</h2>
          <div className="flex flex-wrap gap-2">
            {upcoming && (
              <form action={stage}>
                <input type="hidden" name="jobId" value={job.id} />
                <input type="hidden" name="stage" value={upcoming} />
                <button className="rounded bg-stone-900 px-4 py-2 text-sm font-medium text-white">
                  {upcoming === 'done' ? 'Mark finished' : `Move to ${STAGES[upcoming].toLowerCase()}`}
                </button>
              </form>
            )}
            {Object.entries(STAGES)
              .filter(([value]) => value !== job.stage && value !== upcoming)
              .map(([value, text]) => (
                <form key={value} action={stage}>
                  <input type="hidden" name="jobId" value={job.id} />
                  <input type="hidden" name="stage" value={value} />
                  <button className="rounded border border-stone-300 px-3 py-2 text-sm">{text}</button>
                </form>
              ))}
          </div>
        </section>
      )}

      {job.status === 'ready' && <CollectForm job={job} />}

      {job.status === 'collected' && invoice && (
        <section className="rounded-lg border border-stone-200 bg-white p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">Invoice</h2>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-sm">
            <span>
              <Link href={`/invoices/${invoice.id}`} className="font-mono hover:underline">
                {invoice.invoice_number}
              </Link>
              <span className="ml-3 text-stone-500">{invoice.status}</span>
            </span>
            <a href={`/receipt/${invoice.id}`} target="_blank" rel="noreferrer"
               className="rounded border border-stone-300 px-3 py-1.5 text-xs hover:bg-stone-100">
              Print receipt
            </a>
          </div>
        </section>
      )}

      {/* --- history */}
      {job.events.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">Bench history</h2>
          <div className="overflow-hidden rounded-lg border border-stone-200 bg-white text-sm">
            {job.events.map((event) => (
              <div key={event.id} className="flex justify-between border-b border-stone-100 px-4 py-2 last:border-0">
                <span>{STAGES[event.to_stage]}</span>
                <span className="text-stone-500">{event.note}</span>
                <span className="text-stone-400">{new Date(event.created_at).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {job.payments.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">Money</h2>
          <div className="overflow-hidden rounded-lg border border-stone-200 bg-white text-sm">
            {job.payments.map((payment) => (
              <div key={payment.id} className="flex justify-between border-b border-stone-100 px-4 py-2 last:border-0">
                <span>{payment.kind}</span>
                <span className="text-stone-500">{payment.method}</span>
                <span className="tabular-nums">{formatNaira(payment.amount_kobo)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {job.status !== 'collected' && job.status !== 'cancelled' && (
        <form action={cancel} className="flex items-center gap-2 pt-4">
          <input type="hidden" name="jobId" value={job.id} />
          <input
            name="reason"
            placeholder="Reason for cancelling"
            className="rounded border border-stone-300 px-3 py-1.5 text-sm"
            required
          />
          <button className="text-sm text-stone-500 hover:text-red-700">Cancel this job</button>
        </form>
      )}
    </div>
  );
}
