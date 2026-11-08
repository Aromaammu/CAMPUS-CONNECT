import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { config } from './config';

export async function createApp() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: config.isTest ? ['error', 'warn'] : ['log', 'error', 'warn'] });
  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '2mb' });
  app.setGlobalPrefix('api');

  // CSRF defence in depth: state-changing API calls must come from our own pages (SameSite=Lax cookies + this header).
  app.use((req: Request, res: Response, next: NextFunction) => {
    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const exempt = req.path.startsWith('/api/livekit/webhook');
    if (unsafe && req.path.startsWith('/api/') && !exempt && req.headers['x-cc'] !== '1' && !req.headers.authorization) {
      res.status(403).json({ statusCode: 403, message: 'Request blocked' });
      return;
    }
    next();
  });

  // Production: serve the built website from the same server.
  if (existsSync(join(config.webDist, 'index.html'))) {
    app.useStaticAssets(config.webDist, { index: false, maxAge: '1h' });
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method === 'GET' && !req.path.startsWith('/api') && !req.path.startsWith('/socket.io')) {
        res.sendFile(join(config.webDist, 'index.html'));
        return;
      }
      next();
    });
  }
  app.enableShutdownHooks();
  return app;
}
