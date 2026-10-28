/** The IP counted for a request when no proxy sets `X-Forwarded-For` (dev without Caddy). */
export const LOCAL_CLIENT_IP = "local";

/**
 * The client address Caddy sets: the first `X-Forwarded-For` entry. Caddy trusts no upstream
 * proxy, so it replaces any client-supplied value and the first entry is always the peer it saw.
 */
export function clientIp(headers: Headers): string {
  const first = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return first ? first : LOCAL_CLIENT_IP;
}
