// Network guard for npm test (spec 6.2, item 9). Importing this module patches
// net.Socket.prototype.connect so that only loopback hosts and file sockets connect.
// Loaded with `--import` by the npm test scripts and, in MCP child processes,
// through NODE_OPTIONS built by guardNodeOptions().
import net from 'node:net';

const MARK = Symbol.for('secure-legacy-mcp.noNetwork');
const ALLOWED_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

type ConnectOptions = { host?: unknown; hostname?: unknown; path?: unknown };
type Target = { kind: 'file' } | { kind: 'tcp'; host: string };

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const stripBrackets = (host: string) => (host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host);

function targetOf(args: unknown[]): Target {
  // connect([options, cb]): internal normalized form used by net.createConnection, http and undici.
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  if (first !== null && typeof first === 'object') {
    const options = first as ConnectOptions;
    if (isNonEmptyString(options.path)) return { kind: 'file' };
    const host = options.host ?? options.hostname ?? 'localhost';
    return { kind: 'tcp', host: stripBrackets(String(host)) };
  }
  // connect(path[, cb]): a non-numeric string is a Unix socket or pipe path.
  if (isNonEmptyString(first) && Number.isNaN(Number(first))) return { kind: 'file' };
  // connect(port[, host][, cb])
  const host = typeof args[1] === 'string' ? args[1] : 'localhost';
  return { kind: 'tcp', host: stripBrackets(host) };
}

const globals = globalThis as Record<symbol, unknown>;

if (!globals[MARK]) {
  globals[MARK] = true;
  const original = net.Socket.prototype.connect as (this: net.Socket, ...args: unknown[]) => net.Socket;

  const guarded = function connect(this: net.Socket, ...args: unknown[]): net.Socket {
    const target = targetOf(args);
    if (target.kind === 'file' || ALLOWED_HOSTS.has(target.host)) return original.apply(this, args);
    const err = Object.assign(new Error(`no-network guard: blocked connection to ${target.host}`), { code: 'NO_NETWORK' });
    process.nextTick(() => this.destroy(err));
    return this;
  };

  net.Socket.prototype.connect = guarded as typeof net.Socket.prototype.connect;
}
