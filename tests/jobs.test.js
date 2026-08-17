import test from 'node:test';
import assert from 'node:assert/strict';

import { openMemoryDb } from '../lib/db.js';
import { migrate } from '../lib/migrate.js';
import { seed } from '../lib/seed.js';
import { createMaterial, getMaterial, receiveStock } from '../lib/stock.js';
import { createPriceItem } from '../lib/price-items.js';
import { createQuote, getJob, acceptQuote, moveStage, collectJob, cancelJob, awaitingCollection, inCustody } from '../lib/jobs.js';
import { accountBalance, trialBalance } from '../lib/ledger.js';
import { ACCT } from '../lib/chart-of-accounts.js';
import { parseAmount } from '../lib/money.js';
import { customerAccount } from '../lib/customers.js';

/** A shop set up the way Master's Technology would set it up. */
function shop() {
  const db = openMemoryDb();
  migrate({ db });
  seed({ db, owner: { username: 'owner', password: 'a long password', name: 'Owner' } });

  const oakMat = createMaterial(
    { name: 'Oak 40mm', category: 'moulding', baseUnit: 'mm', packSize: 3000,
      packLabel: '3 m length', costPerPackKobo: parseAmount('10,500'), mouldingWidthMm: 40 },
    { db }
  ).id;
  const glassMat = createMaterial(
    { name: 'Clear glass 2mm', category: 'glass', baseUnit: 'mm2', packSize: 1220 * 914,
      packLabel: 'sheet', costPerPackKobo: parseAmount('8,000'), yieldPct: 70 },
    { db }
  ).id;

  /* Received on credit on purpose. Paying cash for opening stock would leave
   * the cash account carrying N290,000 of supplier payments, and every
   * assertion about takings below would have to know that. On credit, cash
   * means customer money and nothing else. */
  receiveStock({ materialId: oakMat, packs: 20, onCredit: true }, { db });
  receiveStock({ materialId: glassMat, packs: 10, onCredit: true }, { db });

  const oak = createPriceItem(
    { name: 'Oak 40mm', category: 'moulding', mode: 'per_m', priceKobo: parseAmount('3,500'),
      costKobo: parseAmount('1,800'), mouldingWidthMm: 40, wastageMm: 150, materialId: oakMat },
    { db }
  ).id;
  const glass = createPriceItem(
    { name: 'Clear glass 2mm', category: 'glazing', mode: 'per_sqm', priceKobo: parseAmount('8,000'),
      costKobo: parseAmount('4,500'), materialId: glassMat },
    { db }
  ).id;

  return { db, oak, glass, oakMat, glassMat };
}

const PIECE = {
  description: 'Wedding portrait',
  artworkWidthMm: 600,
  artworkHeightMm: 900,
  mountBorderMm: 50,
  labourKobo: parseAmount('2,500'),
};

function quoteFor(db, oak, glass, extra = {}) {
  return createQuote(
    {
      customer: { name: 'Mrs Adeyemi', phone: '0803 111 2222' },
      items: [{ ...PIECE, mouldingPriceId: oak, glazingPriceId: glass, ...extra }],
    },
    { db }
  );
}

/* ----------------------------------------------------------- quote */

test('a quote prices the pieces and owes nothing', () => {
  const { db, oak, glass } = shop();
  const result = quoteFor(db, oak, glass);

  assert.equal(result.ok, true);
  assert.match(result.jobNumber, /^Q-\d{4}$/);

  const job = getJob(result.id, { db });
  assert.equal(job.status, 'quote');
  assert.equal(job.items.length, 1);

  // Nothing is owed and nothing has moved.
  assert.equal(accountBalance(ACCT.RECEIVABLE, { db }), 0);
  assert.equal(accountBalance(ACCT.FRAMING_SALES, { db }), 0);
  assert.equal(customerAccount(job.customer_id, { db }).outstandingKobo, 0);
});

test('the quote freezes what the customer was told', () => {
  const { db, oak, glass } = shop();
  const { id } = quoteFor(db, oak, glass);

  const before = getJob(id, { db });
  const quotedTotal = before.total_kobo;
  const frozen = JSON.stringify(before.items[0].breakdown);

  // The supplier puts moulding up by half next month.
  db.prepare('UPDATE price_items SET price_kobo = ? WHERE id = ?').run(parseAmount('5,250'), oak);

  const after = getJob(id, { db });
  // August's quote still says what it said in August.
  assert.equal(after.total_kobo, quotedTotal);
  assert.equal(JSON.stringify(after.items[0].breakdown), frozen);
});

