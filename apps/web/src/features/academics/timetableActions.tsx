import type { ReactNode } from 'react';
import type { TTItem } from './TimetablePage';

/** Buttons on timetable rows (Join live class…), registered by Phase 3. */
export const TIMETABLE_ACTIONS: ((p: { item: TTItem }) => ReactNode)[] = [];
