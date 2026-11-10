import { Global, Module } from '@nestjs/common';
import { SessionUserService } from './auth';
import { FilesController, FilesService, LocalDiskStorage, Storage } from './files.service';
import { IdService } from './ids.service';
import { JobsService } from './jobs.service';

@Global()
@Module({
  controllers: [FilesController],
  providers: [SessionUserService, IdService, FilesService, JobsService, { provide: Storage, useClass: LocalDiskStorage }],
  exports: [SessionUserService, IdService, FilesService, JobsService, Storage],
})
export class CommonModule {}
