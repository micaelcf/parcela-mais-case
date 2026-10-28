#!/usr/bin/env bun
/** `vp run backoffice:hash-password`: reads a password (first stdin line), prints the env line. */
import { hashPassword } from "#/server/modules/backoffice/auth/password";

if (process.stdin.isTTY) process.stderr.write("Password: ");

let password = "";
for await (const line of console) {
  password = line.replace(/\r$/, "");
  break;
}

if (password === "") {
  console.error("✗ empty password (pipe it in or type it at the prompt)");
  process.exit(1);
}

console.log(`BACKOFFICE_PASSWORD_HASH=${await hashPassword(password)}`);
