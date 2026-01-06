import { FastifyPluginAsync } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '../../database/prisma';

export const userRoutes: FastifyPluginAsync = async (app) => {
  const server = app.withTypeProvider<ZodTypeProvider>();

  // Проверка токена
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
            username: z.string().nullable(),
            discordId: z.string().nullable(),
            accessToken: z.string(),
            subscriptionLevel: z.string().nullable(),
            status: z.string(),
            isLegacy: z.boolean(),
            isFrozen: z.boolean(),
            bannedAt: z.string().nullable(),
            banReason: z.string().nullable(),
            expiresAtFragment: z.string().nullable(),
            expiresAtPulse: z.string().nullable(),
            expiresAtGearwire: z.string().nullable(),
            expiresAtOuch: z.string().nullable(),
            createdAt: z.string(),
          }),
        },
      },
    },
    async (request, reply) => {
      const user = (request as any).user;
      
      return {
        telegramId: user.telegramId.toString(),
        username: user.username,
        discordId: user.discordId ? user.discordId.toString() : null,
        accessToken: user.accessToken,
        subscriptionLevel: user.subscriptionLevel,
        status: user.status,
        isLegacy: user.isLegacy,
        isFrozen: user.isFrozen,
        bannedAt: user.bannedAt ? user.bannedAt.toISOString() : null,
        banReason: user.banReason,
        expiresAtFragment: user.expiresAtFragment ? user.expiresAtFragment.toISOString() : null,
        expiresAtPulse: user.expiresAtPulse ? user.expiresAtPulse.toISOString() : null,
        expiresAtGearwire: user.expiresAtGearwire ? user.expiresAtGearwire.toISOString() : null,
        expiresAtOuch: user.expiresAtOuch ? user.expiresAtOuch.toISOString() : null,
        createdAt: user.createdAt.toISOString(),
      };
    }
  );
};
