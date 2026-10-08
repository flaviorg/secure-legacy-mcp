// Token counting for the comparison (spec 9.1): o200k_base, offline, plus the rough
// "4 characters per token" estimate.
import { encode } from 'gpt-tokenizer/encoding/o200k_base';

export function countTokens(text: string): { o200k: number; chars4: number } {
  return { o200k: encode(text).length, chars4: Math.ceil(text.length / 4) };
}
