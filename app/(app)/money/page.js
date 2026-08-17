import { requireUser, canSeeCosts } from '@/lib/auth';
import { expenseAccounts, listExpenses, expensesByAccount } from '@/lib/expenses';
import { allSettings } from '@/lib/settings';
import { trialBalance, totalsByType, accountBalance } from '@/lib/ledger';
import { ACCT } from '@/lib/chart-of-accounts';
import { formatNaira } from '@/lib/money';
import { ExpenseForm, SettingsForm } from './MoneyForms';

export const dynamic = 'force-dynamic';

export default async function MoneyPage() {
  const user = await requireUser();
  const owner = canSeeCosts(user);

  const settings = allSettings();
  const accounts = expenseAccounts();

  const today = new Date();
  const from = new Date(today.getFullYear(), today.getMonth(), 1).toISOString();

  const month = owner ? totalsByType({ from }) : null;
  const spending = owner ? expensesByAccount({ from }) : [];
  const recent = owner ? listExpenses({ limit: 20 }) : [];
  const books = owner ? trialBalance() : null;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold">Money and settings</h1>
        <p className="mt-1 text-sm text-stone-600">What the shop spends, and how it prices.</p>
      </div>

      {owner && (
        <>
          <section className="grid gap-4 sm:grid-cols-4">
            <Tile label="Earned this month" value={formatNaira(month.income)} />
            <Tile label="Spent this month" value={formatNaira(month.expense)} />
            <Tile
              label="Difference"
              value={formatNaira(month.income - month.expense)}
              tone={month.income - month.expense < 0 ? 'bad' : 'good'}
            />
            <Tile label="Cash in hand" value={formatNaira(accountBalance(ACCT.CASH))} />
          </section>

          {/* The one figure that says the books are sound. */}
          <p className={`rounded-lg border p-3 text-sm ${books.balanced ? 'border-stone-200 bg-white text-stone-600' : 'border-red-300 bg-red-50 text-red-800'}`}>
            {books.balanced
              ? 'The books balance.'
              : `The books are out by ${formatNaira(books.driftKobo)}. Something has bypassed the ledger — do not trust the figures until this is looked at.`}
          </p>

          <ExpenseForm accounts={accounts} />

          {spending.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
                Where the money went this month
              </h2>
              <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
                {spending.map((row) => (
                  <div key={row.code} className="flex justify-between border-b border-stone-100 px-4 py-2 text-sm last:border-0">
                    <span>{row.name}</span>
                    <span className="tabular-nums">{formatNaira(row.total_kobo)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {recent.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">Recent payments out</h2>
              <div className="overflow-hidden rounded-lg border border-stone-200 bg-white">
                {recent.map((expense) => (
                  <div key={expense.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-100 px-4 py-2 text-sm last:border-0">
                    <span className="font-medium">{expense.description}</span>
                    <span className="text-stone-500">{expense.account_name} · {expense.method}</span>
                    <span className="text-stone-400">{new Date(expense.spent_at).toLocaleDateString()}</span>
                    <span className="tabular-nums">{formatNaira(expense.amount_kobo)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <SettingsForm settings={settings} />
    </div>
  );
}

function Tile({ label, value, tone = 'plain' }) {
  const colour = tone === 'bad' ? 'text-red-700' : tone === 'good' ? 'text-emerald-700' : '';
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-stone-500">{label}</div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${colour}`}>{value}</div>
    </div>
  );
}
