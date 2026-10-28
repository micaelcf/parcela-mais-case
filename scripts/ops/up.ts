#!/usr/bin/env bun
/**
 * `vp run up`: Postgres + migrations, then the app (`vp dev`) and the worker in the foreground with
 * prefixed logs; Ctrl-C stops both, Postgres keeps running (RF-701).
 * `vp run up --prod`: the `prod` compose profile behind Caddy, checked through `/api/health` (RF-702).
 */
import { existsSync } from "node:fs";

import { $, spawn, which } from "bun";

import { detectEngine } from "./lib/engine";
import { sleep } from "./lib/health";
import { assertLocalCommand, createRunner } from "./lib/run";
import { createShellExec } from "./lib/shell-exec";
import {
  createLinePrefixer,
  DEV_PROCESSES,
  parseUpArgs,
  runDevSetup,
  runProdUp,
} from "./lib/up-plan";

const parsed = parseUpArgs(process.argv.slice(2));
if (!parsed.ok) {
  console.error(`✗ ${parsed.error}`);
  process.exit(2);
}

const engine = detectEngine({
  env: process.env,
  which: (command) => which(command),
  exists: existsSync,
});
const run = createRunner(createShellExec($), process.env);
const log = (line: string) => console.log(line);

if (parsed.mode === "prod") {
  process.exit(
    await runProdUp({
      run,
      engine,
      fetch: (url) => fetch(url),
      sleep,
      httpPort: process.env.HTTP_PORT ?? "8080",
      log,
    }),
  );
}

const setup = await runDevSetup({ run, engine, log });
if (setup !== 0) process.exit(setup);

async function forward(
  stream: ReadableStream<Uint8Array>,
  prefix: string,
  target: NodeJS.WriteStream,
): Promise<void> {
  const prefixer = createLinePrefixer(prefix, (text) => target.write(text));
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    prefixer.push(decoder.decode(chunk.value, { stream: true }));
  }
  prefixer.flush();
}

const children = DEV_PROCESSES.map(({ name, argv }) => {
  assertLocalCommand(argv, process.env);
  const child = spawn([...argv], {
    stdin: "inherit",
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  });
  const prefix = `[${name}] `.padEnd(9);
  const output = Promise.all([
    forward(child.stdout, prefix, process.stdout),
    forward(child.stderr, prefix, process.stderr),
  ]);
  return { name, child, output };
});

let interrupted = false;
const stopAll = () => {
  for (const { child } of children) if (child.exitCode === null) child.kill();
};
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    interrupted = true;
    stopAll();
  });
}

const first = await Promise.race(
  children.map(({ name, child }) => child.exited.then((code) => ({ name, code }))),
);
if (!interrupted)
  console.error(`✗ ${first.name} exited with code ${first.code}; stopping the other process`);
stopAll();
await Promise.all(children.map(({ child, output }) => Promise.all([child.exited, output])));
console.log("stopped app and worker (Postgres keeps running)");
process.exit(interrupted ? 0 : first.code || 1);
