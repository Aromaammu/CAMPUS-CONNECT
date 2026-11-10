import { Global, Module } from '@nestjs/common';
import { config } from '../../config';
import { FakeLiveGateway, LiveGateway, LiveKitGateway } from './live.gateway';
import { LiveController, LiveWebhookController } from './live.controller';
import { PollsController } from './polls.controller';
import { BoardsController } from './boards.controller';
import { LiveService } from './live.service';

@Global()
@Module({
  controllers: [LiveController, LiveWebhookController, PollsController, BoardsController],
  providers: [LiveService, { provide: LiveGateway, useClass: config.liveMode === 'fake' ? FakeLiveGateway : LiveKitGateway }],
  exports: [LiveService, LiveGateway],
})
export class LiveModule {}
