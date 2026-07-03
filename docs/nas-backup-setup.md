# NAS backup vault — Synology setup

systema backs itself up to your Synology **automatically and opportunistically**:
whenever the receiver is reachable, the app pushes a data snapshot (everything
except photo files) after any change, and each photo exactly once. Failures are
silent — no wifi, NAS asleep, internet cut-out — it simply retries on the next
change, reconnect, or app open. Photos on the NAS are safe to delete from the
phone to free space.

No credentials live in the app or this repo: the app stores only the receiver
URL and a token you choose, on-device.

## What runs on the NAS

One PHP file — [`nas/systema-backup.php`](../nas/systema-backup.php) — that only
ever writes inside its own `systema-backups/` folder:

```
web/
  systema-backup.php        <- the receiver (edit $TOKEN before use)
  systema-backups/
    data/                   <- rolling JSON snapshots (last 60 kept)
    photos/                 <- one file per photo, by id
```

## One-time DSM setup (~10 minutes)

The receiver must be reachable **over HTTPS with a valid certificate**, because
the app is served from an HTTPS page (browsers block anything less). Synology
provides all of it for free:

1. **Web Station + PHP** — Package Center → install _Web Station_ and a _PHP_
   package. In Web Station, create the default web portal if asked, and enable
   the PHP profile for it. This creates the shared folder `web`.
2. **Copy the receiver** — put `systema-backup.php` in the `web` shared folder
   (File Station, or from the Mac: the `web` share via Finder → Connect to
   Server). **Edit `$TOKEN`** in the file to a long random string first.
3. **DDNS** — Control Panel → External Access → DDNS → Add → service provider
   _Synology_, pick a hostname like `<yours>.synology.me`. This tracks your
   changing home IP automatically (no fixed IP needed).
4. **Certificate** — Control Panel → Security → Certificate → Add → _Get a
   certificate from Let's Encrypt_, domain = your `synology.me` hostname. DSM
   renews it automatically.
5. **Router** (optional but recommended) — forward external port **443** to the
   NAS port 443 (Web Station's HTTPS port). With it, backups also run away from
   home; without it, they run on home wifi only (if your router supports NAT
   loopback for your hostname).
6. **Test** — open `https://<yours>.synology.me/systema-backup.php` in a
   browser: it should show `{"ok":true,"service":"systema-backup"}`.

Then in systema → **Settings → NAS backup vault**: paste that URL and the same
token, Save, and tap **Back up now** once to confirm ("Last data backup" gets a
timestamp).

## Zero-setup fallback (works today, manual)

Until the receiver is up — or any time you want a belt-and-braces copy:

- **iPhone:** Export tab → _Download backup (JSON)_ → Files app → _Connect to
  Server_ → `smb://192.168.0.20` → save into `home/systema-backups/manual/`.
- **Mac:** download the same file and drop it in the mounted
  `homes/ethan/systema-backups/manual/` folder.

## Restoring — getting everything onto a (new) phone

The NAS is the hub: every device pushes to it, and any device can restore from
it. Three routes, best first:

1. **Settings → Data on this device → Restore from NAS** (needs the receiver):
   pulls the newest snapshot — trips, stops, expenses, journals, settings — and
   then fetches any photos this device is missing, re-linked to their stops.
2. **Import backup file**: grab a JSON from `systema-backups/manual/` (iPhone:
   Files app → Connect to Server → `smb://192.168.0.20`), then Settings →
   _Import backup file_.
3. **Paste from clipboard**: on the Mac, open the backup JSON and copy it; on
   the iPhone (same Apple ID, Handoff on), Settings → _Paste backup from
   clipboard_.

Imports merge by id — safe to run over existing data, and safe to run twice.

## Security notes

- The receiver accepts only token-gated POSTs and writes only inside
  `systema-backups/`. It never reads, lists, or deletes anything else.
- Don't port-forward DSM itself (5000/5001) — only 443 for Web Station.
- Keep `$TOKEN` out of the repo; it lives in the PHP file on the NAS and in
  the app's on-device settings.
