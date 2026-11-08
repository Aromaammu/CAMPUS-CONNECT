import { Body, Controller, Get, HttpCode, Module, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { changePasswordSchema, forgotPasswordSchema, loginSchema, otpRequestSchema, otpVerifySchema, resetPasswordSchema, SessionUser } from '@cc/shared';
import { z } from 'zod';
import { ACCESS_COOKIE, AllowMustChange, CurrentUser, Public, REFRESH_COOKIE, SessionUserService, tokenFromRequest, verifyAccessToken } from '../../common/auth';
import { Zod, clientIp } from '../../common/http';
import { config } from '../../config';
import { PrismaService } from '../../common/prisma.service';
import { AuthService, POLICY_VERSION, Tokens, ageOn } from './auth.service';

function setCookies(res: Response, t: Tokens) {
  const base = { httpOnly: true, sameSite: 'lax' as const, secure: config.isProd };
  res.cookie(ACCESS_COOKIE, t.access, { ...base, path: '/', maxAge: config.accessTokenMinutes * 60000 });
  res.cookie(REFRESH_COOKIE, t.refresh, { ...base, path: '/api/auth', maxAge: t.refreshMaxAgeMs });
}
function clearCookies(res: Response) {
  res.clearCookie(ACCESS_COOKIE, { path: '/' });
  res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
}
const info = (req: Request) => ({ ip: clientIp(req), userAgent: req.headers['user-agent'] });

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService, private prisma: PrismaService, private users: SessionUserService) {}

  /** Who is logged in, without errors for visitors: renews the session from the refresh cookie when needed. */
  @Public()
  @Get('session')
  async session(@Req() req: Request & { cookies: Record<string, string> }, @Res({ passthrough: true }) res: Response) {
    const token = tokenFromRequest(req);
    let userId = token ? verifyAccessToken(token) : null;
    if (!userId && req.cookies?.[REFRESH_COOKIE]) {
      try {
        const t = await this.auth.refresh(req.cookies[REFRESH_COOKIE], info(req));
        setCookies(res, t);
        userId = verifyAccessToken(t.access);
      } catch {
        clearCookies(res);
      }
    }
    const user = userId ? await this.users.load(userId) : null;
    if (!user) return { user: null };
    return this.me(user);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(@Body(new Zod(loginSchema)) body: z.infer<typeof loginSchema>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const t = await this.auth.login(body.identifier, body.password, info(req));
    setCookies(res, t);
    return { ok: true, accessToken: t.access };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request & { cookies: Record<string, string> }, @Res({ passthrough: true }) res: Response) {
    try {
      const t = await this.auth.refresh(req.cookies?.[REFRESH_COOKIE], info(req));
      setCookies(res, t);
      return { ok: true, accessToken: t.access };
    } catch (e) {
      clearCookies(res);
      throw e;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request & { cookies: Record<string, string> }, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE]);
    clearCookies(res);
    return { ok: true };
  }

  @AllowMustChange()
  @Get('me')
  async me(@CurrentUser() user: SessionUser) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: { consents: true, student: true } });
    return {
      user,
      needsConsent: !u.consents.some((c) => c.policyVersion === POLICY_VERSION),
      isMinor: u.student?.dob ? ageOn(u.student.dob, new Date()) < 18 : false,
    };
  }

  @AllowMustChange()
  @Post('change-password')
  @HttpCode(200)
  async changePassword(@CurrentUser() user: SessionUser, @Body(new Zod(changePasswordSchema)) body: z.infer<typeof changePasswordSchema>, @Req() req: Request) {
    await this.auth.changePassword(user.id, body, info(req));
    return { ok: true };
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(200)
  async forgot(@Body(new Zod(forgotPasswordSchema)) body: z.infer<typeof forgotPasswordSchema>) {
    await this.auth.forgot(body.identifier);
    return { ok: true, message: 'If that account exists, we have sent a reset link.' };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(200)
  async reset(@Body(new Zod(resetPasswordSchema)) body: z.infer<typeof resetPasswordSchema>, @Req() req: Request) {
    await this.auth.reset(body.token, body.newPassword, info(req));
    return { ok: true };
  }

  @Public()
  @Post('otp/request')
  @HttpCode(200)
  async otpRequest(@Body(new Zod(otpRequestSchema)) body: z.infer<typeof otpRequestSchema>) {
    await this.auth.requestOtp(body.mobile);
    return { ok: true, message: 'If that number is registered, we have sent a 6-digit code.' };
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(200)
  async otpVerify(@Body(new Zod(otpVerifySchema)) body: z.infer<typeof otpVerifySchema>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const t = await this.auth.verifyOtp(body.mobile, body.code, info(req));
    setCookies(res, t);
    return { ok: true, accessToken: t.access };
  }
}

@Module({ controllers: [AuthController], providers: [AuthService], exports: [AuthService] })
export class AuthModule {}
