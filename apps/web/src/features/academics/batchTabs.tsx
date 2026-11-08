import type { ReactNode } from 'react';
import type { BatchDetail } from './types';

/** Extra tabs on the batch page (materials, attendance, recordings, chat…), registered by later phases. */
export interface BatchTab { id: string; label: string; show: (b: BatchDetail) => boolean; render: (b: BatchDetail) => ReactNode }
export const BATCH_TABS: BatchTab[] = [];

/** Buttons on each class row (Join, Attendance…), registered by the live-class phases. */
export const SESSION_ACTIONS: ((p: { batch: BatchDetail; session: import('./types').SessionRow }) => ReactNode)[] = [];
