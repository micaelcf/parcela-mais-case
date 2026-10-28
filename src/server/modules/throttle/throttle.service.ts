import { env } from "#/server/infra/env/server-env";
import { hashIp } from "#/server/lib/crypto/ip-hash";
import { DomainError } from "#/server/lib/errors/domain-error";

import { type ThrottleRoute, throttleRepository } from "./throttle.repository";

const RETENTION_GRACE_MS = 24 * 60 * 60 * 1000;

/** Requests one IP may make per route inside `RATE_LIMIT_IP_WINDOW_MINUTES`. */
const ROUTE_CAP: Record<ThrottleRoute, number> = {
  "consultation.create": env.RATE_LIMIT_IP_MAX,
  "consultation.requote": env.RATE_LIMIT_IP_MAX,
  "address.lookup": env.RATE_LIMIT_LOOKUP_IP_MAX,
};

export const throttleService = {
  /**
   * Counts one request (`boundaries.md` § Throttle): records it, then counts the IP's rows for the
   * route inside `RATE_LIMIT_IP_WINDOW_MINUTES`. `rejection` is set once the count passes the
   * route's cap (`RATE_LIMIT_LOOKUP_IP_MAX` for CEP lookups, `RATE_LIMIT_IP_MAX` otherwise); the
   * row stays and is counted like any other.
   */
  async admit(
    ip: string,
    route: ThrottleRoute,
  ): Promise<{ requestId: string; rejection: DomainError | null }> {
    const ipHmac = hashIp(ip);
    const requestId = await throttleRepository.insert({ ipHmac, route });
    const count = await throttleRepository.countRecent(
      ipHmac,
      route,
      env.RATE_LIMIT_IP_WINDOW_MINUTES,
    );
    const rejection =
      count > ROUTE_CAP[route]
        ? new DomainError(
            "IP_LIMIT",
            "Muitas solicitações a partir deste endereço. Tente novamente mais tarde.",
          )
        : null;
    return { requestId, rejection };
  },

  /** Writes the answer a counted request got (abuse metrics, RF-614). */
  recordOutcome(requestId: string, statusCode: number, errorCode: string | null): Promise<void> {
    return throttleRepository.recordOutcome(requestId, statusCode, errorCode);
  },

  /** Deletes rows older than the IP window + 24 h, relative to `now`; returns how many. */
  purgeExpired(now: Date = new Date()): Promise<number> {
    const retentionMs = env.RATE_LIMIT_IP_WINDOW_MINUTES * 60_000 + RETENTION_GRACE_MS;
    return throttleRepository.deleteCreatedBefore(new Date(now.getTime() - retentionMs));
  },
};
