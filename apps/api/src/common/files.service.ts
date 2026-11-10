import { BadRequestException, Controller, Get, Injectable, NotFoundException, Param, PayloadTooLargeException, Query, Req, Res } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import type { Request, Response } from 'express';
import { config } from '../config';
import { Public } from './auth';
import { PrismaService, Tx } from './prisma.service';
import { SettingsService } from './settings.service';

/** What kinds of files a feature accepts. Types are checked from the file's content, never its name. */
export type FileKind = 'image' | 'pdf' | 'video' | 'office' | 'text';

const MIME: Record<string, { kind: FileKind; mime: string }> = {
  png: { kind: 'image', mime: 'image/png' },
  jpg: { kind: 'image', mime: 'image/jpeg' },
  gif: { kind: 'image', mime: 'image/gif' },
  webp: { kind: 'image', mime: 'image/webp' },
  pdf: { kind: 'pdf', mime: 'application/pdf' },
  mp4: { kind: 'video', mime: 'video/mp4' },
  webm: { kind: 'video', mime: 'video/webm' },
  zip: { kind: 'office', mime: 'application/zip' },
};

/** Recognises a file from its first bytes. */
export function sniff(buf: Buffer, name = ''): { kind: FileKind; mime: string } | null {
  const hex = buf.subarray(0, 12).toString('hex');
  if (hex.startsWith('89504e470d0a1a0a')) return MIME.png;
  if (hex.startsWith('ffd8ff')) return MIME.jpg;
  if (hex.startsWith('474946383')) return MIME.gif;
  if (hex.startsWith('52494646') && buf.subarray(8, 12).toString('ascii') === 'WEBP') return MIME.webp;
  if (hex.startsWith('25504446')) return MIME.pdf;
  if (buf.subarray(4, 8).toString('ascii') === 'ftyp') return MIME.mp4;
  if (hex.startsWith('1a45dfa3')) return MIME.webm;
  if (hex.startsWith('504b0304')) {
    const ext = name.toLowerCase().split('.').pop() ?? '';
    const office: Record<string, string> = {
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    };
    return { kind: 'office', mime: office[ext] ?? MIME.zip.mime };
  }
  // Plain text: no NUL bytes in the first 4 KB and valid UTF-8.
  const head = buf.subarray(0, 4096);
  if (head.length && !head.includes(0) && Buffer.from(head.toString('utf8'), 'utf8').equals(head)) return { kind: 'text', mime: 'text/plain; charset=utf-8' };
  return null;
}

/** Where file bytes live: local disk in dev, S3-compatible storage (Mumbai) in production (Phase 10). */
export abstract class Storage {
  abstract put(key: string, data: Buffer): Promise<void>;
  abstract size(key: string): Promise<number | null>;
  abstract stream(key: string, range?: { start: number; end: number }): NodeJS.ReadableStream;
  abstract remove(key: string): Promise<void>;
}

@Injectable()
export class LocalDiskStorage extends Storage {
  private path(key: string) {
    const p = normalize(join(config.storageDir, key));
    if (!p.startsWith(normalize(config.storageDir))) throw new BadRequestException('Bad file key');
    return p;
  }
  async put(key: string, data: Buffer) {
    const p = this.path(key);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, data);
  }
  async size(key: string) {
    const p = this.path(key);
    return existsSync(p) ? statSync(p).size : null;
  }
  stream(key: string, range?: { start: number; end: number }) {
    return createReadStream(this.path(key), range);
  }
  async remove(key: string) {
    const p = this.path(key);
    if (existsSync(p)) unlinkSync(p);
  }
}

const LINK_MINUTES = 10;

/**
 * Private files: stored under random keys, opened only through short-lived signed links
 * that a feature hands out after its own permission check (CLAUDE.md §6.8).
 */
@Injectable()
export class FilesService {
  constructor(private prisma: PrismaService, private storage: Storage, private settings: SettingsService) {}

