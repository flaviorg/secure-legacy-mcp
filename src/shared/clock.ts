export type Clock = { now(): Date };

export const systemClock: Clock = { now: () => new Date() };

// Deterministic clock for tests: starts at `iso` and only moves when advanced.
export function fixedClock(iso: string): Clock & { advance(ms: number): void } {
  let current = new Date(iso).getTime();
  if (Number.isNaN(current)) throw new RangeError(`fixedClock: invalid ISO date: ${iso}`);
  return {
    now: () => new Date(current),
    advance(ms: number) { current += ms; },
  };
}
