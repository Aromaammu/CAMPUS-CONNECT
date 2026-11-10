import { BadRequestException, Controller, ForbiddenException, Get, Param, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SessionUser, formatTime } from '@cc/shared';
import { CurrentUser } from '../../common/auth';
import { FilesService } from '../../common/files.service';
import { PrismaService } from '../../common/prisma.service';
import { LiveService } from './live.service';

/** "Save the board to the class materials" (PRD §7.2). */
@Controller('live/sessions/:id/boards')
export class BoardsController {
  constructor(private live: LiveService, private files: FilesService, private prisma: PrismaService) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024 } }))
  async save(@CurrentUser() user: SessionUser, @Param('id') id: string, @UploadedFile() file?: Express.Multer.File) {
    const a = await this.live.access(user, id);
    if (a.role !== 'teacher') throw new ForbiddenException('Only the teacher can save the board');
    if (!file) throw new BadRequestException('Nothing to save');
    const s = a.session;
    const count = await this.prisma.material.count({ where: { sessionId: id, kind: 'WHITEBOARD' } });
    return this.prisma.$transaction(async (tx) => {
      const f = await this.files.save(file, { purpose: 'material', userId: user.id, kinds: ['image'], maxMb: 15 }, tx);
      return tx.material.create({
        data: {
          courseId: s.batch.courseId, sessionId: id, kind: 'WHITEBOARD', fileId: f.id, uploadedById: user.id,
          title: `Whiteboard ${count + 1} · ${s.batch.name} class ${s.position} (${formatTime(new Date())})`,
          shares: { create: { batchId: s.batchId } },
        },
      });
    });
  }

  /** Saved boards with short-lived links; students of the batch, teachers and branch staff. */
  @Get()
  async list(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    await this.live.access(user, id);
    const rows = await this.prisma.material.findMany({ where: { sessionId: id, kind: 'WHITEBOARD' }, orderBy: { createdAt: 'asc' } });
    return rows.map((m) => ({ id: m.id, title: m.title, createdAt: m.createdAt, url: m.fileId ? this.files.signedUrl(m.fileId, user.id) : null }));
  }
}
