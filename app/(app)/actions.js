'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { backupNow, verifyBackup, pruneBackups } from '@/lib/backup';

/**
 * Back up from the app, so it does not depend on somebody remembering a
 * command. The copy is read back immediately — a backup that silently wrote
 * nothing looks exactly like one that worked.
 */
export async function runBackup(_previous) {
  await requireUser();

  try {
    const result = backupNow({});
    const check = verifyBackup(result.file);

    if (!check.ok) return { ok: false, errors: [`The copy could not be read back: ${check.errors.join(' ')}`] };

    pruneBackups({ keep: 30 });
    revalidatePath('/');

    return {
      ok: true,
      name: result.name,
      sizeKb: Math.round(result.sizeBytes / 1024),
      counts: check.counts,
      balanced: check.balanced,
    };
  } catch (error) {
    return { ok: false, errors: [error.message] };
  }
}
