import type { City, PromptPrefs, Trip, TripType } from './db';

/**
 * Research-prompt builder. Turns a few answers (pre-filled from the trip) into
 * a copy-ready prompt for Claude (or any LLM) that produces a high-density
 * "city operating system" plan — in a Markdown shape the app can then import
 * deterministically (see the Route rules in the output-format section, which
 * match `extractStopsFromPlan`).
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

const durationByType: Record<TripType, string> = {
  'same-day': 'one-day (out at dawn, home for bed)',
  'airport-sleep': 'one-day with a late-night arrival and an airport doze',
  weekend: 'two-to-three day',
  custom: 'multi-day',
};

/** Human date like "20 June 2026" from 'YYYY-MM-DD'; '' passes through. */
function humanDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

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

export function defaultPromptPrefs(trip: Trip, cities: City[]): PromptPrefs {
  const destination = cities.length ? cities.map((c) => c.name).join(' / ') : trip.name;
  return {
    destination,
    arrival: humanDate(trip.startDate),
    departure: trip.returnFlightAt ? humanDateTime(trip.returnFlightAt) : humanDate(trip.endDate),
    durationLabel: durationByType[trip.type],
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

export function buildResearchPrompt(p: PromptPrefs): string {
  const interests = p.interests.length
    ? p.interests
    : ['history and culture', 'architecture and city design'];

  const lines: string[] = [];
  const push = (...xs: string[]) => lines.push(...xs);

  push(
    'You are a world-class travel strategist, cultural interpreter, and urban systems analyst.',
    '',
    "Design a high-density cultural learning expedition that helps the traveller discover, understand, and physically experience the city's **operating system**: the forces that shaped its geography, urban form, neighbourhood functions, architecture, transport, social behaviour, food culture, religion, politics, class signals, trade, climate adaptation, and public life.",
    '',
    `The plan must feel like a designed route through the city's logic, not a list of attractions. Do not provide a strict hour-by-hour plan with strict deadlines. Provide an optimal practical plan, optimised for a ${p.durationLabel} trip.`,
    '',
    'Write in plain UK English. Use short paragraphs and bullets. Avoid jargon unless it adds precision. Target readability: Flesch 70-85.',
    '',
    '## Traveller profile',
    '',
    'Assume this profile unless the inputs override it:',
    '',
    '- Based in London',
    '- Often does intense one-day or two-day European trips',
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
    '',
    '## Inputs',
    '',
    `Destination: ${p.destination}`,
    `Trip type: ${p.durationLabel}`,
    `Arrival: ${p.arrival || 'TBC'}`,
    `Departure: ${p.departure || 'TBC'}`,
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
  );

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

  push(
    '## Evidence rules',
    '',
    'Before writing the itinerary, check current evidence for changeable facts:',
    '',
    '- opening hours, closure days, last entry times, ticket rules, and booking needs',
    '- public transport routes, approximate travel times, fares, and airport/station transfers',
    '- safety, access, weather, seasonal, late-night, or early-morning issues',
    '- coeliac-safe gluten-free vegetarian food options, prioritising grocery-based meals',
    '',
    'Use current sources where available. Do not invent opening hours, prices, ticket rules, transport claims, safety claims, or food safety claims.',
    '',
    'If key inputs are missing, ask up to 3 clarifying questions only if the plan cannot be made responsibly. Otherwise proceed with clearly labelled assumptions.',
    '',
    '## Planning principles',
    '',
    'Design the route from first principles. Prioritise:',
    '',
    '- walking-first route logic and maximum cultural signal per hour',
    '- minimal logistical friction; ambitious but realistic pacing',
    '- time-sensitive attractions and historically meaningful streets, squares, markets, waterfronts, religious sites, civic spaces, and transit nodes',
    '- neighbourhoods with distinct functions or identities',
    "- views or vantage points that reveal the city's structure",
    "- everyday places where local life reveals the city's operating system",
    '- self-reflection through comparison with London, Iranian cultural traditions (especially Esfahan), and wider European urban life',
    '',
    'Avoid: unnecessary zig-zags, filler stops, weak museums, generic shopping streets, restaurants as anchors, parks unless exceptional, and tourist traps unless structurally revealing.',
    `Include at most ${p.museumsMax} museum${p.museumsMax === 1 ? '' : 's'}.`,
    '',
    'Every major stop should answer at least one of:',
    '',
    '- What system does this reveal?',
    '- What behaviour does this place produce?',
    '- What historical force is visible here?',
    '- What contrast with London or Iran becomes clearer here?',
    '- Why is this place here, in this form, rather than somewhere else?',
    '',
    '## Output format',
    '',
    'Use exactly these level-2 Markdown headings, in this order:',
    '',
    '1. `## Executive summary` — maximum 8 bullets: why this city suits the expedition, the core route logic, the operating system in one sentence, the key timing constraint, what to book ahead, the best walking read.',
    '2. `## Assumptions` — list any assumptions clearly.',
    '3. `## Evidence checked` — changeable facts checked, date checked, items still needing verification.',
    '4. `## City character and operating system` — 6-8 sentences, then four labelled lines: **Operating system:**, **Causal chain:**, **Main tension:**, **Best walking lens:**.',
    '5. `## Strategy` — why the route starts where it does, key clusters, time-sensitive elements, how to pace attention.',
    '6. `## Route` — see the route rules below.',
    '7. `## Cultural insight moments` — 3-5 moments: what to notice, what it reveals, why it matters.',
    '8. `## Reflection prompts` — 3-5 short prompts tied to specific locations, comparing with London, Iran/Esfahan, and prior assumptions.',
    '9. `## Compression levers` — two things to skip if the day slips: what is lost, what is preserved.',
    '10. `## Stretch add-on` — one extra experience if ahead of time.',
    '11. `## Logistics checklist` — tickets, apps, transport tips.',
    '12. `## Food plan` — grocery stops on the route, safe default meal strategy, low-risk gluten-free vegetarian options only with credible evidence. Do not recommend restaurants.',
    '13. `## Cost estimate` — transfers, local transport, tickets, food, contingency; flag prices needing verification.',
    '',
    '### Route rules (important, for machine import)',
    '',
    'Inside `## Route`:',
    '',
    '- Give every stop its own level-3 heading: `### <Stop name>` — the place name only, no numbering.',
    '- Under each stop heading, add 2-5 short bullets: what to notice, the system it reveals, one London and one Esfahan/Iran contrast where meaningful, and any timing note.',
    '- Then add 2-4 discovery items as Markdown task lines (`- [ ] ...`): concrete, physical things to find, spot, count, or compare on the spot at that exact place (an inscription to find, a detail to notice, a behaviour to watch for). Specific to the stop, never generic.',
    '- Add one line per stop: `Location: <latitude>, <longitude>` — approximate decimal-degree coordinates of the place, so the app can pin it on the route map.',
    '- Mark day or phase boundaries with a bold line of text such as `**Day 1 - morning**`, never with a heading.',
    '- Use level-3 headings for stops only — nowhere else in the document.',
    '- Order the stops as they should be walked.',
    '',
    '## Quality bar',
    '',
    "The final plan should leave the traveller oriented, intellectually satisfied, physically able to follow the route, aware of the city's underlying logic, and more reflective about their own assumptions and cultural defaults. Avoid generic travel advice. Prioritise what makes the destination structurally and culturally distinctive.",
  );

  return lines.join('\n');
}