test('the mount grows the glass, and the frozen line proves it', () => {
  const { db, oak, glass } = shop();
  const { id } = quoteFor(db, oak, glass);
  const item = getJob(id, { db }).items[0];

  // 600x900 artwork with a 50mm mount is cut as 700x1000 glass.
  assert.equal(item.glass_width_mm, 700);
  assert.equal(item.glass_height_mm, 1000);

  const moulding = item.breakdown.lines.find((l) => l.part === 'moulding');
  // Perimeter 3400 + mitres 320 + wastage 150.
  assert.equal(moulding.quantityMm, 3870);
});

test('a quote for nobody is refused', () => {
  const { db, oak, glass } = shop();
  const result = createQuote({ items: [{ ...PIECE, mouldingPriceId: oak, glazingPriceId: glass }] }, { db });
  assert.equal(result.ok, false);
});

test('an empty quote is refused', () => {
  const { db } = shop();
  const result = createQuote({ customer: { name: 'x' }, items: [] }, { db });
  assert.equal(result.ok, false);
});

/* ---------------------------------------------------------- accept */

test('accepting takes a deposit and the picture', () => {
  const { db, oak, glass } = shop();
  const { id } = quoteFor(db, oak, glass);
  const total = getJob(id, { db }).total_kobo;
  const deposit = Math.round(total / 2);

  const result = acceptQuote(
    {
      jobId: id,
      depositKobo: deposit,
      method: 'cash',
      custody: [{ description: 'Wedding portrait, sepia 8x10', conditionNote: 'Small tear top-left, noted at intake' }],
    },
    { db }
  );

  assert.equal(result.ok, true);
  assert.match(result.tags[0], /^T-\d{4}$/);

  // The deposit is money held, not earned.
  assert.equal(accountBalance(ACCT.CASH, { db }), deposit);
  assert.equal(accountBalance(ACCT.CUSTOMER_DEPOSITS, { db }), deposit);
  assert.equal(accountBalance(ACCT.FRAMING_SALES, { db }), 0);

  const job = getJob(id, { db });
  assert.equal(job.status, 'accepted');
  assert.equal(job.custody.length, 1);
  assert.equal(job.custody[0].released_at, null);
});

test('the quote number survives acceptance', () => {
  const { db, oak, glass } = shop();
  const { id, jobNumber } = quoteFor(db, oak, glass);
  acceptQuote({ jobId: id, depositKobo: 0 }, { db });

  // Renumbering would break the piece of paper the customer is holding.
  assert.equal(getJob(id, { db }).job_number, jobNumber);
});

test('a deposit larger than the job is refused', () => {
  const { db, oak, glass } = shop();
  const { id } = quoteFor(db, oak, glass);
  const total = getJob(id, { db }).total_kobo;

  assert.equal(acceptQuote({ jobId: id, depositKobo: total + 1 }, { db }).ok, false);
});

test('a quote cannot be accepted twice', () => {
  const { db, oak, glass } = shop();
  const { id } = quoteFor(db, oak, glass);
  acceptQuote({ jobId: id, depositKobo: 0 }, { db });

  assert.equal(acceptQuote({ jobId: id, depositKobo: 0 }, { db }).ok, false);
});

/* ---------------------------------------------------------- stages */

test('the work moves through the workshop and is remembered', () => {
  const { db, oak, glass } = shop();
  const { id } = quoteFor(db, oak, glass);
  acceptQuote({ jobId: id, depositKobo: 0 }, { db });

  moveStage({ jobId: id, stage: 'cut_moulding' }, { db });
  moveStage({ jobId: id, stage: 'cut_glass', note: 'Glass cut oversize, recut' }, { db });
  moveStage({ jobId: id, stage: 'done' }, { db });

  const job = getJob(id, { db });
  assert.equal(job.stage, 'done');
  // Finishing the last stage is what makes it ready to collect.
  assert.equal(job.status, 'ready');
  assert.equal(job.events.length, 3);
  assert.equal(job.events[1].note, 'Glass cut oversize, recut');
});

test('a quote cannot be put into the workshop', () => {
  const { db, oak, glass } = shop();
  const { id } = quoteFor(db, oak, glass);

  const result = moveStage({ jobId: id, stage: 'cut_moulding' }, { db });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /still a quote/);
});

test('finished work appears on the collection shelf', () => {
  const { db, oak, glass } = shop();
  const { id } = quoteFor(db, oak, glass);
  acceptQuote({ jobId: id, depositKobo: 0, custody: [{ description: 'Portrait' }] }, { db });
  moveStage({ jobId: id, stage: 'done' }, { db });

  const waiting = awaitingCollection({ db });
  assert.equal(waiting.length, 1);
  assert.equal(waiting[0].held, 1);
});

/* --------------------------------------------------------- collect */

