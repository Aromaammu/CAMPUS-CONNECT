import { Controller, Get, Module, NotFoundException, Query } from '@nestjs/common';
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

@Module({ controllers: [MailboxController] })
export class MailboxModule {}
