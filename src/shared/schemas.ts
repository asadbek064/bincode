// Server-side validation schemas. The client only imports types/constants, so zod stays out of the bundle.
import { z } from 'zod';
import { DEFAULT_TITLE, LIMITS } from './constants.ts';

export const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(LIMITS.emailMax));

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(LIMITS.passwordMax),
});

export const newPasswordSchema = z.string().min(LIMITS.newPasswordMin).max(LIMITS.passwordMax);

const titleSchema = z
  .string()
  .trim()
  .max(LIMITS.titleMax)
  .transform((t) => t || DEFAULT_TITLE);

const codeSchema = z.string().max(LIMITS.codeMax);

function checkCodeSize(v: { html?: string; css?: string; js?: string }, ctx: z.RefinementCtx) {
  const size = (v.html?.length ?? 0) + (v.css?.length ?? 0) + (v.js?.length ?? 0);
  if (size > LIMITS.codeMax) {
    ctx.addIssue({ code: 'custom', message: `Combined code exceeds ${LIMITS.codeMax} characters`, path: [] });
  }
}

export const snippetInputSchema = z
  .object({
    title: titleSchema.default(DEFAULT_TITLE),
    html: codeSchema.default(''),
    css: codeSchema.default(''),
    js: codeSchema.default(''),
  })
  .superRefine(checkCodeSize);

export const forkInputSchema = z
  .object({
    title: titleSchema.optional(),
    html: codeSchema.optional(),
    css: codeSchema.optional(),
    js: codeSchema.optional(),
  })
  .superRefine(checkCodeSize);
