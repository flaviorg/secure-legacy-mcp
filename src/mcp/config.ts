// MCP server configuration (spec 5.8). Receives the environment as a parameter: only
// main.ts reads process.env.
import { z } from 'zod';
import { ConfigError } from '../shared/config-error.ts';
import type { ConfigIssue } from '../shared/config-error.ts';
import type { ConfigLevel } from '../shared/logger.ts';
import { isServiceToken } from '../shared/token-pattern.ts';

export type McpConfig = { serviceToken: string; legacyApiUrl: string; timeoutMs: number; logLevel: ConfigLevel };

export const MCP_ENV_KEYS = ['SERVICE_TOKEN', 'LEGACY_API_URL', 'LEGACY_API_TIMEOUT_MS', 'LOG_LEVEL'] as const;

// fetch refuses a URL with user:password, and the URL goes to the startup log. Zod
// runs this check even after the URL check failed, so an unparsable value passes here.
const withoutCredentials = (value: string) => {
  const url = URL.parse(value);
  return url === null || (url.username === '' && url.password === '');
};

// Every message below is fixed text: none of them can carry the received value.
const schema = z.object({
  SERVICE_TOKEN: z.string({ error: 'Required' })
    .refine(isServiceToken, { error: 'Must be a service token in the format slm_<id>_<secret>' }),
  LEGACY_API_URL: z.url({ protocol: /^https?$/, error: 'Must be an http(s) URL' })
    .refine(withoutCredentials, { error: 'Must not contain credentials (user:password@)' })
    .transform((url) => url.replace(/\/+$/, ''))
    .default('http://127.0.0.1:9999'),
  LEGACY_API_TIMEOUT_MS: z.string()
    .regex(/^\d+$/, { error: 'Expected an integer' })
    .transform(Number)
    .pipe(z.number().int().min(500, { error: 'Must be between 500 and 30000' }).max(30_000, { error: 'Must be between 500 and 30000' }))
    .default(5000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error'], { error: 'Must be one of debug, info, warn, error' }).default('info'),
});

// Values are trimmed (a token pasted from a terminal often ends with a newline) and an
// empty value counts as unset. Throws ConfigError with one issue per invalid variable.
export function loadMcpConfig(env: Record<string, string | undefined>): McpConfig {
  const input = Object.fromEntries(MCP_ENV_KEYS.map((key) => {
    const value = env[key]?.trim();
    return [key, value === '' ? undefined : value];
  }));
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const issues = new Map<string, ConfigIssue>();
    for (const issue of parsed.error.issues) {
      const path = String(issue.path[0] ?? '(root)');
      if (!issues.has(path)) issues.set(path, { path, message: issue.message });
    }
    throw new ConfigError([...issues.values()]);
  }
  const e = parsed.data;
  return { serviceToken: e.SERVICE_TOKEN, legacyApiUrl: e.LEGACY_API_URL, timeoutMs: e.LEGACY_API_TIMEOUT_MS, logLevel: e.LOG_LEVEL };
}
