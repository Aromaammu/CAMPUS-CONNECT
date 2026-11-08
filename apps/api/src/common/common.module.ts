import { Global, Module } from '@nestjs/common';
import { SessionUserService } from './auth';
import { IdService } from './ids.service';

@Global()
@Module({ providers: [SessionUserService, IdService], exports: [SessionUserService, IdService] })
export class CommonModule {}
