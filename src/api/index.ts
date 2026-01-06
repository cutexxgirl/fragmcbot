import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { config } from '../config';
import { authRoutes } from './routes/auth';
import { userRoutes } from './routes/user';
import { statsRoutes } from './routes/stats';
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

  // Zod validation
  server.setValidatorCompiler(validatorCompiler);
  server.setSerializerCompiler(serializerCompiler);

  // Register routes
  await server.register(authRoutes, { prefix: '/auth' });
  await server.register(userRoutes, { prefix: '/user' });
  await server.register(statsRoutes, { prefix: '/stats' });

  try {
    const port = 3000; // Hardcoded for now, or use config
    await server.listen({ port, host: '0.0.0.0' });
    console.log(`🚀 API Server running on port ${port}`);
  } catch (err) {
    server.log.error(err);
    // process.exit(1); // Don't kill the bot if API fails
  }
};
