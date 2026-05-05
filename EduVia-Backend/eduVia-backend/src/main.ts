import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as express from 'express';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Body parsers
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  const allowedOrigins = [
    process.env.FRONTEND_URL,
    'http://localhost:4200',
    'https://eduvia-frontend.vercel.app',
  ].filter(Boolean);

  const isAllowedVercelPreview = (origin: string) =>
    /^https:\/\/eduvia-frontend-[a-z0-9-]+-mayarahachanis-projects\.vercel\.app$/.test(origin);

  // CORS : autorise le frontend Vercel, ses previews et localhost pour tests
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin) || isAllowedVercelPreview(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin not allowed by CORS: ${origin}`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Dossier uploads
  const uploadDir = join(process.cwd(), 'uploads');
  if (!existsSync(uploadDir)) {
    mkdirSync(uploadDir);
  }

  // Servir les fichiers statiques uploadés
  app.use(
    '/uploads',
    express.static(uploadDir, {
      acceptRanges: true,
      setHeaders: (res, filePath) => {
        const extension = filePath.split('.').pop()?.toLowerCase();
        if (extension === 'pdf') {
          res.setHeader('Content-Type', 'application/pdf');
          res.setHeader('Content-Disposition', 'inline');
        }
        if (['mp4', 'webm', 'ogg', 'mov', 'm4v'].includes(extension || '')) {
          res.setHeader('Accept-Ranges', 'bytes');
        }
      },
    }),
  );

  // Lancer l'application sur le PORT fourni par Render
  await app.listen(process.env.PORT ?? 3000);
}

bootstrap();
