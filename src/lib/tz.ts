/**
 * Time zones for a multi-country itinerary. Leg times are stored as the
 * wall-clock strings printed on tickets ('YYYY-MM-DDTHH:mm', local to the
 * city) plus the city's IANA zone; this turns them into real instants with
 * the platform's own zone data (Intl) — no library, correct across DST, and
 * independent of the zone the phone happens to be in.
 *
 * A leg without a zone (older trips) falls back to the device's zone, which is
 * what every version before this one did.
 */

export const HOME_TZ = 'Europe/London';

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function parts(tz: string): Intl.DateTimeFormat {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    fmtCache.set(tz, f);
  }
  return f;
}

/** Whether `tz` is an IANA zone this platform knows. */
export function isValidTz(tz: string | undefined): tz is string {
  if (!tz) return false;
  try {
    parts(tz);
    return true;
  } catch {
    return false;
  }
}

/** The zone's UTC offset (ms) at instant `t`. */
function offsetAt(tz: string, t: number): number {
  const p = Object.fromEntries(
    parts(tz)
      .formatToParts(new Date(t))
      .map((x) => [x.type, x.value]),
  );
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(t / 1000) * 1000;
}

const WALL = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/;

/**
 * The instant (ms) of a wall-clock time in `tz` ('YYYY-MM-DD' = midnight).
 * A time skipped by a DST jump resolves forward; a repeated hour takes the
 * first occurrence. No zone: the device's zone. Undefined if unparseable.
 */
export function wallToInstant(wall: string | undefined, tz?: string): number | undefined {
  const m = wall?.match(WALL);
  if (!m) return undefined;
  const [y, mo, d, h = '0', mi = '0'] = m.slice(1);
  if (!isValidTz(tz)) {
    const t = new Date(+y, +mo - 1, +d, +h, +mi).getTime();
    return Number.isNaN(t) ? undefined : t;
  }
  const guess = Date.UTC(+y, +mo - 1, +d, +h, +mi);
  const want = `${y}-${mo}-${d}T${h.padStart(2, '0')}:${mi.padStart(2, '0')}`;
  // The offsets either side of any transition near this time give every
  // possible reading; keep those that round-trip to the same wall clock.
  const before = guess - offsetAt(tz, guess - 86_400_000);
  const after = guess - offsetAt(tz, guess + 86_400_000);
  const valid = [before, after].filter((t) => instantToWall(t, tz) === want);
  // Repeated hour: the first occurrence. Skipped hour: resolve forward.
  return valid.length ? Math.min(...valid) : before;
}

