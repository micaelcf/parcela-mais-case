type Level = "info" | "warn" | "error";

/** Values a log line may carry. Callers pass ids, codes and measurements, never PII. */
export type LogFields = Record<string, string | number | boolean | null | undefined>;

function write(level: Level, event: string, fields: LogFields): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields });
  if (level === "error") console.error(line);
  else console.log(line);
}

/** One JSON line per event on stdout/stderr. */
export const logger = {
  info: (event: string, fields: LogFields = {}) => write("info", event, fields),
  warn: (event: string, fields: LogFields = {}) => write("warn", event, fields),
  error: (event: string, fields: LogFields = {}) => write("error", event, fields),
};
