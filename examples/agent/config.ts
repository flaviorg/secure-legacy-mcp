// Agent configuration (spec 5.8): which chat model the example uses. The only file of
// examples/ that reads process.env; everything else receives the config as a value.
import { ConfigError } from '../../src/shared/config-error.ts';
import type { ConfigIssue } from '../../src/shared/config-error.ts';

export type AgentConfig = { provider: 'fake' | 'openrouter'; apiKey?: string; model: string };

export const AGENT_ENV_KEYS = ['LLM_PROVIDER', 'OPENROUTER_API_KEY', 'OPENROUTER_MODEL'] as const;

const DEFAULT_MODEL = 'openrouter/free';

// fake by default; openrouter when a key exists and LLM_PROVIDER is unset; openrouter
// without a key fails early. Values are trimmed and an empty value counts as unset.
// Messages name the variable, never its value.
export function loadAgentConfig(env: Record<string, string | undefined>): AgentConfig {
  const read = (key: (typeof AGENT_ENV_KEYS)[number]) => {
    const value = env[key]?.trim();
    return value === '' ? undefined : value;
  };
  const requested = read('LLM_PROVIDER');
  const apiKey = read('OPENROUTER_API_KEY');
  const model = read('OPENROUTER_MODEL') ?? DEFAULT_MODEL;
  const issues: ConfigIssue[] = [];
  if (requested !== undefined && requested !== 'fake' && requested !== 'openrouter') {
    issues.push({ path: 'LLM_PROVIDER', message: 'Must be fake or openrouter' });
  }
  const provider = requested === 'fake' || requested === 'openrouter' ? requested : apiKey !== undefined ? 'openrouter' : 'fake';
  if (provider === 'openrouter' && apiKey === undefined) {
    issues.push({ path: 'OPENROUTER_API_KEY', message: 'Required when LLM_PROVIDER is openrouter' });
  }
  if (issues.length > 0) throw new ConfigError(issues);
  return provider === 'openrouter' ? { provider, apiKey, model } : { provider, model };
}

// For the example entrypoints (demo.ts): the process environment, read here only.
export function loadAgentConfigFromProcessEnv(): AgentConfig {
  return loadAgentConfig(process.env);
}
