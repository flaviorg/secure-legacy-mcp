// Single source of the service token format: `slm_` + 8 chars of [a-z0-9] (public id)
// + `_` + 43 chars of base64url (secret). Shared by the legacy API and the MCP server.
export const TOKEN_REGEX = /^slm_([a-z0-9]{8})_([A-Za-z0-9_-]{43})$/;

// Unanchored variant used for masking. It swallows the whole base64url run after the
// id, whatever its length, so a token pasted with a missing or an extra character is
// never partially echoed either.
const TOKEN_ANYWHERE = /slm_([a-z0-9]{8})_[A-Za-z0-9_-]+/g;

export function isServiceToken(value: string): boolean {
  return TOKEN_REGEX.test(value);
}

export function tokenIdOf(value: string): string | null {
  return TOKEN_REGEX.exec(value)?.[1] ?? null;
}

export function maskTokens(text: string): string {
  return text.replace(TOKEN_ANYWHERE, (_match, id: string) => `slm_${id}_***`);
}
