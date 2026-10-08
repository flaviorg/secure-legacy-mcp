// Entrypoint of the MCP server (spec 4.2 and 6.2): `node src/mcp/main.ts`, `npm run -s mcp`
// and the package binary. stdout carries JSON-RPC only; every log line goes to stderr.
import { writeSync } from 'node:fs';
import { format } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ConfigError } from '../shared/config-error.ts';
import { createLogger } from '../shared/logger.ts';
import type { Logger } from '../shared/logger.ts';
import { tokenIdOf } from '../shared/token-pattern.ts';
import { createCustomerService } from './application/customer-service.ts';
import { loadMcpConfig } from './config.ts';
import type { McpConfig } from './config.ts';
import { createLegacyCustomerGateway } from './infrastructure/legacy-customer-gateway.ts';
import { createMcpServer } from './server.ts';
import { VERSION } from './version.ts';

let logger: Logger = createLogger({ component: 'mcp', level: 'info' });

// Crash path only: a synchronous write, so the fatal line survives process.exit.
const crashLogger = createLogger({
  component: 'mcp',
  level: 'error',
  write: (line) => {
    try {
      writeSync(2, line);
    } catch {
      process.stderr.write(line);
    }
  },
});

// Exits once everything queued on stderr has been written (process.exit alone can
// truncate an asynchronous pipe). The timer is a fallback and does not hold the loop.
function exitAfterFlush(code: number): void {
  process.exitCode = code;
  process.stderr.write('', () => process.exit(code));
  setTimeout(() => process.exit(code), 1000).unref();
}

// 1. Defense in depth for the stdout channel: stray console output and Node warnings
//    become log lines on stderr.
const toLog = (level: 'info' | 'debug') => (...args: unknown[]) => { logger[level]('console', { message: format(...args) }); };
console.log = toLog('info');
console.info = toLog('info');
console.debug = toLog('debug');
process.removeAllListeners('warning');
process.on('warning', (warning) => { logger.warn('node_warning', { name: warning.name, message: warning.message }); });
process.on('uncaughtException', (err) => { crashLogger.fatal('uncaught_exception', { error: err }); process.exit(1); });
process.on('unhandledRejection', (reason) => { crashLogger.fatal('unhandled_rejection', { error: reason }); process.exit(1); });

// 2. Fail early: without a valid configuration, report the variable names (never the
//    values) and exit 1 before any transport exists. stdout stays empty.
let config: McpConfig | undefined;
try {
  config = loadMcpConfig(process.env);
} catch (err) {
  if (!(err instanceof ConfigError)) throw err;
  logger.fatal('config_invalid', { issues: err.issues });
  process.exitCode = 1;
}

if (config !== undefined) {
  logger = createLogger({ component: 'mcp', level: config.logLevel });
  const gateway = createLegacyCustomerGateway({
    baseUrl: config.legacyApiUrl,
    token: config.serviceToken,
    timeoutMs: config.timeoutMs,
    logger,
    userAgent: `secure-legacy-mcp/${VERSION}`,
  });
  const service = createCustomerService({ gateway });
  const server = createMcpServer({ service, logger, version: VERSION, apiBaseUrl: config.legacyApiUrl });
  server.server.onerror = (err) => { logger.error('protocol_error', { error: err }); };

  // 3. Graceful shutdown on signals and when the client closes stdin.
  let closing = false;
  const shutdown = async (reason: string) => {
    if (closing) return;
    closing = true;
    logger.info('shutdown', { reason });
    try {
      await server.close();
    } finally {
      exitAfterFlush(0);
    }
  };
  process.on('SIGINT', () => { void shutdown('SIGINT'); });
  process.on('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.stdin.once('end', () => { void shutdown('stdin_closed'); });

  await server.connect(new StdioServerTransport());
  logger.info('startup', { version: VERSION, apiBaseUrl: config.legacyApiUrl, tokenId: tokenIdOf(config.serviceToken) });
}
