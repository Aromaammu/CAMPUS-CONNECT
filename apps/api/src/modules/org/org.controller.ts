import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, NotFoundException, Param, Post, Put, Query } from '@nestjs/common';
import { BRANCH_PERMISSIONS, SessionUser, departmentSchema, designationSchema } from '@cc/shared';
import { z } from 'zod';
import { CurrentUser, assertCan, can } from '../../common/org-access';
import { Zod } from '../../common/http';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../../common/audit.service';

/** branchId '' / undefined = head-office templates (only global People admins and the Super Admin). */
function checkOrg(user: SessionUser, branchId: string | null) {
  if (branchId) return assertCan(user, 'org.manage', branchId);
  if (!(user.kind === 'SUPER_ADMIN' || (user.kind === 'ADMIN' && can(user, 'org.manage')))) throw new ForbiddenException('Only head office can change templates');
}

@Controller('org')
export class OrgController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  @Get('structure')
  async structure(@CurrentUser() user: SessionUser, @Query('branchId') branchId?: string) {
    const b = branchId || null;
    if (b) {
      if (!can(user, 'org.manage', b) && !can(user, 'employees.view', b)) throw new ForbiddenException('You do not have access to this');
    } else if (user.kind === 'STUDENT') throw new ForbiddenException();
    const [departments, designations] = await Promise.all([
      this.prisma.department.findMany({ where: { branchId: b }, orderBy: { name: 'asc' }, include: { _count: { select: { employees: true } } } }),
      this.prisma.designation.findMany({ where: { branchId: b }, orderBy: { name: 'asc' }, include: { department: { select: { name: true } }, _count: { select: { employees: true } } } }),
    ]);
    return { departments, designations };
  }

  @Post('departments')
  async addDept(@CurrentUser() user: SessionUser, @Query('branchId') branchId: string | undefined, @Body(new Zod(departmentSchema)) body: z.infer<typeof departmentSchema>) {
    const b = branchId || null;
    checkOrg(user, b);
    const dept = await this.prisma.department.create({ data: { branchId: b, name: body.name } });
    await this.audit.record({ actorId: user.id, action: 'department.create', entity: 'Department', entityId: dept.id, branchId: b, summary: `Added department ${body.name}` });
    return dept;
  }

  @Put('departments/:id')
  async renameDept(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new Zod(departmentSchema)) body: z.infer<typeof departmentSchema>) {
    const dept = await this.prisma.department.findUnique({ where: { id } });
    if (!dept) throw new NotFoundException('Department not found');
    checkOrg(user, dept.branchId);
    const after = await this.prisma.department.update({ where: { id }, data: { name: body.name } });
    await this.audit.record({ actorId: user.id, action: 'department.update', entity: 'Department', entityId: id, branchId: dept.branchId, summary: `Renamed department ${dept.name} to ${body.name}` });
    return after;
  }

  @Delete('departments/:id')
  async removeDept(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    const dept = await this.prisma.department.findUnique({ where: { id }, include: { _count: { select: { employees: true, designations: true } } } });
    if (!dept) throw new NotFoundException('Department not found');
    checkOrg(user, dept.branchId);
    if (dept._count.employees || dept._count.designations) throw new BadRequestException('Move its employees and designations to another department first');
    await this.prisma.department.delete({ where: { id } });
    await this.audit.record({ actorId: user.id, action: 'department.delete', entity: 'Department', entityId: id, branchId: dept.branchId, summary: `Removed department ${dept.name}` });
    return { ok: true };
  }

  @Post('designations')
  async addDesig(@CurrentUser() user: SessionUser, @Query('branchId') branchId: string | undefined, @Body(new Zod(designationSchema)) body: z.infer<typeof designationSchema>) {
    const b = branchId || null;
    checkOrg(user, b);
    const permissions = body.permissions.filter((p) => (BRANCH_PERMISSIONS as string[]).includes(p));
    const des = await this.prisma.designation.create({ data: { branchId: b, name: body.name, departmentId: body.departmentId ?? null, permissions } });
    await this.audit.record({ actorId: user.id, action: 'designation.create', entity: 'Designation', entityId: des.id, branchId: b, summary: `Added designation ${body.name}`, after: des });
    return des;
  }

  @Put('designations/:id')
  async updateDesig(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new Zod(designationSchema)) body: z.infer<typeof designationSchema>) {
    const des = await this.prisma.designation.findUnique({ where: { id } });
    if (!des) throw new NotFoundException('Designation not found');
    checkOrg(user, des.branchId);
    const permissions = body.permissions.filter((p) => (BRANCH_PERMISSIONS as string[]).includes(p));
    const after = await this.prisma.designation.update({ where: { id }, data: { name: body.name, departmentId: body.departmentId ?? null, permissions } });
    await this.audit.record({ actorId: user.id, action: 'designation.update', entity: 'Designation', entityId: id, branchId: des.branchId, summary: `Changed designation ${after.name}`, before: des, after });
    return after;
  }

  @Delete('designations/:id')
  async removeDesig(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    const des = await this.prisma.designation.findUnique({ where: { id }, include: { _count: { select: { employees: true } } } });
    if (!des) throw new NotFoundException('Designation not found');
    checkOrg(user, des.branchId);
    if (des._count.employees) throw new BadRequestException('Employees still have this designation. Change them first.');
    await this.prisma.designation.delete({ where: { id } });
    await this.audit.record({ actorId: user.id, action: 'designation.delete', entity: 'Designation', entityId: id, branchId: des.branchId, summary: `Removed designation ${des.name}` });
    return { ok: true };
  }
}
