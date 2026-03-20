import { prisma } from '../database/prisma';

// Используем только заглавные латинские буквы
const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const ID_LENGTH = 3; // 3+3=6 символов(ABC-XYZ)

function generateRandomString(length: number): string {
  let result = '';
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * CHARSET.length);
    result += CHARSET[randomIndex];
  }
  return result;
}

export async function generateFragmentId(): Promise<string> {
  let isUnique = false;
  let fragmentId = '';

  while (!isUnique) {
    const part1 = generateRandomString(ID_LENGTH);
    const part2 = generateRandomString(ID_LENGTH);
    fragmentId = `${part1}-${part2}`;

    const existingUser = await prisma.user.findUnique({
      where: { fragmentId },
    });

    if (!existingUser) {
      isUnique = true;
    }
  }

  return fragmentId;
}
