// Zod mirror of what the legacy API answers (spec 5.2). Independent from
// src/legacy-api on purpose: the published package does not contain the API.
import { z } from 'zod';

export const legacyCustomerSchema = z.object({
  cst_id: z.number().int().positive(),
  cst_nm: z.string(),
  cst_phn: z.string().regex(/^\d{10,11}$/),
  cst_eml: z.string(),
  cst_sts: z.enum(['A', 'I']),
  cst_seg: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  dt_cad: z.string().regex(/^\d{8}$/),
});
export type LegacyCustomer = z.infer<typeof legacyCustomerSchema>;

export const legacyListSchema = z.object({
  qtd: z.number().int().nonnegative(),
  dados: z.array(legacyCustomerSchema),
});

export const legacyMutationSchema = z.object({
  id: z.number().int().positive(),
  msg: z.string(),
});

export const legacyWhoamiSchema = z.object({
  tokenId: z.string(),
  name: z.string(),
  role: z.enum(['member', 'admin']),
});

export type LegacyWritable = { cst_nm: string; cst_phn: string; cst_eml: string; cst_sts: 'A' | 'I'; cst_seg: 1 | 2 | 3 };
