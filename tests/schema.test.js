import test from 'node:test';
import assert from 'node:assert/strict';

import { openMemoryDb, newId, now } from '../lib/db.js';
import { migrate } from '../lib/migrate.js';

function freshDb() {
  const db = openMemoryDb();
  migrate({ db });
  return db;
}

test('the migrations apply to an empty database', () => {
  const db = openMemoryDb();
  const applied = migrate({ db });
  assert.deepEqual(applied, ['001_foundation.sql', '002_jobs_and_money.sql']);
});

test('running the migrator again does nothing', () => {
  const db = openMemoryDb();
  migrate({ db });
  // This runs on every start-up on a machine nobody administers, so a second
  // run must be a no-op rather than an error.
  assert.deepEqual(migrate({ db }), []);
  assert.deepEqual(migrate({ db }), []);
});

test('every expected table exists', () => {
  const db = freshDb();
  const tables = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name)
  );
  for (const expected of [
    'users', 'settings', 'counters', 'customers', 'suppliers',
    'accounts', 'journal_entries', 'journal_lines',
    'materials', 'stock_movements', 'price_items',
    'jobs', 'job_items', 'job_stage_events', 'custody_items',
    'sales', 'sale_items', 'payments', 'expenses',
  ]) {
    assert.ok(tables.has(expected), `missing table: ${expected}`);
  }
});

test('foreign keys are enforced', () => {
  const db = freshDb();
  // A payment against an invoice that does not exist must be impossible, not
  // merely unlikely.
  assert.throws(
    () =>
      db
        .prepare(
          `INSERT INTO payments (id, sale_id, kind, method, amount_kobo, received_at, created_at, updated_at)
           VALUES (?, 'no-such-sale', 'payment', 'cash', 5000, ?, ?, ?)`
        )
        .run(newId(), now(), now(), now()),
    /FOREIGN KEY/
  );
});

test('a sale and its lines are written together or not at all', () => {
  const db = freshDb();
  const saleId = newId();

  const write = db.transaction(() => {
    db.prepare(
      `INSERT INTO sales (id, invoice_number, customer_name, sold_at, total_kobo, created_at, updated_at)
       VALUES (?, 'INV-001', 'Walk-in customer', ?, 500000, ?, ?)`
    ).run(saleId, now(), now(), now());

    db.prepare(
      `INSERT INTO sale_items (id, sale_id, line_no, description, quantity, unit_kobo, total_kobo, created_at)
       VALUES (?, ?, 1, 'Framed portrait', 1, 500000, 500000, ?)`
    ).run(newId(), saleId, now());

    throw new Error('ledger posting failed');
  });

  assert.throws(write, /ledger posting failed/);
  // This is the guarantee standalone MongoDB could not give: no orphan sale.
  assert.equal(db.prepare('SELECT count(*) n FROM sales').get().n, 0);
  assert.equal(db.prepare('SELECT count(*) n FROM sale_items').get().n, 0);
});

