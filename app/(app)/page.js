import Link from 'next/link';
import { requireUser, canSeeCosts } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { migrate } from '@/lib/migrate';
import { awaitingCollection, inCustody, listJobs } from '@/lib/jobs';
import { customersOwing } from '@/lib/customers';
import { lowStock } from '@/lib/stock';
import { formatQuantity } from '@/lib/stock-catalog';
import { STAGES } from '@/lib/job-catalog';
import { backupStatus } from '@/lib/backup';
import { formatNaira } from '@/lib/money';
import { totalsByType } from '@/lib/ledger';
import BackupPanel from './BackupPanel';

export const dynamic = 'force-dynamic';

export default async function Today() {
  const user = await requireUser();

  // Applied on start-up so the shop is never left on an old schema because
  // somebody forgot to run a command.
  migrate({ db: getDb() });

  const ready = awaitingCollection();
  const holding = inCustody();
  const owing = customersOwing({ limit: 5 });
  const low = lowStock();
  const backup = backupStatus();

  const working = listJobs().filter((j) => j.status === 'accepted' || j.status === 'in_progress');
  const quotes = listJobs({ status: 'quote' });

  const owedTotal = owing.reduce((sum, row) => sum + row.outstanding_kobo, 0);

  const today = new Date();
  const from = new Date(today.getFullYear(), today.getMonth(), 1).toISOString();
  const month = totalsByType({ from });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Today</h1>
          <p className="mt-1 text-sm text-stone-600">
            {today.toLocaleDateString('en-NG', { weekday: 'long', day: 'numeric', month: 'long' })}
          </p>
        </div>
        <Link href="/jobs/new" className="rounded bg-stone-900 px-4 py-2 text-sm font-medium text-white">
          New quote
        </Link>
      </div>

      <BackupPanel status={backup} />

      {/* The numbers the owner actually acts on. */}
      <section className="grid gap-4 sm:grid-cols-4">
        <Tile label="Ready to collect" value={ready.length} href="/jobs?status=ready" tone={ready.length ? 'good' : 'plain'} />
        <Tile label="On the bench" value={working.length} href="/jobs" />
        <Tile label="Open quotes" value={quotes.length} href="/jobs?status=quote" />
        <Tile
          label="Owed to the shop"
          value={formatNaira(owedTotal)}
          href="/customers"
          tone={owedTotal > 0 ? 'warn' : 'plain'}
          small
        />
      </section>

      {canSeeCosts(user) && (
        <section className="rounded-lg border border-stone-200 bg-white p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-stone-500">This month</h2>
          <div className="mt-2 grid gap-4 sm:grid-cols-3 text-sm">
            <div>
              <div className="text-stone-500">Earned</div>
              <div className="text-lg tabular-nums">{formatNaira(month.income)}</div>
            </div>
            <div>
              <div className="text-stone-500">Spent</div>
              <div className="text-lg tabular-nums">{formatNaira(month.expense)}</div>
            </div>
            <div>
              <div className="text-stone-500">Difference</div>
              <div className={`text-lg tabular-nums ${month.income - month.expense < 0 ? 'text-red-700' : ''}`}>
                {formatNaira(month.income - month.expense)}
              </div>
            </div>
          </div>
          <p className="mt-2 text-xs text-stone-500">
            Income counts when work is handed over, not when a deposit arrives.
          </p>
        </section>
      )}

      {/* Customer property, above everything else. */}
      {holding.length > 0 && (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <h2 className="text-sm font-semibold text-amber-900">
            Holding {holding.length} item{holding.length > 1 ? 's' : ''} belonging to customers
          </h2>
          <ul className="mt-2 space-y-1 text-sm text-amber-900">
            {holding.slice(0, 8).map((item) => (
              <li key={item.id}>
                <span className="font-mono">{item.tag_number}</span> — {item.description}
                {item.job_number && (
                  <Link href={`/jobs`} className="ml-2 text-xs underline">{item.job_number}</Link>
                )}
              </li>
            ))}
          </ul>
          {holding.length > 8 && (
            <p className="mt-1 text-xs text-amber-800">and {holding.length - 8} more.</p>
          )}
        </section>
      )}

      {ready.length > 0 && (
        <Panel title="Finished, waiting to be collected">
          {ready.map((job) => (
            <Row
              key={job.id}
              href={`/jobs/${job.id}`}
              left={job.job_number}
              middle={job.customer_name}
              right={formatNaira(job.total_kobo)}
              note={job.held > 0 ? `${job.held} item${job.held > 1 ? 's' : ''} to hand back` : null}
            />
          ))}
        </Panel>
      )}

      {working.length > 0 && (
        <Panel title="On the bench">
          {working.map((job) => (
            <Row
              key={job.id}
              href={`/jobs/${job.id}`}
              left={job.job_number}
              middle={job.customer_name}
              right={STAGES[job.stage]}
              note={job.promised_at ? `promised ${new Date(job.promised_at).toLocaleDateString()}` : null}
            />
          ))}
        </Panel>
      )}

      {owing.length > 0 && (
        <Panel title="Owing the most">
          {owing.map((row) => (
            <Row
              key={row.id}
              href={`/customers/${row.id}`}
              left={row.name}
              middle={row.phone || ''}
              right={formatNaira(row.outstanding_kobo)}
            />
          ))}
        </Panel>
      )}

      {low.length > 0 && (
        <Panel title="Running low">
          {low.map((material) => (
            <Row
              key={material.id}
              href="/stock"
              left={material.name}
              middle=""
              right={formatQuantity(material.quantity_base, material)}
            />
          ))}
        </Panel>
      )}

      {ready.length === 0 && working.length === 0 && quotes.length === 0 && (
        <p className="rounded-lg border border-dashed border-stone-300 p-6 text-sm text-stone-600">
          Nothing on the go. Start with a <Link href="/jobs/new" className="underline">new quote</Link>.
        </p>
      )}
    </div>
  );
}

function Tile({ label, value, href, tone = 'plain', small = false }) {
  const colour =
    tone === 'good' ? 'text-emerald-700' : tone === 'warn' ? 'text-amber-700' : 'text-stone-900';
  return (
    <Link href={href} className="rounded-lg border border-stone-200 bg-white p-4 hover:border-stone-400">
      <div className="text-xs uppercase tracking-wide text-stone-500">{label}</div>
      <div className={`mt-1 tabular-nums ${small ? 'text-lg' : 'text-2xl'} font-semibold ${colour}`}>
        {value}
      </div>
    </Link>
  );
}

function Panel({ title, children }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">{title}</h2>
      <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">{children}</div>
    </section>
  );
}

function Row({ href, left, middle, right, note }) {
  return (
    <Link
      href={href}
      className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 px-4 py-2.5 text-sm last:border-0 hover:bg-stone-50"
    >
      <span className="flex items-center gap-3">
        <span className="font-mono text-xs text-stone-500">{left}</span>
        <span className="font-medium">{middle}</span>
        {note && <span className="text-xs text-stone-500">{note}</span>}
      </span>
      <span className="tabular-nums">{right}</span>
    </Link>
  );
}
