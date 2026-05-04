import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as express from 'express';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:4200',
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  const uploadDir = join(process.cwd(), 'uploads');
  if (!existsSync(uploadDir)) {
    mkdirSync(uploadDir);
  }

  app.useStaticAssets(uploadDir, { prefix: '/uploads/' });

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
