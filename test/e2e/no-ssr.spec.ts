import { expect, test } from "./support/fixtures";

test.describe("no SSR", () => {
  test("serves the shell without route content", async ({ request }) => {
    const response = await request.get("/cadastro/paciente");
    expect(response.status()).toBe(200);
    const html = await response.text();

    // The dev server's devtools add attributes to <html>, so match the lang attribute on the tag.
    expect(html).toMatch(/<html\b[^>]*\slang="pt-BR"[^>]*>/);
    expect(html).not.toMatch(/<(input|select|textarea|button)\b/i);
  });
});
