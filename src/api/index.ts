import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { config } from '../config';
import { authRoutes } from './routes/auth';
import { userRoutes } from './routes/user';
import { statsRoutes } from './routes/stats';
import { adminRoutes } from './routes/admin';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';

export const startAPI = async () => {
  const server: FastifyInstance = Fastify({
    logger: true,
  });

  // Register plugins
  await server.register(cors, { 
    origin: '*', // Adjust for production
  });
  await server.register(helmet);
  await server.register(require('@fastify/reply-from'), {
      base: 'http://127.0.0.1:3001' // Адрес File API
  });

  // Zod validation
  server.setValidatorCompiler(validatorCompiler);
  server.setSerializerCompiler(serializerCompiler);

  // Register routes
  await server.register(authRoutes, { prefix: '/auth' });
  await server.register(userRoutes, { prefix: '/user' });
  await server.register(adminRoutes, { prefix: '/auth/admin' }); // CHANGED PREFIX
  await server.register(statsRoutes, { prefix: '/stats' });
  
  // PROXY FOR FILE API
  // Frontend calls /auth/files/... -> Proxy calls http://127.0.0.1:3001/api/...
  server.get('/auth/files/*', async (request, reply) => {
      const path = (request.params as any)['*'];
      return (reply as any).from(`/api/${path}`);
  });
  
  // PROXY FOR UPLOADS
  // Frontend calls /upload/:buildId -> Proxy calls http://127.0.0.1:3001/api/upload/:buildId
  server.post('/upload/:buildId', async (request, reply) => {
      const { buildId } = request.params as { buildId: string };
      return (reply as any).from(`/api/upload/${buildId}`, {
          contentType: request.headers['content-type']
      });
  });

  try {
    const port = 3000; // Hardcoded for now, or use config
    await server.listen({ port, host: '0.0.0.0' });
    console.log(`🚀 API Server running on port ${port}`);
  } catch (err) {
    server.log.error(err);
    // process.exit(1); // Don't kill the bot if API fails
  }
};
