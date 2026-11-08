import { z } from 'zod';

/** Indian mobile: 10 digits starting 6-9, optional +91 */
export const mobileSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, '').replace(/^\+?91(?=\d{10}$)/, ''))
  .refine((v) => /^[6-9]\d{9}$/.test(v), 'Enter a 10-digit Indian mobile number');

export const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email address');

export const passwordSchema = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(128)
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Use letters and at least one number');

export const loginSchema = z.object({
  identifier: z.string().trim().min(1, 'Enter your email or mobile number'),
  password: z.string().min(1, 'Enter your password'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().optional(),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
    consent: z.boolean().optional(),
    guardianConsent: z.boolean().optional(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, { message: 'The passwords do not match', path: ['confirmPassword'] });

export const forgotPasswordSchema = z.object({ identifier: z.string().trim().min(1, 'Enter your email or mobile number') });
export const resetPasswordSchema = z
  .object({ token: z.string().min(10), newPassword: passwordSchema, confirmPassword: z.string() })
  .refine((v) => v.newPassword === v.confirmPassword, { message: 'The passwords do not match', path: ['confirmPassword'] });

export const otpRequestSchema = z.object({ mobile: mobileSchema });
export const otpVerifySchema = z.object({ mobile: mobileSchema, code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') });

export const hhmmSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');
export const dateKeySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date')
  .refine((k) => {
    const d = new Date(`${k}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === k;
  }, 'That date does not exist');
export const idSchema = z.string().min(1);

export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  q: z.string().trim().optional(),
});
