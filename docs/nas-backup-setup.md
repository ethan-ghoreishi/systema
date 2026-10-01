# NAS sync and backup — Synology setup

systema syncs and backs itself up through your Synology **automatically**:
whenever the receiver is reachable it uploads new photos (each once), merges in
the NAS's newest snapshot, and pushes a new snapshot if the NAS lacks anything.
Every device you set up (iPhone, Mac) does the same, so they stay in step.
Failures are expected and harmless — no wifi, NAS asleep — nothing is pushed or
replaced, and it retries on the next change, reconnect, or app open.

How two devices combine: each keeps the last snapshot it agreed with the NAS,
so changes merge three ways. Edits to different things combine. The same thing
edited on both keeps the newer edit, and the other appears in **Settings →
Edits made on two devices** for you to choose. A deletion applies unless the
other device edited that record meanwhile (then the edit wins). Photos only
leave through an explicit delete — never because a snapshot lacks them.

No credentials live in the app or this repo: the app stores only the receiver
URL and a token you choose, on-device.

## What runs on the NAS

One PHP file — [`nas/systema-backup.php`](../nas/systema-backup.php) — that only
ever writes inside its own `systema-backups/` folder:

```
web/
  systema-backup.php        <- the receiver (edit $TOKEN before use)
  systema-backups/
    data/                   <- JSON snapshots (newest 60, plus one per day for 90 days)
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

Then in systema → **Settings → NAS sync**: paste that URL and the same token,
Save, and tap **Sync now** in the Backup card ("Last NAS sync" gets a time). Do
this on every device. A new or reset device merges the NAS copy before it ever
pushes, so it can't replace it. **Check NAS copy** verifies the snapshot and
that every photo it lists is on the NAS, without changing anything.

**Updating the receiver (optional):** the app works with the original
`systema-backup.php`. The current version keeps two snapshots pushed in the
same second (instead of the second replacing the first), never serves a
half-written file, reports uploaded photo sizes for the app to verify, and keeps
a daily snapshot for 90 days. To update, copy the new file over the old one and
set `$TOKEN` again.

## If `synology.me` won't connect (CGNAT / ISP blocks inbound)

Many home ISPs (especially UK ones) put you behind **CGNAT** or block inbound
443, so `https://<you>.synology.me/…` never connects from outside — and often
not from inside either (no NAT loopback). Two hard rules make this the usual
sticking point:

- The app is served over **HTTPS**, so it can only call an **`https://`** URL
  with a **valid certificate**. `http://192.168.0.20/…` is blocked by the
  browser as mixed content, even on home wifi. `https://192.168.0.20/…` fails
  too, because the certificate is issued for the `synology.me` name, not the IP.
- So you need the NAS reachable at an **`https://` name with a valid cert**,
  from anywhere, without relying on your ISP's inbound.

**The clean fix: Tailscale** (free, no port-forwarding, works behind CGNAT):

1. **NAS:** Package Center → install **Tailscale** → sign in.
2. **iPhone:** install the **Tailscale** app → sign in to the same account →
   turn it on.
3. On the NAS, enable HTTPS for its Tailscale name (DSM: Tailscale package, or
   `sudo tailscale cert` / `tailscale serve`), giving something like
   `https://ds220.tailXXXX.ts.net`. Tailscale issues a real certificate for it.
4. Put the receiver behind it (Web Station serves it; the `.ts.net` name gets a
   valid cert automatically via `tailscale serve https / --bg`), so
   `https://ds220.tailXXXX.ts.net/systema-backup.php` returns
   `{"ok":true,...}` in the phone's browser.
5. In systema → **Settings → NAS sync**, use that `.ts.net` URL. Now
   backups and restores work from anywhere the phone has Tailscale on — no
   port-forwarding, no cert warning, no ISP dependency.

Until Tailscale is set up, use the manual fallback below (it needs no HTTPS at
all).

## Zero-setup fallback (works today, manual)

Until the receiver is up — or any time you want a belt-and-braces copy:

- **iPhone:** Settings → _Download full backup (.zip)_ → Files app → _Connect
  to Server_ → `smb://192.168.0.20` → save into `home/systema-backups/manual/`.
- **Mac:** download the same file and drop it in the mounted
  `homes/ethan/systema-backups/manual/` folder.

The ZIP holds the data plus every photo as an ordinary image file, so it opens
anywhere. It is built without loading all photos into memory.

## Restoring — getting everything onto a (new) phone

1. **NAS:** enter the receiver URL and token in Settings, then **Sync now**. A
   new device simply receives everything — trips, stops, expenses, journals and
   photos — and pushes nothing of its own until it has something new.
2. **Backup file:** Settings → _Restore from a backup file_ → pick a `.zip` (or
   an older `.json`), e.g. from `systema-backups/manual/` via Files → Connect to
   Server. It is checked first (every checksum, every record) and shows what it
   would add; nothing is written until you tap _Restore these records_.
3. **Paste from clipboard:** a `.json` backup copied on the Mac (Universal
   Clipboard) — same check and preview.

Restoring only adds records this device doesn't have — safe over existing data,
and safe to run twice. To move edits between devices, use NAS sync.

**Getting back something deleted** (deletions sync to every device): restore
the last backup file that had it, or pick an older snapshot from
`web/systema-backups/data/` on the NAS (they are plain JSON, named by date) in
_Restore from a backup file_ — the trip's photos come back from the NAS too.

## Security notes

- The receiver answers only token-gated requests and reads and writes only
  inside `systema-backups/`. It never touches anything else.
- Don't port-forward DSM itself (5000/5001) — only 443 for Web Station.
- Keep `$TOKEN` out of the repo; it lives in the PHP file on the NAS and in
  the app's on-device settings.
