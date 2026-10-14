/**
 * What went wrong talking to the NAS receiver, in words that lead to a fix.
 * Pure: the sync client classifies every failure through here, so the same
 * HTTP status always gets the same explanation — and the token never appears
 * in anything shown, logged or stored.
 */

export type FailureKind =
  | 'offline' // the device says it has no network
  | 'unreachable' // the request never got an answer: network, DNS, TLS, CORS or a proxy
  | 'auth' // 403: token mismatch
  | 'not-found' // 404 on the receiver URL itself
  | 'too-large' // 413, or PHP dropped the body (post_max_size)
  | 'server' // 5xx: the receiver couldn't write
  | 'bad-response' // an answer, but not the receiver's (a login page, a redirect)
  | 'verify' // stored, but the size or SHA-256 didn't match
  | 'unreadable' // this device can't read the photo's bytes from its own storage
  | 'other';

export class NasError extends Error {
  constructor(
    message: string,
    readonly kind: FailureKind,
    readonly status?: number,
  ) {
    super(message);
  }
}

/** Replace the token (raw or URL-encoded) wherever it could appear. */
export function redact(text: string, token: string): string {
  let out = text.replace(/([?&]token=)[^&\s"']*/gi, '$1•••');
  const t = token.trim();
  if (t.length >= 4) {
    for (const v of new Set([t, encodeURIComponent(t)])) out = out.split(v).join('•••');
  }
  return out;
}

/**
 * Classify a receiver reply. `sentBytes` > 0 with an "empty body" error means
 * PHP discarded an upload larger than post_max_size.
 */
export function classifyReply(
  status: number,
  json: { ok?: boolean; error?: string } | null,
  sentBytes = 0,
): FailureKind | null {
  if (status >= 200 && status < 300 && json?.ok) return null;
  if (status === 403) return 'auth';
  if (status === 404 && !json) return 'not-found';
  if (status === 413) return 'too-large';
  if (status === 400 && json?.error === 'empty body' && sentBytes > 0) return 'too-large';
  if (status >= 500) return 'server';
  if (!json) return 'bad-response';
  return 'other';
}

/** A failure thrown by fetch itself (no HTTP answer at all). */
export function classifyThrown(err: unknown, online = true): FailureKind {
  if (!online) return 'offline';
  if (err instanceof NasError) return err.kind;
  if (err instanceof TypeError) return 'unreachable';
  return 'other';
}

/** Failures worth retrying right away (a blip), rather than after the backoff. */
export const transient = (kind: FailureKind) => kind === 'unreachable' || kind === 'server';

/** Failures of the receiver as a whole: no point trying the next photo. */
export const fatal = (kind: FailureKind) =>
  kind === 'auth' || kind === 'not-found' || kind === 'bad-response' || kind === 'offline';

/**
 * How long a photo that keeps failing waits before the next automatic try:
 * 5 min, doubling, capped at 6 h. "Retry failed only" ignores it.
 */
export function backoffMs(attempts: number): number {
  return Math.min(5 * 60_000 * 2 ** Math.max(0, attempts - 1), 6 * 3_600_000);
}

const MB = (n: number) => `${(n / 1e6).toFixed(1)} MB`;

/** One line that says what happened and what to do. */
export function explain(kind: FailureKind, detail = '', bytes?: number): string {
  switch (kind) {
    case 'offline':
      return 'This device is offline. It syncs by itself once connected.';
    case 'unreachable':
      return "Couldn't reach the NAS: away from home or its network, the NAS asleep, or the address, certificate or a proxy needs checking. Test connection tells you which.";
    case 'auth':
      return 'The NAS refused the token (HTTP 403). It must match $TOKEN in systema-backup.php exactly.';
    case 'not-found':
      return 'No receiver at that address (HTTP 404). Check the path to systema-backup.php.';
    case 'too-large':
      return `Too large for the receiver${bytes ? ` (${MB(bytes)})` : ''}: raise post_max_size and upload_max_filesize in Web Station → Script Language Settings → PHP profile.${detail ? ` ${detail}` : ''}`;
    case 'server':
      return `The receiver couldn't store it${detail ? ` (${detail})` : ''}: check the systema-backups folder exists and Web Station can write to it, and that the NAS has space.`;
    case 'bad-response':
      return 'Something answered, but not the systema receiver (a login page or redirect?). Check the URL.';
    case 'unreadable':
      return "This device can't read the photo's image data from its storage. It tries again later; if it keeps failing, the copy here is damaged — any copy on another device or the NAS is unaffected.";
    case 'verify':
      return `The stored copy didn't match the original${detail ? ` (${detail})` : ''}. It will be uploaded again.`;
    default:
      return detail || 'Unexpected reply from the receiver.';
  }
}

export interface Check {
  label: string;
  ok: boolean;
  detail: string;
}

/**
 * The size probe's verdict: POST n bytes with kind=probe. The current receiver
 * echoes the size; the original one answers "unknown kind", which still means
 * the body arrived intact; "empty body" means PHP dropped it.
 */
export function probeVerdict(
  status: number | 'threw',
  json: { ok?: boolean; error?: string; bytes?: number } | null,
  sent: number,
): Check {
  const label = `An upload the size of your largest photo (${MB(sent)})`;
  if (status === 'threw')
    return {
      label,
      ok: false,
      detail:
        "Cut off before a readable answer: a size limit — in a proxy in front of PHP (a 413 without the headers the browser needs), or PHP printing a warning before its headers (an upload over post_max_size with display_errors on). Raise post_max_size and upload_max_filesize, and turn display_errors off, in Web Station's PHP profile.",
    };
  if (status === 200 && json?.ok)
    return json.bytes === undefined || json.bytes === sent
      ? { label, ok: true, detail: 'Arrives intact.' }
      : { label, ok: false, detail: `Only ${json.bytes} of ${sent} bytes arrived.` };
  if (status === 400 && json?.error === 'unknown kind')
    return {
      label,
      ok: true,
      detail: 'Arrives intact (an older receiver: update it for verified uploads).',
    };
  const kind = classifyReply(status, json, sent);
  return { label, ok: false, detail: explain(kind ?? 'other', json?.error ?? `HTTP ${status}`) };
}
