import { prisma } from '../../database/prisma';
import { BotContext } from '../../types/context';
import { UserStatus } from '../../config';
import { bot } from '../../bot';
import * as fs from 'fs/promises';
import * as path from 'path';

const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'builds');
const MAX_VERSIONS = 6;

export class BuildManager {

  static async initialize() {
    try {
      await fs.mkdir(UPLOAD_DIR, { recursive: true });
      console.log(`✅ Build upload directory is ready at: ${UPLOAD_DIR}`);
    } catch (error) {
      console.error('❌ Failed to create build upload directory:', error);
      process.exit(1);
    }
  }

  static async addNewVersion(
    ctx: BotContext,
    buildCodeName: string,
    version: string,
    description: string,
    fileId: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      await fs.mkdir(UPLOAD_DIR, { recursive: true });

      const build = await prisma.build.findUnique({ where: { codeName: buildCodeName } });
      if (!build) {
        return { success: false, message: '❌ Сборка с таким кодовым именем не найдена.' };
      }

      console.log(`[Build] Getting file for ${buildCodeName} v${version}`);
      const file = await ctx.telegram.getFile(fileId);
      
      if (!file || !('file_path' in file) || !file.file_path) {
        console.error('[Build] getFile did not return a file_path.');
        return { success: false, message: '❌ Локальный API сервер не вернул путь к файлу.' };
      }

      const sourceFilePath = file.file_path;
      const fileSize = file.file_size;
      console.log(`[Build] Received file path: ${sourceFilePath}`);

      const fileExtension = path.extname(sourceFilePath) || '.zip';
      const fileName = `${buildCodeName}-${version}${fileExtension}`;
      const destinationFilePath = path.join(UPLOAD_DIR, fileName);

      await fs.copyFile(sourceFilePath, destinationFilePath);
      console.log(`[Build] Copied file to: ${destinationFilePath}`);

      await prisma.buildVersion.create({
        data: {
          buildId: build.id,
          version,
          description,
          filePath: destinationFilePath,
          fileSize: BigInt(fileSize || 0),
          fileId,
        },
      });

      console.log(`[Build] Version ${version} created for ${build.name}`);

      // Отправляем уведомления пользователям
      await this.notifyUsersAboutNewVersion(build.codeName, build.name, version, description);

      // Автоматическое удаление старых версий
      await this.cleanOldVersions(build.id, build.name);

      return { success: true, message: `✅ Версия ${version} для сборки "${build.name}" успешно загружена!` };

    } catch (error) {
      console.error('Error adding new build version:', error);
      return { success: false, message: '❌ Произошла критическая ошибка при загрузке версии.' };
    }
  }

  /**
   * Уведомляет пользователей о новой версии сборки
   */
  private static async notifyUsersAboutNewVersion(
    buildCodeName: string,
    buildName: string,
    version: string,
    description: string
  ) {
    try {
      console.log(`[Build] Notifying users about ${buildName} v${version}`);

      const users = await prisma.user.findMany({
        where: {
          notifyOnNewBuilds: true,
          status: UserStatus.ACTIVE,
          isFrozen: false,
        },
        select: {
          telegramId: true,
          expiresAtFragment: true,
          expiresAtPulse: true,
          expiresAtGearwire: true,
          expiresAtOuch: true,
          isLegacy: true,
        },
      });

      const now = new Date();
      let notifiedCount = 0;

      for (const user of users) {
        try {
          let hasAccess = false;

          switch (buildCodeName) {
            case 'fragment':
              hasAccess = !!(user.expiresAtFragment && user.expiresAtFragment > now);
              break;
            case 'pulse':
              hasAccess = user.isLegacy || !!(user.expiresAtPulse && user.expiresAtPulse > now);
              break;
            case 'gearwire':
              hasAccess = user.isLegacy || !!(user.expiresAtGearwire && user.expiresAtGearwire > now);
              break;
            case 'ouch':
              hasAccess = user.isLegacy || !!(user.expiresAtOuch && user.expiresAtOuch > now);
              break;
          }

          if (!hasAccess) continue;

          const message = 
            `🎉 <b>Новая версия доступна!</b>\n\n` +
            `📦 <b>Сборка:</b> ${buildName}\n` +
            `🔢 <b>Версия:</b> ${version}\n\n` +
            `📝 <b>Что нового:</b>\n${description || 'Описание отсутствует'}`;

          await bot.telegram.sendMessage(Number(user.telegramId), message, {
            parse_mode: 'HTML',
          });

          notifiedCount++;
          await new Promise(resolve => setTimeout(resolve, 100));

        } catch (error) {
          console.log(`[Build] Could not notify user ${user.telegramId}:`, error);
        }
      }

      console.log(`[Build] ✅ Notified ${notifiedCount} users about ${buildName} v${version}`);
    } catch (error) {
      console.error('[Build] Error notifying users:', error);
    }
  }

  /**
   * Удаляет старые версии, оставляя только MAX_VERSIONS последних
   */
  private static async cleanOldVersions(buildId: number, buildName: string) {
    try {
      const allVersions = await prisma.buildVersion.findMany({
        where: { buildId },
        orderBy: { createdAt: 'desc' },
      });

      if (allVersions.length <= MAX_VERSIONS) {
        console.log(`[Build] ${buildName} has ${allVersions.length} versions (within limit)`);
        return;
      }

      const versionsToDelete = allVersions.slice(MAX_VERSIONS);

      console.log(`[Build] Cleaning ${versionsToDelete.length} old versions for ${buildName}`);

      for (const version of versionsToDelete) {
        try {
          if (version.filePath) {
            try {
              await fs.unlink(version.filePath);
              console.log(`[Build] Deleted file: ${version.filePath}`);
            } catch (fileError) {
              console.warn(`[Build] Could not delete file ${version.filePath}:`, fileError);
            }
          }

          await prisma.buildVersion.delete({
            where: { id: version.id },
          });

          console.log(`[Build] Deleted version ${version.version} (${version.createdAt.toLocaleDateString()})`);
        } catch (error) {
          console.error(`[Build] Error deleting version ${version.id}:`, error);
        }
      }

      console.log(`[Build] ✅ Cleanup complete for ${buildName}, kept ${MAX_VERSIONS} latest versions`);
    } catch (error) {
      console.error('[Build] Error in cleanOldVersions:', error);
    }
  }
}