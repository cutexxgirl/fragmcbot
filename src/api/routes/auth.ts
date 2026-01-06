import { FastifyPluginAsync } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '../../database/prisma';
import bcrypt from 'bcrypt';

// Маршруты авторизации
export const authRoutes: FastifyPluginAsync = async (app) => {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.post(
    '/login',
    {
      schema: {
        body: z.object({
          accessToken: z.string(),
          password: z.string(),
        }),
        response: {
          200: z.object({
            accessToken: z.string(),
            user: z.object({
                telegramId: z.string(),
                username: z.string().nullable(),
                subscriptionLevel: z.string().nullable(),
            })
          }),
          401: z.object({
            error: z.string(),
          }),
        },
      },
    },
    async (request, reply) => {
      const { accessToken, password } = request.body;

      const user = await prisma.user.findUnique({
        where: { accessToken },
      });

      if (!user || !user.passwordHash) {
        return reply.status(401).send({ error: 'Invalid credentials' });
      }

      const isValid = await bcrypt.compare(password, user.passwordHash);

      if (!isValid) {
        return reply.status(401).send({ error: 'Invalid credentials' });
      }

      return { 
        accessToken: user.accessToken,
        user: {
            telegramId: user.telegramId.toString(),
            username: user.username,
            subscriptionLevel: user.subscriptionLevel
        }
      };
    }
  );
};
