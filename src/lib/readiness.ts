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
/** "Leave by" turns from Prepare into its own stage this close to the time. */
const SOON_MIN = 10;
const MIN = 60_000;

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
  const d = MODE_DEFAULTS[mode];
  const n = (v: number | undefined) => (typeof v === 'number' && v >= 0 ? v : undefined);
  const journeyMin = n(plan.journeyMin) ?? d.journeyMin;
  const bufferMin = n(plan.bufferMin) ?? d.bufferMin;
  const contingencyMin = n(plan.contingencyMin) ?? d.contingencyMin;
  const prepareMin = n(plan.prepareMin) ?? PREPARE_MIN;
  const leaveBy = at - (bufferMin + journeyMin + contingencyMin) * MIN;
  const assumed: Departure['assumed'] = [];
  if (n(plan.journeyMin) == null) assumed.push('journey');
  if (n(plan.bufferMin) == null) assumed.push('buffer');
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
    journeyMin,
    bufferMin,
    contingencyMin,
    prepareMin,
    assumed,
    leaveBy,
    prepareAt: leaveBy - prepareMin * MIN,
    latestLeave: leaveBy + contingencyMin * MIN,
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

function duration(ms: number): string {
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
  const assumed = d.assumed.includes('journey')
    ? ` Assuming ${d.journeyMin} min to get there — set the real time.`
    : '';
  const ref = d.plan.ref?.trim() ? ` Booking ${d.plan.ref.trim()}.` : '';
  switch (stage) {
    case 'later': {
      const until = d.leaveBy - now;
      return {
        stage,
        title: `Leave for ${d.hub} by ${leave}.`,
        detail: `You are on track.${until < 24 * 60 * MIN ? ` That's in ${duration(until)}.` : ''}${assumed}`,
      };
    }
    case 'prepare':
      return {
        stage,
        title: `Start getting ready — leave for ${d.hub} by ${leave}.`,
        detail: `You are on track. ${d.journeyMin} min${via} to ${d.hub}.${assumed}`,
      };
    case 'leave-by':
      return {
        stage,
        title: `Leave for ${d.hub} by ${leave} — in ${duration(d.leaveBy - now)}.`,
        detail: `${d.journeyMin} min${via} to ${d.hub}, then ${d.bufferMin} min before departure.${assumed}`,
      };
    case 'go':
      return {
        stage,
        title: `Time to go — leave for ${d.hub} now.`,
        detail: `Your ${d.contingencyMin}-minute cushion is in use; you're still fine.${ref}`,
      };
    default: {
      const margin = Math.round((d.at - (now + d.journeyMin * MIN)) / MIN);
      const advice =
        margin <= 0
          ? 'Going now you would arrive after departure: look at the next service or rebooking.'
          : margin < d.bufferMin / 2
            ? `Going now you'd reach ${d.hub} about ${margin} min before departure — take the fastest option and check when the gate or bag drop closes.`
            : `Going now you'd still reach ${d.hub} about ${margin} min before departure. Take the quickest way.`;
      return { stage, title: `Plan B for ${d.hub}.`, detail: `${advice}${ref}` };
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
