import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { listJobs } from '@/lib/jobs';
import { STATUSES, STAGES } from '@/lib/job-catalog';
import { formatNaira } from '@/lib/money';

export const dynamic = 'force-dynamic';

const TONE = {
  quote: 'bg-stone-100 text-stone-700',
  accepted: 'bg-blue-100 text-blue-800',
  in_progress: 'bg-blue-100 text-blue-800',
  ready: 'bg-emerald-100 text-emerald-800',
  collected: 'bg-stone-100 text-stone-500',
  cancelled: 'bg-stone-100 text-stone-400',
};

export default async function JobsPage({ searchParams }) {
  await requireUser();
  const params = await searchParams;
  const filter = params?.status || null;

  const jobs = listJobs({ status: filter });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Jobs</h1>
          <p className="mt-1 text-sm text-stone-600">
            Ready for collection first, then what is on the bench.
          </p>
        </div>
        <Link href="/jobs/new" className="rounded bg-stone-900 px-4 py-2 text-sm font-medium text-white">
          New quote
        </Link>
      </div>

      <nav className="flex flex-wrap gap-2 text-sm">
        <Link
          href="/jobs"
          className={`rounded border px-3 py-1.5 ${!filter ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-300'}`}
        >
          All
        </Link>
        {Object.entries(STATUSES).map(([value, text]) => (
          <Link
            key={value}
            href={`/jobs?status=${value}`}
            className={`rounded border px-3 py-1.5 ${filter === value ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-300'}`}
          >
            {text}
          </Link>
        ))}
      </nav>

      {jobs.length === 0 ? (
        <p className="rounded-lg border border-dashed border-stone-300 p-6 text-sm text-stone-600">
          Nothing here. Start with a quote.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
          {jobs.map((job) => (
            <Link
              key={job.id}
              href={`/jobs/${job.id}`}
              className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-100 px-4 py-3 text-sm last:border-0 hover:bg-stone-50"
            >
              <div className="flex items-center gap-3">
                <span className="font-mono text-xs text-stone-500">{job.job_number}</span>
                <span className="font-medium">{job.customer_name}</span>
              </div>

              <div className="flex items-center gap-3">
                {job.status !== 'quote' && job.status !== 'collected' && (
                  <span className="text-xs text-stone-500">{STAGES[job.stage]}</span>
                )}
                <span className={`rounded px-2 py-0.5 text-xs ${TONE[job.status]}`}>
                  {STATUSES[job.status]}
                </span>
                <span className="tabular-nums">{formatNaira(job.total_kobo)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
