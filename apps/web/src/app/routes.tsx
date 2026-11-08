import type { ReactElement } from 'react';

export interface AppRoute { path: string; element: ReactElement }

/** Pages inside the main layout. Each phase adds its routes here. */
export const APP_ROUTES: AppRoute[] = [];

/** Pages that take the whole screen (live class room, recording player). */
export const FULLSCREEN_ROUTES: AppRoute[] = [];
