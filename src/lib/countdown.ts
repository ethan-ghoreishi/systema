/**
 * Pure departure-countdown maths. The Plan tab feeds it `Date.now()` on a timer;
 * keeping it pure makes it trivially testable.
 */

export interface Countdown {
  expired: boolean;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  text: string;
}

export function computeCountdown(targetMs: number, nowMs: number): Countdown {
  const remaining = targetMs - nowMs;
  const expired = remaining <= 0;
  const clamped = Math.max(0, remaining);

  const totalSeconds = Math.floor(clamped / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  let text: string;
  if (days > 0) text = `${days}d ${hours}h ${minutes}m`;
  else if (hours > 0) text = `${hours}h ${minutes}m`;
  else text = `${minutes}m ${seconds}s`;

  return { expired, days, hours, minutes, seconds, text };
}
