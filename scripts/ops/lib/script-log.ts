import { createLogger } from "#/server/lib/log/logger";

type Level = "info" | "warn" | "error";

/** The ops scripts mark each status line: `✗` failed, `!` needs attention, anything else is info. */
const LEVEL_BY_MARK: Partial<Record<string, Level>> = { "✗": "error", "!": "warn" };

/** An ops script's line logger (tslog, named after the script), levelled by each line's mark. */
export function scriptLog(name: string): (line: string) => void {
  const log = createLogger(name);
  return (line) => log[LEVEL_BY_MARK[line.trimStart().charAt(0)] ?? "info"](line);
}
