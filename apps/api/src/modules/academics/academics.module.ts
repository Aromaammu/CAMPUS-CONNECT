import { Global, Module } from '@nestjs/common';
import { AcademicsService } from './academics.service';
import { BatchHooks } from './batch-hooks';
import { BatchesController } from './batches.controller';
import { CourseRequestsController, CoursesController } from './courses.controller';
import { TimetableController } from './timetable.controller';

@Global()
@Module({
  controllers: [CoursesController, CourseRequestsController, BatchesController, TimetableController],
  providers: [AcademicsService, BatchHooks],
  exports: [AcademicsService, BatchHooks],
})
export class AcademicsModule {}
