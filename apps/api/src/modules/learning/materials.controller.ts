import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, Post, Put, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { MaterialInput, SessionUser, can, materialSchema, materialShareSchema } from '@cc/shared';
import { CurrentUser } from '../../common/auth';
import { FilesService } from '../../common/files.service';
import { Zod } from '../../common/http';
import { PrismaService } from '../../common/prisma.service';
import { SettingsService } from '../../common/settings.service';
import { AcademicsService } from '../academics/academics.service';
import { NotifyService } from '../notifications/notify.service';
import { z } from 'zod';

const materialSchemaFile = z.object({ fileId: z.string().optional() });

/** PRD §9.1 notes and materials. */
@Controller()
export class MaterialsController {
  constructor(private prisma: PrismaService, private acad: AcademicsService, private files: FilesService, private settings: SettingsService, private notify: NotifyService) {}

  /** Teachers manage materials of batches they teach; Branch Admins of every batch in their branch. */
  async canManage(user: SessionUser, b: { id: string; branchId: string }) {
    if (!can(user, 'materials.manage', b.branchId)) return false;
    return can(user, 'batches.manage', b.branchId) || (await this.acad.isTeacher(user, b.id));
  }

  @Get('batches/:id/materials')
  async forBatch(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    const b = await this.acad.batchOr404(id);
    await this.acad.assertViewBatch(user, b);
    const manage = await this.canManage(user, b);
    const rows = await this.prisma.material.findMany({
      where: { shares: { some: { batchId: id } } },
      include: { module: { select: { id: true, position: true, title: true } }, session: { select: { id: true, position: true, startsAt: true } }, shares: { select: { batchId: true } } },
      orderBy: [{ createdAt: 'desc' }],
    });
    const fileIds = rows.map((r) => r.fileId).filter((x): x is string => !!x);
    const files = await this.prisma.fileObject.findMany({ where: { id: { in: fileIds } }, select: { id: true, name: true, mime: true, sizeBytes: true } });
    const modules = await this.prisma.courseModule.findMany({ where: { courseId: b.courseId }, orderBy: { position: 'asc' }, select: { id: true, position: true, title: true } });
    return {
      canManage: manage, modules,
      rows: rows.map((m) => ({ ...m, file: files.find((f) => f.id === m.fileId) ?? null, canDelete: manage && (m.uploadedById === user.id || can(user, 'batches.manage', b.branchId)) })),
    };
  }

  /** Short-lived link to open or download a material. */
  @Get('materials/:id/open')
  async open(@CurrentUser() user: SessionUser, @Param('id') id: string, @Query('download') download?: string) {
    const m = await this.prisma.material.findUnique({ where: { id }, include: { shares: { include: { batch: { select: { id: true, branchId: true } } } } } });
    if (!m) throw new NotFoundException('Material not found');
    let ok = false;
    for (const s of m.shares) {
      try { await this.acad.assertViewBatch(user, s.batch); ok = true; break; } catch { /* try the next batch */ }
    }
    if (!ok) throw new ForbiddenException('This material is not shared with your batch');
    if (m.url) return { url: m.url, external: true };
    if (!m.fileId) throw new NotFoundException('No file');
    return { url: this.files.signedUrl(m.fileId, user.id, { download: download === '1' }), external: false };
  }

