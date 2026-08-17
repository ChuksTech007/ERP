-- Foundation: people, the chart of accounts, the ledger, stock and the price
-- list. Everything the shop's daily work is recorded against.
--
-- Conventions holding across every table in this schema:
--
--   id            TEXT, a UUID decided by the writer, never an autoincrement
--   *_kobo        INTEGER, always. There are no decimal amounts anywhere.
--   *_mm, *_mm2   INTEGER millimetres / square millimetres, always.
--   created_at    ISO-8601 TEXT, UTC
--   updated_at    ISO-8601 TEXT — present on every table so that a cloud sync
--                 can be added later without rewriting the schema
--   deleted_at    ISO-8601 TEXT or NULL. Rows are retired, never removed:
--                 a deleted customer still has invoices pointing at them, and
--                 a real DELETE either breaks those or cascades away history
--                 the shop is legally required to keep.

-- ---------------------------------------------------------------- people

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  -- owner sees costs, margins and the ledger; staff see prices and jobs only
  role          TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('owner', 'manager', 'staff')),
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT
);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Document numbering. Kept in a table rather than derived from a COUNT so
-- that a voided invoice does not cause the next one to reuse its number —
-- numbers on paper in a customer's hand must never be issued twice.
CREATE TABLE counters (
  name       TEXT PRIMARY KEY,   -- 'invoice', 'job', 'quote', 'claim_ticket'
  prefix     TEXT NOT NULL DEFAULT '',
  next_value INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE customers (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  phone       TEXT,
  email       TEXT,
  address     TEXT,
  notes       TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT
);
-- Staff look customers up by phone far more than by name, because that is
-- what is written on the claim ticket.
CREATE INDEX idx_customers_phone ON customers (phone) WHERE deleted_at IS NULL;
CREATE INDEX idx_customers_name  ON customers (name)  WHERE deleted_at IS NULL;

CREATE TABLE suppliers (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  phone      TEXT,
  email      TEXT,
  address    TEXT,
  notes      TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

-- ------------------------------------------------------- the ledger

-- Double-entry, properly. Every movement of money writes a journal entry
-- whose lines sum to zero, and the shop's position is always derivable from
-- the ledger alone rather than from a set of running totals nobody can audit.
CREATE TABLE accounts (
  id         TEXT PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,   -- '1000', '4000' — sorts into a report order
  name       TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('asset', 'liability', 'equity', 'income', 'expense')),
  -- Which way a positive balance runs. Assets and expenses are debit-normal;
  -- everything else is credit-normal. Stored so reports need not hardcode it.
  normal     TEXT NOT NULL CHECK (normal IN ('debit', 'credit')),
  system     INTEGER NOT NULL DEFAULT 0 CHECK (system IN (0, 1)), -- cannot be deleted
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE journal_entries (
  id          TEXT PRIMARY KEY,
  entry_date  TEXT NOT NULL,
  memo        TEXT NOT NULL,
  -- What caused this entry, so a figure in a report can be traced back to the
  -- sale or expense that produced it.
  source_type TEXT CHECK (source_type IN ('sale', 'payment', 'expense', 'purchase', 'supplier_payment', 'stock', 'manual', 'opening')),
  source_id   TEXT,
  created_by  TEXT REFERENCES users (id),
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX idx_journal_date   ON journal_entries (entry_date);
CREATE INDEX idx_journal_source ON journal_entries (source_type, source_id);

CREATE TABLE journal_lines (
  id          TEXT PRIMARY KEY,
  entry_id    TEXT NOT NULL REFERENCES journal_entries (id) ON DELETE CASCADE,
  account_id  TEXT NOT NULL REFERENCES accounts (id),
  -- One signed column rather than separate debit and credit columns. A debit
  -- is positive, a credit negative, and "the entry balances" is then simply
  -- SUM(amount_kobo) = 0 — one condition to check instead of two columns that
  -- can disagree.
  amount_kobo INTEGER NOT NULL,
  memo        TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_journal_lines_entry   ON journal_lines (entry_id);
CREATE INDEX idx_journal_lines_account ON journal_lines (account_id);

-- ------------------------------------------------------------- stock

-- Materials, with the two-unit problem solved explicitly.
--
-- A framing shop buys in packs and consumes in fractions of them: moulding
-- arrives in 3-metre lengths and is cut in millimetres; glass arrives as
-- 1220x914 sheets and is cut by area. Holding stock in "lengths" and
-- consuming in "millimetres" is how stock figures drift until nobody trusts
-- them, so stock is held in the BASE unit and packs are a purchasing
-- convenience layered on top.
CREATE TABLE materials (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  category      TEXT NOT NULL DEFAULT 'other' CHECK (category IN (
                  'moulding', 'glass', 'acrylic', 'mount_board', 'backing',
                  'hardware', 'print_media', 'consumable', 'other')),

  -- The unit stock is COUNTED in. 'mm' for moulding, 'mm2' for sheet goods,
  -- 'piece' for hangers, screws, ready-made frames.
  base_unit     TEXT NOT NULL DEFAULT 'piece' CHECK (base_unit IN ('mm', 'mm2', 'piece')),
  -- How many base units are in one purchasable pack: 3000 for a 3m length,
  -- 1114508 (1220x914) for a sheet, 1 for a piece.
  pack_size     INTEGER NOT NULL DEFAULT 1 CHECK (pack_size > 0),
  pack_label    TEXT NOT NULL DEFAULT 'piece',  -- '3 m length', '1220 x 914 sheet'

  quantity_base INTEGER NOT NULL DEFAULT 0,     -- current stock, in base units
  reorder_base  INTEGER NOT NULL DEFAULT 0,
  cost_per_pack_kobo INTEGER NOT NULL DEFAULT 0,

  -- Moulding only: how wide the face is, which drives the mitre allowance in
  -- the pricing engine. Zero for anything that is not moulding.
  moulding_width_mm INTEGER NOT NULL DEFAULT 0,
  -- Sheet goods only: how much of a sheet is genuinely usable once offcuts
  -- are thrown away. Measured by the shop, not assumed.
  yield_pct     INTEGER NOT NULL DEFAULT 100 CHECK (yield_pct BETWEEN 1 AND 100),

  supplier_id   TEXT REFERENCES suppliers (id),
  shelf         TEXT,
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT
);
CREATE INDEX idx_materials_category ON materials (category) WHERE deleted_at IS NULL;

-- Every change in stock, ever. The quantity on `materials` is a cache over
-- this log and can be rebuilt from it at any time; the log itself is the
-- truth and is never edited or deleted.
CREATE TABLE stock_movements (
  id            TEXT PRIMARY KEY,
  material_id   TEXT NOT NULL REFERENCES materials (id),
  material_name TEXT NOT NULL,  -- snapshot, so the log stays readable after a rename

  kind          TEXT NOT NULL CHECK (kind IN (
                  'opening',    -- what was on the shelf when the system started
                  'purchase',   -- stock received
                  'consume',    -- used on a job
                  'breakage',   -- glass broke. Happens weekly; needs its own
                                -- reason or stock silently drifts and the
                                -- software gets blamed for it
                  'offcut',     -- unusable remainder written off
                  'return',     -- sent back to the supplier
                  'adjust')),   -- stock count correction

  -- Signed, in base units: negative takes stock off the shelf. Signed rather
  -- than a positive quantity plus a direction, so the balance is a plain SUM.
  delta_base    INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  unit_cost_kobo INTEGER NOT NULL DEFAULT 0,  -- per base unit, at the time

  job_id        TEXT,   -- set once jobs exist (migration 002)
  reason        TEXT,
  created_by    TEXT REFERENCES users (id),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE INDEX idx_stock_material ON stock_movements (material_id, created_at);
CREATE INDEX idx_stock_kind     ON stock_movements (kind, created_at);

-- -------------------------------------------------------- price list

-- What the shop charges, and how that charge is worked out.
--
-- The mode is the important column and the thing the old print-shop model
-- could not express: a price of 350000 means ₦3,500 per METRE for moulding
-- and ₦3,500 per SQUARE METRE for glass, and the pricing engine cannot guess
-- which without being told.
CREATE TABLE price_items (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  category      TEXT NOT NULL DEFAULT 'other' CHECK (category IN (
                  'moulding', 'glazing', 'mount_board', 'backing', 'service',
                  'print', 'ready_made', 'other')),
  mode          TEXT NOT NULL DEFAULT 'per_piece' CHECK (mode IN (
                  'per_piece', 'per_m', 'per_sqm', 'per_aperture')),

  price_kobo    INTEGER NOT NULL DEFAULT 0,  -- read according to `mode`
  cost_kobo     INTEGER NOT NULL DEFAULT 0,  -- owner-only; drives the margin
  cutting_kobo  INTEGER NOT NULL DEFAULT 0,  -- mount board: charged per aperture

  -- Copied onto the quote line when this item is chosen, so pricing does not
  -- have to reach back into `materials` mid-calculation.
  moulding_width_mm INTEGER NOT NULL DEFAULT 0,
  wastage_mm    INTEGER NOT NULL DEFAULT 0,

  material_id   TEXT REFERENCES materials (id),  -- what to take off the shelf
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT
);
CREATE INDEX idx_price_items_category ON price_items (category) WHERE deleted_at IS NULL;
