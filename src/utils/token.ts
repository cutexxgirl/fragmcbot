import { randomBytes } from 'crypto';

export const generateToken = (): string => {
  return randomBytes(32).toString('hex');
};