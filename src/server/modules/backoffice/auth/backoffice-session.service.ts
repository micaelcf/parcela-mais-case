import { createHash, timingSafeEqual } from "node:crypto";

import { env } from "#/server/infra/env/server-env";
import { DomainError } from "#/server/lib/errors/domain-error";

import { verifyPassword } from "./password";

/** 8 h: one operator shift (RFC D12). */
export const SESSION_TTL_SECONDS = 8 * 60 * 60;

const SEPARATOR = "|";

export type BackofficeSession = { username: string; expiresAt: number };

/** Constant-time string equality (hashes first so lengths never leak). */
function sameText(a: string, b: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(a), digest(b));
}

/** The single-operator session (D12): `"<username>|<expiresAtEpochSeconds>"`, signed by Elysia. */
export const backofficeSessionService = {
  /** Checks the configured credentials; the cookie value of a new session, or INVALID_CREDENTIALS. */
  async login(username: string, password: string, now: Date = new Date()): Promise<string> {
    // Always run scrypt, so a wrong username costs as much as a wrong password.
    const passwordOk = await verifyPassword(password, env.BACKOFFICE_PASSWORD_HASH);
    if (!sameText(username, env.BACKOFFICE_USERNAME) || !passwordOk) {
      throw new DomainError("INVALID_CREDENTIALS", "Usuário ou senha inválidos.");
    }
    const expiresAt = Math.floor(now.getTime() / 1000) + SESSION_TTL_SECONDS;
    return `${env.BACKOFFICE_USERNAME}${SEPARATOR}${expiresAt}`;
  },

  /** The session in a verified cookie value; null when malformed, expired or for another user. */
  read(value: unknown, now: Date = new Date()): BackofficeSession | null {
    if (typeof value !== "string") return null;
    const at = value.lastIndexOf(SEPARATOR);
    if (at <= 0) return null;
    const username = value.slice(0, at);
    const expiresText = value.slice(at + 1);
    if (!/^\d+$/.test(expiresText)) return null;
    const expiresAt = Number(expiresText);
    if (expiresAt * 1000 <= now.getTime() || username !== env.BACKOFFICE_USERNAME) return null;
    return { username, expiresAt };
  },
};
