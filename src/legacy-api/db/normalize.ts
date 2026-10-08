// Search key for names: no accents (composed or decomposed input), lower case,
// single spaces, trimmed. Stored in cst_nm_norm and applied to the `nm` filter.
export function normalizeName(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Escapes LIKE wildcards for use with `ESCAPE '\'`.
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}
