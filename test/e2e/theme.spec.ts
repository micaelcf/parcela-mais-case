import type { Page } from "@playwright/test";

import { logIn } from "./support/backoffice";
import { expect, test } from "./support/fixtures";

const html = (page: Page) => page.locator("html");

test.describe("theme", () => {
  test("follows the system theme until the user picks one", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/cadastro/paciente");
    const toggle = page.getByRole("button", { name: "Tema escuro" });
    await expect(html(page)).toHaveClass(/\bdark\b/);
    await expect(toggle).toHaveAttribute("aria-pressed", "true");

    // No choice stored yet: a system change is followed live.
    await page.emulateMedia({ colorScheme: "light" });
    await expect(html(page)).not.toHaveClass(/\bdark\b/);
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  test("switches the theme from the top bar and keeps the choice after a reload", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/cadastro/paciente");
    const toggle = page.getByRole("button", { name: "Tema escuro" });
    await expect(toggle).toHaveAttribute("aria-pressed", "false");

    await toggle.click();
    await expect(html(page)).toHaveClass(/\bdark\b/);
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

    // The stored choice wins over the system setting, before the first paint of the next load.
    await page.reload();
    await expect(html(page)).toHaveClass(/\bdark\b/);
    await expect(page.getByRole("button", { name: "Tema escuro" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
      background,
    );

    await page.getByRole("button", { name: "Tema escuro" }).click();
    await expect(html(page)).not.toHaveClass(/\bdark\b/);
  });

  test("offers the switch in the backoffice too", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await logIn(page);
    await page.getByRole("button", { name: "Tema escuro" }).click();
    await expect(html(page)).toHaveClass(/\bdark\b/);
  });
});
