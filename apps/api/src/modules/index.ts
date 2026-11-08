import { PublicModule } from './public/public.controller';
import { OrgModule } from './org/org.module';
import { AdminModule } from './admin/admin.controllers';

// Feature modules are registered here as each phase adds them.
export const FEATURE_MODULES: (new () => unknown)[] = [PublicModule, OrgModule, AdminModule];