  async save(file: { buffer: Buffer; originalname: string } | undefined, o: { purpose: string; userId: string; kinds: FileKind[]; maxMb?: number }, tx: Tx = this.prisma) {
    if (!file?.buffer?.length) throw new BadRequestException('Choose a file');
    const limit = o.maxMb ?? (await this.settings.get('uploads.maxMb'));
    if (file.buffer.length > limit * 1024 * 1024) throw new PayloadTooLargeException(`Files must be under ${limit} MB`);
    const type = sniff(file.buffer, file.originalname);
    if (!type || !o.kinds.includes(type.kind)) throw new BadRequestException(`That file type is not allowed here. Allowed: ${o.kinds.join(', ')}`);
    const key = `${o.purpose}/${new Date().toISOString().slice(0, 7)}/${randomUUID()}`;
    await this.storage.put(key, file.buffer);
    const name = file.originalname.replace(/[^\w.\- ()]+/g, '_').slice(0, 150) || 'file';
    return tx.fileObject.create({ data: { storageKey: key, name, mime: type.mime, sizeBytes: file.buffer.length, uploadedById: o.userId, purpose: o.purpose } });
  }

  /** A link that works for a few minutes, for one person. */
  signedUrl(fileId: string, userId: string, o: { download?: boolean; minutes?: number } = {}) {
    const exp = Math.floor(Date.now() / 1000) + (o.minutes ?? LINK_MINUTES) * 60;
    const payload = `${fileId}.${userId}.${exp}.${o.download ? 1 : 0}`;
    return `/api/files/${fileId}?u=${userId}&e=${exp}&d=${o.download ? 1 : 0}&s=${this.sign(payload)}`;
  }

  private sign(payload: string) {
    return createHmac('sha256', config.jwtSecret).update(`file:${payload}`).digest('base64url');
  }

  verify(fileId: string, q: { u?: string; e?: string; d?: string; s?: string }) {
    if (!q.u || !q.e || !q.s) return false;
    if (Number(q.e) < Date.now() / 1000) return false;
    const expected = Buffer.from(this.sign(`${fileId}.${q.u}.${q.e}.${q.d === '1' ? 1 : 0}`));
    const got = Buffer.from(q.s);
    return expected.length === got.length && timingSafeEqual(expected, got);
  }

  async remove(fileId: string) {
    const f = await this.prisma.fileObject.findUnique({ where: { id: fileId } });
    if (!f) return;
    await this.storage.remove(f.storageKey);
    await this.prisma.fileObject.delete({ where: { id: fileId } }).catch(() => undefined);
  }

  /** Stores bytes that the server produced itself (e.g. a recording). */
  async saveRaw(data: Buffer, o: { purpose: string; userId: string; name: string; mime: string }) {
    const key = `${o.purpose}/${new Date().toISOString().slice(0, 7)}/${randomUUID()}`;
    await this.storage.put(key, data);
    return this.prisma.fileObject.create({ data: { storageKey: key, name: o.name, mime: o.mime, sizeBytes: data.length, uploadedById: o.userId, purpose: o.purpose } });
  }

  get store() { return this.storage; }
}

@Controller('files')
export class FilesController {
  constructor(private files: FilesService, private prisma: PrismaService, private storage: Storage) {}

  /** Serves a file from a signed link. Supports byte ranges so videos can be watched and skipped through. */
  @Public()
  @Get(':id')
  async get(@Param('id') id: string, @Query() q: Record<string, string>, @Req() req: Request, @Res() res: Response) {
    if (!this.files.verify(id, q)) throw new NotFoundException('This link has expired. Please open it again from the app.');
    const f = await this.prisma.fileObject.findUnique({ where: { id } });
    if (!f) throw new NotFoundException('File not found');
    const size = (await this.storage.size(f.storageKey)) ?? 0;
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', f.mime);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Disposition', `${q.d === '1' ? 'attachment' : 'inline'}; filename="${encodeURIComponent(f.name)}"`);
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
    if (m && size) {
      const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
      const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
      if (start >= size || start > end) { res.status(416).setHeader('Content-Range', `bytes */${size}`).end(); return; }
      res.status(206).setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
      res.setHeader('Content-Length', String(end - start + 1));
      this.storage.stream(f.storageKey, { start, end }).pipe(res);
      return;
    }
    res.setHeader('Content-Length', String(size));
    this.storage.stream(f.storageKey).pipe(res);
  }
}
