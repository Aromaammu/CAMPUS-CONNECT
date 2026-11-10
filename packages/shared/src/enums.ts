/** Enum values mirrored from prisma/schema.prisma, with the labels the UI shows. */
export const BATCH_MODES = { ONLINE: 'Online', OFFLINE: 'Offline', HYBRID: 'Hybrid' } as const;
export type BatchMode = keyof typeof BATCH_MODES;

export const BATCH_STATUS = { UPCOMING: 'Upcoming', RUNNING: 'Running', COMPLETED: 'Completed', CANCELLED: 'Cancelled' } as const;
export const SESSION_STATUS = { SCHEDULED: 'Scheduled', LIVE: 'Live now', COMPLETED: 'Completed', CANCELLED: 'Cancelled' } as const;
export const ENROLMENT_STATUS = { ACTIVE: 'Active', ON_HOLD: 'On hold', DROPPED: 'Dropped', COMPLETED: 'Completed', MOVED: 'Moved' } as const;
export const STUDENT_STATUS = { ACTIVE: 'Active', ON_HOLD: 'On hold', COMPLETED: 'Completed', DROPPED: 'Dropped' } as const;
export const USER_STATUS = { ACTIVE: 'Active', INACTIVE: 'Inactive' } as const;
export const COURSE_STATUS = { DRAFT: 'Draft', PUBLISHED: 'Published', RETIRED: 'Retired' } as const;
export const REQUEST_STATUS = { PENDING: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected', SENT_BACK: 'Sent back' } as const;

export const ATTENDANCE_STATUS = { PRESENT: 'Present', LATE: 'Late', ABSENT: 'Absent', EXCUSED: 'Excused' } as const;
export type AttendanceStatus = keyof typeof ATTENDANCE_STATUS;
export const ATTENDANCE_SOURCE = { AUTO: 'Automatic', CHECKIN: 'Check-in', MANUAL: 'Teacher', REQUEST: 'Request', ROSTER: 'Roster', NONE: 'Not marked' } as const;

export const PROJECT_STATUS = {
  NOT_SUBMITTED: 'Not submitted', SUBMITTED: 'Submitted', CHANGES_REQUESTED: 'Changes requested',
  TEACHER_APPROVED: 'Teacher approved', COMPLETED: 'Completed', REJECTED: 'Rejected',
} as const;

export const PAYMENT_METHODS = { CASH: 'Cash', UPI: 'UPI', BANK: 'Bank transfer', CARD: 'Card (POS)', CHEQUE: 'Cheque', DD: 'Demand draft' } as const;
export type PaymentMethod = keyof typeof PAYMENT_METHODS;
export const PAYMENT_STATUS = { VALID: 'Valid', VOID_PENDING: 'Void requested', VOIDED: 'Voided' } as const;
export const PAYMENT_KIND = { PAYMENT: 'Payment', REFUND: 'Refund', ADJUSTMENT: 'Adjustment' } as const;
export const DISCOUNT_STATUS = { NONE: 'No discount', PENDING: 'Waiting for approval', APPROVED: 'Approved', REJECTED: 'Rejected' } as const;

export const TICKET_CATEGORIES = { CLASS: 'Class', TECHNICAL: 'Technical', FEES: 'Fees', CERTIFICATE: 'Certificate', OTHER: 'Other' } as const;
export const TICKET_STATUS = { OPEN: 'Open', IN_PROGRESS: 'In progress', WAITING: 'Waiting on student', RESOLVED: 'Resolved', CLOSED: 'Closed' } as const;

export const CONVERSATION_KIND = { DIRECT: 'Direct', BATCH: 'Batch group', GROUP: 'Staff group' } as const;
export const RECORDING_STATUS = { PROCESSING: 'Processing', READY: 'Ready', FAILED: 'Failed' } as const;
export const FEEDBACK_KIND = {
  TEACHER_NOTE: 'Teacher feedback', TEACHER_MID: 'Mid-course feedback', TEACHER_END: 'End-of-course feedback',
  STUDENT_SESSION: 'Class rating', STUDENT_COURSE: 'Course feedback',
} as const;
