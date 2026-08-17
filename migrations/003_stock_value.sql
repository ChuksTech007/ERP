-- Record what a stock movement was WORTH, not what one base unit costs.
--
-- The original column held cost per base unit, which cannot survive sheet
-- goods. A 1220x914 sheet of glass is 1,114,508 square millimetres. At
-- N8,000 the cost of one square millimetre is 0.72 kobo — and since amounts
-- are whole kobo, that rounds to 1, overstating the cost of every piece of
-- glass the shop cuts by about forty per cent.
--
-- Moulding hides the problem: a 3m length at N10,500 is exactly 350 kobo per
-- millimetre, so it looks fine right up until the first sheet is received.
--
-- The fix is to keep the pack price, which is a real number the supplier
-- actually charges, and to store the total value of each movement computed
-- from it. Nothing then depends on a per-base-unit figure existing.

ALTER TABLE stock_movements ADD COLUMN value_kobo INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stock_movements ADD COLUMN pack_cost_kobo INTEGER NOT NULL DEFAULT 0;

-- Existing rows carry no value; there are none in any shop yet.
UPDATE stock_movements SET value_kobo = 0 WHERE value_kobo IS NULL;
