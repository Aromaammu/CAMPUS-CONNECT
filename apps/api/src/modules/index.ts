import { PublicModule } from './public/public.controller';

// Feature modules are registered here as each phase adds them.
export const FEATURE_MODULES: (new () => unknown)[] = [PublicModule];
