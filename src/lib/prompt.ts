import type { City, PromptPrefs, Trip } from './db';
import {
  legBaseName,
  stopoverShape,
  tripDays,
  tripDisplayName,
  tripLegs,
  tripShape,
} from './trip-shape';
import { cityBlock } from './headings';
import { tripDepartures } from './readiness';
import { instantToWall, tzLongName, wallParts } from './tz';

/**
 * Research-prompt builder. Turns the trip's legs plus a few subjective answers
 * into a copy-ready prompt for Claude (or any LLM), in a Markdown shape the app
 * imports deterministically (see the Route rules, which match
 * `extractStopsFromPlan`).
 *
 * Multi-city trips are researched one city at a time (`buildCityPrompt`):
 * each prompt carries only that city's base, times, hours, arrival and
 * departure — a smaller, sharper job — and its answer starts with `# City`,
 * so pasting them one after another builds the trip plan. One prompt for the
 * whole trip (`buildResearchPrompt`) remains for single-city trips and for
 * those who prefer one conversation.
 *
 * Two modes:
 *  - 'plan'      — design a new route from scratch.
 *  - 'have-plan' — I already have the itinerary (pasted in the Plan tab or a
 *                  prior chat). Enrich and annotate it into the app's structured
 *                  format; do NOT invent a new route. This is the mode for past
 *                  trips, so the app stops treating them as blank slates.
 *
 * Pure module: no AI, no network. Just text assembly.
 */

export const paceOptions = ['relaxed', 'medium', 'medium to fast', 'fast'] as const;
export const budgetOptions = ['low', 'medium', 'comfortable'] as const;

export const interestOptions = [
  'history and culture',
  'architecture and city design',
  'neighbourhood exploration',
  'social behaviour and cultural patterns',
  'public transport as cultural insight',
  'religion and civic power',
  'markets and food culture',
  'waterfronts and industrial heritage',
] as const;

/**
 * "Friday 16 October 2026, 9:00am" from a wall-clock string, as written —
 * never re-read in the device's zone (that shifted times by an hour or more).
 */
export function humanWall(v: string): string {
  const p = wallParts(v);
  if (!p) return v;
  const date = `${p.weekday} ${p.day} ${p.month} ${p.y}`;
  if (!p.h) return date;
  return `${date}, ${+p.h % 12 || 12}:${p.mi}${+p.h < 12 ? 'am' : 'pm'}`;
}

function sleepPhrase(sleep: string): string {
  if (sleep === 'hotel') return 'hotel overnight';
  if (sleep === 'airport') return 'doze at the airport, no hotel';
  return 'no overnight';
}

function groundHours(arrivalMs?: number, departureMs?: number): string {
  if (arrivalMs == null || departureMs == null) return '';
  const h = Math.round((departureMs - arrivalMs) / 3_600_000);
  return h > 0 ? `~${h}h on the ground` : '';
}

/** The itinerary section: one line per leg, with times, sleep and time on the ground. */
export function itineraryLines(trip: Trip, cities: City[]): string[] {
  const legs = tripLegs(cities).filter((l) => l.name);
  if (!legs.length) return [`Destination: ${tripDisplayName(trip, cities)} (add legs for detail)`];

  const shape = tripShape(trip, cities).label;
  const days = tripDays(trip, cities);
  const out: string[] = [
    `Trip shape: ${shape}${days ? `, ${days} day${days > 1 ? 's' : ''}` : ''}`,
    '',
  ];
  out.push(
    legs.length > 1 ? 'Itinerary (in order, times are local to each city):' : 'Destination:',
    '',
  );

  legs.forEach((l, i) => {
    const bits: string[] = [`${i + 1}. **${l.name}**`];
    const arr = l.arrival ? humanWall(l.arrival) : '';
    const dep = l.departure ? humanWall(l.departure) : '';
    if (arr || dep) bits.push(`arrive ${arr || 'TBC'}, leave ${dep || 'TBC'}`);
    bits.push(sleepPhrase(l.sleep));
    const hours = groundHours(l.arrivalMs, l.departureMs);
    if (hours) bits.push(hours);
    out.push(`- ${bits.join(' · ')}`);
  });
  return out;
}

