'use client';

import { useActionState } from 'react';
import { runBackup } from './actions';

export default function BackupPanel({ status }) {
  const [state, action, pending] = useActionState(runBackup, null);

  /* Loud when overdue, quiet when not. A warning that is always on screen
   * stops being read, and one that only appears when it matters gets acted
   * on. */
  const urgent = status.overdue;

  return (
    <section
      className={`rounded-lg border p-4 ${urgent ? 'border-red-300 bg-red-50' : 'border-stone-200 bg-white'}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className={`text-sm font-semibold ${urgent ? 'text-red-900' : 'text-stone-700'}`}>
            {status.never
              ? 'This shop has never been backed up'
              : urgent
                ? `Last backup was ${status.daysAgo} days ago`
                : status.daysAgo === 0
                  ? 'Backed up today'
                  : `Backed up ${status.daysAgo} day${status.daysAgo === 1 ? '' : 's'} ago`}
          </h2>
          {urgent && (
            <p className="mt-1 text-xs text-red-800">
              Everything this shop has ever recorded is in one file on this computer. If the
              machine is lost or the disk fails, there is nothing to rebuild it from. Back up now,
              and keep the copies on a flash drive rather than on this machine.
            </p>
          )}
        </div>

        <form action={action}>
          <button
            disabled={pending}
            className={`rounded px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ${urgent ? 'bg-red-700' : 'bg-stone-900'}`}
          >
            {pending ? 'Backing up...' : 'Back up now'}
          </button>
        </form>
      </div>

      {state?.ok && (
        <p className="mt-3 rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          Saved <strong>{state.name}</strong> ({state.sizeKb} KB) — {state.counts.jobs} jobs,{' '}
          {state.counts.sales} invoices, {state.counts.customers} customers
          {state.balanced ? ', books balanced' : ', BOOKS DO NOT BALANCE'}. Copy it onto a flash
          drive.
        </p>
      )}

      {state?.errors?.length > 0 && (
        <p className="mt-3 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {state.errors.join(' ')}
        </p>
      )}
    </section>
  );
}
