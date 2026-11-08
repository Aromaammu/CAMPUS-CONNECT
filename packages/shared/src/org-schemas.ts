import { z } from 'zod';
import { MODULE_KEYS, PERMISSION_KEYS } from './permissions';
import { dateKeySchema, emailSchema, mobileSchema } from './schemas';

const opt = <T extends z.ZodTypeAny>(s: T) => z.preprocess((v) => (v === '' || v === null ? undefined : v), s.optional());

export const branchSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z]{2,5}\d{2}$/, 'Use 2–5 letters and 2 digits, e.g. KOC01'),
  name: z.string().trim().min(3, 'Enter the branch name').max(120),
  address: opt(z.string().trim().max(300)),
  city: opt(z.string().trim().max(80)),
  state: opt(z.string().trim().max(80)),
  pin: opt(z.string().trim().regex(/^\d{6}$/, 'PIN code has 6 digits')),
  phone: opt(z.string().trim().max(20)),
  email: opt(emailSchema),
  gstin: opt(z.string().trim().toUpperCase().regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Enter a valid 15-character GSTIN')),
  openedOn: opt(dateKeySchema),
});
export type BranchInput = z.infer<typeof branchSchema>;
export const branchUpdateSchema = branchSchema.omit({ code: true });

export const roomSchema = z.object({
  name: z.string().trim().min(1, 'Enter a room name').max(60),
  capacity: z.coerce.number().int().min(1, 'At least 1').max(1000),
  active: z.boolean().default(true),
});

export const holidaySchema = z.object({
  date: dateKeySchema,
  name: z.string().trim().min(2, 'Enter the holiday name').max(100),
  branchId: opt(z.string()),
});

export const departmentSchema = z.object({ name: z.string().trim().min(2, 'Enter a name').max(60) });

export const designationSchema = z.object({
  name: z.string().trim().min(2, 'Enter a name').max(60),
  departmentId: opt(z.string()),
  permissions: z.array(z.enum(PERMISSION_KEYS as [string, ...string[]])).default([]),
});

export const adminSchema = z.object({
  name: z.string().trim().min(2, 'Enter the full name').max(100),
  email: emailSchema,
  mobile: mobileSchema,
  modules: z.array(z.enum(MODULE_KEYS as [string, ...string[]])).min(1, 'Choose at least one module'),
});
export const adminUpdateSchema = adminSchema.omit({ email: true, mobile: true }).extend({ email: emailSchema, mobile: mobileSchema });

export const employeeSchema = z.object({
  name: z.string().trim().min(2, 'Enter the full name').max(100),
  email: opt(emailSchema),
  mobile: mobileSchema,
  branchId: z.string().min(1, 'Choose a branch'),
  designationId: z.string().min(1, 'Choose a designation'),
  departmentId: opt(z.string()),
  joiningDate: opt(dateKeySchema),
  extraBranchIds: z.array(z.string()).default([]),
  extraPermissions: z.array(z.string()).default([]),
  removedPermissions: z.array(z.string()).default([]),
});
export type EmployeeInput = z.infer<typeof employeeSchema>;

export const studentSchema = z.object({
  name: z.string().trim().min(2, 'Enter the full name').max(100),
  email: opt(emailSchema),
  mobile: mobileSchema,
  branchId: z.string().min(1, 'Choose a branch'),
  dob: opt(dateKeySchema),
  address: opt(z.string().trim().max(300)),
  guardianName: opt(z.string().trim().max(100)),
  guardianPhone: opt(mobileSchema),
});
export type StudentInput = z.infer<typeof studentSchema>;

export const studentStatusSchema = z.object({ status: z.enum(['ACTIVE', 'ON_HOLD', 'COMPLETED', 'DROPPED']), note: opt(z.string().max(300)) });

/** Columns of the Excel bulk-upload templates (header text → field). */
export const STUDENT_IMPORT_COLUMNS = [
  { header: 'Full name', key: 'name', required: true },
  { header: 'Mobile', key: 'mobile', required: true },
  { header: 'Email', key: 'email' },
  { header: 'Date of birth (DD-MM-YYYY)', key: 'dob' },
  { header: 'Address', key: 'address' },
  { header: 'Guardian name', key: 'guardianName' },
  { header: 'Guardian mobile', key: 'guardianPhone' },
] as const;

export const EMPLOYEE_IMPORT_COLUMNS = [
  { header: 'Full name', key: 'name', required: true },
  { header: 'Mobile', key: 'mobile', required: true },
  { header: 'Email', key: 'email' },
  { header: 'Designation', key: 'designation', required: true },
  { header: 'Joining date (DD-MM-YYYY)', key: 'joiningDate' },
] as const;

/** "15-08-2005" or Excel date → "2005-08-15" */
export function parseDdMmYyyy(v: unknown): string | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  const key = m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  return key && isRealDate(key) ? key : 'invalid';
}

/** "2026-02-30" is not a real date. */
export function isRealDate(key: string): boolean {
  const d = new Date(`${key}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === key;
}
