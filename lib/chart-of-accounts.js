/* The chart of accounts for Master's Technology.
 *
 * Structure, not figures. Every account here is one the shop will actually
 * use; nothing is invented to look complete, because an unused account on a
 * report is a line the owner has to learn to ignore, and a report full of
 * those stops being read.
 *
 * Codes are strings, and reports sort by them — which is why they are spaced
 * out in thousands. Slotting "Generator fuel" in between two existing expense
 * accounts later should never mean renumbering the ones around it.
 */

/** Referenced by name in posting code, so a typo is a crash and not a silent
 *  posting into the wrong account. */
export const ACCT = {
  CASH: '1000',
  BANK: '1010',
  RECEIVABLE: '1100',
  INVENTORY: '1200',

  PAYABLE: '2000',
  CUSTOMER_DEPOSITS: '2100',

  CAPITAL: '3000',
  RETAINED: '3900',

  FRAMING_SALES: '4000',
  PORTRAIT_SALES: '4010',
  OTHER_INCOME: '4090',

  COST_OF_MATERIALS: '5000',
  BREAKAGE: '5010',
};

export const CHART = [
  // --- what the shop has
  { code: ACCT.CASH, name: 'Cash', type: 'asset', normal: 'debit', system: 1 },
  { code: ACCT.BANK, name: 'Bank', type: 'asset', normal: 'debit', system: 1 },
  { code: ACCT.RECEIVABLE, name: 'Money owed by customers', type: 'asset', normal: 'debit', system: 1 },
  { code: ACCT.INVENTORY, name: 'Materials in stock', type: 'asset', normal: 'debit', system: 1 },

  // --- what the shop owes
  { code: ACCT.PAYABLE, name: 'Money owed to suppliers', type: 'liability', normal: 'credit', system: 1 },
  /* Deposits are a LIABILITY, not income, and this is the one accounting
   * point a framing shop gets wrong most often.
   *
   * A customer pays half up front for a frame that does not exist yet. Until
   * the work is handed over, that money is not earned — it is owed back if
   * the job falls through. Counting it as income on the day it arrives makes
   * a good month look better than it was and leaves nothing to recognise on
   * the day the work is actually delivered. It moves to income at collection. */
  { code: ACCT.CUSTOMER_DEPOSITS, name: 'Customer deposits held', type: 'liability', normal: 'credit', system: 1 },

  // --- the owner's stake
  { code: ACCT.CAPITAL, name: "Owner's capital", type: 'equity', normal: 'credit', system: 1 },
  { code: ACCT.RETAINED, name: 'Retained earnings', type: 'equity', normal: 'credit', system: 1 },

  // --- what comes in
  { code: ACCT.FRAMING_SALES, name: 'Framing sales', type: 'income', normal: 'credit', system: 1 },
  { code: ACCT.PORTRAIT_SALES, name: 'Portrait and print sales', type: 'income', normal: 'credit', system: 1 },
  { code: ACCT.OTHER_INCOME, name: 'Other income', type: 'income', normal: 'credit', system: 0 },

  // --- what goes out
  { code: ACCT.COST_OF_MATERIALS, name: 'Cost of materials used', type: 'expense', normal: 'debit', system: 1 },
  /* Breakage gets its own account rather than disappearing into cost of
   * materials. Glass broken in the workshop is money lost to handling, not
   * money spent on a customer's job, and a shop that cannot see the two apart
   * cannot tell whether the figure is normal or whether something needs
   * fixing on the bench. */
  { code: ACCT.BREAKAGE, name: 'Breakage and wastage', type: 'expense', normal: 'debit', system: 1 },

  { code: '6000', name: 'Rent', type: 'expense', normal: 'debit', system: 0 },
  { code: '6010', name: 'Salaries and wages', type: 'expense', normal: 'debit', system: 0 },
  { code: '6020', name: 'Power and fuel', type: 'expense', normal: 'debit', system: 0 },
  { code: '6030', name: 'Transport and delivery', type: 'expense', normal: 'debit', system: 0 },
  { code: '6040', name: 'Repairs and tools', type: 'expense', normal: 'debit', system: 0 },
  { code: '6050', name: 'Bank and POS charges', type: 'expense', normal: 'debit', system: 0 },
  { code: '6900', name: 'Other expenses', type: 'expense', normal: 'debit', system: 0 },
];

/** Numbering for documents the shop hands to customers. */
export const COUNTERS = [
  { name: 'quote', prefix: 'Q-' },
  { name: 'job', prefix: 'J-' },
  { name: 'invoice', prefix: 'INV-' },
  /* The number on the tag tied to a customer's picture, and on the slip they
   * take away. Short on purpose: it gets read aloud over a phone and written
   * on a paper tag by hand. */
  { name: 'claim_ticket', prefix: 'T-' },
];

/** Shop-wide settings, seeded with defaults the owner can change. */
export const DEFAULT_SETTINGS = [
  { key: 'shop.name', value: "Master's Technology" },
  { key: 'shop.phone', value: '' },
  { key: 'shop.address', value: '' },

  /* What staff type at the counter. Framing customers speak in inches, so
   * that is the default, but everything is stored in millimetres regardless —
   * this only decides how a size is read and displayed. */
  { key: 'quote.unit', value: 'in' },

  /* Left at zero deliberately. These are the shop's own commercial decisions
   * and seeding a guess would mean quoting a number nobody at Master's
   * Technology ever agreed to. They are set on the price list screen. */
  { key: 'pricing.minCharge_kobo', value: '0' },
  { key: 'pricing.defaultLabour_kobo', value: '0' },
  { key: 'pricing.defaultMountBorder_mm', value: '50' },
  { key: 'pricing.depositPercent_bp', value: '5000' }, // 50%, the framing norm
];
