import { FastifyPluginAsync } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '../../database/prisma';

export const userRoutes: FastifyPluginAsync = async (app) => {
  const server = app.withTypeProvider<ZodTypeProvider>();

  // Проверка токена + обновление lastActiveAt
  server.addHook('preHandler', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Missing token' });
    }

    const token = authHeader.split(' ')[1];
    const user = await prisma.user.findUnique({
      where: { accessToken: token },
    });

    if (!user) {
      return reply.status(401).send({ error: 'Invalid token' });
    }

    // Обновляем lastActiveAt при каждом API запросе
    await prisma.user.update({
      where: { telegramId: user.telegramId },
      data: { lastActiveAt: new Date() },
    });

    // Прикрепляем пользователя к запросу
    (request as any).user = user;
  });

  server.get(
    '/me',
    {
      schema: {
        response: {
          200: z.object({
            telegramId: z.string(),
            fragmentId: z.string().nullable(),
            username: z.string().nullable(),
            discordId: z.string().nullable(),
            accessToken: z.string(),
            subscriptionLevel: z.string().nullable(),
            status: z.string(),
            isFrozen: z.boolean(),
            bannedAt: z.string().nullable(),
            banReason: z.string().nullable(),
            expiresAtFragment: z.string().nullable(),
            expiresAtExtra: z.string().nullable(),
            giftedById: z.string().nullable(),
            createdAt: z.string(),
            lastActiveAt: z.string().nullable(),
          }),
        },
      },
    },
    async (request, reply) => {
      const user = (request as any).user;
      
      return {
        telegramId: user.telegramId.toString(),
        fragmentId: user.fragmentId,
        username: user.username,
        discordId: user.discordId ? user.discordId.toString() : null,
        accessToken: user.accessToken,
        subscriptionLevel: user.subscriptionLevel,
        status: user.status,
        isFrozen: user.isFrozen,
        bannedAt: user.bannedAt ? user.bannedAt.toISOString() : null,
        banReason: user.banReason,
        expiresAtFragment: user.expiresAtFragment ? user.expiresAtFragment.toISOString() : null,
        expiresAtExtra: user.expiresAtExtra ? user.expiresAtExtra.toISOString() : null,
        giftedById: user.giftedById ? user.giftedById.toString() : null,
        createdAt: user.createdAt.toISOString(),
        lastActiveAt: user.lastActiveAt ? user.lastActiveAt.toISOString() : null,
      };
    }
  );
};
