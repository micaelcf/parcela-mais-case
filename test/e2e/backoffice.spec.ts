import { randomUUID } from "node:crypto";

import type { Page, Request } from "@playwright/test";

import { fillLogin, logIn, OPERATOR } from "./support/backoffice";
import { expect, test } from "./support/fixtures";
import { acquireExclusive } from "./support/lender-switch-lock";
import { newPatient } from "./support/patient";
import { createConsultation, signupBody } from "./support/signup";

/** Waits for the explorer's list GET whose query satisfies `matches`. */
function listRequest(page: Page, matches: (params: URLSearchParams) => boolean) {
  return page.waitForRequest((request: Request) => {
    const url = new URL(request.url());
    return (
      request.method() === "GET" &&
      url.pathname === "/api/backoffice/consultations" &&
      matches(url.searchParams)
    );
  });
}

/** The explorer's table (the CPF-search results table is a different one). */
const explorerTable = (page: Page) => page.getByRole("table", { name: "Consultas", exact: true });
const explorerPaging = (page: Page) =>
  page.getByRole("navigation", { name: "Paginação: Consultas", exact: true });

test.describe("backoffice", () => {
  test("logs in", async ({ page }) => {
    await logIn(page);
    await expect(page.getByRole("heading", { name: "Painel", exact: true })).toBeVisible();
    // The money pipeline's totals.
    const totals = page.locator('dl[aria-label="Totais do período"]');
    for (const label of ["Volume solicitado", "Volume aprovado", "Volume escolhido"]) {
      await expect(totals.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(page.getByText(`Operador: ${OPERATOR.username}`)).toBeVisible();
  });

  test("is reachable from the public header and leads back to the signup", async ({ page }) => {
    await page.goto("/cadastro/paciente");
    await page.getByRole("link", { name: "Área da clínica" }).click();
    // No session yet: the backoffice sends the operator to its login.
    await expect(page).toHaveURL(/\/backoffice\/login$/);

    await fillLogin(page, OPERATOR.username, OPERATOR.password);
    await expect(page.getByRole("heading", { name: "Painel", exact: true })).toBeVisible();

    await page.getByRole("link", { name: "Ir para o cadastro" }).click();
    await expect(page).toHaveURL(/\/cadastro\/paciente$/);
  });

  test("rejects a wrong password", async ({ page }) => {
    await fillLogin(page, OPERATOR.username, `${OPERATOR.password}-errada`);

    const failure = page.getByRole("alert").filter({ hasText: "Não foi possível entrar" });
    await expect(failure).toBeVisible();
    await expect(failure).toContainText("Usuário ou senha inválidos");
    await expect(page).toHaveURL(/\/backoffice\/login$/);
    expect((await page.request.get("/api/backoffice/session")).status()).toBe(401);
    expect((await page.context().cookies()).map((cookie) => cookie.name)).not.toContain(
      "bo_session",
    );
  });

  test("logs out", async ({ page }) => {
    await logIn(page);
    await page.getByRole("button", { name: "Sair" }).click();
    await expect(page).toHaveURL(/\/backoffice\/login$/);
    await expect(page.getByLabel("Usuário")).toBeVisible();

    await page.goto("/backoffice");
    await expect(page).toHaveURL(/\/backoffice\/login$/);
    await expect(page.getByLabel("Usuário")).toBeVisible();
    expect((await page.request.get("/api/backoffice/session")).status()).toBe(401);
  });

  test("renders the dashboards from the API", async ({ page }) => {
    // Distinctive figures injected into the real responses: only the API can put them on screen.
    await page.route(/\/api\/backoffice\/metrics\/pipeline(\?|$)/, async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.totals = {
        ...body.totals,
        consultations: 4321,
        requestedCents: 123_456_789,
        approvedCents: 98_765_432,
        chosenCents: 4_567_890,
        approvalRate: 0.625,
        approvedRequestedRatio: 0.8,
        avgChosenInstallmentCents: 97_428,
        avgChosenTotalCents: 1_169_136,
      };
      body.chosenByLender = body.chosenByLender.map((row: { lender: string }) =>
        row.lender === "ALFA" ? { ...row, chosenOffers: 77, chosenCents: 3_456_789 } : row,
      );
      body.series = body.series.map((bucket: object, index: number) =>
        index === body.series.length - 1 ? { ...bucket, requestedCents: 55_555_555 } : bucket,
      );
      await route.fulfill({ response, json: body });
    });
    await page.route(/\/api\/backoffice\/metrics\/lenders(\?|$)/, async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.lenders = body.lenders.map((lender: { lender: string }) =>
        lender.lender === "DELTA"
          ? {
              ...lender,
              breaker: "OPEN",
              queueBacklog: 37,
              settledAttempts: 2468,
              p50LatencyMs: 4321.4,
              p95LatencyMs: 9876,
              approvalRate: 0.123,
              refusalRate: 0.343,
              errorRate: 0.456,
              timeoutRate: 0.078,
            }
          : lender,
      );
      await route.fulfill({ response, json: body });
    });
    const topPatientId = randomUUID();
    await page.route(/\/api\/backoffice\/metrics\/abuse(\?|$)/, async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      await route.fulfill({
        response,
        json: {
          ...body,
          requests: 8642,
          tooManyRequests: 135,
          limitHits: { IP_LIMIT: 97, PATIENT_LIMIT: 38 },
          topPatients: [{ patientId: topPatientId, firstName: "Zuleica", consultations: 29 }],
          topIps: [{ ipHash: "deadbeef", requests: 314, tooManyRequests: 15 }],
        },
      });
    });
    const tile = (label: string) =>
      page.locator("dl > div").filter({ has: page.getByText(label, { exact: true }) });

    await logIn(page);
    // Money pipeline (RF-604, RF-605).
    await expect(tile("Volume solicitado")).toContainText("R$ 1.234.567,89");
    await expect(tile("Volume solicitado")).toContainText("4.321 consultas");
    await expect(tile("Volume aprovado")).toContainText("R$ 987.654,32");
    await expect(tile("Volume escolhido")).toContainText("R$ 45.678,90");
    await expect(tile("Taxa de aprovação")).toContainText("62,5%");
    await expect(tile("Aprovado / solicitado")).toContainText("80,0%");
    await expect(tile("Parcela média escolhida")).toContainText("R$ 974,28");
    await expect(tile("Total médio escolhido")).toContainText("R$ 11.691,36");
    const chosenByLender = page.getByRole("table", { name: "Volume escolhido por financeira" });
    await expect(chosenByLender.getByRole("row", { name: /Alfa/ })).toContainText("77");
    await expect(chosenByLender.getByRole("row", { name: /Alfa/ })).toContainText("R$ 34.567,89");
    await expect(
      page.getByRole("table", { name: "Volume solicitado, aprovado e escolhido" }),
    ).toContainText("R$ 555.555,55");

    // Lender health (RF-606, RF-607, RF-610), on the dashboard and on the lenders page.
    for (const path of ["/backoffice", "/backoffice/financeiras"]) {
      if (path !== "/backoffice") await page.goto(path);
      const delta = page
        .getByRole("table", { name: "Saúde das financeiras" })
        .locator('tr[data-lender="DELTA"]');
      for (const figure of ["Aberto", "37", "4.321 ms", "9.876 ms", "12,3%", "34,3%", "45,6%"]) {
        await expect(delta, `${path}: ${figure}`).toContainText(figure);
      }
      await expect(delta).toContainText("7,8%");
      await expect(delta).toContainText("2.468");
    }

    // Abuse (RF-614).
    await page.goto("/backoffice/abuso");
    await expect(tile("Requisições contadas")).toContainText("8.642");
    await expect(tile("Respostas 429")).toContainText("135");
    await expect(tile("Limite por IP")).toContainText("97");
    await expect(tile("Limite por paciente")).toContainText("38");
    const topPatients = page.getByRole("table", { name: "Pacientes com mais consultas" });
    await expect(topPatients.getByRole("row", { name: /Zuleica/ })).toContainText("29");
    const topIps = page.getByRole("table", { name: "IPs com mais requisições" });
    await expect(topIps.getByRole("row", { name: /deadbeef/ })).toContainText("314");
    await expect(topIps.getByRole("row", { name: /deadbeef/ })).toContainText("15");
  });

  test("toggles a lender", async ({ page }) => {
    test.setTimeout(180_000);
    // No public journey runs while Delta is off (they hold the shared side of this lock).
    const release = await acquireExclusive();
    try {
      await logIn(page);
      await page.goto("/backoffice/financeiras?lender=DELTA&sort=createdAt:desc");
      const health = page.getByRole("table", { name: "Saúde das financeiras" });
      const deltaRow = health.locator('tr[data-lender="DELTA"]');
      const deltaSwitch = page.getByRole("switch", { name: "Delta ativa" });
      const log = page.getByRole("table", { name: "Histórico de ativação das financeiras" });
      const logTotal = async () => {
        const text = await page
          .getByRole("navigation", { name: "Paginação: Histórico de ativação das financeiras" })
          .innerText();
        return Number(/([\d.]+) alteraç/.exec(text)?.[1].replaceAll(".", "") ?? Number.NaN);
      };
      await expect(deltaSwitch).toBeChecked();
      await expect(deltaRow).toContainText("Ativa");
      const before = await logTotal();

      await deltaSwitch.click();
      await expect(deltaSwitch).not.toBeChecked();
      await expect(deltaRow).toContainText("Desativada");
      await expect.poll(logTotal).toBe(before + 1);
      const offRow = log.getByRole("row").nth(1);
      await expect(offRow).toContainText("Delta");
      await expect(offRow).toContainText("Desativada");
      await expect(offRow).toContainText(OPERATOR.username);

      await deltaSwitch.click();
      await expect(deltaSwitch).toBeChecked();
      await expect(deltaRow).toContainText("Ativa");
      await expect.poll(logTotal).toBe(before + 2);
      const onRow = log.getByRole("row").nth(1);
      await expect(onRow).toContainText("Delta");
      await expect(onRow).toContainText("Ativada");
      await expect(onRow).toContainText(OPERATOR.username);
    } finally {
      // Never leave Delta off for the rest of the suite, whatever failed above.
      const metrics = await page.request.get("/api/backoffice/metrics/lenders");
      const delta = metrics.ok()
        ? (await metrics.json()).lenders.find(
            (lender: { lender: string }) => lender.lender === "DELTA",
          )
        : null;
      if (delta && !delta.enabled) {
        await page.request.put("/api/backoffice/lenders/delta/switch", { data: { enabled: true } });
      }
      await release();
    }
  });

  test("drives the table from the server", async ({ page, request }) => {
    // At least two consultations exist, so a one-row page has a next page.
    const patient = newPatient();
    await createConsultation(request, patient, "ALL_APPROVE");
    await createConsultation(request, patient, "ALL_APPROVE");
    await logIn(page);
    await page.goto("/backoffice/consultas?pageSize=1");
    await expect(explorerTable(page)).toBeVisible();

    const pageRequest = listRequest(page, (params) => params.get("page") === "2");
    await explorerPaging(page).getByRole("button", { name: "Próxima página" }).click();
    await pageRequest;

    const sortRequest = listRequest(page, (params) =>
      /^treatmentAmountCents:(asc|desc)$/.test(params.get("sort") ?? ""),
    );
    await explorerTable(page).getByRole("button", { name: "Valor" }).click();
    await sortRequest;

    const filterRequest = listRequest(page, (params) => params.get("status") === "OFFERS");
    await page.getByRole("combobox", { name: "Situação" }).click();
    await page.getByRole("option", { name: "Com ofertas" }).click();
    await filterRequest;

    const searchRequest = listRequest(page, (params) => params.get("q") === patient.token);
    await page.getByRole("searchbox", { name: "Buscar", exact: true }).fill(patient.token);
    await page.getByRole("searchbox", { name: "Buscar", exact: true }).press("Enter");
    await searchRequest;
  });

  test("keeps table state in the URL", async ({ page, request }) => {
    const first = newPatient({ treatmentAmountCents: 1_000_000 });
    const second = newPatient({
      fullName: first.fullName,
      token: first.token,
      treatmentAmountCents: 1_200_000,
    });
    for (const patient of [first, second]) {
      const id = await createConsultation(request, patient, "ALL_APPROVE");
      await expect
        .poll(
          async () => (await (await request.get(`/api/consultations/${id}`)).json()).journeyStatus,
        )
        .toBe("OFFERS");
    }
    await logIn(page);
    const search = `page=2&pageSize=1&sort=createdAt%3Aasc&status=OFFERS&q=${first.token}`;

    const expectTableState = async () => {
      await expect(page.getByRole("searchbox", { name: "Buscar", exact: true })).toHaveValue(
        first.token,
      );
      await expect(page.getByRole("combobox", { name: "Situação" })).toHaveText(/Com ofertas/);
      await expect(
        explorerTable(page).getByRole("columnheader", { name: "Criada em" }),
      ).toHaveAttribute("aria-sort", "ascending");
      await expect(explorerPaging(page)).toContainText("2 consultas · página 2 de 2");
      const rows = explorerTable(page).getByRole("row");
      await expect(rows).toHaveCount(2); // header + one row
      await expect(rows.nth(1)).toContainText(first.fullName);
      await expect(rows.nth(1)).toContainText("R$ 12.000,00");
    };

    await page.goto(`/backoffice/consultas?${search}`);
    await expectTableState();
    const url = page.url();

    const reloaded = listRequest(
      page,
      (params) =>
        params.get("page") === "2" &&
        params.get("pageSize") === "1" &&
        params.get("sort") === "createdAt:asc" &&
        params.get("status") === "OFFERS" &&
        params.get("q") === first.token,
    );
    await page.reload();
    await reloaded;
    await expectTableState();
    expect(page.url()).toBe(url);
  });

  test("searches by CPF without putting it in the URL", async ({ page, request, patient }) => {
    await createConsultation(request, patient, "ALL_APPROVE");
    await createConsultation(request, patient, "ALL_APPROVE");
    const visited: string[] = [];
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) visited.push(frame.url());
    });
    page.on("request", (sent) => visited.push(sent.url()));

    await logIn(page);
    await page.goto("/backoffice/consultas");
    const form = page.getByRole("form", { name: "Buscar consultas por CPF" });
    await form.getByLabel("CPF do paciente").fill(patient.cpf);
    await form.getByRole("button", { name: "Buscar por CPF" }).click();

    const results = page.getByRole("table", { name: "Consultas do CPF buscado" });
    const resultRows = results.getByRole("row").filter({ hasText: patient.fullName });
    await expect(resultRows).toHaveCount(2);
    await expect(
      page.getByRole("navigation", { name: "Paginação: Consultas do CPF buscado" }),
    ).toContainText("2 consultas");

    await page.getByRole("button", { name: "Limpar busca por CPF" }).click();
    await page.reload();
    await expect(explorerTable(page)).toBeVisible();

    // The explorer's own search box (RF-617): a CPF typed there, alone or after a name, is refused
    // with a pointer to "Buscar por CPF", even on Enter.
    const search = page.getByRole("searchbox", { name: "Buscar", exact: true });
    const hint = page.getByRole("status").filter({ hasText: "O CPF não entra nesta busca." });
    for (const typed of [
      patient.cpf,
      patient.cpfFormatted,
      `${patient.token} ${patient.cpf}`,
      `${patient.token} ${patient.cpfFormatted}`,
    ]) {
      await search.fill(typed);
      await expect(hint).toBeVisible();
      await search.press("Enter");
      await expect(hint).toBeVisible();
    }
    // A name followed by the first digits of a CPF waits for Enter: a typing pause longer than the
    // 400 ms debounce applies nothing. Nothing can signal that a search didn't run, so wait it out.
    const partials = [patient.cpf.slice(0, 7), patient.cpfFormatted.slice(0, 7)];
    for (const partial of partials) {
      await search.fill(`${patient.token} ${partial}`);
      await expect(hint).toBeHidden();
      await page.waitForTimeout(1_000);
    }
    visited.push(page.url());

    const cpfForms = [
      patient.cpf,
      patient.cpfFormatted,
      encodeURIComponent(patient.cpfFormatted),
      ...partials,
      ...partials.map((partial) => encodeURIComponent(partial)),
    ];
    for (const url of visited) {
      for (const cpf of cpfForms) expect(url, `visited ${url}`).not.toContain(cpf);
    }
  });

  test("shows the decrypted CPF and the address on the detail", async ({
    page,
    request,
    patient,
  }) => {
    const email = `paciente.${patient.token.toLowerCase()}@exemplo.com`;
    const created = await request.post("/api/consultations", {
      headers: { "Idempotency-Key": randomUUID() },
      data: { ...signupBody(patient, "ALL_APPROVE"), email },
    });
    expect(created.status(), await created.text()).toBe(202);
    const { id } = (await created.json()) as { id: string };
    await logIn(page);
    await page.goto("/backoffice/consultas");
    const rows = explorerTable(page).getByRole("row");
    await expect(rows.nth(1)).toBeVisible();
    await expect(explorerTable(page)).not.toContainText("Nenhuma consulta encontrada.");

    await page.getByRole("searchbox", { name: "Buscar", exact: true }).fill(patient.token);
    await page.getByRole("searchbox", { name: "Buscar", exact: true }).press("Enter");
    await expect(page).toHaveURL(new RegExp(`[?&]q=${patient.token}`));
    await expect(rows).toHaveCount(2); // header + this patient's consultation
    await explorerTable(page).getByRole("link", { name: patient.fullName }).click();

    await expect(page).toHaveURL(new RegExp(`/backoffice/consultas/${id}$`));
    await expect(page.getByText(patient.cpfFormatted, { exact: true })).toBeVisible();
    const patientFacts = page.locator("dl", { hasText: "Celular" });
    await expect(patientFacts).toContainText(email);
    await expect(patientFacts).toContainText("01310-100");
    await expect(patientFacts).toContainText("Avenida Paulista, 1578");
    await expect(patientFacts).toContainText("Bela Vista");
    await expect(patientFacts).toContainText("São Paulo/SP");
  });

  test("filters by a creation date typed or picked from the calendar", async ({ page }) => {
    await logIn(page);
    await page.goto("/backoffice/consultas");
    await expect(explorerTable(page)).toBeVisible();

    // Typed: the text is masked as dd/mm/aaaa and applies once it is a complete real day; the URL
    // keeps the calendar day, the API gets the instant it starts at (the browser runs in São Paulo).
    const from = page.getByRole("textbox", { name: "Criada de" });
    const typedRequest = listRequest(
      page,
      (params) => params.get("createdAtFrom") === "2026-03-01T03:00:00.000Z",
    );
    await from.pressSequentially("01032026");
    await expect(from).toHaveValue("01/03/2026");
    await typedRequest;
    await expect(page).toHaveURL(/[?&]createdAtFrom=2026-03-01(&|$)/);

    // Picked: the calendar button opens on the current month; a day click fills the text and the URL.
    const to = page.getByRole("textbox", { name: "Criada até" });
    const toGroup = page.getByRole("group").filter({ has: to });
    await toGroup.getByRole("button", { name: "Selecionar data" }).click();
    const calendar = page.getByRole("dialog");
    await calendar.getByRole("button", { name: /, 15 de / }).click();
    await expect(calendar).toBeHidden();
    await expect(to).toHaveValue(/^15\/\d{2}\/\d{4}$/);
    const [day, month, year] = (await to.inputValue()).split("/");
    await expect(page).toHaveURL(new RegExp(`[?&]createdAtTo=${year}-${month}-${day}(&|$)`));

    // Keyboard: ArrowDown opens on the selected day, arrows move, Enter picks, Escape closes.
    await from.press("ArrowDown");
    await expect(calendar.getByRole("button", { name: /, 1 de março de 2026/ })).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(calendar.getByRole("button", { name: /, 2 de março de 2026/ })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(calendar).toBeHidden();
    await expect(from).toHaveValue("02/03/2026");
    await expect(page).toHaveURL(/[?&]createdAtFrom=2026-03-02(&|$)/);
    await from.press("ArrowDown");
    await expect(calendar).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(calendar).toBeHidden();

    // Clearing the text drops the filter.
    await from.fill("");
    await expect(page).not.toHaveURL(/createdAtFrom=/);
  });

  test("searches once typing pauses, never per keystroke nor after leaving", async ({
    page,
    request,
    patient,
  }) => {
    await createConsultation(request, patient, "ALL_APPROVE");
    await logIn(page);
    await page.goto("/backoffice/consultas");
    await expect(explorerTable(page).getByRole("link").first()).toBeVisible();
    const searched: string[] = [];
    page.on("request", (sent) => {
      const url = new URL(sent.url());
      if (sent.method() === "GET" && url.pathname === "/api/backoffice/consultations") {
        searched.push(url.searchParams.get("q") ?? "");
      }
    });

    // Keystrokes 50 ms apart stay inside the 400 ms debounce: one request, for the whole text.
    const search = page.getByRole("searchbox", { name: "Buscar", exact: true });
    await search.pressSequentially(patient.token, { delay: 50 });
    await expect(page).toHaveURL(new RegExp(`[?&]q=${patient.token}(&|$)`));
    await expect(explorerTable(page).getByRole("link", { name: patient.fullName })).toBeVisible();
    await page.waitForTimeout(1_000);
    expect(searched).toEqual([patient.token]);

    // Text still pending when the user opens a consultation never pulls them back to the list.
    await search.pressSequentially("x");
    await explorerTable(page).getByRole("link", { name: patient.fullName }).click();
    await expect(page).toHaveURL(/\/backoffice\/consultas\/[\da-f-]+$/);
    await page.waitForTimeout(1_000);
    await expect(page).toHaveURL(/\/backoffice\/consultas\/[\da-f-]+$/);
    expect(searched).toEqual([patient.token]);
  });
});
