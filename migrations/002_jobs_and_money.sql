-- Jobs, the custody of customer property, and money in and out.

-- --------------------------------------------------------------- jobs

CREATE TABLE jobs (
  id            TEXT PRIMARY KEY,
  job_number    TEXT NOT NULL UNIQUE,
  customer_id   TEXT REFERENCES customers (id),
  customer_name TEXT NOT NULL,   -- snapshot for fast lists
  customer_phone TEXT,

  -- A quote is not yet work. It becomes a job when the customer accepts and
  -- pays a deposit, and only then is material committed to it.
  status        TEXT NOT NULL DEFAULT 'quote' CHECK (status IN (
                  'quote', 'accepted', 'in_progress', 'ready', 'collected', 'cancelled')),

  -- Where the work physically is. Separate from `status` because a job can be
  -- accepted and paid for but stuck waiting on moulding that has not arrived,
  -- and the shop needs to see that at a glance rather than reading notes.
  stage         TEXT NOT NULL DEFAULT 'not_started' CHECK (stage IN (
                  'not_started', 'awaiting_material', 'cut_moulding', 'join',
                  'cut_glass', 'cut_mount', 'fit', 'wrap', 'done')),

  promised_at   TEXT,
  notes         TEXT,

  -- Totals, all derived from job_items but stored so that lists and reports
  -- do not have to aggregate on every page load.
  subtotal_kobo INTEGER NOT NULL DEFAULT 0,
  discount_kobo INTEGER NOT NULL DEFAULT 0,
  total_kobo    INTEGER NOT NULL DEFAULT 0,
  deposit_kobo  INTEGER NOT NULL DEFAULT 0,  -- taken at acceptance
  -- Owner-only: what the materials actually cost, from the same measured
  -- quantities the price used.
  cost_kobo     INTEGER NOT NULL DEFAULT 0,

  cancelled_reason TEXT,
  created_by    TEXT REFERENCES users (id),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT
);
CREATE INDEX idx_jobs_status   ON jobs (status) WHERE deleted_at IS NULL;
CREATE INDEX idx_jobs_customer ON jobs (customer_id);
CREATE INDEX idx_jobs_promised ON jobs (promised_at) WHERE status IN ('accepted', 'in_progress');

-- One framed piece. A single order is often several — "these three portraits,
-- same moulding, one deadline, one invoice" — so a job holds a list.
CREATE TABLE job_items (
  id             TEXT PRIMARY KEY,
  job_id         TEXT NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  line_no        INTEGER NOT NULL,
  description    TEXT NOT NULL,

  -- The measurements the price was worked out from. Kept because a job ticket
  -- in the workshop needs the cutting sizes, and because a dispute about a
  -- price is settled by re-reading the size that was quoted.
  artwork_width_mm  INTEGER NOT NULL,
  artwork_height_mm INTEGER NOT NULL,
  mount_border_mm   INTEGER NOT NULL DEFAULT 0,
  mount_apertures   INTEGER NOT NULL DEFAULT 1,
  glass_width_mm    INTEGER NOT NULL,   -- artwork + 2 x mount border
  glass_height_mm   INTEGER NOT NULL,

  quantity       INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1),

  -- Which price items were chosen. Nullable throughout: a canvas has no
  -- glazing, a ready-made frame has no moulding.
  moulding_price_id   TEXT REFERENCES price_items (id),
  glazing_price_id    TEXT REFERENCES price_items (id),
  mount_price_id      TEXT REFERENCES price_items (id),
  backing_price_id    TEXT REFERENCES price_items (id),

  labour_kobo    INTEGER NOT NULL DEFAULT 0,
  unit_kobo      INTEGER NOT NULL DEFAULT 0,
  discount_kobo  INTEGER NOT NULL DEFAULT 0,
  total_kobo     INTEGER NOT NULL DEFAULT 0,
  cost_kobo      INTEGER NOT NULL DEFAULT 0,

  -- The full priced breakdown as JSON, exactly as it was calculated at the
  -- moment of quoting.
  --
  -- This is deliberate duplication and it earns its place. A quote given in
  -- August must still explain itself in October, after the moulding price has
  -- risen. Recomputing from today's price list would silently rewrite what
  -- the customer was told and turn an argument into one the shop loses.
  breakdown_json TEXT NOT NULL DEFAULT '{}',

  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX idx_job_items_job ON job_items (job_id);

