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

## Day to day

```
npm run backup     take a backup now
npm run migrate    apply any schema updates (also runs automatically)
npm test           check the system is sound
```

---

## Notes for whoever maintains this

- Money is always an **integer number of kobo**. Dimensions are always **integer
  millimetres**. No float ever touches a price.
- `better-sqlite3` is pinned to **v11**. Version 13 installs cleanly and then
  segfaults on Windows with no stack trace.
- Client components import labels from `lib/*-catalog.js`, never from the
  modules that touch the database — importing those pulls a compiled binary
  into the browser bundle and the build error points at the wrong file.
- `sales` has no `amount_paid` or `status` column on purpose. They are sums
  over `payments`; two places that can disagree eventually will.
- Every quote stores its own `breakdown_json`. That duplication is the only
  reason editing a price is safe.
- Server actions each call `requireUser()` themselves. The layout guard
  protects pages, not actions — an action is a POST endpoint anyone can call
  directly.
