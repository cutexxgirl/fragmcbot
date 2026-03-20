import { prisma } from '../../database/prisma';
import { bot } from '../../bot';
import { logEvent } from '../statistics/logger';
import { config, TicketStatus, SUBSCRIPTION_NAMES, SubscriptionLevel } from '../../config';
import { User } from '@prisma/client';

export class SupportSystem {
  
  static async createTicket(
    userId: bigint, 
    username: string | undefined, 
    message: any  // Теперь принимаем полный объект сообщения
  ) {
    const existingTicket = await prisma.supportTicket.findFirst({
      where: {
        userId,
        status: {
          in: [TicketStatus.OPEN, TicketStatus.IN_PROGRESS],
        },
      },
    });

    if (existingTicket) {
      return { 
        success: false, 
        ticketId: existingTicket.id,
        message: 'У вас уже есть открытый тикет' 
      };
    }

    const ticket = await prisma.supportTicket.create({
      data: {
        userId,
        status: TicketStatus.OPEN,
      },
      include: {
        user: true,
      },
    });

    // Сохраняем сообщение в БД - извлекаем текст из разных типов
    let messageText = '';
    let photoUrl: string | undefined;
    
    if (message.text) {
      messageText = message.text;
    } else if (message.caption) {
      messageText = message.caption;
    }
    
    // Для БД сохраняем file_id первого медиа (для обратной совместимости)
    if (message.photo) {
      photoUrl = message.photo[message.photo.length - 1].file_id;
    } else if (message.video) {
      photoUrl = message.video.file_id;
    } else if (message.animation) {
      photoUrl = message.animation.file_id;
    } else if (message.document) {
      photoUrl = message.document.file_id;
    }

    await prisma.ticketMessage.create({
      data: {
        ticketId: ticket.id,
        senderId: userId,
        senderRole: 'user',
        message: messageText || '[Медиа без подписи]',
        photoUrl,
      },
    });

    const user = ticket.user;
    const profileInfo = await this.getUserProfileInfo(user);

    const agents = await prisma.supportAgent.findMany({
      where: { isActive: true },
    });

    const mentionAgents = agents.map((agent: { telegramId: bigint }) => `[👤](tg://user?id=${agent.telegramId})`).join(' ');

    const safeUsername = username ? username.replace(/_/g, '\\_') : undefined;
    const headerText = `
🆘 **НОВЫЙ ТИКЕТ #${ticket.id}**
${mentionAgents}

👤 **Пользователь:** ${safeUsername ? '@' + safeUsername : 'Нет username'}
🆔 **ID:** \`${userId}\`

📋 **Профиль:**
${profileInfo}

💬 **Сообщение:**`;

    try {
      // Пересылаем сообщение в зависимости от типа
      if (message.text) {
        await bot.telegram.sendMessage(Number(config.groups.support), 
          `${headerText}\n${message.text}`, 
          { parse_mode: 'Markdown' }
        );
      }
      else if (message.photo) {
        const photo = message.photo[message.photo.length - 1];
        await bot.telegram.sendPhoto(Number(config.groups.support), photo.file_id, {
          caption: `${headerText}\n${message.caption || '[Фото без подписи]'}`,
          parse_mode: 'Markdown',
        });
      }
      else if (message.voice) {
        await bot.telegram.sendVoice(Number(config.groups.support), message.voice.file_id, {
          caption: `${headerText}\n${message.caption || '[Голосовое сообщение]'}`,
          parse_mode: 'Markdown',
        });
      }
      else if (message.audio) {
        await bot.telegram.sendAudio(Number(config.groups.support), message.audio.file_id, {
          caption: `${headerText}\n${message.caption || '[Аудио]'}`,
          parse_mode: 'Markdown',
        });
      }
      else if (message.document) {
        await bot.telegram.sendDocument(Number(config.groups.support), message.document.file_id, {
          caption: `${headerText}\n${message.caption || '[Документ]'}`,
          parse_mode: 'Markdown',
        });
      }
      else if (message.video) {
        await bot.telegram.sendVideo(Number(config.groups.support), message.video.file_id, {
          caption: `${headerText}\n${message.caption || '[Видео]'}`,
          parse_mode: 'Markdown',
        });
      }
      else if (message.animation) {
        await bot.telegram.sendAnimation(Number(config.groups.support), message.animation.file_id, {
          caption: `${headerText}\n${message.caption || '[GIF]'}`,
          parse_mode: 'Markdown',
        });
      }
      else if (message.sticker) {
        // Для стикера сначала отправляем заголовок, потом стикер
        await bot.telegram.sendMessage(Number(config.groups.support), 
          `${headerText}\n[Стикер]`, 
          { parse_mode: 'Markdown' }
        );
        await bot.telegram.sendSticker(Number(config.groups.support), message.sticker.file_id);
      }
      else if (message.video_note) {
        // Для видео-кружка тоже сначала заголовок
        await bot.telegram.sendMessage(Number(config.groups.support), 
          `${headerText}\n[Видео-сообщение]`, 
          { parse_mode: 'Markdown' }
        );
        await bot.telegram.sendVideoNote(Number(config.groups.support), message.video_note.file_id);
      }
      else if (message.location) {
        await bot.telegram.sendMessage(Number(config.groups.support), 
          `${headerText}\n[Локация]`, 
          { parse_mode: 'Markdown' }
        );
        await bot.telegram.sendLocation(Number(config.groups.support), 
          message.location.latitude, 
          message.location.longitude
        );
      }
      else if (message.contact) {
        await bot.telegram.sendMessage(Number(config.groups.support), 
          `${headerText}\n[Контакт]`, 
          { parse_mode: 'Markdown' }
        );
        await bot.telegram.sendContact(Number(config.groups.support),
          message.contact.phone_number,
          message.contact.first_name,
          { last_name: message.contact.last_name }
        );
      }
    } catch (error) {
      console.error('Failed to send ticket to support group:', error);
    }

    await logEvent('new_ticket', userId, { ticketId: ticket.id });

    return { 
      success: true, 
      ticketId: ticket.id,
      message: 'Тикет создан' 
    };
  }

