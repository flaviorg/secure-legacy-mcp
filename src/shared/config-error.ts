export type ConfigIssue = { path: string; message: string };

// Raised by the API and MCP config loaders. The message lists variable names only,
// never their values, so it is safe to print even when a secret is malformed.
export class ConfigError extends Error {
  readonly issues: ConfigIssue[];

  constructor(issues: ConfigIssue[]) {
    super(`Invalid configuration: ${issues.map((i) => i.path).join(', ')}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}