-- Who moved the job to which stage, and when. Answers "who said this was
-- ready?" and "how long does a mount actually take us?".
CREATE TABLE job_stage_events (
  id         TEXT PRIMARY KEY,
  job_id     TEXT NOT NULL REFERENCES jobs (id) ON DELETE CASCADE,
  from_stage TEXT,
  to_stage   TEXT NOT NULL,
  note       TEXT,
  created_by TEXT REFERENCES users (id),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_stage_events_job ON job_stage_events (job_id, created_at);

-- ------------------------------------------------- customer property

-- The customer's own artwork, held by the shop.
--
-- This table has no equivalent in a print shop and is the most important one
-- here. Customers hand over things that cannot be replaced at any price: a
-- wedding portrait, a certificate, the only photograph of someone who has
-- died. Nearly every serious dispute in a framing shop is about what was
-- handed over, what condition it was in, and who collected it.
--
-- So intake is a record with a condition note and a photograph, release is a
-- record of who took it and when, and neither is a free-text field buried in
-- the job's notes.
CREATE TABLE custody_items (
  id             TEXT PRIMARY KEY,
  job_id         TEXT REFERENCES jobs (id),
  customer_id    TEXT REFERENCES customers (id),
  -- What is written on the physical tag tied to the item, and on the
  -- customer's claim slip. This is what is actually said at the counter:
  -- people arrive holding a number, not a job id.
  tag_number     TEXT NOT NULL UNIQUE,

  description    TEXT NOT NULL,          -- 'Wedding portrait, sepia, 8x10'
  condition_note TEXT,                   -- 'Small tear top-left corner, noted at intake'
  photo_path     TEXT,                   -- taken at the counter, stored on this machine

  received_at    TEXT NOT NULL,
  received_by    TEXT REFERENCES users (id),

  -- Null until it goes back to the customer. A row with a received_at and no
  -- released_at is, by definition, something of a customer's that the shop is
  -- currently holding — which makes "what are we responsible for right now?"
  -- a query rather than a walk around the workshop.
  released_at    TEXT,
  released_to    TEXT,                   -- the name of whoever actually collected
  released_by    TEXT REFERENCES users (id),
  release_note   TEXT,

  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX idx_custody_held     ON custody_items (received_at) WHERE released_at IS NULL;
CREATE INDEX idx_custody_job      ON custody_items (job_id);
CREATE INDEX idx_custody_customer ON custody_items (customer_id);

-- -------------------------------------------------------------- sales

CREATE TABLE sales (
  id             TEXT PRIMARY KEY,
  invoice_number TEXT NOT NULL UNIQUE,
  job_id         TEXT REFERENCES jobs (id),
  customer_id    TEXT REFERENCES customers (id),
  customer_name  TEXT NOT NULL DEFAULT 'Walk-in customer',
  customer_phone TEXT,

  sold_at        TEXT NOT NULL,
  subtotal_kobo  INTEGER NOT NULL DEFAULT 0,
  discount_kobo  INTEGER NOT NULL DEFAULT 0,
  total_kobo     INTEGER NOT NULL DEFAULT 0,
  cost_kobo      INTEGER NOT NULL DEFAULT 0,   -- owner-only

  -- Not stored: amount paid, balance, paid/unpaid status. They are SUMs over
  -- `payments` and are worked out on read.
  --
  -- Storing them means two places that can disagree, and they will: a payment
  -- reversed in one place and not the other leaves an invoice that says paid
  -- while the ledger says otherwise, and no way to tell which is right.

  voided         INTEGER NOT NULL DEFAULT 0 CHECK (voided IN (0, 1)),
  void_reason    TEXT,
  voided_at      TEXT,
  voided_by      TEXT REFERENCES users (id),

  created_by     TEXT REFERENCES users (id),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX idx_sales_date     ON sales (sold_at) WHERE voided = 0;
CREATE INDEX idx_sales_customer ON sales (customer_id);
CREATE INDEX idx_sales_job      ON sales (job_id);

CREATE TABLE sale_items (
  id            TEXT PRIMARY KEY,
  sale_id       TEXT NOT NULL REFERENCES sales (id) ON DELETE CASCADE,
  job_item_id   TEXT REFERENCES job_items (id),
  line_no       INTEGER NOT NULL,
  description   TEXT NOT NULL,
  quantity      INTEGER NOT NULL DEFAULT 1,
  unit_kobo     INTEGER NOT NULL DEFAULT 0,
  total_kobo    INTEGER NOT NULL DEFAULT 0,
  cost_kobo     INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_sale_items_sale ON sale_items (sale_id);

-- Money received. A deposit is a payment like any other; what makes it a
-- deposit is that it arrives before the work is delivered, and the ledger
-- treats it as a liability until it is.
CREATE TABLE payments (
  id           TEXT PRIMARY KEY,
  sale_id      TEXT REFERENCES sales (id),
  job_id       TEXT REFERENCES jobs (id),
  customer_id  TEXT REFERENCES customers (id),

  kind         TEXT NOT NULL DEFAULT 'payment' CHECK (kind IN ('deposit', 'payment', 'refund')),
  method       TEXT NOT NULL DEFAULT 'cash' CHECK (method IN ('cash', 'transfer', 'pos', 'cheque', 'other')),
  -- Signed: a refund is negative, so a customer's balance is a plain SUM
  -- rather than a sum with an exception in it.
  amount_kobo  INTEGER NOT NULL,
  reference    TEXT,
  received_at  TEXT NOT NULL,
  note         TEXT,

  created_by   TEXT REFERENCES users (id),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX idx_payments_sale     ON payments (sale_id);
CREATE INDEX idx_payments_job      ON payments (job_id);
CREATE INDEX idx_payments_customer ON payments (customer_id);
CREATE INDEX idx_payments_date     ON payments (received_at);

-- ----------------------------------------------------------- expenses

CREATE TABLE expenses (
  id          TEXT PRIMARY KEY,
  spent_at    TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT 'other',
  description TEXT NOT NULL,
  amount_kobo INTEGER NOT NULL,
  method      TEXT NOT NULL DEFAULT 'cash' CHECK (method IN ('cash', 'transfer', 'pos', 'cheque', 'other')),
  supplier_id TEXT REFERENCES suppliers (id),
  account_id  TEXT REFERENCES accounts (id),   -- which expense account it hits
  reference   TEXT,
  note        TEXT,
  created_by  TEXT REFERENCES users (id),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT
);
CREATE INDEX idx_expenses_date     ON expenses (spent_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_expenses_category ON expenses (category);

-- Now that jobs exist, stock movements can point at the job that consumed
-- them. Added here rather than in 001 because the table did not yet exist.
CREATE INDEX idx_stock_job ON stock_movements (job_id) WHERE job_id IS NOT NULL;
