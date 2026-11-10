import { PublicModule } from './public/public.controller';
import { OrgModule } from './org/org.module';
import { AdminModule } from './admin/admin.controllers';
import { NotifyModule } from './notifications/notify.service';
import { AcademicsModule } from './academics/academics.module';
import { LiveModule } from './live/live.module';

// Feature modules are registered here as each phase adds them.
export const FEATURE_MODULES: (new () => unknown)[] = [PublicModule, NotifyModule, OrgModule, AdminModule, AcademicsModule, LiveModule];
