import { Logger, type ILogObj, type ISettingsParam } from "tslog";

/** Values a log line may carry. Callers pass ids, codes and measurements, never PII. */
export type LogFields = Record<string, string | number | boolean | null | undefined>;

/**
 * Field names that would be PII if a caller ever passed one, masked in every output. A safety net:
 * callers pass ids, codes and measurements only (RF-811).
 */
const PII_KEYS = [
  "cpf",
  "fullName",
  "birthdate",
  "phone",
  "email",
  "monthlyIncomeCents",
  "address",
  "street",
  "addressNumber",
  "cep",
  "password",
  "cookie",
  "authorization",
];

/**
 * The project's tslog settings. Pretty by default: a time, the level in its colour, the event and
 * its fields on one line (coloured on a terminal; `vp run up` sets `FORCE_COLOR` for its children
 * and colours each process's line prefix). `TSLOG_TYPE=json` (the production stack) writes one JSON
 * line per event, `{ event, level, ts, …fields, _logMeta: { name, … } }`; `TSLOG_TYPE=hidden` (the
 * tests) prints nothing while transports still receive every record. `TSLOG_NAME` names the
 * process (app, worker, migrate); `TSLOG_LEVEL` sets the minimum level.
 */
const SETTINGS: ISettingsParam<ILogObj> = {
  json: { messageKey: "event", levelKey: "level", timeKey: "ts", numericLevel: false },
  pretty: {
    template: "{{hh}}:{{MM}}:{{ss}}.{{ms}} {{logLevelName}} ",
    timeZone: "local",
    styles: {
      hh: "dim",
      MM: "dim",
      ss: "dim",
      ms: "dim",
      logLevelName: {
        "*": ["bold", "white"],
        DEBUG: ["bold", "green"],
        INFO: ["bold", "blue"],
        WARN: ["bold", "yellow"],
        ERROR: ["bold", "red"],
        FATAL: ["bold", "redBright"],
      },
    },
    inspectOptions: { breakLength: Number.POSITIVE_INFINITY, compact: true },
  },
  mask: { keys: PII_KEYS, caseInsensitive: true },
};

type Level = "info" | "warn" | "error";

/** One event per call: `event` names it (`lender.call`), `fields` carry its ids and measurements. */
export type AppLogger = Record<Level, (event: string, fields?: LogFields) => void> & {
  /** Adds a sink (e.g. a test capturing JSON lines); returns its detach function. */
  attachTransport: Logger<ILogObj>["attachTransport"];
};

/** A logger for one process or script; `name` overrides `TSLOG_NAME`. */
export function createLogger(name?: string): AppLogger {
  const base = Logger.fromEnv({ ...SETTINGS, ...(name === undefined ? {} : { name }) });
  const emit =
    (level: Level) =>
    (event: string, fields: LogFields = {}) => {
      if (Object.keys(fields).length === 0) base[level](event);
      else base[level](event, fields);
    };
  return {
    info: emit("info"),
    warn: emit("warn"),
    error: emit("error"),
    attachTransport: (transport) => base.attachTransport(transport),
  };
}

/** This process's logger (app or worker, by `TSLOG_NAME`; `app` when unset). */
export const logger: AppLogger = createLogger(undefined);
