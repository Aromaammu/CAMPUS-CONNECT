import {
  CanActivate, ExecutionContext, ForbiddenException, Injectable, SetMetadata, UnauthorizedException, createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Permission, SessionUser, UserKind, can, permissionsForModules, PERMISSION_KEYS, ModuleKey, MODULE_KEYS } from '@cc/shared';
import jwt from 'jsonwebtoken';
import type { Request } from 'express';
import { config } from '../config';
import { PrismaService } from './prisma.service';

export const ACCESS_COOKIE = 'cc_at';
export const REFRESH_COOKIE = 'cc_rt';

const PUBLIC = 'cc:public';
const PERMS = 'cc:perms';
const KINDS = 'cc:kinds';
const ALLOW_MUST_CHANGE = 'cc:allowMustChange';

/** No login needed. */
export const Public = () => SetMetadata(PUBLIC, true);
/** User needs at least one of these permissions (in any of their branches). Branch-specific checks happen in services. */
export const RequirePerm = (...perms: Permission[]) => SetMetadata(PERMS, perms);
/** Only these kinds of user. */
export const Kinds = (...kinds: UserKind[]) => SetMetadata(KINDS, kinds);
/** Reachable while the user still has to change their first-login password. */
export const AllowMustChange = () => SetMetadata(ALLOW_MUST_CHANGE, true);

export interface AuthedRequest extends Request {
  user: SessionUser;
}

export const CurrentUser = createParamDecorator((_d: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<AuthedRequest>().user);

export function signAccessToken(userId: string): string {
  return jwt.sign({ sub: userId, typ: 'access' }, config.jwtSecret, { expiresIn: `${config.accessTokenMinutes}m` });
}

export function verifyAccessToken(token: string): string | null {
  try {
    const p = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload;
    return p.typ === 'access' && typeof p.sub === 'string' ? p.sub : null;
  } catch {
    return null;
  }
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

export function tokenFromRequest(req: Request): string | undefined {
  const cookie = (req as Request & { cookies?: Record<string, string> }).cookies?.[ACCESS_COOKIE];
  if (cookie) return cookie;
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7) : undefined;
}

/** Loads everything the permission system needs for one user. */
@Injectable()
export class SessionUserService {
  constructor(private prisma: PrismaService) {}

  async load(userId: string): Promise<SessionUser | null> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        adminModules: true,
        employee: { include: { designation: true, extraBranches: true } },
        student: true,
      },
    });
    if (!u || u.status !== 'ACTIVE') return null;
    let modules: ModuleKey[] = [];
    let permissions: Permission[] = [];
    let branchIds: string[] | null = null;
    if (u.kind === 'SUPER_ADMIN') {
      modules = [...MODULE_KEYS];
      permissions = [...PERMISSION_KEYS];
    } else if (u.kind === 'ADMIN') {
      modules = u.adminModules.map((m) => m.module).filter((m): m is ModuleKey => (MODULE_KEYS as string[]).includes(m));
      permissions = permissionsForModules(modules);
    } else if (u.kind === 'EMPLOYEE' && u.employee) {
      const e = u.employee;
      const set = new Set<string>([...e.designation.permissions, ...e.extraPermissions]);
      e.removedPermissions.forEach((p) => set.delete(p));
      permissions = PERMISSION_KEYS.filter((p) => set.has(p));
      branchIds = [e.branchId, ...e.extraBranches.map((b) => b.branchId)];
    } else {
      branchIds = u.student ? [u.student.branchId] : [];
    }
    return {
      id: u.id,
      kind: u.kind,
      name: u.name,
      email: u.email,
      mobile: u.mobile,
      mustChangePassword: u.mustChangePassword,
      modules,
      permissions,
      branchIds,
      employeeId: u.employee?.id ?? null,
      studentId: u.student?.id ?? null,
      designation: u.employee?.designation.name ?? null,
      homeBranchId: u.employee?.branchId ?? u.student?.branchId ?? null,
    };
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private reflector: Reflector, private users: SessionUserService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, targets)) return true;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const token = tokenFromRequest(req);
    const userId = token ? verifyAccessToken(token) : null;
    if (!userId) throw new UnauthorizedException('Please log in again');
    const user = await this.users.load(userId);
    if (!user) throw new UnauthorizedException('Your account is not active');
    req.user = user;

    if (user.mustChangePassword && !this.reflector.getAllAndOverride<boolean>(ALLOW_MUST_CHANGE, targets)) {
      throw new ForbiddenException('Please set a new password first');
    }
    const kinds = this.reflector.getAllAndOverride<UserKind[]>(KINDS, targets);
    if (kinds && !kinds.includes(user.kind)) throw new ForbiddenException('You do not have access to this');
    const perms = this.reflector.getAllAndOverride<Permission[]>(PERMS, targets);
    if (perms && !perms.some((p) => can(user, p))) throw new ForbiddenException('You do not have access to this');
    return true;
  }
}

// ── Branch-scope helpers (CLAUDE.md §6.1) ──

/** Throws unless the user holds `perm` in `branchId`. */
export function assertCan(user: SessionUser, perm: Permission, branchId?: string | null) {
  if (!can(user, perm, branchId)) throw new ForbiddenException('You do not have access to this');
}

export function canAny(user: SessionUser, perms: Permission[], branchId?: string | null) {
  return perms.some((p) => can(user, p, branchId));
}

/** Prisma `where` fragment limiting rows to the user's branches for `perm`. */
export function branchWhere(user: SessionUser, perm: Permission, field = 'branchId'): Record<string, unknown> {
  if (user.kind === 'SUPER_ADMIN') return {};
  if (!user.permissions.includes(perm)) return { [field]: '__none__' };
  if (user.branchIds === null) return {};
  return { [field]: { in: user.branchIds } };
}

/** Branch ids where the user holds `perm`; null = all. */
export function branchesFor(user: SessionUser, perm: Permission): string[] | null {
  if (user.kind === 'SUPER_ADMIN') return null;
  if (!user.permissions.includes(perm)) return [];
  return user.branchIds;
}

export function isStaff(user: SessionUser) {
  return user.kind !== 'STUDENT';
}
