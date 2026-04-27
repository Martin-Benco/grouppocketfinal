import { createHash, randomBytes } from 'crypto';

const PEPPER = process.env.QUICKSPLIT_TOKEN_PEPPER || 'dev-change-in-production';

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(`${PEPPER}:${token}`).digest('hex');
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}