test('collecting invoices, settles, charges stock and hands the picture back', () => {
  const { db, oak, glass, oakMat } = shop();
  const { id } = quoteFor(db, oak, glass);
  const total = getJob(id, { db }).total_kobo;
  const deposit = Math.round(total / 2);

  acceptQuote({ jobId: id, depositKobo: deposit, custody: [{ description: 'Wedding portrait' }] }, { db });
  moveStage({ jobId: id, stage: 'done' }, { db });

  const stockBefore = getMaterial(oakMat, { db }).quantity_base;

  const result = collectJob(
    { jobId: id, paymentKobo: total - deposit, method: 'transfer', releasedTo: 'Mrs Adeyemi' },
    { db }
  );

  assert.equal(result.ok, true);
  assert.match(result.invoiceNumber, /^INV-\d{4}$/);
  assert.equal(result.balanceKobo, 0);
  assert.equal(result.released, 1);

  // Income is earned now, not when the deposit arrived.
  assert.equal(accountBalance(ACCT.FRAMING_SALES, { db }), total);
  assert.equal(accountBalance(ACCT.CUSTOMER_DEPOSITS, { db }), 0);
  assert.equal(accountBalance(ACCT.RECEIVABLE, { db }), 0);

  // Materials came off the shelf, and the frozen quantity is what was taken.
  const stockAfter = getMaterial(oakMat, { db }).quantity_base;
  assert.equal(stockBefore - stockAfter, 3870);
  assert.ok(accountBalance(ACCT.COST_OF_MATERIALS, { db }) > 0);

  // The picture went home, and it is recorded who took it.
  const job = getJob(id, { db });
  assert.equal(job.status, 'collected');
  assert.equal(job.custody[0].released_to, 'Mrs Adeyemi');
  assert.ok(job.custody[0].released_at);

  assert.equal(trialBalance({ db }).balanced, true);
});

test('a picture is not released to nobody', () => {
  const { db, oak, glass } = shop();
  const { id } = quoteFor(db, oak, glass);
  acceptQuote({ jobId: id, depositKobo: 0, custody: [{ description: 'Wedding portrait' }] }, { db });
  moveStage({ jobId: id, stage: 'done' }, { db });

  // When a family argues about who collected their mother's portrait, this
  // line is the only answer the shop has.
  const result = collectJob({ jobId: id, paymentKobo: 0, releasedTo: '  ' }, { db });
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /who is collecting/);
});

test('nothing is left half-done when a collection is refused', () => {
  const { db, oak, glass } = shop();
  const { id } = quoteFor(db, oak, glass);
  acceptQuote({ jobId: id, depositKobo: 0, custody: [{ description: 'Portrait' }] }, { db });
  moveStage({ jobId: id, stage: 'done' }, { db });

  collectJob({ jobId: id, paymentKobo: 0, releasedTo: '' }, { db });

  // No invoice, no payment, nothing off the shelf.
  assert.equal(db.prepare('SELECT count(*) n FROM sales').get().n, 0);
  assert.equal(getJob(id, { db }).status, 'ready');
});

test('collecting without paying leaves a balance owing', () => {
  const { db, oak, glass } = shop();
  const { id } = quoteFor(db, oak, glass);
  const total = getJob(id, { db }).total_kobo;

  acceptQuote({ jobId: id, depositKobo: parseAmount('5,000') }, { db });
  moveStage({ jobId: id, stage: 'done' }, { db });
  const result = collectJob({ jobId: id, paymentKobo: 0, releasedTo: 'Mrs Adeyemi' }, { db });

  assert.equal(result.balanceKobo, total - parseAmount('5,000'));
  assert.equal(accountBalance(ACCT.RECEIVABLE, { db }), total - parseAmount('5,000'));

  const job = getJob(id, { db });
  assert.equal(customerAccount(job.customer_id, { db }).outstandingKobo, total - parseAmount('5,000'));
});

test('a job cannot be collected twice', () => {
  const { db, oak, glass } = shop();
  const { id } = quoteFor(db, oak, glass);
  acceptQuote({ jobId: id, depositKobo: 0 }, { db });
  moveStage({ jobId: id, stage: 'done' }, { db });
  collectJob({ jobId: id, paymentKobo: 0, releasedTo: 'x' }, { db });

  assert.equal(collectJob({ jobId: id, paymentKobo: 0, releasedTo: 'x' }, { db }).ok, false);
});

/* ---------------------------------------------------------- cancel */

test('cancelling keeps the deposit question open', () => {
  const { db, oak, glass } = shop();
  const { id } = quoteFor(db, oak, glass);
  acceptQuote({ jobId: id, depositKobo: parseAmount('20,000'), custody: [{ description: 'Portrait' }] }, { db });

  const result = cancelJob({ jobId: id, reason: 'Customer changed their mind' }, { db });

  assert.equal(result.ok, true);
  // Whether it is refunded or kept against wasted material is a conversation
  // with the customer, not something the software decides.
  assert.equal(result.depositHeldKobo, parseAmount('20,000'));
  assert.equal(accountBalance(ACCT.CUSTOMER_DEPOSITS, { db }), parseAmount('20,000'));
  // And the shop is still holding their picture.
  assert.equal(result.custodyStillHeld, 1);
});