export function defaultPromptPrefs(trip: Trip, _cities: City[]): PromptPrefs {
  const alreadyPlanned = trip.status === 'done' || trip.planText.trim() !== '';
  return {
    mode: alreadyPlanned ? 'have-plan' : 'plan',
    pace: 'medium to fast',
    budget: 'medium',
    companions: trip.partySize === 2 ? 'travelling as a party of 2' : `party of ${trip.partySize}`,
    interests: [...interestOptions.slice(0, 5)],
    museumsMax: 2,
    hotel: '',
    constraints: '',
    pastVisits: '',
    notes: '',
  };
}

const TRAVELLER_PROFILE = [
  '## Traveller profile',
  '',
  'Assume this profile unless the inputs override it:',
  '',
  '- Based in London',
  '- Often does intense one-day or two-day European trips, sometimes two cities on one ticket via a stopover',
  '- Travels light, usually with one small bag only',
  '- Walking first; public transport when it saves time, and as cultural insight in itself: how a city moves people says how it works',
  '- Ideally include one authentic public transport experience if meaningful',
  '- Food must be coeliac-safe gluten-free, preferably vegetarian; grocery store meals preferred over restaurants',
  '- Selective about parks and green spaces; include only if exceptional or structurally revealing',
  '- Enjoys ambitious routes and smart ideas that maximise learning — without rushing: fewer, deeper stops beat a checklist, and the plan should leave room to be present',
  '- Trip purpose includes self-reflection, cultural comparison, and understanding how places work',
  '',
  'The traveller wants to learn:',
  '',
  '1. What is unique about this city?',
  "2. What is the city's operating system — architecture, history, religion, public transport, everyday social behaviour?",
  '3. What does this city reveal about London or modern Western urban life?',
  '4. What does this city reveal about different cultural ways of thinking, including contrasts with Iranian (especially Esfahan) and European cultural traditions?',
];

const ROUTE_RULES = [
  '### Route rules (important, for machine import)',
  '',
  'Inside `## Route`:',
  '',
  '- Give every stop its own level-3 heading: `### <Stop name>` — the place name only, no numbering.',
  '- Under each stop heading, add 2-5 short bullets: what to notice, the system it reveals, one London and one Esfahan/Iran contrast where meaningful, and any timing note.',
  '- For every museum, church, palace, historic site and major neighbourhood stop, add these five labelled lines after the bullets, each on its own line:',
  '  - `Anchor:` where to begin, and why it matters (one sentence)',
  '  - `Minimum visit:` the 10-20 minute version: one route, object, room or viewpoint',
  '  - `Look for:` three concrete things to spot, separated by semicolons',
  '  - `Stretch:` one optional deeper layer, only if calm and ahead of time',
  '  - `Exit rule:` what can be skipped without losing the point',
  '- Then add 2-4 discovery items as Markdown task lines (`- [ ] ...`): concrete, physical things to find, spot, count, or compare on the spot at that exact place. Specific to the stop, never generic.',
  '- Add one line per stop: `Location: <latitude>, <longitude>` — approximate decimal-degree coordinates, so the app can pin it on the map.',
  '- To show the rhythm of the day, you may put a bold line such as `**Morning**` or `**After the hotel**` between stops — never a heading, and never a city name.',
  '- Use level-3 headings for stops only — nowhere else in the document.',
  '- Order the stops as they should be walked.',
];

function sharedInputs(trip: Trip, cities: City[], p: PromptPrefs, interests: string[]): string[] {
  return [
    '## Inputs',
    '',
    ...itineraryLines(trip, cities),
    '',
    ...companionsAndTaste(p, interests),
  ];
}

function companionsAndTaste(p: PromptPrefs, interests: string[]): string[] {
  return [
    `Companion context: ${p.companions || 'solo'}`,
    `Pace preference: ${p.pace}`,
    `Budget comfort: ${p.budget}`,
    'Food requirements: coeliac-safe gluten-free and vegetarian',
    '',
    'Interests:',
    '',
    ...interests.map((i) => `- ${i}`),
    '- parks or nature only if exceptional',
    '',
  ];
}

