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
          login: z.string().optional(), // username, fragmentId, or telegramId
          password: z.string().optional(),
          accessToken: z.string().optional(), // Direct token login
        }),
        response: {
          200: z.object({
            accessToken: z.string(),
            user: z.object({
                telegramId: z.string(),
                username: z.string().nullable(),
                subscriptionLevel: z.string().nullable(),
                isAdmin: z.boolean().optional(),
            })
          }),
          401: z.object({
            error: z.string(),
          }),
          400: z.object({
            error: z.string(),
          }),
        },
      },
    },
    async (request, reply) => {
      const { login, password, accessToken } = request.body;

      // 1. Вход по токену (для лаунчера)
      if (accessToken) {
          const user = await prisma.user.findUnique({ where: { accessToken } });
          if (!user) {
              return reply.status(401).send({ error: 'Invalid access token' });
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

      // 2. Вход по логину/паролю
      if (!login || !password) {
           return reply.status(400).send({ error: 'Missing credentials' });
      }

      // Поиск пользователя по разным полям
      let user = await prisma.user.findUnique({ where: { fragmentId: login } });
      
      if (!user) {
         // Пробуем как username
         user = await prisma.user.findFirst({ 
             where: { username: { equals: login.replace('@', ''), mode: 'insensitive' } } 
         });
      }

      if (!user && /^\d+$/.test(login)) {
          // Пробуем как telegramId
          try {
             user = await prisma.user.findUnique({ where: { telegramId: BigInt(login) } });
          } catch {}
      }

      if (!user || !user.passwordHash) {
        return reply.status(401).send({ error: 'Invalid credentials' });
      }

      const isValid = await bcrypt.compare(password, user.passwordHash);

      if (!isValid) {
        return reply.status(401).send({ error: 'Invalid credentials' });
      }

      // Проверяем админа
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
