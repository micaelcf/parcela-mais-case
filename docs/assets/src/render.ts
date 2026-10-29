// Renders the README animations to docs/assets/<name>.gif.
//   bun docs/assets/src/render.ts                 # all three
//   bun docs/assets/src/render.ts fan-out         # just one
//   bun docs/assets/src/render.ts --keep journey  # keep the PNG frames (path printed)
// Each scene is seeked frame by frame (`window.seek(t)`), screenshotted with Playwright's
// Chromium, then encoded by ffmpeg with a per-GIF palette.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { chromium } from "@playwright/test";

/** What `common.js` exposes on each scene page. */
declare global {
  interface Window {
    DURATION: number;
    seek(t: number): void;
  }
}

const FPS = 12.5; // 8 cs per frame: GIF delays are whole centiseconds
const SCENES = ["fan-out", "live-updates", "journey"];

const args = process.argv.slice(2);
const keep = args.includes("--keep");
const names = args.filter((a) => !a.startsWith("--"));
const targets = names.length > 0 ? names : SCENES;
const srcDir = import.meta.dir;
const outDir = join(srcDir, "..");

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 1 });

for (const name of targets) {
  const frames = mkdtempSync(join(tmpdir(), `gif-${name}-`));
  await page.goto(`${pathToFileURL(join(srcDir, `${name}.html`)).href}?render`);
  await page.evaluate(() => document.fonts.ready);
  const duration = await page.evaluate(() => window.DURATION);
  const count = Math.round(duration * FPS);
  for (let i = 0; i < count; i++) {
    await page.evaluate((t) => window.seek(t), i / FPS);
    await page.screenshot({ path: join(frames, `f${String(i).padStart(4, "0")}.png`) });
  }

  const out = join(outDir, `${name}.gif`);
  const ffmpeg = spawnSync(
    "ffmpeg",
    [
      "-y",
      "-v",
      "error",
      "-framerate",
      String(FPS),
      "-i",
      join(frames, "f%04d.png"),
      "-filter_complex",
      "[0:v]split[a][b];[a]palettegen=max_colors=128:stats_mode=full[p];[b][p]paletteuse=dither=none:diff_mode=rectangle",
      "-loop",
      "0",
      out,
    ],
    { stdio: "inherit" },
  );
  if (ffmpeg.status !== 0) throw new Error(`ffmpeg failed for ${name}`);
  const kb = (statSync(out).size / 1024).toFixed(0);
  console.log(
    `${name}.gif  ${count} frames  ${duration}s  ${kb} KB${keep ? `  frames: ${frames}` : ""}`,
  );
  if (!keep) rmSync(frames, { recursive: true, force: true });
}

await browser.close();
