# Capture sheet + Apps Script setup

This connects systema's **Expenses** tab to a **dedicated capture spreadsheet**
via a free Google Apps Script web app. It is **append-only** and bound to that
one sheet — it can never touch your master "Tax and Source of Income" workbook.

You only do this once.

## 1. Create the capture spreadsheet

1. Create a **new** Google Sheet named **`Travel Capture - Ehsan Ghoreishi`**
   (kept separate from your master finance workbook).
2. Rename the first tab to **`Travel Spending`**.
3. Put this header in row 1 (columns A–K), matching your master exactly:

   | Date | Transaction# | Destination | Category | Subcategory | Description | Payment Method | Amount (GBP) | Amount (Local) | Notes | Subtotal |
   | ---- | ------------ | ----------- | -------- | ----------- | ----------- | -------------- | ------------ | -------------- | ----- | -------- |

4. Optional but recommended formatting so appended rows look right:
   - Format **Amount (GBP)** and **Subtotal** columns as **£ currency**.
   - Leave **Amount (Local)** as plain text (it holds values like `240 CZK`).

## 2. Add the script (binds it to this sheet only)

1. In the capture sheet: **Extensions → Apps Script**. (Opening it from inside
   the sheet is what makes the script _container-bound_ — it can reach this
   spreadsheet via `getActiveSpreadsheet()` and nothing else.)
2. Delete the placeholder code and paste the contents of
   [`apps-script/Code.gs`](../apps-script/Code.gs).
3. (Optional) Set `SHARED_TOKEN` to a secret string for a little extra safety.
4. Rename the Apps Script project to **`systema-sheet-sync`**. Save.

## 3. Deploy as a web app

1. **Deploy → New deployment**. Select type **Web app**.
2. **Execute as:** _Me_.
3. **Who has access:** _Anyone_ (required so the PWA can POST without a Google
   login). The URL is unguessable; set `SHARED_TOKEN` if you want a second gate.
4. **Deploy**, then **Authorize access** and accept the permission prompt.
   (The only scope needed is editing this one spreadsheet — no Drive-wide access.)
5. Copy the **Web app URL** (it ends in `/exec`).

## 4. Connect systema

1. Open systema → **Settings → Capture sync**.
2. Paste the `/exec` URL into **Apps Script web app URL**.
3. If you set a token, paste the same value into **Shared token**. Save.

Visit the `/exec` URL in a browser to confirm it returns
`{"ok":true,"service":"systema-sheet-sync"}`.

## How systema uses it

- Each expense becomes one appended row in the exact column order above
  (Transaction# is sequential within the trip; Amount (Local) is blank when paid
  in GBP).
- A separate **"Append subtotal row"** button writes the trailing per-trip total
  (all cells blank except Subtotal), matching your master's layout.
- Entries made offline queue on the device and sync when you're back online.

## Updating the script later

If you change `Code.gs`, you must **Deploy → Manage deployments → Edit → New
version** for the changes to take effect (the `/exec` URL stays the same).

## Security recap

- Container-bound to the capture sheet; appends only; no `DriveApp`, no other
  files. Treat the capture sheet as a write buffer you reconcile into your
  master records by hand.
- systema stores only the `/exec` URL and the optional token. No Google
  credentials, no API keys.
