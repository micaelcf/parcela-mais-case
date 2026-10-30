// Loads each area of the app once in Chromium before the E2E suite: `vp dev` compiles modules on
// first request and re-optimizes dependencies once (a full reload), which on a slow runner ate
// the first tests' timeouts. Runs on Node, like Playwright Test.
import { chromium } from "@playwright/test";

const ORIGIN = "https://parcela.localhost:8443";
const PAGES = [
  ["/cadastro/paciente", "Nome completo"],
  ["/consultas/00000000-0000-0000-0000-000000000000", "Consulta não encontrada"],
  ["/backoffice/login", "Usuário"],
];

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const [path, text] of PAGES) {
    const started = Date.now();
    await page.goto(ORIGIN + path);
    await page.getByText(text).first().waitFor({ timeout: 120_000 });
    console.log(`warm: ${path} in ${Date.now() - started} ms`);
  }
} finally {
  await browser.close();
}
