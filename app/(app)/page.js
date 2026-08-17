import { getDb } from '@/lib/db';
import { migrate } from '@/lib/migrate';

/* Nothing is cached: this reads the shop's live database, and a till showing
 * a figure from five minutes ago is a till showing a wrong figure. */
export const dynamic = 'force-dynamic';

export default function Home() {
  const db = getDb();

  // Applying migrations on start-up means the shop machine is never left on
  // an old schema because somebody forgot to run a command.
  migrate({ db });

  const tables = db
    .prepare("SELECT count(*) n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .get().n;
  const applied = db.prepare('SELECT name, applied_at FROM _migrations ORDER BY name').all();

  return (
    <main className="mx-auto max-w-2xl p-10">
      <h1 className="text-2xl font-semibold">Frame Shop</h1>
      <p className="mt-2 text-stone-600">
        Foundation is in place. {tables} tables, {applied.length} migrations applied.
      </p>

      <ul className="mt-6 space-y-1 text-sm text-stone-500">
        {applied.map((m) => (
          <li key={m.name}>
            <span className="font-mono">{m.name}</span> — {new Date(m.applied_at).toLocaleString()}
          </li>
        ))}
      </ul>
    </main>
  );
}
