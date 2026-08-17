/* Shop settings.
 *
 * Small, and read on nearly every screen, so they are fetched one at a time
 * rather than cached — on a single machine with a local file that is a
 * microsecond, and a stale cache is a wrong price.
 */

import { getDb, now } from './db.js';

export function getSetting(key, fallback = null, { db = getDb() } = {}) {
  return db.prepare('SELECT value FROM settings WHERE key = ?').get(key)?.value ?? fallback;
}

export function getNumber(key, fallback = 0, { db = getDb() } = {}) {
  const raw = getSetting(key, null, { db });

  /* An absent setting must fall back, not read as zero. Number(null) is 0 and
   * 0 is perfectly finite, so checking only for a finite result quietly turns
   * "nobody has set a minimum charge" into "the minimum charge is nothing" —
   * and every small frame is then quoted at little more than its materials. */
  if (raw === null || String(raw).trim() === '') return fallback;

  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export function allSettings({ db = getDb() } = {}) {
  return Object.fromEntries(
    db.prepare('SELECT key, value FROM settings ORDER BY key').all().map((r) => [r.key, r.value])
  );
}

export function setSettings(values, { db = getDb() } = {}) {
  const write = db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  );

  return db.transaction(() => {
    for (const [key, value] of Object.entries(values)) write.run(key, String(value), now());
    return { ok: true, count: Object.keys(values).length };
  })();
}