test('a journal entry balances to zero', () => {
  const db = freshDb();

  const cash = newId();
  const income = newId();
  const ins = db.prepare(
    `INSERT INTO accounts (id, code, name, type, normal, system, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
  );
  ins.run(cash, '1000', 'Cash', 'asset', 'debit', now(), now());
  ins.run(income, '4000', 'Framing sales', 'income', 'credit', now(), now());

  const entryId = newId();
  db.prepare(
    `INSERT INTO journal_entries (id, entry_date, memo, source_type, created_at, updated_at)
     VALUES (?, ?, 'Sale INV-001', 'sale', ?, ?)`
  ).run(entryId, now(), now(), now());

  const line = db.prepare(
    `INSERT INTO journal_lines (id, entry_id, account_id, amount_kobo, created_at) VALUES (?, ?, ?, ?, ?)`
  );
  line.run(newId(), entryId, cash, 500000, now());    // debit cash
  line.run(newId(), entryId, income, -500000, now()); // credit income

  // Signed amounts make "does this entry balance?" one condition instead of
  // two columns that can disagree.
  const { total } = db
    .prepare('SELECT SUM(amount_kobo) total FROM journal_lines WHERE entry_id = ?')
    .get(entryId);
  assert.equal(total, 0);
});

test('deleting a journal entry takes its lines with it', () => {
  const db = freshDb();
  const acct = newId();
  db.prepare(
    `INSERT INTO accounts (id, code, name, type, normal, created_at, updated_at)
     VALUES (?, '1000', 'Cash', 'asset', 'debit', ?, ?)`
  ).run(acct, now(), now());

  const entryId = newId();
  db.prepare(
    `INSERT INTO journal_entries (id, entry_date, memo, created_at, updated_at) VALUES (?, ?, 'x', ?, ?)`
  ).run(entryId, now(), now(), now());
  db.prepare(
    `INSERT INTO journal_lines (id, entry_id, account_id, amount_kobo, created_at) VALUES (?, ?, ?, 0, ?)`
  ).run(newId(), entryId, acct, now());

  db.prepare('DELETE FROM journal_entries WHERE id = ?').run(entryId);
  assert.equal(db.prepare('SELECT count(*) n FROM journal_lines').get().n, 0);
});

test('an invoice number cannot be issued twice', () => {
  const db = freshDb();
  const write = (id) =>
    db
      .prepare(
        `INSERT INTO sales (id, invoice_number, customer_name, sold_at, created_at, updated_at)
         VALUES (?, 'INV-001', 'x', ?, ?, ?)`
      )
      .run(id, now(), now(), now());

  write(newId());
  assert.throws(() => write(newId()), /UNIQUE/);
});

test('a claim tag cannot be issued twice', () => {
  const db = freshDb();
  const write = (id) =>
    db
      .prepare(
        `INSERT INTO custody_items (id, tag_number, description, received_at, created_at, updated_at)
         VALUES (?, 'T-001', 'Wedding portrait', ?, ?, ?)`
      )
      .run(id, now(), now(), now());

  // Two customers' irreplaceable pictures sharing one tag number is exactly
  // the mix-up this system exists to prevent.
  write(newId());
  assert.throws(() => write(newId()), /UNIQUE/);
});

test('what the shop is currently holding is a query, not a walk around', () => {
  const db = freshDb();
  const held = (tag, releasedAt) =>
    db
      .prepare(
        `INSERT INTO custody_items (id, tag_number, description, received_at, released_at, created_at, updated_at)
         VALUES (?, ?, 'Portrait', ?, ?, ?, ?)`
      )
      .run(newId(), tag, now(), releasedAt, now(), now());

  held('T-001', null);
  held('T-002', null);
  held('T-003', now()); // gone home

  const { n } = db
    .prepare('SELECT count(*) n FROM custody_items WHERE released_at IS NULL')
    .get();
  assert.equal(n, 2);
});

test('stock is held in base units and rebuilds from its movements', () => {
  const db = freshDb();
  const matId = newId();
  db.prepare(
    `INSERT INTO materials (id, name, category, base_unit, pack_size, pack_label, quantity_base, created_at, updated_at)
     VALUES (?, 'Oak 40mm', 'moulding', 'mm', 3000, '3 m length', 0, ?, ?)`
  ).run(matId, now(), now());

  const move = db.prepare(
    `INSERT INTO stock_movements (id, material_id, material_name, kind, delta_base, balance_after, created_at, updated_at)
     VALUES (?, ?, 'Oak 40mm', ?, ?, ?, ?, ?)`
  );
  move.run(newId(), matId, 'purchase', 30000, 30000, now(), now()); // ten 3m lengths
  move.run(newId(), matId, 'consume', -3320, 26680, now(), now());  // one framed piece
  move.run(newId(), matId, 'breakage', -1500, 25180, now(), now()); // a length snapped

  // The running quantity is a cache; the log is the truth and must agree.
  const { total } = db
    .prepare('SELECT SUM(delta_base) total FROM stock_movements WHERE material_id = ?')
    .get(matId);
  assert.equal(total, 25180);
});

test('breakage is recordable as itself, not as a mystery adjustment', () => {
  const db = freshDb();
  const kinds = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='stock_movements'")
    .get().sql;
  // If glass breaking has no name of its own, it gets recorded as nothing and
  // the stock figures drift until the shop stops trusting them.
  assert.match(kinds, /'breakage'/);
});

test('rows are retired, never removed', () => {
  const db = freshDb();
  const custId = newId();
  db.prepare(
    `INSERT INTO customers (id, name, created_at, updated_at) VALUES (?, 'Mrs Adeyemi', ?, ?)`
  ).run(custId, now(), now());
  db.prepare(
    `INSERT INTO sales (id, invoice_number, customer_id, customer_name, sold_at, created_at, updated_at)
     VALUES (?, 'INV-009', ?, 'Mrs Adeyemi', ?, ?, ?)`
  ).run(newId(), custId, now(), now(), now());

  db.prepare('UPDATE customers SET deleted_at = ? WHERE id = ?').run(now(), custId);

  // The invoice still points at a real customer row, so history stays intact.
  const sale = db.prepare('SELECT customer_id FROM sales WHERE invoice_number = ?').get('INV-009');
  assert.equal(sale.customer_id, custId);
  const live = db.prepare('SELECT count(*) n FROM customers WHERE deleted_at IS NULL').get().n;
  assert.equal(live, 0);
});