function extraContext(p: PromptPrefs, { hotel = true } = {}): string[] {
  const lines: string[] = [];
  const push = (...xs: string[]) => lines.push(...xs);
  if (hotel && p.hotel.trim()) push('Base / hotel:', '', p.hotel.trim(), '');
  if (p.constraints.trim()) push('Hard constraints:', '', p.constraints.trim(), '');
  if (p.pastVisits.trim())
    push(
      'Already visited on previous trips (treat as context and comparison anchors, do not repeat as main stops):',
      '',
      p.pastVisits.trim(),
      '',
    );
  if (p.notes.trim()) push('Further context:', '', p.notes.trim(), '');
  return lines;
}

const EVIDENCE_RULES = [
  '## Evidence rules',
  '',
  'Before writing, check current evidence for changeable facts:',
  '',
  '- opening hours, closure days, last entry times, ticket rules, and booking needs',
  '- public transport routes, approximate travel times, fares, and airport/station transfers',
  '- safety, access, weather, seasonal, late-night, or early-morning issues',
  '- coeliac-safe gluten-free vegetarian food options, prioritising grocery-based meals',
  '',
  'Use current sources where available. Do not invent opening hours, prices, ticket rules, transport claims, safety claims, or food safety claims.',
  '',
  'If key inputs are missing, ask up to 3 clarifying questions only if the work cannot be done responsibly. Otherwise proceed with clearly labelled assumptions.',
];

const QUALITY_BAR = [
  '## Quality bar',
  '',
  "The result should leave the traveller oriented, intellectually satisfied, physically able to follow the route without feeling rushed, aware of the city's underlying logic, and more reflective about their own assumptions and cultural defaults. Avoid generic travel advice. Prioritise what makes each destination structurally and culturally distinctive.",
];

const PLAN_HEADINGS = [
  '1. `## Executive summary` — max 8 bullets: why this suits the expedition, the core route logic, the operating system in one sentence, the key timing constraint, what to book ahead, the best walking read.',
  '2. `## Assumptions` — list any assumptions clearly.',
  '3. `## Evidence checked` — changeable facts checked, date checked, items still needing verification.',
  '4. `## City character and operating system` — 6-8 sentences, then four labelled lines: **Operating system:**, **Causal chain:**, **Main tension:**, **Best walking lens:**.',
  '5. `## Strategy` — why the route starts where it does, key clusters, time-sensitive elements, how to pace attention across the hours available.',
  '6. `## Route` — see the route rules below.',
  '7. `## Cultural insight moments` — 3-5 moments: what to notice, what it reveals, why it matters.',
  '8. `## Reflection prompts` — 3-5 short prompts tied to specific locations, comparing with London, Iran/Esfahan, and prior assumptions.',
  '9. `## Compression levers` — two things to skip if the day slips: what is lost, what is preserved.',
  '10. `## Stretch add-on` — one extra experience if ahead of time.',
  '11. `## Logistics checklist` — tickets, apps, transport tips, the transfer in and out (and when to leave for it).',
  '12. `## Food plan` — grocery stops on the route, safe default meal strategy, low-risk gluten-free vegetarian options only with credible evidence. Do not recommend restaurants.',
  '13. `## Cost estimate` — transfers, local transport, tickets, food, contingency; flag prices needing verification.',
];

const PLAN_INTRO = [
  'You are a world-class travel strategist, cultural interpreter, and urban systems analyst.',
  '',
  "Design a high-density cultural learning expedition that helps the traveller discover, understand, and physically experience the city's **operating system**: the forces that shaped its geography, urban form, neighbourhood functions, architecture, transport, social behaviour, food culture, religion, politics, class signals, trade, climate adaptation, and public life.",
  '',
];

