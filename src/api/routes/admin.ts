import { FastifyPluginAsync } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { prisma } from '../../database/prisma';
import { UserStatus, SubscriptionLevel } from '../../config';

export const adminRoutes: FastifyPluginAsync = async (app) => {
  const server = app.withTypeProvider<ZodTypeProvider>();

  // ADMIN AUTH MIDDLEWARE
  server.addHook('preHandler', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Missing token' });
    }

    const token = authHeader.split(' ')[1];
    
    // 1. Find User by Token
    const user = await prisma.user.findUnique({
      where: { accessToken: token },
    });

    if (!user) {
      return reply.status(401).send({ error: 'Invalid token' });
    }

    // 2. Check if User is Admin
    const admin = await prisma.admin.findUnique({
      where: { telegramId: user.telegramId },
    });

    if (!admin || !admin.isActive) {
      return reply.status(403).send({ error: 'Access denied: Admin rights required' });
    }

    (request as any).adminUser = user;
    (request as any).adminRecord = admin;
  });

  // --- USERS LIST ---
  server.get(
    '/users',
    {
      schema: {
        querystring: z.object({
          page: z.coerce.number().min(1).default(1),
          limit: z.coerce.number().min(1).max(100).default(20),
          search: z.string().optional(),
          status: z.nativeEnum(UserStatus).optional(),
          level: z.nativeEnum(SubscriptionLevel).optional(),
        }),
      },
    },
    async (request, reply) => {
      const { page, limit, search, status, level } = request.query;
      const skip = (page - 1) * limit;

      const where: any = {};

      if (search) {
        where.OR = [
          { username: { contains: search, mode: 'insensitive' } },
          { fragmentId: { contains: search, mode: 'insensitive' } },
          // Telegram ID search (need to handle BigInt conversion carefully or search by string if possible, 
          // Prisma BigInt filter validation might fail if search is not a number)
        ];
        if (/^\d+$/.test(search)) {
             where.OR.push({ telegramId: BigInt(search) });
        }
      }

      if (status) where.status = status;
      if (level) where.subscriptionLevel = level;

      const [users, total] = await Promise.all([
        prisma.user.findMany({
          where,
          skip,
          take: limit,
          orderBy: { createdAt: 'desc' },
        }),
        prisma.user.count({ where }),
      ]);

      return {
        data: users.map((u: any) => ({
          ...u,
          telegramId: u.telegramId.toString(),
          giftedById: u.giftedById?.toString() || null,
          discordId: u.discordId?.toString() || null,
        })),
        meta: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      };
    }
  );

  // --- USER PARAM SCHEMA ---
  const UserParams = z.object({
    id: z.string().regex(/^\d+$/), // telegramId as string
  });

  // --- GET USER DETAILS ---
  server.get(
    '/users/:id',
    {
      schema: {
        params: UserParams,
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const user = await prisma.user.findUnique({
        where: { telegramId: BigInt(id) },
        include: {
            sharedByMe: { include: { guest: true } },
            sharedToMe: { include: { owner: true } },
            supportTickets: { orderBy: { createdAt: 'desc' }, take: 5 }
        }
      });

      if (!user) return reply.status(404).send({ error: 'User not found' });

      return {
          ...user,
          telegramId: user.telegramId.toString(),
          giftedById: user.giftedById?.toString() || null,
          discordId: user.discordId?.toString() || null,
          // Serialize relations
          sharedByMe: user.sharedByMe.map((s: any) => ({
              ...s,
              ownerId: s.ownerId.toString(),
              guestId: s.guestId.toString(),
              guest: { ...s.guest, telegramId: s.guest.telegramId.toString(), discordId: s.guest.discordId?.toString() || null, giftedById: s.guest.giftedById?.toString() || null }
          })),
          sharedToMe: user.sharedToMe.map((s: any) => ({
            ...s,
            ownerId: s.ownerId.toString(),
            guestId: s.guestId.toString(),
            owner: { ...s.owner, telegramId: s.owner.telegramId.toString(), discordId: s.owner.discordId?.toString() || null, giftedById: s.owner.giftedById?.toString() || null }
        })),
        supportTickets: user.supportTickets.map((t: any) => ({
            ...t,
            userId: t.userId.toString(),
            agentId: t.agentId?.toString() || null,
            assignedBy: t.assignedBy?.toString() || null
        }))
      };
    }
  );

  // --- PATCH USER ---
  server.patch(
    '/users/:id',
    {
      schema: {
        params: UserParams,
        body: z.object({
            // GOD MODE FIELDS
            fragmentId: z.string().regex(/^[A-Z0-9-]{3,20}$/).optional(),
            username: z.string().optional(),
            firstName: z.string().optional(), // Added
            discordId: z.string().optional(), // Принимаем как строку, конвертим в BigInt
            donationAmount: z.number().int().optional(),
            notifyOnNewBuilds: z.boolean().optional(),
            isFrozen: z.boolean().optional(),
            status: z.nativeEnum(UserStatus).optional(),
            subscriptionLevel: z.nativeEnum(SubscriptionLevel).nullable().optional(),
            expiresAtFragment: z.string().datetime().nullable().optional(), // ISO date
            expiresAtExtra: z.string().datetime().nullable().optional(),
            giftedById: z.string().optional().nullable(), // Можно переназначить дарителя
            promoAttempts: z.number().int().optional()
        })
      },
    },
    async (request, reply) => {
        const { id } = request.params;
        const data = request.body;
        
        const updateData: any = { ...data };
        
        // Handle dates
        if (updateData.expiresAtFragment) updateData.expiresAtFragment = new Date(updateData.expiresAtFragment);
        if (updateData.expiresAtExtra) updateData.expiresAtExtra = new Date(updateData.expiresAtExtra);
        
        // Handle BigInts
        if (updateData.discordId) updateData.discordId = BigInt(updateData.discordId);
        if (updateData.giftedById) updateData.giftedById = BigInt(updateData.giftedById);

        try {
            const updated = await prisma.user.update({
                where: { telegramId: BigInt(id) },
                data: updateData
            });
            return { success: true, user: { ...updated, telegramId: updated.telegramId.toString(), discordId: updated.discordId?.toString() || null, giftedById: updated.giftedById?.toString() || null } };
        } catch (e: any) {
            // Check for Unique Constraint Violation (P2002)
            if (e.code === 'P2002' && e.meta?.target?.includes('fragmentId')) {
                return reply.status(400).send({ error: 'Fragment ID already taken' });
            }
            return reply.status(404).send({ error: 'User not found or update failed: ' + e.message });
        }
    }
  );
  
  // --- BAN USER ---
    server.post(
    '/users/:id/ban',
    {
      schema: {
        params: UserParams,
        body: z.object({
            reason: z.string().default('Admin manual ban')
        })
      },
    },
    async (request, reply) => {
        const { id } = request.params;
        const { reason } = request.body;
        
        await prisma.user.update({
            where: { telegramId: BigInt(id) },
            data: {
                // bannedAt: new Date(), // TODO: Add bannedAt to schema if not exists? User model has bannedAt.
                bannedAt: new Date(),
                banReason: reason
            }
        });
        return { success: true, message: 'User banned' };
    });

  // --- UNBAN USER ---
  server.post(
    '/users/:id/unban',
    {
        schema: { params: UserParams }
    },
    async (request, reply) => {
        const { id } = request.params;
        await prisma.user.update({
            where: { telegramId: BigInt(id) },
            data: {
                bannedAt: null,
                banReason: null
            }
        });
        return { success: true, message: 'User unbanned' };
    });


  // --- PROMO CODES ---
  server.get('/promos', async (request, reply) => {
      const promos = await prisma.promoCode.findMany({
          orderBy: { createdAt: 'desc' },
          include: { _count: { select: { activations: true } } }
      });
      return promos;
  });

  server.post(
      '/promos',
      {
          schema: {
              body: z.object({
                  code: z.string().min(3),
                  grantDays: z.coerce.number().min(1),
                  grantLevel: z.preprocess((val) => String(val).toLowerCase(), z.nativeEnum(SubscriptionLevel)).default(SubscriptionLevel.NOVICE),
                  maxActivations: z.coerce.number().default(1),
                  validMinutes: z.coerce.number().optional() // Optional duration in minutes
              })
          }
      },
      async (request, reply) => {
          const { code, grantDays, grantLevel, maxActivations, validMinutes } = request.body;
          
          let validUntil: Date | undefined;
          if (validMinutes) {
              validUntil = new Date();
              validUntil.setMinutes(validUntil.getMinutes() + validMinutes);
          }

          try {
              const promo = await prisma.promoCode.create({
                  data: {
                      code,
                      grantDays,
                      grantLevel,
                      maxActivations,
                      validUntil
                  }
              });
              return { success: true, promo };
          } catch (e) {
              return reply.status(400).send({ error: 'Code already exists' });
          }
      }
  );

  server.delete('/promos/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      try {
          await prisma.promoActivation.deleteMany({ where: { promoId: parseInt(id) } }); // Удаляем связи
          await prisma.promoCode.delete({ where: { id: parseInt(id) } });
          return { success: true };
      } catch (e) {
          return reply.status(404).send({ error: 'Promo not found' });
      }
  });
  
    // --- STATS (DASHBOARD) ---
  server.get('/dashboard', async (request, reply) => {
      const [
          totalUsers,
          activeUsers,
          usersByLevel,
          frozenUsers,
          sharedUsers,
          totalTickets,
          openTickets,
          unassignedTickets,
          closedTickets,
          totalAgents,
          promoRequestsTotal,
          promoRequestsPending,
          promoRequestsApproved,
          promoCodesTotal,
          promoCodesActivations
      ] = await Promise.all([
          // Users
          prisma.user.count(),
          prisma.user.count({ where: { status: UserStatus.ACTIVE } }),
          prisma.user.groupBy({
              by: ['subscriptionLevel'],
              _count: { telegramId: true }
          }),
          prisma.user.count({ where: { isFrozen: true } }),
          prisma.user.count({ where: { status: UserStatus.SHARED } }),
          
          // Tickets
          prisma.supportTicket.count(),
          prisma.supportTicket.count({ where: { status: 'open' } }),
          prisma.supportTicket.count({ where: { agentId: null, status: 'open' } }),
          prisma.supportTicket.count({ where: { status: 'closed' } }),
          
          // Agents
          prisma.supportAgent.count({ where: { isActive: true } }),

          // Promo Requests (Actions)
          prisma.promoRequest.count(),
          prisma.promoRequest.count({ where: { status: 'pending' } }),
          prisma.promoRequest.count({ where: { status: 'approved' } }),

          // Promo Codes
          prisma.promoCode.count(),
          prisma.promoActivation.count()
      ]);
      
      // Format Users by Level
      const levels = {
          novice: 0,
          adept: 0,
          legend: 0,
          spark: 0,
          none: 0
      };
      usersByLevel.forEach((g: any) => {
          if (g.subscriptionLevel) {
              (levels as any)[g.subscriptionLevel] = g._count.telegramId;
          } else {
              levels.none += g._count.telegramId;
          }
      });
      
      return {
          users: {
              total: totalUsers,
              active: activeUsers,
              frozen: frozenUsers,
              shared: sharedUsers,
              byLevel: levels
          },
          tickets: {
              total: totalTickets,
              open: openTickets,
              unassigned: unassignedTickets, // Тикеты, которые никто не принял
              closed: closedTickets
          },
          staff: {
              agents: totalAgents
          },
          promos: {
              requests: {
                  total: promoRequestsTotal,
                  pending: promoRequestsPending,
                  approved: promoRequestsApproved
              },
              codes: {
                  total: promoCodesTotal,
                  activations: promoCodesActivations
              }
          }
      };
  });

  // --- AGENT STATS ---
  server.get('/agents/stats', async (request, reply) => {
      const agents = await prisma.supportAgent.findMany();
      
      // Агрегация тикетов по агентам
      const ticketStats = await prisma.supportTicket.groupBy({
          by: ['agentId'],
          _count: { id: true },
          where: { agentId: { not: null } }
      });
      
      const closedStats = await prisma.supportTicket.groupBy({
          by: ['agentId'],
          _count: { id: true },
          where: { agentId: { not: null }, status: 'closed' }
      });

      const result = agents.map((agent: any) => {
          const total = ticketStats.find((s: any) => s.agentId === agent.telegramId)?._count.id || 0;
          const closed = closedStats.find((s: any) => s.agentId === agent.telegramId)?._count.id || 0;
          
          return {
              id: agent.telegramId.toString(),
              username: agent.username,
              isActive: agent.isActive,
              tickets: {
                  totalAssigned: total,
                  closed: closed,
                  open: total - closed
              }
          };
      });

      return result;
  });
};
