import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../src/bootstrap';
import { PrismaService } from '../src/common/prisma.service';

let app: INestApplication | null = null;

export async function getApp() {
  if (!app) {
    app = await createApp();
    await app.init();
  }
  return app;
}

export async function closeApp() {
  if (app) await app.close();
  app = null;
}

export function prisma() {
  if (!app) throw new Error('call getApp() first');
  return app.get(PrismaService);
}

const tokens = new Map<string, string>();
export async function tokenFor(email: string, password = 'Demo@1234') {
  const cached = tokens.get(email);
  if (cached) return cached;
  const res = await request((await getApp()).getHttpServer()).post('/api/auth/login').set('x-cc', '1').send({ identifier: email, password });
  if (res.status !== 200) throw new Error(`login ${email} failed: ${res.status} ${JSON.stringify(res.body)}`);
  tokens.set(email, res.body.accessToken);
  return res.body.accessToken as string;
}

/** Authenticated request helper: as('director@demo.cc').get('/api/...') */
export async function as(email: string) {
  const server = (await getApp()).getHttpServer();
  const t = await tokenFor(email);
  const wrap = (r: request.Test) => r.set('Authorization', `Bearer ${t}`);
  return {
    get: (u: string) => wrap(request(server).get(u)),
    post: (u: string, body?: object) => wrap(request(server).post(u)).send(body ?? {}),
    put: (u: string, body?: object) => wrap(request(server).put(u)).send(body ?? {}),
    patch: (u: string, body?: object) => wrap(request(server).patch(u)).send(body ?? {}),
    delete: (u: string, body?: object) => wrap(request(server).delete(u)).send(body ?? {}),
  };
}

export async function anon() {
  return request((await getApp()).getHttpServer());
}

export const DEMO = {
  director: 'director@demo.cc',
  academics: 'academics@demo.cc',
  accounts: 'accounts@demo.cc',
  monitoring: 'monitoring@demo.cc',
  ops: 'ops@demo.cc',
  kochiAdmin: 'kochi.admin@demo.cc',
  tvmAdmin: 'tvm.admin@demo.cc',
  blrAdmin: 'blr.admin@demo.cc',
  anita: 'anita.trainer@demo.cc',
  rahul: 'rahul.trainer@demo.cc',
  sanjay: 'sanjay.trainer@demo.cc',
  kochiAccounts: 'kochi.accounts@demo.cc',
  tvmAccounts: 'tvm.accounts@demo.cc',
  counsellor: 'kochi.counsellor@demo.cc',
  arjun: 'arjun.student@demo.cc',
  diya: 'diya.student@demo.cc',
  newStudent: 'new.student@demo.cc',
  newStaff: 'new.staff@demo.cc',
};
