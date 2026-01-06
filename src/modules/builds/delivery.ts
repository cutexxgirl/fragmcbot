import { prisma } from '../../database/prisma';
import { Build, BuildVersion, User } from '@prisma/client';

export type BuildCodeName = 'fragment' | 'pulse' | 'gearwire' | 'ouch';
export type DownloadInfo = { description: string | null; filePath: string; fileId: string | null };

const USER_ACCESS_FIELDS: Record<BuildCodeName, keyof Pick<User, 'expiresAtFragment' | 'expiresAtPulse' | 'expiresAtGearwire' | 'expiresAtOuch'>> = {
  fragment: 'expiresAtFragment',
  pulse: 'expiresAtPulse',
  gearwire: 'expiresAtGearwire',
  ouch: 'expiresAtOuch',
};

export class BuildDelivery {
  static async getAvailableBuilds(user: User): Promise<Build[]> {
    const now = new Date();

    // Если пользователь забанен или заморожен или неактивен — доступа нет
    if (user.bannedAt || user.isFrozen || user.status !== 'active') {
      return [];
    }

    const accessibleCodeNames: BuildCodeName[] = [];

    // Legacy-пользователь получает доступ к 3 доп. сборкам
    if (user.isLegacy) {
      // Legacy даёт pulse, gearwire, ouch (но НЕ fragment!)
      if (!accessibleCodeNames.includes('pulse')) accessibleCodeNames.push('pulse');
      if (!accessibleCodeNames.includes('gearwire')) accessibleCodeNames.push('gearwire');
      if (!accessibleCodeNames.includes('ouch')) accessibleCodeNames.push('ouch');
    }

    // Проверяем срок доступа для каждой сборки
    for (const code of Object.keys(USER_ACCESS_FIELDS) as BuildCodeName[]) {
      const field = USER_ACCESS_FIELDS[code];
      const expiresAt = user[field] as Date | null;
      
      // Если есть дата истечения и она в будущем - есть доступ
      if (expiresAt && expiresAt > now && !accessibleCodeNames.includes(code)) {
        accessibleCodeNames.push(code);
      }
    }

    // УДАЛЕНА проверка hasPromoAccess - теперь всё через expiresAtFragment!

    if (accessibleCodeNames.length === 0) return [];

    return prisma.build.findMany({
      where: { codeName: { in: accessibleCodeNames } },
      orderBy: { id: 'asc' },
    });
  }

  static async getBuildVersions(buildCodeName: string): Promise<BuildVersion[]> {
    return prisma.buildVersion.findMany({
      where: { build: { codeName: buildCodeName } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
  }

  static async getDownloadInfo(versionId: number): Promise<DownloadInfo | null> {
    return prisma.buildVersion.findUnique({
      where: { id: versionId },
      select: { description: true, filePath: true, fileId: true },
    });
  }

  static shouldShowDownloadButton(user: Pick<User, 'status' | 'isFrozen'>): boolean {
    return user.status === 'active' && !user.isFrozen;
  }
}