/** The wall-clock string ('YYYY-MM-DDTHH:mm') of instant `t` in `tz` (device zone if unset). */
export function instantToWall(t: number, tz?: string): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  if (!isValidTz(tz)) {
    const d = new Date(t);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  const p = Object.fromEntries(
    parts(tz)
      .formatToParts(new Date(t))
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * The calendar parts of a wall-clock string, read as written (no zone maths,
 * and no Intl wording, which differs between engines).
 */
export function wallParts(wall: string) {
  const m = wall.match(WALL);
  if (!m) return undefined;
  const [y, mo, d, h, mi] = m.slice(1);
  const dow = new Date(Date.UTC(+y, +mo - 1, +d)).getUTCDay();
  return { y: +y, day: +d, weekday: DAYS[dow], month: MONTHS[+mo - 1], h, mi };
}

/** 'Fri 10 Oct, 14:05' from a wall-clock string, read as written (no zone maths). */
export function wallLabel(wall: string, opts: { weekday?: boolean } = {}): string {
  const p = wallParts(wall);
  if (!p) return wall;
  const day = `${opts.weekday === false ? '' : `${p.weekday.slice(0, 3)} `}${p.day} ${p.month.slice(0, 3)}`;
  return p.h ? `${day}, ${p.h}:${p.mi}` : day;
}

/** 'HH:mm' of instant `t` in `tz`. */
export function timeIn(t: number, tz?: string): string {
  return instantToWall(t, tz).slice(11, 16);
}

/** Readable zone name: 'Central European Summer Time' (at instant `t`). */
export function tzLongName(tz: string, t = Date.now()): string {
  try {
    return (
      new Intl.DateTimeFormat('en-GB', { timeZone: tz, timeZoneName: 'long' })
        .formatToParts(new Date(t))
        .find((p) => p.type === 'timeZoneName')?.value ?? tz
    );
  } catch {
    return tz;
  }
}

/** The device's zone. */
export function deviceTz(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Every zone the platform knows, for the zone picker. */
export function allTimeZones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
  return intl.supportedValuesOf?.('timeZone') ?? [HOME_TZ];
}

// ponytail: a suggestion table, not a geocoder — only ever offered for the
// traveller to confirm. Add a city here when a guess comes out wrong.
const CITY_TZ: Record<string, string> = {
  lisbon: 'Europe/Lisbon',
  porto: 'Europe/Lisbon',
  faro: 'Europe/Lisbon',
  funchal: 'Atlantic/Madeira',
  madeira: 'Atlantic/Madeira',
  azores: 'Atlantic/Azores',
  'ponta delgada': 'Atlantic/Azores',
  dublin: 'Europe/Dublin',
  cork: 'Europe/Dublin',
  galway: 'Europe/Dublin',
  shannon: 'Europe/Dublin',
  belfast: 'Europe/London',
  edinburgh: 'Europe/London',
  tenerife: 'Atlantic/Canary',
  'las palmas': 'Atlantic/Canary',
  'gran canaria': 'Atlantic/Canary',
  lanzarote: 'Atlantic/Canary',
  fuerteventura: 'Atlantic/Canary',
  athens: 'Europe/Athens',
  thessaloniki: 'Europe/Athens',
  heraklion: 'Europe/Athens',
  chania: 'Europe/Athens',
  rhodes: 'Europe/Athens',
  corfu: 'Europe/Athens',
  larnaca: 'Asia/Nicosia',
  paphos: 'Asia/Nicosia',
  limassol: 'Asia/Nicosia',
  nicosia: 'Asia/Nicosia',
  helsinki: 'Europe/Helsinki',
  tallinn: 'Europe/Tallinn',
  riga: 'Europe/Riga',
  vilnius: 'Europe/Vilnius',
  sofia: 'Europe/Sofia',
  plovdiv: 'Europe/Sofia',
  varna: 'Europe/Sofia',
  bucharest: 'Europe/Bucharest',
  cluj: 'Europe/Bucharest',
  'cluj-napoca': 'Europe/Bucharest',
  istanbul: 'Europe/Istanbul',
  antalya: 'Europe/Istanbul',
  izmir: 'Europe/Istanbul',
  yerevan: 'Asia/Yerevan',
  tbilisi: 'Asia/Tbilisi',
  kutaisi: 'Asia/Tbilisi',
  baku: 'Asia/Baku',
  cairo: 'Africa/Cairo',
  marrakech: 'Africa/Casablanca',
  marrakesh: 'Africa/Casablanca',
  fes: 'Africa/Casablanca',
  tangier: 'Africa/Casablanca',
  casablanca: 'Africa/Casablanca',
  tunis: 'Africa/Tunis',
  amman: 'Asia/Amman',
  'tel aviv': 'Asia/Jerusalem',
  jerusalem: 'Asia/Jerusalem',
  dubai: 'Asia/Dubai',
  'abu dhabi': 'Asia/Dubai',
  doha: 'Asia/Qatar',
  reykjavik: 'Atlantic/Reykjavik',
  kyiv: 'Europe/Kyiv',
  kiev: 'Europe/Kyiv',
  chisinau: 'Europe/Chisinau',
  tehran: 'Asia/Tehran',
  esfahan: 'Asia/Tehran',
  isfahan: 'Asia/Tehran',
};

// One zone per currency where the currency's area keeps one clock. EUR falls
// back to Central European time — right for most euro cities, and the
// exceptions above are matched by name first.
const CURRENCY_TZ: Record<string, string> = {
  GBP: 'Europe/London',
  EUR: 'Europe/Paris',
  CHF: 'Europe/Zurich',
  CZK: 'Europe/Prague',
  HUF: 'Europe/Budapest',
  PLN: 'Europe/Warsaw',
  DKK: 'Europe/Copenhagen',
  SEK: 'Europe/Stockholm',
  NOK: 'Europe/Oslo',
  ISK: 'Atlantic/Reykjavik',
  RON: 'Europe/Bucharest',
  BGN: 'Europe/Sofia',
  RSD: 'Europe/Belgrade',
  BAM: 'Europe/Sarajevo',
  MKD: 'Europe/Skopje',
  ALL: 'Europe/Tirane',
  MDL: 'Europe/Chisinau',
  UAH: 'Europe/Kyiv',
  TRY: 'Europe/Istanbul',
  GEL: 'Asia/Tbilisi',
  AMD: 'Asia/Yerevan',
  AZN: 'Asia/Baku',
  EGP: 'Africa/Cairo',
  MAD: 'Africa/Casablanca',
  TND: 'Africa/Tunis',
  JOD: 'Asia/Amman',
  ILS: 'Asia/Jerusalem',
  AED: 'Asia/Dubai',
  QAR: 'Asia/Qatar',
  IRR: 'Asia/Tehran',
};

/**
 * A zone to *suggest* for a city: by name (a known city, or a zone named after
 * it, e.g. Europe/Rome), else by currency. Undefined when there's no sensible
 * guess. Never applied without the traveller confirming it.
 */
export function suggestTz(cityName: string, currency = ''): string | undefined {
  const name = cityName.trim().toLowerCase();
  if (!name && !currency) return undefined;
  if (CITY_TZ[name]) return CITY_TZ[name];
  const zoneKey = name.replace(/\s+/g, '_');
  const named = zoneKey && allTimeZones().find((z) => z.toLowerCase().endsWith(`/${zoneKey}`));
  if (named) return named;
  return CURRENCY_TZ[currency.trim().toUpperCase()];
}
