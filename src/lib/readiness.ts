import type { City, DepartPlan, Trip } from './db';
import { HOME_TZ, instantToWall, wallLabel, wallToInstant } from './tz';

/**
 * Calm per-departure readiness: for each airport (or station) departure,
 *
 *   leaveBy = departure − arrival buffer − journey − contingency
 *
 * and a plain-language stage instead of a ticking countdown. Pure: the card
 * feeds it `Date.now()` once a minute.
 */

export interface ModeDefaults {
  bufferMin: number;
  contingencyMin: number;
  journeyMin: number;
}

// Hand luggage only, intense short trips: 90 min at a European airport, a few
// minutes at a station. Every value is the traveller's to change.
export const MODE_DEFAULTS: Record<string, ModeDefaults> = {
  flight: { bufferMin: 90, contingencyMin: 15, journeyMin: 45 },
  train: { bufferMin: 15, contingencyMin: 10, journeyMin: 20 },
  bus: { bufferMin: 10, contingencyMin: 10, journeyMin: 20 },
  ferry: { bufferMin: 45, contingencyMin: 15, journeyMin: 30 },
  other: { bufferMin: 30, contingencyMin: 15, journeyMin: 30 },
};
export const PREPARE_MIN = 45;
/** Past this much waiting at the hub, a day-before reading is worth querying. */
const DAY_EARLY_MIN = 12 * 60;
/** "Leave by" turns from Prepare into its own stage this close to the time. */
const SOON_MIN = 10;
const MIN = 60_000;

/**
 * What the leave-by time rests on. A booked coach has a timetable, and it does
 * not wait: once its own departure is known, counting back from an assumed
 * journey length is guesswork laid over a fact. So the fact wins, and the card
 * says which of the two it used.
 */
export interface Timing {
  journeyMin: number;
  bufferMin: number;
  contingencyMin: number;
  prepareMin: number;
  /** Values filled from defaults, so the card can say so. */
  assumed: ('journey' | 'buffer')[];
  /** The instant the ride to the hub leaves, where its time is known. */
  serviceAt?: number;
  /** And arrives, where the ticket says so. */
  serviceArr?: number;
  leaveBy: number;
  prepareAt: number;
  /** Past this, the contingency is used up. */
  latestLeave: number;
  /** Minutes at the hub before departure on the booked ride, where it is known. */
  slackMin?: number;
  /**
   * The only reading of these times that leaves before the departure puts the
   * ride most of a day early, on the day before. The 23:10 coach for the 06:30
   * flight is not that — it lands at 00:40 the same morning — and nor is the
   * 23:00 arrival for a 00:30 flight. A 07:00 ride typed against a 06:30 flight
   * is: a wrong time far more often than a plan, and silence would hide it.
   */
  hubDayBefore?: boolean;
}

const n = (v: number | undefined) => (typeof v === 'number' && v >= 0 ? v : undefined);

/**
 * The instant of an 'HH:MM' ride on the day of a departure — or the day
 * before, when that is the only reading that leaves before the departure (the
 * 23:10 coach for the 06:30 flight).
 */
