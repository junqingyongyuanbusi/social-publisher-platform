import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module.js';
import { API_CONFIG, type ApiConfig } from './config/api-config.module.js';
import { ProblemDetailsFilter } from './shared/problem-details.filter.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const runtime = app.get<ApiConfig>(API_CONFIG);
  app.setGlobalPrefix('api/v1');
  app.enableCors({ origin: runtime.webOrigin, credentials: false });
  app.use((request: Request, response: Response, next: NextFunction) => {
    const requestId = request.header('x-request-id') ?? randomUUID();
    response.setHeader('x-request-id', requestId);
    request.headers['x-request-id'] = requestId;
    next();
  });
  app.useGlobalFilters(new ProblemDetailsFilter());

  if (runtime.swaggerEnabled) {
    const config = new DocumentBuilder()
      .setTitle('Social Publisher API')
      .setDescription('Versioned API for Instagram, Facebook Pages, and X publishing')
      .setVersion('1.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, config));
  }

  await app.listen(runtime.port);
}

void bootstrap();
