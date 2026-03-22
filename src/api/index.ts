import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import Fastify, { FastifyInstance } from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { config } from '../config';
import { enforceApiRateLimit } from './rateLimit';
import { adminRoutes } from './routes/admin';
import { authRoutes } from './routes/auth';
import { fileProxyRoutes } from './routes/file-proxy';
import { statsRoutes } from './routes/stats';
import { userRoutes } from './routes/user';

export const startAPI = async () => {
  const server: FastifyInstance = Fastify({
    logger: true,
    trustProxy: true
  });

  await server.register(cors, {
    origin: (origin, callback) => {
      if (!origin || origin === 'null') {
        return callback(null, true);
      }

      if (config.api.corsOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error('Not allowed by CORS'), false);
    }
  });
  await server.register(helmet);

  server.setValidatorCompiler(validatorCompiler);
  server.setSerializerCompiler(serializerCompiler);

  server.addHook('onRequest', async (request, reply) => {
    const rateLimitResponse = await enforceApiRateLimit(request, reply);
    if (rateLimitResponse) {
      return rateLimitResponse;
    }
  });

  await server.register(authRoutes, { prefix: '/auth' });
  await server.register(userRoutes, { prefix: '/user' });
  await server.register(adminRoutes, { prefix: '/auth/admin' });
  await server.register(statsRoutes, { prefix: '/stats' });
  await server.register(fileProxyRoutes, { prefix: '/auth/files' });

  try {
    await server.listen({
      port: config.api.port,
      host: config.api.host
    });
    console.log(`API Server running on ${config.api.host}:${config.api.port}`);
  } catch (err) {
    server.log.error(err);
  }
};
