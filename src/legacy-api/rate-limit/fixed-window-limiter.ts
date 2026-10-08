import type { Clock } from '../../shared/clock.ts';

export type HitResult = { allowed: boolean; limit: number; remaining: number; retryAfterSeconds: number };

// Above this many keys, inserting a new key first drops the expired windows.
const SWEEP_THRESHOLD = 10_000;

// In-memory fixed window per key (D-06). A key's window starts at its first hit and
// lasts windowMs; blocked hits do not extend it. The clock is injected so tests are
// deterministic.
export function createFixedWindowLimiter(opts: { max: number; windowMs: number; clock: Clock }) {
  const { max, windowMs, clock } = opts;
  if (!Number.isInteger(max) || max < 1) throw new RangeError('max must be an integer >= 1');
  if (!Number.isFinite(windowMs) || windowMs < 1) throw new RangeError('windowMs must be >= 1');
  const windows = new Map<string, { start: number; count: number }>();
  const expired = (start: number, now: number) => now >= start + windowMs;

  return {
    hit(key: string): HitResult {
      const now = clock.now().getTime();
      let window = windows.get(key);
      if (window && expired(window.start, now)) window = undefined;
      if (!window) {
        if (!windows.has(key) && windows.size >= SWEEP_THRESHOLD) {
          for (const [k, w] of windows) if (expired(w.start, now)) windows.delete(k);
        }
        window = { start: now, count: 0 };
        windows.set(key, window);
      }
      if (window.count >= max) {
        return { allowed: false, limit: max, remaining: 0, retryAfterSeconds: Math.ceil((window.start + windowMs - now) / 1000) };
      }
      window.count += 1;
      return { allowed: true, limit: max, remaining: max - window.count, retryAfterSeconds: 0 };
    },

    // Number of keys currently tracked (tests and diagnostics).
    size(): number {
      return windows.size;
    },
  };
}