function rideInstant(
  hhmm: string | undefined,
  departAt: number,
  wall: string,
  tz: string | undefined,
  after = false,
): number | undefined {
  if (!/^(?:[01]?\d|2[0-3]):[0-5]\d$/.test(hhmm?.trim() ?? '')) return undefined;
  const time = hhmm!.trim().padStart(5, '0');
  const sameDay = wallToInstant(`${wall.slice(0, 10)}T${time}`, tz);
  if (sameDay == null) return undefined;
  if (after ? sameDay >= departAt : sameDay <= departAt) return sameDay;
  // Move on the calendar: DST days can contain 23 or 25 hours.
  const d = new Date(`${wall.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + (after ? 1 : -1));
  return wallToInstant(`${d.toISOString().slice(0, 10)}T${time}`, tz) ?? sameDay;
}

/**
 * Every timing fact for one departure, from its plan. Pure, and the one place
 * leave-by is worked out — the card, the calendar file, the trip list and
 * "getting ready" all read it from here.
 */
export function planTiming(
  departAt: number,
  wall: string,
  tz: string | undefined,
  plan: DepartPlan,
  mode = 'flight',
): Timing {
  const d = MODE_DEFAULTS[mode] ?? MODE_DEFAULTS.flight;
  const serviceAt = rideInstant(plan.transferAt, departAt, wall, tz);
  const arrivesAt =
    serviceAt == null
      ? undefined
      : rideInstant(plan.transferArr, serviceAt, instantToWall(serviceAt, tz), tz, true);
  const timed = serviceAt != null && arrivesAt != null && arrivesAt > serviceAt;
  // Two equal times are not a timetable: counting the ride as instant would
  // claim a margin the journey eats.
  const serviceArr = timed ? arrivesAt : undefined;
  const journeyMin = timed
    ? Math.round((serviceArr! - serviceAt!) / MIN)
    : (n(plan.journeyMin) ?? d.journeyMin);
  const bufferMin = n(plan.bufferMin) ?? d.bufferMin;
  const contingencyMin = n(plan.contingencyMin) ?? d.contingencyMin;
  const prepareMin = n(plan.prepareMin) ?? PREPARE_MIN;
  const assumed: Timing['assumed'] = [];
  if (!timed && n(plan.journeyMin) == null) assumed.push('journey');
  if (n(plan.bufferMin) == null) assumed.push('buffer');
  // With a timetable, the spare minutes are the walk to the stop: miss the
  // coach and the next one is not a cushion away. Without one, they are slack
  // on top of a journey nobody has measured.
  const leaveBy =
    serviceAt != null
      ? serviceAt - contingencyMin * MIN
      : departAt - (bufferMin + journeyMin + contingencyMin) * MIN;
  // When you are at the hub on the booked ride: its own arrival where the
  // ticket states one, else the journey laid on its departure.
  const hubAt = serviceAt == null ? undefined : (serviceArr ?? serviceAt + journeyMin * MIN);
  return {
    journeyMin,
    bufferMin,
    contingencyMin,
    prepareMin,
    assumed,
    ...(serviceAt != null ? { serviceAt } : {}),
    ...(serviceArr != null ? { serviceArr } : {}),
    leaveBy,
    prepareAt: leaveBy - prepareMin * MIN,
    // The coach you must be on is the last moment you can leave; otherwise the
    // cushion is what is left.
    latestLeave: serviceAt != null ? serviceAt : leaveBy + contingencyMin * MIN,
    ...(hubAt != null
      ? {
          slackMin: Math.round((departAt - hubAt) / MIN),
          ...(instantToWall(hubAt, tz).slice(0, 10) < wall.slice(0, 10) &&
          departAt - hubAt > DAY_EARLY_MIN * MIN
            ? { hubDayBefore: true }
            : {}),
        }
      : {}),
  };
}

export interface Departure {
  /** 'outbound' (leaving home) or the leg's id. */
  key: string;
  cityId: string | null;
  from: string;
  to: string;
  /** Departure instant, and its wall clock in `tz`. */
  at: number;
  wall: string;
  tz?: string;
  plan: DepartPlan;
  mode: string;
  /** 'BLQ', or 'Bologna airport' when no code is set. */
  hub: string;
  journeyMin: number;
  bufferMin: number;
  contingencyMin: number;
  prepareMin: number;
  /** Values filled from defaults, so the card can say so. */
  assumed: ('journey' | 'buffer')[];
  leaveBy: number;
  prepareAt: number;
  /** Past this, the contingency is used up. */
  latestLeave: number;
  /** The ride to the hub, where its own times are known (see planTiming). */
  serviceAt?: number;
  serviceArr?: number;
  slackMin?: number;
  hubDayBefore?: boolean;
}

function hubName(plan: DepartPlan, mode: string, from: string): string {
  if (plan.hub?.trim()) return plan.hub.trim();
  if (mode === 'flight') return `${from} airport`;
  if (mode === 'train') return `the station in ${from}`;
  return `your ${mode === 'other' ? 'departure' : mode}`;
}

function build(
  key: string,
  cityId: string | null,
  from: string,
  to: string,
  wall: string,
  tz: string | undefined,
  plan: DepartPlan,
): Departure | null {
  const at = wallToInstant(wall, tz);
  if (at == null) return null;
  const mode = plan.mode && MODE_DEFAULTS[plan.mode] ? plan.mode : 'flight';
  return {
    key,
    cityId,
    from,
    to,
    at,
    wall,
    tz,
    plan,
    mode,
    hub: hubName(plan, mode, from),
    ...planTiming(at, wall, tz, plan, mode),
  };
}

/** Every timed departure of the trip — leaving home, then each leg — in time order. */
export function tripDepartures(trip: Trip, cities: City[]): Departure[] {
  const legs = [...cities].sort((a, b) => a.order - b.order);
  const out: Departure[] = [];
  const ob = trip.outbound;
  if (ob?.at) {
    const d = build(
      'outbound',
      null,
      'home',
      legs[0]?.name || 'the first city',
      ob.at,
      ob.tz ?? HOME_TZ,
      ob,
    );
    if (d) {
      // Leaving home, "home airport" reads better than "home airport airport".
      if (!ob.hub?.trim()) d.hub = 'the airport';
      out.push(d);
    }
  }
  legs.forEach((c, i) => {
    if (!c.departure) return;
    const d = build(
      c.id,
      c.id,
      c.name || `Leg ${i + 1}`,
      legs[i + 1]?.name || 'home',
      c.departure,
      c.tz,
      c.exit ?? {},
    );
    if (d) out.push(d);
  });
  return out.sort((a, b) => a.at - b.at);
}

/** The next departure that hasn't happened yet — not necessarily the final flight home. */
export function nextDeparture(deps: Departure[], now: number): Departure | null {
  return deps.find((d) => d.at > now) ?? null;
}

export type Stage = 'later' | 'prepare' | 'leave-by' | 'go' | 'plan-b';

export function stageAt(d: Departure, now: number): Stage {
  if (now < d.prepareAt) return 'later';
  if (now < d.leaveBy - SOON_MIN * MIN) return 'prepare';
  if (now < d.leaveBy) return 'leave-by';
  if (now < d.latestLeave) return 'go';
  return 'plan-b';
}

export const STAGE_LABEL: Record<Stage, string> = {
  later: 'Later',
  prepare: 'Prepare',
  'leave-by': 'Leave by',
  go: 'Time to go',
  'plan-b': 'Plan B',
};

export function duration(ms: number): string {
  const m = Math.max(0, Math.round(ms / MIN));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

/** 'Sat 12:40' (or just '12:40' on the same day as `now`), in the departure's zone. */
export function clockLabel(t: number, tz: string | undefined, now: number): string {
  const wall = instantToWall(t, tz);
  const today = instantToWall(now, tz).slice(0, 10);
  return wall.slice(0, 10) === today ? wall.slice(11, 16) : wallLabel(wall);
}

export interface Readiness {
  stage: Stage;
  title: string;
  detail: string;
}

/**
 * The card's words for `now`. `deviceTz` adds "(Bologna time)" when the phone
 * is on a different clock from the departure.
 */
export function readiness(d: Departure, now: number, deviceTz?: string): Readiness {
  const stage = stageAt(d, now);
  const zoneNote =
    d.tz && deviceTz && d.tz !== deviceTz ? ` (${d.from === 'home' ? 'UK' : d.from} time)` : '';
  const leave = `${clockLabel(d.leaveBy, d.tz, now)}${zoneNote}`;
  const via = d.plan.transport?.trim() ? ` by ${d.plan.transport.trim()}` : '';
  // A booked ride's own departure is a fact; a journey length nobody set is a
  // guess. Say which this time is built on, every time.
  const service = d.serviceAt
    ? `the ${clockLabel(d.serviceAt, d.tz, now)}${d.plan.transport?.trim() ? ` ${d.plan.transport.trim().toLowerCase()}` : ' service'}`
    : '';
  // Where the times only read as a ride at all by being put on the day before,
  // saying it "does not wait" would dress a wrong time up as a timetable.
  const ride = service && !d.hubDayBefore ? ` The ${service} does not wait.` : '';
  const assumed = d.serviceAt
    ? ''
    : d.assumed.includes('journey')
      ? ` Assuming ${d.journeyMin} min to get there — set the real time.`
      : '';
  const tight = d.hubDayBefore
    ? ` ${service.charAt(0).toUpperCase()}${service.slice(1)} is read as the day before the flight, reaching ${d.hub} ${duration(d.slackMin! * MIN)} early.`
    : d.slackMin != null && d.slackMin < d.bufferMin
      ? ` That gets you to ${d.hub} ${d.slackMin <= 0 ? 'after the departure' : `only ${d.slackMin} min before`} — check there is nothing earlier.`
      : '';
  const ref = d.plan.ref?.trim() ? ` Booking ${d.plan.ref.trim()}.` : '';
  const onTrack = tight ? 'Check this journey.' : 'You are on track.';
  switch (stage) {
    case 'later': {
      const until = d.leaveBy - now;
      return {
        stage,
        title: `Leave for ${d.hub} by ${leave}.`,
        detail: `${onTrack}${until < 24 * 60 * MIN ? ` That's in ${duration(until)}.` : ''}${ride}${assumed}${tight}`,
      };
    }
    case 'prepare':
      return {
        stage,
        title: `Start getting ready — leave for ${d.hub} by ${leave}.`,
        detail: `${onTrack} ${d.journeyMin} min${via} to ${d.hub}.${ride}${assumed}${tight}`,
      };
    case 'leave-by':
      return {
        stage,
        title: `Leave for ${d.hub} by ${leave} — in ${duration(d.leaveBy - now)}.`,
        detail: `${d.journeyMin} min${via} to ${d.hub}, then ${d.slackMin ?? d.bufferMin} min before departure.${ride}${assumed}${tight}`,
      };
    case 'go':
      return {
        stage,
        title: `Time to go — leave for ${d.hub} now.`,
        detail: d.serviceAt
          ? `The ${clockLabel(d.serviceAt, d.tz, now)} service leaves in ${duration(d.serviceAt - now)}.${tight}${ref}`
          : `Your ${d.contingencyMin}-minute cushion is in use; you're still fine.${ref}`,
      };
    default: {
      const margin = Math.round((d.at - (now + d.journeyMin * MIN)) / MIN);
      const advice =
        margin <= 0
          ? 'Going now you would arrive after departure: look at the next service or rebooking.'
          : margin < d.bufferMin / 2
            ? `Going now you'd reach ${d.hub} about ${margin} min before departure — take the fastest option and check when the gate or bag drop closes.`
            : `Going now you'd still reach ${d.hub} about ${margin} min before departure. Take the quickest way.`;
      return { stage, title: `Plan B for ${d.hub}.`, detail: `${advice}${tight}${ref}` };
    }
  }
}