  /** Step 1 of a file upload: PDF, slides, documents, images, zip, text, video; size limit from Settings. */
  @Post('materials/upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 1024 * 1024 * 1024 } }))
  async upload(@CurrentUser() user: SessionUser, @UploadedFile() file?: Express.Multer.File) {
    if (!user.permissions.includes('materials.manage')) throw new ForbiddenException('You cannot upload materials');
    const f = await this.files.save(file, { purpose: 'material', userId: user.id, kinds: ['pdf', 'office', 'image', 'text', 'video'] });
    return { id: f.id, name: f.name, sizeBytes: f.sizeBytes };
  }

  /** Batches of a course this person may share materials with (picker). */
  @Get('materials/batches')
  async shareable(@CurrentUser() user: SessionUser, @Query('batchId') batchId: string) {
    const b = await this.acad.batchOr404(batchId);
    const all = await this.prisma.batch.findMany({ where: { courseId: b.courseId, status: { not: 'CANCELLED' } }, include: { branch: { select: { code: true } } }, orderBy: { name: 'asc' } });
    const out = [];
    for (const x of all) if (await this.canManage(user, x)) out.push({ id: x.id, name: x.name, branch: x.branch.code });
    return out;
  }

  @Post('materials')
  async create(@CurrentUser() user: SessionUser, @Body(new Zod(materialSchema.and(materialSchemaFile))) body: MaterialInput & { fileId?: string }) {
    if (!body.url === !body.fileId) throw new BadRequestException('Add a link or upload a file');
    const batches = await this.prisma.batch.findMany({ where: { id: { in: body.batchIds } } });
    if (batches.length !== new Set(body.batchIds).size) throw new BadRequestException('Batch not found');
    const courseId = batches[0].courseId;
    if (batches.some((b) => b.courseId !== courseId)) throw new BadRequestException('Materials can only be shared with batches of the same course');
    for (const b of batches) if (!(await this.canManage(user, b))) throw new ForbiddenException(`You cannot add materials to ${b.name}`);
    if (body.sessionId) {
      const s = await this.prisma.session.findUnique({ where: { id: body.sessionId } });
      if (!s || !body.batchIds.includes(s.batchId)) throw new BadRequestException('That class is not in the chosen batch');
    }
    if (body.moduleId && !(await this.prisma.courseModule.findFirst({ where: { id: body.moduleId, courseId } }))) throw new BadRequestException('That module is not in this course');
    if (body.fileId) {
      const f = await this.prisma.fileObject.findUnique({ where: { id: body.fileId } });
      if (!f || f.uploadedById !== user.id || f.purpose !== 'material') throw new BadRequestException('Upload the file again');
    }
    const m = await this.prisma.material.create({
      data: {
        courseId, title: body.title, kind: body.fileId ? 'FILE' : 'LINK', fileId: body.fileId ?? null, url: body.url ?? null,
        sessionId: body.sessionId ?? null, moduleId: body.moduleId ?? null, uploadedById: user.id,
        shares: { create: body.batchIds.map((batchId) => ({ batchId })) },
      },
    });
    const students = await this.prisma.enrolment.findMany({ where: { batchId: { in: body.batchIds }, status: 'ACTIVE' }, select: { batchId: true, student: { select: { userId: true } } } });
    for (const b of batches) {
      await this.notify.sendMany(students.filter((s) => s.batchId === b.id).map((s) => s.student.userId), { type: 'N8', title: `New material in ${b.name}: ${body.title}`, link: `/learn/courses/${b.id}` });
    }
    return m;
  }

  @Put('materials/:id/shares')
  async share(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new Zod(materialShareSchema)) body: { batchIds: string[] }) {
    const m = await this.prisma.material.findUnique({ where: { id }, include: { shares: { include: { batch: true } } } });
    if (!m) throw new NotFoundException('Material not found');
    const target = await this.prisma.batch.findMany({ where: { id: { in: body.batchIds } } });
    if (target.some((b) => b.courseId !== m.courseId)) throw new BadRequestException('Materials can only be shared with batches of the same course');
    // You may only add or remove batches you manage; other batches' shares stay as they are.
    const keep: string[] = [];
    for (const s of m.shares) if (!(await this.canManage(user, s.batch))) keep.push(s.batchId);
    for (const b of target) if (!keep.includes(b.id) && !(await this.canManage(user, b))) throw new ForbiddenException(`You cannot share with ${b.name}`);
    if (!m.shares.some((s) => !keep.includes(s.batchId)) && !target.length) throw new ForbiddenException('You do not manage this material');
    const next = [...new Set([...keep, ...target.map((b) => b.id)])];
    await this.prisma.$transaction([
      this.prisma.materialShare.deleteMany({ where: { materialId: id } }),
      this.prisma.materialShare.createMany({ data: next.map((batchId) => ({ materialId: id, batchId })) }),
    ]);
    return { batchIds: next };
  }

  @Delete('materials/:id')
  async remove(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    const m = await this.prisma.material.findUnique({ where: { id }, include: { shares: { include: { batch: true } } } });
    if (!m) throw new NotFoundException('Material not found');
    const isAdmin = m.shares.some((s) => can(user, 'batches.manage', s.batch.branchId) && can(user, 'materials.manage', s.batch.branchId));
    if (m.uploadedById !== user.id && !isAdmin) throw new ForbiddenException('Only the person who added it or the Branch Admin can delete it');
    await this.prisma.material.delete({ where: { id } });
    if (m.fileId) await this.files.remove(m.fileId);
    return { ok: true };
  }

  /** T6: everything I uploaded. */
  @Get('teach/materials')
  async mine(@CurrentUser() user: SessionUser) {
    const rows = await this.prisma.material.findMany({
      where: { uploadedById: user.id },
      include: { shares: { include: { batch: { select: { id: true, name: true, branch: { select: { code: true } } } } } }, course: { select: { name: true } }, module: { select: { title: true } } },
      orderBy: { createdAt: 'desc' }, take: 300,
    });
    return rows;
  }
}
