/**
 * The only way ops scripts run a command. Every command goes through `remoteCommandReason` first, so
 * no ops script can reach another host (RF-710): no SSH family, no git network verbs, no engine
 * flag or env override that points the engine at a remote daemon. Node-safe; the Bun entries inject
 * the executor.
 */

export type Env = Readonly<Record<string, string | undefined>>;

export type ExecOptions = {
  /** Merged over the runner's base env. */
  readonly env?: Env;
  /** Capture output without echoing it (for commands whose output is parsed). */
  readonly quiet?: boolean;
};

export type CommandResult = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
};

export type Exec = (argv: readonly string[], options: ExecOptions) => Promise<CommandResult>;

export type RunCommand = (argv: readonly string[], options?: ExecOptions) => Promise<CommandResult>;

export class RemoteCommandError extends Error {
  constructor(argv: readonly string[], reason: string) {
    super(`refused \`${argv.join(" ")}\`: ${reason}`);
    this.name = "RemoteCommandError";
  }
}

const ENGINES: Record<string, true> = { podman: true, docker: true };
const LOCAL_GIT_VERBS: Record<string, true> = { status: true, "rev-parse": true };
const TOOLCHAIN: Record<string, true> = { bun: true, vp: true };
const REMOTE_ENV_VARS = ["DOCKER_HOST", "CONTAINER_HOST"] as const;
const REMOTE_ENGINE_FLAGS = ["-H", "--host", "--url", "--connection"] as const;
/** `podman -c <name>` is `--connection`; only meaningful before the subcommand. */
const REMOTE_ENGINE_GLOBAL_SHORT_FLAGS: Record<string, true> = { "-c": true };

/** `C:\…\podman.exe` → `podman`, `/usr/bin/git` → `git`. */
export function programName(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path;
  return base.replace(/\.(exe|cmd|bat)$/i, "").toLowerCase();
}

function remoteEngineFlag(args: readonly string[]): string | undefined {
  for (const arg of args) {
    const flag = REMOTE_ENGINE_FLAGS.find((name) => arg === name || arg.startsWith(`${name}=`));
    if (flag) return flag;
  }
  for (const arg of args) {
    if (!arg.startsWith("-")) break;
    if (REMOTE_ENGINE_GLOBAL_SHORT_FLAGS[arg] === true) return arg;
  }
  return undefined;
}

/** Why a command must not run, or `null` when it is a local command the ops scripts may use. */
export function remoteCommandReason(argv: readonly string[], env: Env): string | null {
  const [program, ...args] = argv;
  if (!program) return "empty command";

  const remoteVar = REMOTE_ENV_VARS.find((name) => env[name]);
  if (remoteVar) return `${remoteVar} points the engine at another host; unset it`;

  const name = programName(program);
  if (ENGINES[name] === true) {
    const flag = remoteEngineFlag(args);
    return flag ? `the ${flag} flag targets a remote engine` : null;
  }
  if (name === "git") {
    const verb = args[0];
    return verb && LOCAL_GIT_VERBS[verb] === true
      ? null
      : "only `git status` and `git rev-parse` are allowed";
  }
  if (TOOLCHAIN[name] === true) return null;
  return `\`${name}\` is not an allowed ops command`;
}

/** Throws `RemoteCommandError` unless `remoteCommandReason` allows the command. */
export function assertLocalCommand(argv: readonly string[], env: Env): void {
  const reason = remoteCommandReason(argv, env);
  if (reason !== null) throw new RemoteCommandError(argv, reason);
}

/** Wraps an executor so every command is policy-checked against the merged env before it runs. */
export function createRunner(exec: Exec, baseEnv: Env): RunCommand {
  return async (argv, options = {}) => {
    const env = { ...baseEnv, ...options.env };
    assertLocalCommand(argv, env);
    return exec(argv, { ...options, env });
  };
}

/** Throws unless the URL targets this machine (`localhost`); ops scripts never fetch another host. */
export function assertLocalUrl(url: string): void {
  const { hostname } = new URL(url);
  if (hostname !== "localhost") throw new Error(`refused ${url}: ops scripts only call localhost`);
}