  private static async getUserProfileInfo(user: User): Promise<string> {
    const formatDate = (date: Date | null) => {
      if (!date) return 'Нет';
      const now = new Date();
      if (date < now) return 'Истекло';
      return date.toLocaleDateString('ru-RU');
    };
    
    const subscriptionLevelName = user.subscriptionLevel 
      ? SUBSCRIPTION_NAMES[user.subscriptionLevel as SubscriptionLevel] 
      : 'Нет';

    const subscriptionStatus = (user.status === 'active' && !user.isFrozen) ? '✅ Активна' : 
      (user.status === 'shared' ? '🎁 Подарено' : '❌ Не активна');

    const extraAccess = user.expiresAtExtra && user.expiresAtExtra > new Date() 
      ? `✅ до ${formatDate(user.expiresAtExtra)}` 
      : 'Нет';

    return `
• FID: ${user.fragmentId || 'Не сгенерирован'}
• Подписка: ${subscriptionStatus}
• Уровень: ${subscriptionLevelName}
• До: ${formatDate(user.expiresAtFragment)}
• Доп. сборки: ${extraAccess}
• Заморожен: ${user.isFrozen ? '🔒 Да' : 'Нет'}
    `.trim();
  }

  static async assignTicket(ticketId: number, agentId: bigint) {
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: ticketId },
    include: { user: true },
  });

  if (!ticket) {
    return { success: false, message: 'Тикет не найден' };
  }

  if (ticket.status === TicketStatus.CLOSED) {
    return { success: false, message: 'Тикет уже закрыт' };
  }

  // Проверяем, не принят ли тикет уже
  if (ticket.agentId && ticket.agentId !== agentId) {
    return { 
      success: false, 
      message: 'Тикет уже принят другим сотрудником. Используйте "Теперь я" для перехвата.' 
    };
  }

  const agent = await prisma.supportAgent.findUnique({
    where: { telegramId: agentId },
  });

  if (!agent) {
    return { success: false, message: 'Вы не являетесь сотрудником поддержки' };
  }

  await prisma.supportTicket.update({
    where: { id: ticketId },
    data: {
      agentId,
      assignedBy: ticket.assignedBy || agentId, // Сохраняем первого, кто принял
      status: TicketStatus.IN_PROGRESS,
    },
  });

  try {
    await bot.telegram.sendMessage(
      Number(ticket.userId),
      `✅ Ваш тикет #${ticketId} принят в работу.\n\nОжидайте ответа от сотрудника поддержки.`
    );
  } catch (error) {
    console.log(`Cannot notify user ${ticket.userId}`);
  }

  try {
    await bot.telegram.sendMessage(
      Number(config.groups.support),
      `✅ Тикет #${ticketId} принят\n👤 @${agent.username || 'no_username'} | 🆔 \`${agentId}\``,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.log('Cannot send message to support group');
  }

  return { success: true, message: 'Тикет принят' };
}

  static async reassignTicket(ticketId: number, newAgentId: bigint) {
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: ticketId },
  });

  if (!ticket || ticket.status === TicketStatus.CLOSED) {
    return { success: false, message: 'Тикет не найден или закрыт' };
  }

  if (!ticket.agentId) {
    return { success: false, message: 'Тикет ещё не принят. Используйте "Я".' };
  }

  if (ticket.agentId === newAgentId) {
    return { success: false, message: 'Тикет уже закреплён за вами.' };
  }

  const newAgent = await prisma.supportAgent.findUnique({
    where: { telegramId: newAgentId },
  });

  if (!newAgent) {
    return { success: false, message: 'Вы не являетесь сотрудником поддержки' };
  }

  await prisma.supportTicket.update({
    where: { id: ticketId },
    data: { 
      agentId: newAgentId,
      reassignedCount: {
        increment: 1,
      },
    },
  });

  try {
    await bot.telegram.sendMessage(
      Number(config.groups.support),
      `🔄 Тикет #${ticketId} переназначен\n👤 @${newAgent.username || 'no_username'} | 🆔 \`${newAgentId}\``,
      { parse_mode: 'Markdown' }
    );
  } catch (error) {
    console.log('Cannot send message to support group');
  }

  return { success: true, message: 'Тикет переназначен' };
}

  static async sendMessage(
    ticketId: number, 
    senderId: bigint, 
    message: any  // Теперь принимаем полный объект сообщения
  ) {
    const ticket = await prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: { user: true },
    });

    if (!ticket) {
      return { success: false, message: 'Тикет не найден' };
    }

    if (ticket.status === TicketStatus.CLOSED) {
      return { success: false, message: 'Тикет закрыт' };
    }

    const isUser = senderId === ticket.userId;
    
    // Проверки для агента остаются теми же
    if (!isUser) {
      const agent = await prisma.supportAgent.findUnique({
        where: { telegramId: senderId, isActive: true },
      });

      if (!agent) {
        return { success: false, message: '❌ Вы не являетесь активным агентом поддержки' };
      }

      if (!ticket.agentId) {
        return { 
          success: false, 
          message: `❌ Тикет #${ticketId} ещё не принят.\n\nИспользуйте "Я" чтобы принять тикет.` 
        };
      }

      if (ticket.agentId !== senderId) {
        return { 
          success: false, 
          message: `❌ Тикет #${ticketId} принят другим агентом.\n\nИспользуйте "Теперь я" чтобы переназначить тикет на себя.` 
        };
      }
    }

    const senderRole = isUser ? 'user' : 'agent';

    // Сохраняем в БД (извлекаем текст для обратной совместимости)
    let messageText = '';
    let photoUrl: string | undefined;
    
    if (message.text) {
      messageText = message.text;
    } else if (message.caption) {
      messageText = message.caption;
    }
    
    if (message.photo) {
      photoUrl = message.photo[message.photo.length - 1].file_id;
    } else if (message.video) {
      photoUrl = message.video.file_id;
    } else if (message.animation) {
      photoUrl = message.animation.file_id;
    } else if (message.document) {
      photoUrl = message.document.file_id;
    }

    await prisma.ticketMessage.create({
      data: {
        ticketId,
        senderId,
        senderRole,
        message: messageText || '[Медиа без подписи]',
        photoUrl,
      },
    });

    if (isUser) {
      // От пользователя в группу
    const username = ticket.user.username ? ticket.user.username.replace(/_/g, '\\_') : null;
    const usernameDisplay = username ? `@${username}` : 'Нет username';
      let headerText = `📩 **Тикет #${ticketId}**\n👤 ${usernameDisplay} | 🆔 \`${ticket.userId}\``;
      
      if (ticket.agentId) {
        const agent = await prisma.supportAgent.findUnique({
          where: { telegramId: ticket.agentId },
        });
        if (agent) {
          const agentName = agent.username ? agent.username.replace(/_/g, '\\_') : 'no\\_username';
          headerText += `\n🔔 [Агент](tg://user?id=${ticket.agentId}) @${agentName}`;
        }
      }
      
      // Пересылаем все типы сообщений
      try {
        await this.forwardMessageToGroup(message, headerText);
      } catch (error) {
        console.error('Failed to forward message to support:', error);
      }
    } else {
      // От агента пользователю
      const headerText = `💬 **Ответ поддержки:**`;
      
      try {
        await this.forwardMessageToUser(message, Number(ticket.userId), headerText);
      } catch (error) {
        console.error('Failed to forward message to user:', error);
      }
    }

    return { success: true, message: 'Сообщение отправлено' };
  }

  // Вспомогательная функция для пересылки в группу
  private static async forwardMessageToGroup(message: any, headerText: string) {
    const groupId = Number(config.groups.support);
    
    if (message.text) {
      await bot.telegram.sendMessage(groupId, `${headerText}\n\n${message.text}`, 
        { parse_mode: 'Markdown' }
      );
    }
    else if (message.photo) {
      const photo = message.photo[message.photo.length - 1];
      await bot.telegram.sendPhoto(groupId, photo.file_id, {
        caption: `${headerText}\n\n${message.caption || ''}`,
        parse_mode: 'Markdown',
      });
    }
    else if (message.voice) {
      await bot.telegram.sendVoice(groupId, message.voice.file_id, {
        caption: headerText,
        parse_mode: 'Markdown',
      });
    }
    else if (message.audio) {
      await bot.telegram.sendAudio(groupId, message.audio.file_id, {
        caption: `${headerText}\n\n${message.caption || ''}`,
        parse_mode: 'Markdown',
      });
    }
    else if (message.document) {
      await bot.telegram.sendDocument(groupId, message.document.file_id, {
        caption: `${headerText}\n\n${message.caption || ''}`,
        parse_mode: 'Markdown',
      });
    }
    else if (message.video) {
      await bot.telegram.sendVideo(groupId, message.video.file_id, {
        caption: `${headerText}\n\n${message.caption || ''}`,
        parse_mode: 'Markdown',
      });
    }
    else if (message.animation) {
      await bot.telegram.sendAnimation(groupId, message.animation.file_id, {
        caption: `${headerText}\n\n${message.caption || ''}`,
        parse_mode: 'Markdown',
      });
    }
    else if (message.sticker) {
      await bot.telegram.sendMessage(groupId, headerText, { parse_mode: 'Markdown' });
      await bot.telegram.sendSticker(groupId, message.sticker.file_id);
    }
    else if (message.video_note) {
      await bot.telegram.sendMessage(groupId, headerText, { parse_mode: 'Markdown' });
      await bot.telegram.sendVideoNote(groupId, message.video_note.file_id);
    }
    else if (message.location) {
      await bot.telegram.sendMessage(groupId, headerText, { parse_mode: 'Markdown' });
      await bot.telegram.sendLocation(groupId, message.location.latitude, message.location.longitude);
    }
    else if (message.contact) {
      await bot.telegram.sendMessage(groupId, headerText, { parse_mode: 'Markdown' });
      await bot.telegram.sendContact(groupId, 
        message.contact.phone_number,
        message.contact.first_name,
        { last_name: message.contact.last_name }
      );
    }
  }

  // Вспомогательная функция для пересылки пользователю
  private static async forwardMessageToUser(message: any, userId: number, headerText: string) {
    if (message.text) {
      await bot.telegram.sendMessage(userId, `${headerText}\n\n${message.text}`, 
        { parse_mode: 'Markdown' }
      );
    }
    else if (message.photo) {
      const photo = message.photo[message.photo.length - 1];
      await bot.telegram.sendPhoto(userId, photo.file_id, {
        caption: `${headerText}\n\n${message.caption || ''}`,
        parse_mode: 'Markdown',
      });
    }
    else if (message.voice) {
      await bot.telegram.sendVoice(userId, message.voice.file_id, {
        caption: headerText,
        parse_mode: 'Markdown',
      });
    }
    else if (message.audio) {
      await bot.telegram.sendAudio(userId, message.audio.file_id, {
        caption: `${headerText}\n\n${message.caption || ''}`,
        parse_mode: 'Markdown',
      });
    }
    else if (message.document) {
      await bot.telegram.sendDocument(userId, message.document.file_id, {
        caption: `${headerText}\n\n${message.caption || ''}`,
        parse_mode: 'Markdown',
      });
    }
    else if (message.video) {
      await bot.telegram.sendVideo(userId, message.video.file_id, {
        caption: `${headerText}\n\n${message.caption || ''}`,
        parse_mode: 'Markdown',
      });
    }
    else if (message.animation) {
      await bot.telegram.sendAnimation(userId, message.animation.file_id, {
        caption: `${headerText}\n\n${message.caption || ''}`,
        parse_mode: 'Markdown',
      });
    }
    else if (message.sticker) {
      await bot.telegram.sendMessage(userId, headerText, { parse_mode: 'Markdown' });
      await bot.telegram.sendSticker(userId, message.sticker.file_id);
    }
    else if (message.video_note) {
      await bot.telegram.sendMessage(userId, headerText, { parse_mode: 'Markdown' });
      await bot.telegram.sendVideoNote(userId, message.video_note.file_id);
    }
    else if (message.location) {
      await bot.telegram.sendMessage(userId, headerText, { parse_mode: 'Markdown' });
      await bot.telegram.sendLocation(userId, message.location.latitude, message.location.longitude);
    }
    else if (message.contact) {
      await bot.telegram.sendMessage(userId, headerText, { parse_mode: 'Markdown' });
      await bot.telegram.sendContact(userId, 
        message.contact.phone_number,
        message.contact.first_name,
        { last_name: message.contact.last_name }
      );
    }
  }

  static async closeTicket(ticketId: number, closedBy: bigint) {
    const ticket = await prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: { user: true },
    });

    if (!ticket) {
      return { success: false, message: 'Тикет не найден' };
    }

    if (ticket.status === TicketStatus.CLOSED) {
      return { success: false, message: 'Тикет уже закрыт' };
    }

    await prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        status: TicketStatus.CLOSED,
        closedAt: new Date(),
      },
    });

    await logEvent('close_ticket', ticket.userId, { ticketId });

    try {
      await bot.telegram.sendMessage(
        Number(ticket.userId),
        `✅ Тикет #${ticketId} закрыт.\n\nЕсли у вас остались вопросы, создайте новый тикет.`
      );
    } catch (error) {
      console.log(`Cannot notify user ${ticket.userId}`);
    }

    try {
      await bot.telegram.sendMessage(
        Number(config.groups.support),
        `✅ Тикет #${ticketId} закрыт`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      console.log('Cannot send message to support group');
    }

    return { success: true, message: 'Тикет закрыт' };
  }

  static async getUserActiveTicket(userId: bigint) {
    return await prisma.supportTicket.findFirst({
      where: {
        userId,
        status: {
          in: [TicketStatus.OPEN, TicketStatus.IN_PROGRESS],
        },
      },
    });
  }

  static async getTicketById(ticketId: number) {
    return await prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: {
        user: true,
        messages: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });
  }
}