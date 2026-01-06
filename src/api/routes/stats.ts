import { FastifyPluginAsync } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '../../database/prisma';

export const statsRoutes: FastifyPluginAsync = async (app) => {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.get(
    '/',
    {
      schema: {
        response: {
          200: z.object({
            totalUsers: z.number(),
            activeUsers: z.number(),
          }),
        },
      },
    },
    async (request, reply) => {
      const totalUsers = await prisma.user.count();
      const activeUsers = await prisma.user.count({
        where: { status: 'active' },
      });

      return {
        totalUsers,
        activeUsers,
      };
    }
  );
};