const PLANNING_PRINCIPLES = (museumsMax: number) => [
  '## Planning principles',
  '',
  'Design the route from first principles. Prioritise:',
  '',
  '- walking-first route logic and maximum cultural signal per hour, with slack: a calm traveller notices more',
  '- minimal logistical friction; ambitious but realistic pacing for the exact hours available',
  '- time-sensitive attractions and historically meaningful streets, squares, markets, waterfronts, religious sites, civic spaces, and transit nodes',
  '- neighbourhoods with distinct functions or identities',
  "- views or vantage points that reveal the city's structure",
  "- everyday places where local life reveals the city's operating system",
  '- self-reflection through comparison with London, Iranian cultural traditions (especially Esfahan), and wider European urban life',
  '',
  `Avoid: unnecessary zig-zags, filler stops, weak museums, generic shopping streets, restaurants as anchors, parks unless exceptional, and tourist traps unless structurally revealing. Include at most ${museumsMax} museum${museumsMax === 1 ? '' : 's'}.`,
  '',
  'Every major stop should answer at least one of: What system does this reveal? What behaviour does this place produce? What historical force is visible here? What contrast with London or Iran becomes clearer here? Why is this place here, in this form?',
  '',
];

function interestsOf(p: PromptPrefs): string[] {
  return p.interests.length ? p.interests : ['history and culture', 'architecture and city design'];
}

/** Whole-trip prompt: single-city trips, or every city in one conversation. */
export function buildResearchPrompt(p: PromptPrefs, trip: Trip, cities: City[]): string {
  const interests = interestsOf(p);
  return p.mode === 'have-plan'
    ? buildHavePlanPrompt(trip, cities, p, interests)
    : buildPlanPrompt(trip, cities, p, interests);
}

function buildPlanPrompt(trip: Trip, cities: City[], p: PromptPrefs, interests: string[]): string {
  const names = tripLegs(cities)
    .filter((l) => l.name)
    .map((l) => l.name);
  const multi = new Set(names.map((n) => n.toLowerCase())).size > 1;
  return [
    ...PLAN_INTRO,
    `The plan must feel like a designed route through the city's logic, not a list of attractions. Do not give a strict hour-by-hour plan. Provide an optimal, practical plan that fits the itinerary and timings below${multi ? ', treating each city as its own chapter and accounting for the transfer between them' : ''}.`,
    '',
    'Write in plain UK English. Use short paragraphs and bullets. Avoid jargon unless it adds precision. Target readability: Flesch 70-85.',
    '',
    ...TRAVELLER_PROFILE,
    '',
    ...sharedInputs(trip, cities, p, interests),
    ...extraContext(p),
    ...EVIDENCE_RULES,
    '',
    ...PLANNING_PRINCIPLES(p.museumsMax),
    '## Output format',
    '',
    multi
      ? 'Produce a SEPARATE, self-contained plan for EACH city, in itinerary order. Begin each city with a level-1 heading `# <City name>` (the only use of a single `#`). Within each city, use exactly these level-2 headings, in this order:'
      : 'Use exactly these level-2 Markdown headings, in this order:',
    '',
    ...PLAN_HEADINGS,
    '',
    ...ROUTE_RULES,
    '',
    ...(multi
      ? [
          'Repeat the entire structure under a new `# <City name>` for every further city, in itinerary order. Keep the cities separate — never merge them into one section.',
          '',
        ]
      : []),
    ...QUALITY_BAR,
  ].join('\n');
}

function buildHavePlanPrompt(
  trip: Trip,
  cities: City[],
  p: PromptPrefs,
  interests: string[],
): string {
  const multi = new Set(tripLegs(cities).map((l) => l.name.toLowerCase())).size > 1;
  const lines: string[] = [
    'You are a world-class cultural interpreter and urban systems analyst.',
    '',
    `I already have the itinerary for this trip (below). **Do not design a new route or replace my stops.** Keep my places and their order, and enrich them into your structured format so my app can import them: for each place, add the system-reading, the London and Iran/Esfahan contrasts, the visit anchor for major sites, concrete on-the-spot discovery items, and approximate coordinates. Fill obvious gaps and flag anything that looks wrong or worth booking — but the itinerary stays mine.${multi ? ' This is a multi-city trip: produce a separate `# <City name>` block for each city.' : ''}`,
    '',
    'Write in plain UK English. Short paragraphs and bullets. Target readability: Flesch 70-85.',
    '',
    ...TRAVELLER_PROFILE,
    '',
    ...sharedInputs(trip, cities, p, interests),
    ...extraContext(p),
    '## My existing itinerary',
    '',
    trip.planText.trim() ||
      '(Paste it here, or I will paste the original planning conversation. If it is missing, ask me for it before proceeding.)',
    '',
    ...EVIDENCE_RULES,
    '',
    ...HAVE_PLAN_OUTPUT(multi),
    '',
    ...ROUTE_RULES,
    '',
    ...QUALITY_BAR,
  ];
  return lines.join('\n');
}

