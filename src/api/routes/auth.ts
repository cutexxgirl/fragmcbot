import { FastifyPluginAsync } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { prisma } from '../../database/prisma';

const findUserByLogin = async (login: string) => {
  let user = await prisma.user.findUnique({ where: { fragmentId: login } });

  if (!user) {
    user = await prisma.user.findFirst({
      where: {
        username: {
          equals: login.replace('@', ''),
          mode: 'insensitive'
        }
      }
    });
  }

  if (!user && /^\d+$/.test(login)) {
    try {
      user = await prisma.user.findUnique({ where: { telegramId: BigInt(login) } });
    } catch {
      user = null;
    }
  }

  return user;
};

export const authRoutes: FastifyPluginAsync = async (app) => {
  const server = app.withTypeProvider<ZodTypeProvider>();

  server.post(
    '/login',
    {
      schema: {
        body: z.object({
          login: z.string().optional(),
          password: z.string().optional(),
          accessToken: z.string().optional()
        }),
        response: {
          200: z.object({
            accessToken: z.string(),
            user: z.object({
              telegramId: z.string(),
              username: z.string().nullable(),
              subscriptionLevel: z.string().nullable(),
              isAdmin: z.boolean().optional()
            })
          }),
          401: z.object({
            error: z.string()
          }),
          400: z.object({
            error: z.string()
          })
        }
      }
    },
    async (request, reply) => {
      const { login, password, accessToken } = request.body;

      if (accessToken) {
        if (!password) {
          return reply.status(400).send({ error: 'Missing credentials' });
        }

        const user = await prisma.user.findUnique({ where: { accessToken } });
        if (!user || !user.passwordHash) {
          return reply.status(401).send({ error: 'Invalid credentials' });
        }

        const isValid = await bcrypt.compare(password, user.passwordHash);
        if (!isValid) {
          return reply.status(401).send({ error: 'Invalid credentials' });
        }

        const admin = await prisma.admin.findUnique({ where: { telegramId: user.telegramId } });
        const isAdmin = !!(admin && admin.isActive);

        return {
          accessToken: user.accessToken,
          user: {
            telegramId: user.telegramId.toString(),
            username: user.username,
            subscriptionLevel: user.subscriptionLevel,
            isAdmin
          }
        };
      }

      if (!login || !password) {
        return reply.status(400).send({ error: 'Missing credentials' });
      }

      const user = await findUserByLogin(login);
      if (!user || !user.passwordHash) {
        return reply.status(401).send({ error: 'Invalid credentials' });
      }

      const isValid = await bcrypt.compare(password, user.passwordHash);
      if (!isValid) {
        return reply.status(401).send({ error: 'Invalid credentials' });
      }

      const admin = await prisma.admin.findUnique({ where: { telegramId: user.telegramId } });
      const isAdmin = !!(admin && admin.isActive);

      return {
        accessToken: user.accessToken,
        user: {
          telegramId: user.telegramId.toString(),
          username: user.username,
          subscriptionLevel: user.subscriptionLevel,
          isAdmin
        }
      };
    }
  );
};
