import test from 'node:test';
import assert from 'node:assert/strict';

import { openMemoryDb, newId, now } from '../lib/db.js';
import { migrate } from '../lib/migrate.js';
import { seed } from '../lib/seed.js';
import {
  normalisePhone, searchCustomers, createCustomer, findOrCreateCustomer,
  customerAccount, customerHistory, customersOwing, retireCustomer, getCustomer,
} from '../lib/customers.js';
import { parseAmount } from '../lib/money.js';

function freshDb() {
  const db = openMemoryDb();
  migrate({ db });
  seed({ db, owner: { username: 'owner', password: 'a long password', name: 'Owner' } });
  return db;
}

function addSale(db, customerId, amount, { voided = 0, invoice = 'INV-' + Math.random() } = {}) {
  const id = newId();
  db.prepare(
    `INSERT INTO sales (id, invoice_number, customer_id, customer_name, sold_at, total_kobo, voided, created_at, updated_at)
     VALUES (?, ?, ?, 'x', ?, ?, ?, ?, ?)`
  ).run(id, invoice, customerId, now(), amount, voided, now(), now());
  return id;
}

function addPayment(db, customerId, amount, kind = 'payment') {
  const id = newId();
  db.prepare(
    `INSERT INTO payments (id, customer_id, kind, method, amount_kobo, received_at, created_at, updated_at)
     VALUES (?, ?, ?, 'cash', ?, ?, ?, ?)`
  ).run(id, customerId, kind, amount, now(), now(), now());
  return id;
}

/* --------------------------------------------------------- phone */

test('one person written four ways is still one person', () => {
  // All of these are the same number as staff and customers write it.
  assert.equal(normalisePhone('08031112222'), '8031112222');
  assert.equal(normalisePhone('+2348031112222'), '8031112222');
  assert.equal(normalisePhone('234 803 111 2222'), '8031112222');
  assert.equal(normalisePhone('0803-111-2222'), '8031112222');
});

test('a customer is found however the number was typed', () => {
  const db = freshDb();
  createCustomer({ name: 'Mrs Adeyemi', phone: '0803 111 2222' }, { db });

  for (const typed of ['08031112222', '+2348031112222', '0803-111-2222', '8031112222']) {
    const found = searchCustomers(typed, { db });
    assert.equal(found.length, 1, `not found when typed as ${typed}`);
    assert.equal(found[0].name, 'Mrs Adeyemi');
  }
});

test('a partial number finds them, because people read it off a ticket', () => {
  const db = freshDb();
  createCustomer({ name: 'Mrs Adeyemi', phone: '08031112222' }, { db });
  assert.equal(searchCustomers('1112222', { db }).length, 1);
});

test('searching by name still works', () => {
  const db = freshDb();
  createCustomer({ name: 'Mrs Adeyemi', phone: '08031112222' }, { db });
  createCustomer({ name: 'Chike Obi', phone: '08039998888' }, { db });

  assert.equal(searchCustomers('Adeyemi', { db }).length, 1);
  assert.equal(searchCustomers('Chike', { db }).length, 1);
});

test('the same regular does not become two records', () => {
  const db = freshDb();
  const first = findOrCreateCustomer({ name: 'Mrs Adeyemi', phone: '0803 111 2222' }, { db });
  assert.equal(first.created, true);

  // Same person, back a month later, number typed differently.
  const second = findOrCreateCustomer({ name: 'Adeyemi', phone: '+2348031112222' }, { db });
  assert.equal(second.created, false);
  assert.equal(second.customer.id, first.customer.id);
  assert.equal(searchCustomers('', { db }).length, 1);
});

test('a walk-in with no phone is still recordable', () => {
  const db = freshDb();
  const result = findOrCreateCustomer({ name: 'Walk-in' }, { db });
  assert.equal(result.created, true);
  assert.ok(result.customer.id);
});

test('a customer with no name is refused', () => {
  const db = freshDb();
  assert.equal(createCustomer({ name: '  ', phone: '08031112222' }, { db }).ok, false);
});

/* ------------------------------------------------------- account */

test('what a customer owes is worked out, not stored', () => {
  const db = freshDb();
  const { id } = createCustomer({ name: 'Mrs Adeyemi', phone: '08031112222' }, { db });

  addSale(db, id, parseAmount('50,000'));
  addPayment(db, id, parseAmount('20,000'));

  const account = customerAccount(id, { db });
  assert.equal(account.billedKobo, parseAmount('50,000'));
  assert.equal(account.paidKobo, parseAmount('20,000'));
  assert.equal(account.outstandingKobo, parseAmount('30,000'));
});

