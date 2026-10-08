import { redact } from './redact.ts';
import { systemClock } from './clock.ts';
import type { Clock } from './clock.ts';

type Level = 'debug' | 'info' | 'warn' | 'error' | 'fatal';
export type ConfigLevel = Exclude<Level, 'fatal'>; // LOG_LEVEL accepts only these; fatal is always written
export type Logger = {
  debug(event: string, fields?: Record<string, unknown>): void;
  info(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
  error(event: string, fields?: Record<string, unknown>): void;
  fatal(event: string, fields?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
};

type LoggerOptions = {
  component: 'mcp'; // the only writer of JSON log lines; the API logs through pino
  level: ConfigLevel;
  write?: (line: string) => void;
  clock?: Clock;
};

const SEVERITY: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40, fatal: 50 };

// One JSON line per event, written to stderr by default (stdout belongs to JSON-RPC).
export function createLogger(opts: LoggerOptions): Logger {
  const write = opts.write ?? ((line: string) => { process.stderr.write(line); });
  const clock = opts.clock ?? systemClock;
  const threshold = SEVERITY[opts.level];

  const build = (bound: Record<string, unknown>): Logger => {
    const emit = (level: Level, event: string, fields?: Record<string, unknown>) => {
      if (level !== 'fatal' && SEVERITY[level] < threshold) return;
      const core = { ts: clock.now().toISOString(), level, component: opts.component, event };
      // Core keys stay first and cannot be overridden by bound or call fields.
      const entry = Object.assign({}, core, bound, fields, core);
      write(JSON.stringify(redact(entry)) + '\n');
    };
    return {
      debug: (event, fields) => emit('debug', event, fields),
      info: (event, fields) => emit('info', event, fields),
      warn: (event, fields) => emit('warn', event, fields),
      error: (event, fields) => emit('error', event, fields),
      fatal: (event, fields) => emit('fatal', event, fields),
      child: (fields) => build({ ...bound, ...fields }),
    };
  };

  return build({});
}