// ---- Calendar reminders (.ics) ----

function icsStamp(t: number): string {
  return new Date(t)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

function icsText(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** RFC 5545 line folding: at most 75 octets per line. */
function fold(line: string): string {
  const enc = new TextEncoder();
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

/**
 * Two reminders per upcoming departure — "start getting ready" and "leave
 * now" — as an .ics file the phone's calendar alerts from, offline and
 * without any server. Times are UTC instants, so no zone tables are needed.
 */
export function departuresIcs(
  tripId: string,
  tripName: string,
  deps: Departure[],
  now = Date.now(),
): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//systema//departures//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  const facts = (d: Departure) =>
    [
      d.plan.number && `${d.mode === 'flight' ? 'Flight' : 'Service'} ${d.plan.number}`,
      `departs ${d.wall.slice(11, 16)} local time`,
      d.plan.terminal && `terminal ${d.plan.terminal}`,
      `${d.journeyMin} min${d.plan.transport ? ` by ${d.plan.transport}` : ''} to ${d.hub}`,
      d.plan.ref && `booking ${d.plan.ref}`,
    ]
      .filter(Boolean)
      .join(', ');
  for (const d of deps) {
    if (d.leaveBy <= now) continue;
    const events = [
      {
        id: 'prepare',
        start: d.prepareAt,
        end: d.leaveBy,
        summary: `Start getting ready — leave for ${d.hub} at ${instantToWall(d.leaveBy, d.tz).slice(11, 16)}`,
      },
      {
        id: 'leave',
        start: d.leaveBy,
        end: d.leaveBy + d.journeyMin * MIN,
        summary: `Leave now for ${d.hub}`,
      },
    ];
    for (const e of events) {
      if (e.start <= now) continue;
      lines.push(
        'BEGIN:VEVENT',
        `UID:${tripId}-${d.key}-${e.id}@systema`,
        `DTSTAMP:${icsStamp(now)}`,
        `DTSTART:${icsStamp(e.start)}`,
        `DTEND:${icsStamp(e.end)}`,
        fold(`SUMMARY:${icsText(e.summary)}`),
        fold(`DESCRIPTION:${icsText(`${tripName}: ${d.from} → ${d.to}. ${facts(d)}.`)}`),
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        'TRIGGER:PT0M',
        fold(`DESCRIPTION:${icsText(e.summary)}`),
        'END:VALARM',
        'END:VEVENT',
      );
    }
  }
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}
