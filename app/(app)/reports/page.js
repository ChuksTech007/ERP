import { redirect } from 'next/navigation';
import { requireUser, canSeeCosts } from '@/lib/auth';
import { profitAndLoss, balanceSheet, cashPosition, takings, monthRange } from '@/lib/reports';
import { trialBalance } from '@/lib/ledger';
import { formatNaira } from '@/lib/money';

export const dynamic = 'force-dynamic';

export default async function ReportsPage({ searchParams }) {
  const user = await requireUser();
  // The shop's books are the owner's business, not the counter's.
  if (!canSeeCosts(user)) redirect('/');

  const params = await searchParams;
  const offset = Number(params?.month || 0);

  const when = new Date();
  when.setMonth(when.getMonth() - offset);
  const { from, to, label } = monthRange(when);

  const pl = profitAndLoss({ from, to });
  const sheet = balanceSheet();
  const position = cashPosition();
  const day = takings();
  const books = trialBalance();

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Reports</h1>
          <p className="mt-1 text-sm text-stone-600">Every figure comes out of the ledger.</p>
        </div>
        <nav className="flex gap-2 text-sm">
          <a href={`/reports?month=${offset + 1}`} className="rounded border border-stone-300 px-3 py-1.5">
            ← Earlier
          </a>
          {offset > 0 && (
            <a href={`/reports?month=${offset - 1}`} className="rounded border border-stone-300 px-3 py-1.5">
              Later →
            </a>
          )}
        </nav>
      </div>

      {!books.balanced && (
        <p className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          The books are out by {formatNaira(books.driftKobo)}. Something has been written without
          going through the ledger. Do not rely on anything below until that is looked into.
        </p>
      )}

      {/* --- today */}
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
          Taken today
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Tile label="Cash — count the drawer against this" value={formatNaira(day.cashKobo)} />
          <Tile label="Transfer and card" value={formatNaira(day.otherKobo)} />
          <Tile label="All takings" value={formatNaira(day.totalKobo)} />
        </div>
      </section>

      {/* --- profit and loss */}
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
          Profit and loss — {label}
        </h2>
        <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
          <Group title="Earned" lines={pl.income} total={pl.incomeKobo} />
          <Group title="Spent" lines={pl.expenses} total={pl.expenseKobo} />
          <div className={`flex justify-between border-t-2 border-stone-300 px-4 py-3 font-semibold ${pl.profitKobo < 0 ? 'text-red-700' : ''}`}>
            <span>{pl.profitKobo < 0 ? 'Loss' : 'Profit'}</span>
            <span className="tabular-nums">{formatNaira(pl.profitKobo)}</span>
          </div>
          {pl.incomeKobo > 0 && (
            <p className="px-4 pb-3 text-xs text-stone-500">
              {(pl.marginBp / 100).toFixed(1)}% of what came in was kept.
            </p>
          )}
        </div>
        <p className="mt-2 text-xs text-stone-500">
          Income counts when work is handed over, not when a deposit arrives. A month full of
          deposits on unfinished frames shows little income — that is correct, and it is why a good
          month for cash can be a quiet one for profit.
        </p>
      </section>

      {/* --- where the shop stands */}
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
          Where the shop stands
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Tile label="Cash in hand" value={formatNaira(position.cashKobo)} tone={position.cashKobo < 0 ? 'bad' : 'plain'} />
          <Tile label="In the bank" value={formatNaira(position.bankKobo)} tone={position.bankKobo < 0 ? 'bad' : 'plain'} />
          <Tile label="Stock on the shelf" value={formatNaira(position.stockKobo)} />
          <Tile label="Owed to the shop" value={formatNaira(position.owedToShopKobo)} tone="warn" />
          <Tile label="Owed to suppliers" value={formatNaira(position.owedBySopKobo)} tone="warn" />
          <Tile label="Deposits held" value={formatNaira(position.depositsHeldKobo)} />
        </div>
        <p className="mt-2 text-xs text-stone-500">
          Deposits held are not the shop&rsquo;s money. Until the work is handed over it is owed
          back, so it should not be counted as profit or spent as though it were.
        </p>
      </section>

      {/* --- balance sheet */}
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
          What the shop owns and owes
        </h2>
        <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
          <Group title="Owns" lines={sheet.assets} total={sheet.assetsKobo} />
          <Group title="Owes" lines={sheet.liabilities} total={sheet.liabilitiesKobo} />
          <Group
            title="The owner's share"
            lines={[...sheet.equity, { code: 'profit', name: 'Profit not yet drawn', amountKobo: sheet.retainedKobo }]}
            total={sheet.equityKobo + sheet.retainedKobo}
          />
        </div>
        <p className={`mt-2 text-xs ${sheet.balanced ? 'text-stone-500' : 'text-red-700'}`}>
          {sheet.balanced
            ? 'What the shop owns equals what it owes plus the owner’s share, as it must.'
            : `Out by ${formatNaira(sheet.differenceKobo)} — this needs looking at.`}
        </p>
      </section>

      {/* --- trial balance */}
      <details className="rounded-lg border border-stone-200 bg-white p-4">
        <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wide text-stone-500">
          Every account (for an accountant)
        </summary>
        <div className="mt-3 space-y-0.5 text-sm">
          {books.accounts.filter((a) => a.balanceKobo !== 0).map((account) => (
            <div key={account.code} className="flex justify-between">
              <span className="text-stone-600">
                <span className="font-mono text-xs text-stone-400">{account.code}</span> {account.name}
              </span>
              <span className="tabular-nums">{formatNaira(account.balanceKobo)}</span>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

function Group({ title, lines, total }) {
  const real = lines.filter((line) => line.amountKobo !== 0);
  if (real.length === 0) return null;

  return (
    <div className="border-b border-stone-200 last:border-0">
      <div className="bg-stone-50 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500">
        {title}
      </div>
      {real.map((line) => (
        <div key={line.code} className="flex justify-between px-4 py-1.5 text-sm">
          <span className="text-stone-600">{line.name}</span>
          <span className="tabular-nums">{formatNaira(line.amountKobo)}</span>
        </div>
      ))}
      <div className="flex justify-between border-t border-stone-100 px-4 py-1.5 text-sm font-medium">
        <span>Total</span>
        <span className="tabular-nums">{formatNaira(total)}</span>
      </div>
    </div>
  );
}

function Tile({ label, value, tone = 'plain' }) {
  const colour = tone === 'bad' ? 'text-red-700' : tone === 'warn' ? 'text-amber-700' : '';
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-stone-500">{label}</div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${colour}`}>{value}</div>
    </div>
  );
}
