import { BotContext } from '../../types/context';
import { BuildDelivery } from '../../modules/builds/delivery';
import { Markup } from 'telegraf';
import * as fs from 'fs';
import { prisma } from '../../database/prisma';
import { logEvent } from '../../modules/statistics/logger';

// Вызывается по кнопке "Скачать"
export const showAvailableBuilds = async (ctx: BotContext) => {
  const user = await prisma.user.findUnique({ 
    where: { telegramId: BigInt(ctx.from!.id) } 
  });
  
  if (!user) return;

  const builds = await BuildDelivery.getAvailableBuilds(user);
  
  if (builds.length === 0) {
    return ctx.reply('У вас нет доступа к сборкам.');
  }

  const buttons = builds.map(build => 
    Markup.button.callback(build.name, `build_select_${build.codeName}`)
  );
  
  if (ctx.callbackQuery) {
    try {
      return await ctx.editMessageText(
        'Выберите сборку для загрузки:', 
        Markup.inlineKeyboard(buttons, { columns: 2 })
      );
    } catch (e) { /* Игнорируем */ }
  }

  await ctx.reply(
    'Выберите сборку для загрузки:', 
    Markup.inlineKeyboard(buttons, { columns: 2 })
  );
};

// Вызывается при выборе конкретной сборки
export const showBuildVersions = async (ctx: BotContext) => {
  if (!ctx.match) return;
  
  const buildCodeName = ctx.match[1];
  const versions = await BuildDelivery.getBuildVersions(buildCodeName);
  
  if (versions.length === 0) {
    await ctx.answerCbQuery('Для этой сборки еще не загружено ни одной версии.');
    return;
  }

  const buttons = versions.map(v => 
    Markup.button.callback(
      `v${v.version} (${v.createdAt.toLocaleDateString('ru-RU')})`, 
      `version_select_${v.id}`
    )
  );
  
  buttons.push(Markup.button.callback('◀️ Назад к сборкам', 'back_to_builds'));

  await ctx.editMessageText(
    'Выберите версию:', 
    Markup.inlineKeyboard(buttons, { columns: 1 })
  );
};

// Вызывается при выборе версии для скачивания
export const sendBuildFile = async (ctx: BotContext) => {
  if (!ctx.match) return;
  
  const versionId = parseInt(ctx.match[1], 10);
  
  // Получаем информацию о версии с build
  const buildVersion = await prisma.buildVersion.findUnique({
    where: { id: versionId },
    include: { build: true },
  });

  if (!buildVersion) {
    await ctx.answerCbQuery('❌ Версия не найдена. Возможно, она была удалена.');
    return;
  }

  const downloadInfo = {
    description: buildVersion.description,
    filePath: buildVersion.filePath,
    fileId: buildVersion.fileId,
  };
  
  await ctx.answerCbQuery('⏳ Подготовка файла...');
  
  try { 
    await ctx.deleteMessage(); 
  } catch(e) {}

  await ctx.replyWithHTML(
    `<b>Описание изменений:</b>\n\n${downloadInfo.description || 'Описание отсутствует.'}`
  );

  try {
    // Пробуем отправить по file_id (кэшированная отправка)
    if (downloadInfo.fileId) {
      await ctx.replyWithDocument(downloadInfo.fileId);
      
      // Логируем скачивание
      await logEvent('download_build', BigInt(ctx.from!.id), { 
        buildCodeName: buildVersion.build.codeName,
        buildName: buildVersion.build.name,
        versionId: versionId,
        version: buildVersion.version,
      });
      
      return;
    }

    // Если file_id нет, отправляем с диска
    if (!downloadInfo.filePath || !fs.existsSync(downloadInfo.filePath)) {
      console.error(`File not found on disk: ${downloadInfo.filePath}`);
      await ctx.reply('❌ Файл сборки не найден на сервере. Пожалуйста, обратитесь в поддержку.');
      return;
    }

    const message = await ctx.replyWithDocument({ source: downloadInfo.filePath });

    // Кэшируем file_id
    // @ts-ignore
    const sentFileId = message && message.document && message.document.file_id;
    if (sentFileId) {
      try {
        await prisma.buildVersion.update({
          where: { id: versionId },
          data: { fileId: sentFileId },
        });
      } catch (dbErr) {
        console.error('Failed to save fileId to DB:', dbErr);
      }
    }

    // Логируем скачивание
    await logEvent('download_build', BigInt(ctx.from!.id), { 
      buildCodeName: buildVersion.build.codeName,
      buildName: buildVersion.build.name,
      versionId: versionId,
      version: buildVersion.version,
    });

  } catch (error) {
    console.error(`Failed to send build file for version ${versionId}:`, error);
    await ctx.reply('❌ Не удалось отправить файл. Пожалуйста, обратитесь в поддержку.');
  }
};