const HAVE_PLAN_OUTPUT = (multi: boolean) => [
  '## What to produce',
  '',
  multi
    ? 'For each city, output a `# <City name>` block (the only use of a single `#`) containing exactly these level-2 headings, in this order:'
    : 'Use exactly these level-2 Markdown headings, in this order:',
  '',
  '1. `## City character and operating system` — 6-8 sentences, then four labelled lines: **Operating system:**, **Causal chain:**, **Main tension:**, **Best walking lens:**.',
  '2. `## Route` — my stops, kept and in my order, enriched per the route rules below. If I clearly missed a place that my own logic implies, add it and mark it **(suggested)**.',
  '3. `## Cultural insight moments` — 3-5 moments tied to my stops.',
  '4. `## Reflection prompts` — 3-5 prompts tied to specific stops, comparing with London and Iran/Esfahan.',
  '5. `## Corrections and gaps` — anything in my itinerary that looks off, closed, mistimed, or worth booking.',
];

/** Distinct cities in leg order (a returning city counts once). */
export function researchCities(cities: City[]): City[] {
  const seen = new Set<string>();
  return [...cities]
    .sort((a, b) => a.order - b.order)
    .filter((c) => {
      const k = c.name.trim().toLowerCase();
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

/**
 * Only this city's facts: when you're there (its own clock), the hours on the
 * ground, where you stay, how you arrive and how you leave (with the time to
 * leave for the airport), and its role in a two-city stopover.
 */
export function cityContext(trip: Trip, cities: City[], cityId: string): string[] {
  const legs = tripLegs(cities);
  const i = legs.findIndex((l) => l.id === cityId);
  const leg = legs[i];
  const city = cities.find((c) => c.id === cityId);
  if (!leg || !city) return [];
  const prev = legs[i - 1];
  const next = legs[i + 1];
  const zone = city.tz ? ` (${tzLongName(city.tz)})` : '';
  const out: string[] = [`City: **${leg.name}**`, ''];
  if (leg.arrival || leg.departure)
    out.push(
      `- In ${leg.name} from ${leg.arrival ? humanWall(leg.arrival) : 'TBC'} to ${leg.departure ? humanWall(leg.departure) : 'TBC'}, local time${zone}.`,
    );
  const hours = groundHours(leg.arrivalMs, leg.departureMs);
  if (hours) out.push(`- ${hours.replace('~', 'About ')}, ${sleepPhrase(leg.sleep)}.`);
  else out.push(`- ${sleepPhrase(leg.sleep)[0].toUpperCase()}${sleepPhrase(leg.sleep).slice(1)}.`);
  const base = legBaseName(trip, cities, city);
  if (base)
    out.push(
      `- Base: ${base}${city.base?.address ? `, ${city.base.address}` : ''}${city.base?.checkIn ? `; check-in ${humanWall(city.base.checkIn)}` : ''}${city.base?.checkOut ? `; check-out ${humanWall(city.base.checkOut)}` : ''}.`,
    );
  else if (leg.sleep === 'none')
    out.push('- No hotel: everything is carried (one small bag), or left at a station locker.');

  const ob = trip.outbound;
  if (!prev)
    out.push(
      `- Arriving from London${ob?.hub ? ` (${ob.hub}${ob.number ? `, ${ob.number}` : ''})` : ''}${ob?.at ? `, leaving home ${humanWall(ob.at)} UK time` : ''}.`,
    );
  else out.push(`- Arriving from ${prev.name}.`);

  const dep = tripDepartures(trip, cities).find((d) => d.key === cityId);
  const exit = city.exit ?? {};
  const via = [exit.hub, exit.number].filter(Boolean).join(' ');
  out.push(
    `- Leaving for ${next?.name ?? 'London'}${via ? ` from ${via}` : ''}${exit.transport ? `; getting there by ${exit.transport}${exit.journeyMin ? ` (${exit.journeyMin} min)` : ''}` : ''}.`,
  );
  if (dep)
    out.push(
      `- To be calm for that departure, leave for ${dep.hub} by ${instantToWall(dep.leaveBy, dep.tz).slice(11, 16)} local time: end the route near the base or the transfer, not across the city.`,
    );

  const stop = stopoverShape(trip, cities);
  if (stop?.scenario) {
    const role =
      stop.stopover?.toLowerCase() === leg.name.toLowerCase()
        ? `This is the stopover city of a two-city trip (the connection to ${stop.destination} is protected on the same ticket).`
        : `This is the destination of a two-city trip; the stopover is ${stop.stopover}.`;
    out.push(`- ${role} The night is in ${stop.nightIn}.`);
  }
  return out;
}

/**
 * One city's research prompt. The answer starts with `# <City>` so it pastes
 * straight into the trip plan next to the other cities.
 */
export function buildCityPrompt(
  p: PromptPrefs,
  trip: Trip,
  cities: City[],
  cityId: string,
): string {
  const city = cities.find((c) => c.id === cityId);
  if (!city) return '';
  const name = city.name.trim();
  const others = researchCities(cities)
    .filter((c) => c.id !== cityId)
    .map((c) => c.name.trim());
  const interests = interestsOf(p);
  const ctx = [
    '## Inputs',
    '',
    ...cityContext(trip, cities, cityId),
    '',
    ...(others.length
      ? [
          `The trip also includes ${others.join(' and ')}, researched separately — keep this plan to ${name}.`,
          '',
        ]
      : []),
    ...companionsAndTaste(p, interests),
    // A city's own base is in its context; the old trip-wide hotel answer only
    // applies when the leg has none.
    ...extraContext(p, { hotel: !legBaseName(trip, cities, city) }),
  ];
  const head = `Your answer must start with the line \`# ${name}\` (the only level-1 heading).`;

  if (p.mode === 'have-plan') {
    const mine = cityBlock(
      trip.planText,
      name,
      researchCities(cities).map((c) => c.name),
    );
    return [
      'You are a world-class cultural interpreter and urban systems analyst.',
      '',
      `I already have my plan for ${name} (below). **Do not design a new route or replace my stops.** Keep my places and their order, and enrich them into the structured format below so my app can import them. Fill obvious gaps and flag anything that looks wrong or worth booking — but the itinerary stays mine.`,
      '',
      'Write in plain UK English. Short paragraphs and bullets. Target readability: Flesch 70-85.',
      '',
      ...TRAVELLER_PROFILE,
      '',
      ...ctx,
      `## My existing plan for ${name}`,
      '',
      mine?.trim() ||
        '(I will paste it, or the original planning conversation. If it is missing, ask me for it before proceeding.)',
      '',
      ...EVIDENCE_RULES,
      '',
      ...HAVE_PLAN_OUTPUT(false),
      '',
      head,
      '',
      ...ROUTE_RULES,
      '',
      ...QUALITY_BAR,
    ].join('\n');
  }

  return [
    ...PLAN_INTRO,
    `This prompt is about **${name}** only. The plan must feel like a designed route through the city's logic, not a list of attractions, and fit the exact hours below — including getting to the departure calmly. Do not give a strict hour-by-hour plan.`,
    '',
    'Write in plain UK English. Use short paragraphs and bullets. Avoid jargon unless it adds precision. Target readability: Flesch 70-85.',
    '',
    ...TRAVELLER_PROFILE,
    '',
    ...ctx,
    ...EVIDENCE_RULES,
    '',
    ...PLANNING_PRINCIPLES(p.museumsMax),
    '## Output format',
    '',
    head,
    '',
    'Then use exactly these level-2 headings, in this order:',
    '',
    ...PLAN_HEADINGS,
    '',
    ...ROUTE_RULES,
    '',
    ...QUALITY_BAR,
  ].join('\n');
}
