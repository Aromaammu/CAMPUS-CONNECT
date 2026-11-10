import { Controller, Get, HttpCode, Module, NotFoundException, Post, Query } from '@nestjs/common';
import { ensureDemoClass } from '../../seed/live';
import { LiveGateway } from '../live/live.gateway';
import { liveRoomName } from '@cc/shared';
import { Public } from '../../common/auth';
import { PrismaService } from '../../common/prisma.service';
import { config } from '../../config';

/** Test mailbox: every captured email/SMS. Only exists outside production. */
@Controller('dev/mailbox')
export class MailboxController {
  constructor(private prisma: PrismaService) {}

  @Public()
  @Get()
  async list(@Query('to') to?: string, @Query('take') take = '50') {
    if (config.isProd) throw new NotFoundException();
    return this.prisma.outboundMessage.findMany({
      where: to ? { to: { contains: to, mode: 'insensitive' } } : undefined,
      orderBy: { createdAt: 'desc' },
      take: Math.min(Number(take) || 50, 200),
    });
  }
}

/** Developer tools (never in production): move the demo class to "now" so the class room can be tried any time. */
@Controller('dev')
export class DevToolsController {
  constructor(private prisma: PrismaService, private live: LiveGateway) {}

  @Public()
  @Post('demo-class')
  @HttpCode(200)
  async demoClass() {
    if (config.isProd) throw new NotFoundException();
    const r = await ensureDemoClass(this.prisma);
    await this.live.closeRoom(liveRoomName('session', r.sessionId)); // start from an empty room
    return r;
  }
}

@Module({ controllers: [MailboxController, DevToolsController] })
export class MailboxModule {}