test('cancelling needs a reason', () => {
  const { db, oak, glass } = shop();
  const { id } = quoteFor(db, oak, glass);
  assert.equal(cancelJob({ jobId: id, reason: '' }, { db }).ok, false);
});

/* -------------------------------------------------------- custody */

test('what the shop is holding is one query across every job', () => {
  const { db, oak, glass } = shop();
  const a = quoteFor(db, oak, glass).id;
  const b = quoteFor(db, oak, glass).id;

  acceptQuote({ jobId: a, custody: [{ description: 'Portrait A' }] }, { db });
  acceptQuote({ jobId: b, custody: [{ description: 'Portrait B' }, { description: 'Certificate' }] }, { db });

  assert.equal(inCustody({ db }).length, 3);

  moveStage({ jobId: a, stage: 'done' }, { db });
  collectJob({ jobId: a, paymentKobo: 0, releasedTo: 'Mrs Adeyemi' }, { db });

  assert.equal(inCustody({ db }).length, 2);
});

test('each item gets its own tag, never a shared one', () => {
  const { db, oak, glass } = shop();
  const { id } = quoteFor(db, oak, glass);

  const result = acceptQuote(
    { jobId: id, custody: [{ description: 'Portrait' }, { description: 'Certificate' }] },
    { db }
  );

  // Two customers' irreplaceable pictures under one number is the mix-up
  // this exists to prevent.
  assert.equal(new Set(result.tags).size, 2);
});

/* ------------------------------------------------- the whole thing */

test('a full job from counter to collection leaves the books sound', () => {
  const { db, oak, glass } = shop();
  const { id } = quoteFor(db, oak, glass);
  const total = getJob(id, { db }).total_kobo;
  const deposit = parseAmount('15,000');

  acceptQuote({ jobId: id, depositKobo: deposit, method: 'cash', custody: [{ description: 'Portrait' }] }, { db });
  for (const stage of ['cut_moulding', 'join', 'cut_glass', 'cut_mount', 'fit', 'wrap', 'done']) {
    moveStage({ jobId: id, stage }, { db });
  }
  collectJob({ jobId: id, paymentKobo: total - deposit, method: 'pos', releasedTo: 'Mrs Adeyemi' }, { db });

  const { balanced, driftKobo } = trialBalance({ db });
  assert.equal(balanced, true, `books drifted by ${driftKobo} kobo`);

  assert.equal(accountBalance(ACCT.FRAMING_SALES, { db }), total);
  assert.equal(accountBalance(ACCT.RECEIVABLE, { db }), 0);
  assert.equal(accountBalance(ACCT.CUSTOMER_DEPOSITS, { db }), 0);
  assert.equal(accountBalance(ACCT.CASH, { db }), deposit);
  assert.equal(accountBalance(ACCT.BANK, { db }), total - deposit);
  assert.equal(inCustody({ db }).length, 0);
});

test('the margin shown is the cost the ledger will actually charge', () => {
  const { db, oak, glass, oakMat } = shop();

  /* The price list says oak costs N1,800 per metre. The supplier's pack price
   * says N10,500 per 3m length, which is N3,500 per metre. Those cannot both
   * be true, and the ledger uses the pack price when it charges stock out.
   * The quote must use the same one, or the owner is shown a margin that the
   * books will never agree with. */
  db.prepare('UPDATE price_items SET cost_kobo = ? WHERE id = ?').run(parseAmount('1,800'), oak);

  const { id } = quoteFor(db, oak, glass);
  const job = getJob(id, { db });

  acceptQuote({ jobId: id, depositKobo: 0 }, { db });
  moveStage({ jobId: id, stage: 'done' }, { db });
  collectJob({ jobId: id, paymentKobo: job.total_kobo, releasedTo: 'Mrs Adeyemi' }, { db });

  // What the job estimated and what the books charged must agree.
  const charged = accountBalance(ACCT.COST_OF_MATERIALS, { db });
  assert.equal(job.cost_kobo, charged);
});

test('a quote refuses to silently drop a part it cannot find', () => {
  const { db, oak, glass } = shop();

  // The moulding is deleted outright, as a bad migration or a stray script
  // might do.
  db.prepare('DELETE FROM price_items WHERE id = ?').run(oak);

  const result = quoteFor(db, oak, glass);

  /* Skipping it quietly would be far worse than failing: the quote still
   * comes out with a number on it, just missing the frame, and nobody notices
   * until it has been sold for the price of its glass. */
  assert.equal(result.ok, false);
  assert.match(result.errors[0], /no longer on the price list/);
});
