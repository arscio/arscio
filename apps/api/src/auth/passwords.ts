// Passwords are never stored as-is. We store an Argon2 "hash" - a one-way
// scramble. Even we can't read a password back; we can only check a guess.
import { hash, verify } from '@node-rs/argon2';
import { badRequest } from '../errors.js';

const COMMON = new Set([
  '123456', '1234567', '12345678', '123456789', '1234567890', 'password', 'password1',
  'qwerty', 'abc123', '111111', '000000', '654321', 'iloveyou', 'admin123', '987654321',
]);

/** Rules kept simple for parents: at least 6 characters, not an obvious one. */
export function checkPasswordStrength(pw: string): void {
  if (pw.length < 6) throw badRequest('weak_password', 'Password must be at least 6 characters');
  if (pw.length > 128) throw badRequest('weak_password', 'Password is too long');
  if (COMMON.has(pw.toLowerCase()) || /^(.)\1+$/.test(pw)) {
    throw badRequest('weak_password', 'This password is too easy to guess. Please choose another.');
  }
}

export const hashPassword = (pw: string) => hash(pw);
export const verifyPassword = (stored: string, pw: string) => verify(stored, pw);
