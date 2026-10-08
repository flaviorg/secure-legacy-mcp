import test from 'node:test';
import assert from 'node:assert/strict';
import { createFixedWindowLimiter } from '../../src/legacy-api/rate-limit/fixed-window-limiter.ts';
import { fixedClock } from '../../src/shared/clock.ts';

test('[SEC-05] allows max hits per window, then blocks with retryAfterSeconds, then resets', () => {
  const clock = fixedClock('2026-10-04T12:00:00.000Z');
  const limiter = createFixedWindowLimiter({ max: 3, windowMs: 60_000, clock });
  assert.deepEqual([1, 2, 3].map(() => limiter.hit('k').remaining), [2, 1, 0]);
  assert.deepEqual(limiter.hit('k'), { allowed: false, limit: 3, remaining: 0, retryAfterSeconds: 60 });
  clock.advance(59_001);
  assert.equal(limiter.hit('k').retryAfterSeconds, 1);
  clock.advance(1_000);
  assert.deepEqual(limiter.hit('k'), { allowed: true, limit: 3, remaining: 2, retryAfterSeconds: 0 });
});

test('[SEC-05] keys are independent', () => {
  const limiter = createFixedWindowLimiter({ max: 1, windowMs: 60_000, clock: fixedClock('2026-10-04T12:00:00.000Z') });
  assert.equal(limiter.hit('a').allowed, true);
  assert.equal(limiter.hit('a').allowed, false);
  assert.equal(limiter.hit('b').allowed, true);
});

test('expired windows are swept once the map holds more than 10 000 keys', () => {
  const clock = fixedClock('2026-10-04T12:00:00.000Z');
  const limiter = createFixedWindowLimiter({ max: 1, windowMs: 1_000, clock });
  for (let i = 0; i < 10_000; i++) limiter.hit(`old-${i}`);
  assert.equal(limiter.size(), 10_000);
  clock.advance(1_000);
  limiter.hit('fresh');
  assert.equal(limiter.size(), 1);
  assert.equal(limiter.hit('fresh').allowed, false);
});

// Known property of a fixed window, documented in docs/security.md and ADR 0004: a
// burst at the end of one window plus a burst at the start of the next one lets up to
// 2 x max hits through within a few milliseconds. Accepted for an API on 127.0.0.1.
test('a burst across the window edge can reach 2 x max (documented limitation)', () => {
  const clock = fixedClock('2026-10-04T12:00:00.000Z');
  const limiter = createFixedWindowLimiter({ max: 90, windowMs: 60_000, clock });
  limiter.hit('k');
  clock.advance(59_999);
  const allowed = () => Array.from({ length: 100 }, () => limiter.hit('k').allowed).filter(Boolean).length;
  assert.equal(allowed(), 89);
  clock.advance(1);
  assert.equal(allowed(), 90);
});
