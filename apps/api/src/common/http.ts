import {
  ArgumentsHost, BadRequestException, Catch, ExceptionFilter, HttpException, HttpStatus, Logger, PipeTransform,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { ZodError, ZodTypeAny, z } from 'zod';

/** `@Body(new Zod(schema)) body: z.infer<typeof schema>` */
export class Zod<T extends ZodTypeAny> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private schema: T) {}
  transform(value: unknown): z.infer<T> {
    const r = this.schema.safeParse(value);
    if (!r.success) throw zodToHttp(r.error);
    return r.data;
  }
}

export function zodToHttp(err: ZodError) {
  const fieldErrors: Record<string, string> = {};
  for (const i of err.issues) {
    const k = i.path.join('.') || '_';
    if (!fieldErrors[k]) fieldErrors[k] = i.message;
  }
  const first = Object.values(fieldErrors)[0] ?? 'Please check the form';
  return new BadRequestException({ message: first, fieldErrors });
}

export function parse<T extends ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  return new Zod(schema).transform(value);
}

/** Friendly errors for everything (no stack traces to the browser). */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private log = new Logger('Error');
  catch(exception: unknown, host: ArgumentsHost) {
    if (host.getType() !== 'http') return;
    const res = host.switchToHttp().getResponse<Response>();
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const payload = typeof body === 'string' ? { message: body } : (body as Record<string, unknown>);
      const msg = Array.isArray(payload.message) ? payload.message.join(', ') : payload.message;
      res.status(status).json({ ...payload, message: msg, statusCode: status });
      return;
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        const target = (exception.meta?.target as string[] | undefined)?.join(', ') ?? 'value';
        res.status(409).json({ statusCode: 409, message: `That ${friendlyField(target)} is already in use` });
        return;
      }
      if (exception.code === 'P2025') {
        res.status(404).json({ statusCode: 404, message: 'Not found' });
        return;
      }
    }
    if (exception instanceof ZodError) {
      const e = zodToHttp(exception);
      res.status(400).json({ ...(e.getResponse() as object), statusCode: 400 });
      return;
    }
    const e = exception as { type?: string; status?: number; message?: string };
    if (e?.type === 'entity.too.large') { res.status(413).json({ statusCode: 413, message: 'That is too large' }); return; }
    if (e?.type === 'entity.parse.failed') { res.status(400).json({ statusCode: 400, message: 'The request could not be read' }); return; }
    this.log.error(exception instanceof Error ? exception.stack : String(exception));
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ statusCode: 500, message: 'Something went wrong. Please try again.' });
  }
}

function friendlyField(target: string) {
  if (target.includes('email')) return 'email address';
  if (target.includes('mobile')) return 'mobile number';
  if (target.includes('code')) return 'code';
  if (target.includes('name')) return 'name';
  return target;
}

export function clientIp(req: { ip?: string; headers: Record<string, unknown> }) {
  const f = req.headers['x-forwarded-for'];
  return (typeof f === 'string' ? f.split(',')[0].trim() : undefined) ?? req.ip ?? null;
}

export function paging(page: number, pageSize: number) {
  return { skip: (page - 1) * pageSize, take: pageSize };
}
