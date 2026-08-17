# Master's Technology

Point of sale, jobs and books for a picture framing and portrait shop.

Runs on one computer in the shop. The whole system — every sale, customer,
job and naira owed — is a **single file**, `data/shop.db`.

---

## Setting it up on the shop computer

You need [Node.js 22 or later](https://nodejs.org).

```
npm install
npm run seed -- --user owner --password "a long password you will remember"
npm run build
npm start
```

Then open **http://localhost:3000** and sign in.

`npm run seed` creates the chart of accounts, the document numbering and the
owner login. It also writes a session key into `.env.local`. It is safe to run
again; it will not touch anything that already exists, and it will not reset a
password.

**No prices, materials or customers are created.** The shop enters its own —
see below.

### To start it every day

`npm start`, then open http://localhost:3000. To have it start by itself when
the computer boots, create a shortcut to a batch file containing:

```
cd C:\path\to\this\folder
npm start
```

and put that shortcut in the Startup folder (`Win+R`, then `shell:startup`).

---

## Backing up — read this part

Everything the shop has ever recorded is in one file on one computer. There is
no second machine and no copy in the cloud. **If that computer is stolen, or
its disk fails, the shop's entire financial history is gone** and there is
nothing anywhere to rebuild it from.

So:

```
npm run backup
```

Safe to run while the shop is open. To write copies straight to a flash drive:

```
npm run backup -- --dir E:\MastersTechBackups
```

There is also a **Back up now** button on the Today screen, which turns red
when the last backup is more than three days old.

**A copy on the same computer protects against nothing that actually happens** —
the disk that dies takes both. Keep the copies on a flash drive or an external
disk, and ideally take one home.

### Putting a backup back

Stop the app first, then:

```
npm run restore -- --list
npm run restore -- --file backups/shop_2026-08-17_1432.db
```

The database being replaced is copied aside first, so restoring the wrong copy
does not lose anything.

---

## First-time setup, in order

The system is deliberately empty. Nothing has been invented on the shop's
behalf, because a made-up price list is one nobody can tell from the real
thing.

1. **Price list** — the mouldings, glass, mount board, backing and labour rates
   the shop charges. Each rate says how it is read: moulding **per metre**,
   glass and board **per square metre**. As you type a rate the screen shows
   what it would charge on a real 24 × 36 in frame, so you can check it against
   what you know you charge.

   Moulding needs its **face width** in millimetres. Each of the four mitred
   corners eats twice that width, so without it every frame is quoted short.

2. **Stock** — the same materials as physical stock: what a pack is (a 3 m
   length, a 1220 × 914 sheet), what it costs, and how much is on the shelf
   now (**Set opening stock**). Link each price list item to its material so
   the profit figures use the real cost.

3. **Settings** — minimum charge, default labour, deposit percentage. These are
   commercial decisions and start at zero.

4. **Staff** — one login per person. A shared login means nobody's name is on
   anything, and the first time money goes missing there is no way to ask who.
   Only the owner sees costs, margins and the books.

Then take a quote.

---

## How a job runs

**Quote** → **Accepted** → on the bench → **Ready** → **Collected**

- A **quote** owes nothing and commits nothing. Its prices are frozen the
  moment it is given, so a quote from August still says what it said in August
  even after the moulding price rises.
- **Accepting** takes a deposit and the customer's picture. Each item gets a
  **tag number** — write it on the item and give the customer the slip. Note any
  existing damage at intake; a tear found at collection that was not written
  down is an argument the shop cannot win.
- **Collecting** raises the invoice, takes the balance, charges the materials
  out of stock and signs the picture back. It asks **who** is collecting, and
  will not proceed without a name.

A deposit is money **held**, not earned. The shop's income only counts when the
work is handed over.

---

## Selling over the counter

Not everything is a framing job. Someone walks in for a ready-made frame, a
packet of hooks or a reprint, pays and leaves — that is **Counter**, and it
raises an invoice and takes the money in one step. No quote, no bench, no tag
on anyone's picture.

- Items priced **each** appear in the dropdown. Anything charged **per metre**
  or **per square metre** does not, because it has no price until somebody says
  how big — that conversation is a quote.
- Anything not on the price list can be typed straight in with its price.
- Prices fill in from the list and stay editable. The counter haggles, and a
  till that cannot be overridden gets worked around with a calculator.
- Type what the customer handed over and the screen works out the **change**.
  Only what the sale is worth is recorded; change comes out of the drawer.
- A name is optional. Most walk-ins do not give one, and forcing it produces a
  customer list full of "Customer" and "Walk in".
- If the price list item is linked to a material counted in **pieces**, the
  stock comes off the shelf automatically. Anything measured by the metre or by
  area is left alone — there is no way to know how much came off the roll, and
  a guess would be worse than the honest gap.

### Paper

- **Claim slip** — printed when a job is accepted. Two copies per item: one is
  tied to the picture, one goes home with the customer. The tag number is
  large because it gets read down a telephone and copied onto a tag by hand,
  and a misread digit puts somebody else's irreplaceable photograph into the
  wrong hands. The condition noted at intake is printed on the customer's copy
  too, so it is a fact both sides agreed to rather than the shop's word.
- **Job ticket** — for the bench. Cutting sizes and materials, and
  deliberately **no prices**: the framer needs the glass size, not the margin,
  and a customer may be looking over the counter.
- **Receipt** — printed from an invoice, showing deposits, payments and
  anything still to pay.

---

## Money

- **Invoices** are raised when work is handed over. A deposit taken earlier
  still counts against the invoice, so the shop never chases somebody who has
  already paid half.
- **Refunds** are recorded as money going back out, never by altering what was
  taken — otherwise the day's takings would look as though the money had never
  arrived.
- **Cancelling an invoice** reverses its ledger entry and keeps the number in
  the book. A missing invoice number looks exactly like a sale somebody
  pocketed. Money already paid is flagged, not swept away.
- **Suppliers** — stock taken on credit becomes a debt. Paying it down reduces
  the debt only; the materials became a cost when they were received.
- **Reports** — profit and loss, what the shop owns and owes, today's takings
  split cash from card, and a full account listing for an accountant.

---

## Day to day

```
npm run backup     take a backup now
npm run migrate    apply any schema updates (also runs automatically)
npm test           check the system is sound
npm run reset      wipe practice data and start clean (backs up first)
```

`npm run reset` is for the moment the shop stops practising and starts using
this for real. It clears jobs, invoices, customers, stock and prices, and puts
the numbering back to 1 — but keeps the login, the chart of accounts and the
settings. It takes a backup before it does anything, because "I only wanted to
clear the test data" is a sentence people say afterwards.

---

## Notes for whoever maintains this

- Money is always an **integer number of kobo**. Dimensions are always **integer
  millimetres**. No float ever touches a price.
- `better-sqlite3` is pinned to **v11**. Version 13 installs cleanly and then
  segfaults on Windows with no stack trace.
- Client components import labels from `lib/*-catalog.js` and `lib/roles.js`,
  never from the modules that touch the database — importing those pulls a
  compiled binary into the browser bundle and the build error points at the
  wrong file.
- A sale is created in exactly two places: `collectJob` (a framing job is
  handed over) and `counterSale` (something sold off the shelf). Both raise the
  invoice, take the money and move the stock inside one transaction.
- `sales` has no `amount_paid` or `status` column on purpose. They are sums
  over `payments`; two places that can disagree eventually will.
- Every quote stores its own `breakdown_json`. That duplication is the only
  reason editing a price is safe.
- Server actions each call `requireUser()` themselves. The layout guard
  protects pages, not actions — an action is a POST endpoint anyone can call
  directly.
