import type { City, PromptPrefs, Trip } from './db';
import { tripLegs, tripShape, tripDays, tripDisplayName } from './trip-shape';

/**
 * Research-prompt builder. Turns the trip's legs plus a few subjective answers
 * into a copy-ready prompt for Claude (or any LLM), in a Markdown shape the app
 * imports deterministically (see the Route rules, which match
 * `extractStopsFromPlan`).
 *
 * Two modes:
 *  - 'plan'      — design a new route from scratch (multi-city aware).
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
  'markets and food culture',
  'waterfronts and industrial heritage',
  'religion and civic power',
] as const;

/** Human datetime like "20 June 2026, 8:40am" from 'YYYY-MM-DDTHH:mm'. */
function humanDateTime(v: string): string {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const time = d
    .toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true })
    .replace(/\s/g, '')
    .toLowerCase();
  return `${date}, ${time}`;
}

function sleepPhrase(sleep: string): string {
  if (sleep === 'hotel') return 'hotel overnight';
  if (sleep === 'airport') return 'doze at the airport, no hotel';
  return 'no overnight';
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
  out.push(legs.length > 1 ? 'Itinerary (in order):' : 'Destination:', '');

  legs.forEach((l, i) => {
    const bits: string[] = [`${i + 1}. **${l.name}**`];
    const arr = l.arrival ? humanDateTime(l.arrival) : '';
    const dep = l.departure ? humanDateTime(l.departure) : '';
    if (arr || dep) bits.push(`arrive ${arr || 'TBC'}, leave ${dep || 'TBC'}`);
    bits.push(sleepPhrase(l.sleep));
    if (l.arrivalMs != null && l.departureMs != null) {
      const h = Math.round((l.departureMs - l.arrivalMs) / 3_600_000);
      if (h > 0) bits.push(`~${h}h on the ground`);
    }
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
    interests: [...interestOptions.slice(0, 4)],
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
  '- Often does intense one-day or two-day European trips, sometimes two cities on one ticket via a transit stop',
  '- Travels light, usually with one small bag only',
  '- Walking first; public transport when it saves time, adds cultural insight, or reveals local life',
  '- Ideally include one authentic public transport experience if meaningful',
  '- Food must be coeliac-safe gluten-free, preferably vegetarian; grocery store meals preferred over restaurants',
  '- Selective about parks and green spaces; include only if exceptional or structurally revealing',
  '- Enjoys ambitious routes and smart ideas that maximise learning',
  '- Trip purpose includes self-reflection, cultural comparison, and understanding how places work',
  '',
  'The traveller wants to learn:',
  '',
  '1. What is unique about this city?',
  "2. What is the city's operating system?",
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
  '- Then add 2-4 discovery items as Markdown task lines (`- [ ] ...`): concrete, physical things to find, spot, count, or compare on the spot at that exact place. Specific to the stop, never generic.',
  '- Add one line per stop: `Location: <latitude>, <longitude>` — approximate decimal-degree coordinates, so the app can pin it on the route map.',
  '- Group stops under the city they belong to with a bold line such as `**Barcelona**` or `**Day 1 - morning**`, never a heading.',
  '- Use level-3 headings for stops only — nowhere else in the document.',
  '- Order the stops as they should be walked, city by city, following the itinerary order.',
];

function sharedInputs(trip: Trip, cities: City[], p: PromptPrefs, interests: string[]): string[] {
  return [
    '## Inputs',
    '',
    ...itineraryLines(trip, cities),
    '',
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

function extraContext(p: PromptPrefs): string[] {
  const lines: string[] = [];
  const push = (...xs: string[]) => lines.push(...xs);
  if (p.hotel.trim()) push('Base / hotel:', '', p.hotel.trim(), '');
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
  '- public transport routes, approximate travel times, fares, and airport/station transfers (including any transit-city leg)',
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
  "The result should leave the traveller oriented, intellectually satisfied, physically able to follow the route, aware of the city's underlying logic, and more reflective about their own assumptions and cultural defaults. Avoid generic travel advice. Prioritise what makes each destination structurally and culturally distinctive.",
];

function buildPlanPrompt(trip: Trip, cities: City[], p: PromptPrefs, interests: string[]): string {
  const multi = tripLegs(cities).filter((l) => l.name).length > 1;
  const lines: string[] = [];
  const push = (...xs: string[]) => lines.push(...xs);

  push(
    'You are a world-class travel strategist, cultural interpreter, and urban systems analyst.',
    '',
    "Design a high-density cultural learning expedition that helps the traveller discover, understand, and physically experience each city's **operating system**: the forces that shaped its geography, urban form, neighbourhood functions, architecture, transport, social behaviour, food culture, religion, politics, class signals, trade, climate adaptation, and public life.",
    '',
    `The plan must feel like a designed route through each city's logic, not a list of attractions. Do not give a strict hour-by-hour plan. Provide an optimal, practical plan that fits the itinerary and timings below${multi ? ', treating each city as its own chapter and accounting for the transfer between them' : ''}.`,
    '',
    'Write in plain UK English. Use short paragraphs and bullets. Avoid jargon unless it adds precision. Target readability: Flesch 70-85.',
    '',
    ...TRAVELLER_PROFILE,
    '',
    ...sharedInputs(trip, cities, p, interests),
    ...extraContext(p),
    ...EVIDENCE_RULES,
    '',
    '## Planning principles',
    '',
    'Design the route from first principles. Prioritise:',
    '',
    '- walking-first route logic and maximum cultural signal per hour',
    '- minimal logistical friction; ambitious but realistic pacing for the exact hours available in each city',
    '- time-sensitive attractions and historically meaningful streets, squares, markets, waterfronts, religious sites, civic spaces, and transit nodes',
    '- neighbourhoods with distinct functions or identities',
    "- views or vantage points that reveal the city's structure",
    "- everyday places where local life reveals the city's operating system",
    '- self-reflection through comparison with London, Iranian cultural traditions (especially Esfahan), and wider European urban life',
    '',
    `Avoid: unnecessary zig-zags, filler stops, weak museums, generic shopping streets, restaurants as anchors, parks unless exceptional, and tourist traps unless structurally revealing. Include at most ${p.museumsMax} museum${p.museumsMax === 1 ? '' : 's'} per city.`,
    '',
    'Every major stop should answer at least one of: What system does this reveal? What behaviour does this place produce? What historical force is visible here? What contrast with London or Iran becomes clearer here? Why is this place here, in this form?',
    '',
    '## Output format',
    '',
    multi
      ? 'Produce a SEPARATE, self-contained plan for EACH city, in itinerary order — you may write each city in its own phase and I will paste them together. Begin each city with a level-1 heading `# <City name>` (the only use of a single `#`). Within each city, use exactly these level-2 headings, in this order:'
      : 'Use exactly these level-2 Markdown headings, in this order:',
    '',
    '1. `## Executive summary` — max 8 bullets: why this suits the expedition, the core route logic, the operating system in one sentence, the key timing constraint, what to book ahead, the best walking read.',
    '2. `## Assumptions` — list any assumptions clearly.',
    '3. `## Evidence checked` — changeable facts checked, date checked, items still needing verification.',
    '4. `## City character and operating system` — for each city: 6-8 sentences, then four labelled lines: **Operating system:**, **Causal chain:**, **Main tension:**, **Best walking lens:**.',
    '5. `## Strategy` — why the route starts where it does, key clusters, time-sensitive elements, how to pace attention across the hours available.',
    '6. `## Route` — see the route rules below.',
    '7. `## Cultural insight moments` — 3-5 moments: what to notice, what it reveals, why it matters.',
    '8. `## Reflection prompts` — 3-5 short prompts tied to specific locations, comparing with London, Iran/Esfahan, and prior assumptions.',
    '9. `## Compression levers` — two things to skip if the day slips: what is lost, what is preserved.',
    '10. `## Stretch add-on` — one extra experience if ahead of time.',
    '11. `## Logistics checklist` — tickets, apps, transport tips, and the inter-city transfer if any.',
    '12. `## Food plan` — grocery stops on the route, safe default meal strategy, low-risk gluten-free vegetarian options only with credible evidence. Do not recommend restaurants.',
    '13. `## Cost estimate` — transfers, local transport, tickets, food, contingency; flag prices needing verification.',
    '',
    ...ROUTE_RULES,
    '',
    ...(multi
      ? [
          'Repeat the entire structure again under a new `# <City name>` for every further city, in itinerary order. Keep the cities separate — never merge them into one section.',
          '',
        ]
      : []),
    ...QUALITY_BAR,
  );
  return lines.join('\n');
}

function buildHavePlanPrompt(
  trip: Trip,
  cities: City[],
  p: PromptPrefs,
  interests: string[],
): string {
  const multi = tripLegs(cities).filter((l) => l.name).length > 1;
  const lines: string[] = [];
  const push = (...xs: string[]) => lines.push(...xs);

  push(
    'You are a world-class cultural interpreter and urban systems analyst.',
    '',
    `I already have the itinerary for this trip (below). **Do not design a new route or replace my stops.** Keep my places and their order, and enrich them into your structured format so my app can import them: for each place, add the system-reading, the London and Iran/Esfahan contrasts, concrete on-the-spot discovery items, and approximate coordinates. Fill obvious gaps and flag anything that looks wrong or worth booking — but the itinerary stays mine.${multi ? ' This is a multi-city trip: produce a separate `# <City name>` block for each city (you may do them in separate phases and paste them together).' : ''}`,
    '',
    'Write in plain UK English. Short paragraphs and bullets. Target readability: Flesch 70-85.',
    '',
    ...TRAVELLER_PROFILE,
    '',
    ...sharedInputs(trip, cities, p, interests),
    ...extraContext(p),
  );

  if (trip.planText.trim()) {
    push('## My existing itinerary', '', trip.planText.trim(), '');
  } else {
    push(
      '## My existing itinerary',
      '',
      '(Paste it here, or I will paste the original planning conversation. If it is missing, ask me for it before proceeding.)',
      '',
    );
  }

  push(
    ...EVIDENCE_RULES,
    '',
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
    '',
    ...ROUTE_RULES,
    '',
    ...QUALITY_BAR,
  );
  return lines.join('\n');
}

export function buildResearchPrompt(p: PromptPrefs, trip: Trip, cities: City[]): string {
  const interests = p.interests.length
    ? p.interests
    : ['history and culture', 'architecture and city design'];
  return p.mode === 'have-plan'
    ? buildHavePlanPrompt(trip, cities, p, interests)
    : buildPlanPrompt(trip, cities, p, interests);
}