test('a voided invoice stops counting against them', () => {
  const db = freshDb();
  const { id } = createCustomer({ name: 'Mrs Adeyemi' }, { db });

  addSale(db, id, parseAmount('50,000'));
  addSale(db, id, parseAmount('99,000'), { voided: 1 });

  assert.equal(customerAccount(id, { db }).billedKobo, parseAmount('50,000'));
});

test('a refund gives the money back', () => {
  const db = freshDb();
  const { id } = createCustomer({ name: 'Mrs Adeyemi' }, { db });

  addSale(db, id, parseAmount('50,000'));
  addPayment(db, id, parseAmount('50,000'));
  addPayment(db, id, parseAmount('-10,000'), 'refund');

  assert.equal(customerAccount(id, { db }).outstandingKobo, parseAmount('10,000'));
});

test('holding a deposit shows as the shop owing them, not the reverse', () => {
  const db = freshDb();
  const { id } = createCustomer({ name: 'Mrs Adeyemi' }, { db });

  // Deposit paid, work not yet delivered or invoiced. Normal, halfway
  // through every framing job.
  addPayment(db, id, parseAmount('20,000'), 'deposit');

  assert.equal(customerAccount(id, { db }).outstandingKobo, parseAmount('-20,000'));
});

test('only real debtors appear on the owing list', () => {
  const db = freshDb();
  const owing = createCustomer({ name: 'Owes money' }, { db }).id;
  const settled = createCustomer({ name: 'Paid up' }, { db }).id;
  const credit = createCustomer({ name: 'Has a deposit down' }, { db }).id;

  addSale(db, owing, parseAmount('50,000'));
  addPayment(db, owing, parseAmount('10,000'));

  addSale(db, settled, parseAmount('30,000'));
  addPayment(db, settled, parseAmount('30,000'));

  addPayment(db, credit, parseAmount('15,000'), 'deposit');

  const list = customersOwing({ db });
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'Owes money');
  assert.equal(list[0].outstanding_kobo, parseAmount('40,000'));
});

test('the worst debtor is listed first', () => {
  const db = freshDb();
  const small = createCustomer({ name: 'Small' }, { db }).id;
  const big = createCustomer({ name: 'Big' }, { db }).id;
  addSale(db, small, parseAmount('5,000'));
  addSale(db, big, parseAmount('500,000'));

  assert.equal(customersOwing({ db })[0].name, 'Big');
});

/* ------------------------------------------------------- history */

test('what the shop is holding for them is the first thing shown', () => {
  const db = freshDb();
  const { id } = createCustomer({ name: 'Mrs Adeyemi' }, { db });

  const custody = (tag, released) =>
    db
      .prepare(
        `INSERT INTO custody_items (id, customer_id, tag_number, description, received_at, released_at, created_at, updated_at)
         VALUES (?, ?, ?, 'Wedding portrait', ?, ?, ?, ?)`
      )
      .run(newId(), id, tag, now(), released, now(), now());

  custody('T-0001', null);
  custody('T-0002', now()); // already collected

  const { holding } = customerHistory(id, { db });
  // "Have you still got my picture?" is the question, and this answers it.
  assert.equal(holding.length, 1);
  assert.equal(holding[0].tag_number, 'T-0001');
});

test('a customer who still owes cannot be quietly retired', () => {
  const db = freshDb();
  const { id } = createCustomer({ name: 'Mrs Adeyemi' }, { db });
  addSale(db, id, parseAmount('50,000'));

  // Hiding a debtor does not collect the debt.
  const result = retireCustomer(id, { db });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /still owes/);
});

test('a settled customer can be retired but keeps their row', () => {
  const db = freshDb();
  const { id } = createCustomer({ name: 'Mrs Adeyemi' }, { db });
  addSale(db, id, parseAmount('50,000'));
  addPayment(db, id, parseAmount('50,000'));

  assert.equal(retireCustomer(id, { db }).ok, true);
  assert.equal(searchCustomers('', { db }).length, 0);
  // The invoice still points at a real row.
  assert.ok(getCustomer(id, { db }));
});
