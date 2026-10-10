import { expect, test } from "@playwright/test";

test("landing carrega sem violar a CSP", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (msg) => {
    if (/Content Security Policy|Refused to/i.test(msg.text())) violations.push(msg.text());
  });

  const response = await page.goto("/");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "MindManager" })).toBeVisible();
  expect(violations).toEqual([]);
});

test("login hidrata (botão responde) e não viola a CSP", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (msg) => {
    if (/Content Security Policy|Refused to/i.test(msg.text())) violations.push(msg.text());
  });

  await page.goto("/login");
  await expect(page.getByRole("button", { name: /entrar/i }).first()).toBeVisible();

  // Next aplicou o nonce da CSP em todos os scripts da página.
  const { total, withNonce } = await page.evaluate(() => {
    const scripts = Array.from(document.querySelectorAll("script"));
    return { total: scripts.length, withNonce: scripts.filter((s) => s.nonce || s.getAttribute("nonce")).length };
  });
  expect(total).toBeGreaterThan(0);
  expect(withNonce).toBe(total);
  expect(violations).toEqual([]);
});

test("cabeçalhos de segurança presentes, com CSP por nonce", async ({ request }) => {
  const res = await request.get("/login");
  const h = res.headers();
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["content-security-policy"]).toMatch(/script-src [^;]*'nonce-[A-Za-z0-9+/=]+'/);
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
});

test("dashboard exige login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});

test("cron sem token → 401", async ({ request }) => {
  const res = await request.get("/api/cron/reminders");
  expect(res.status()).toBe(401);
});

test("/auth/confirm não redireciona para fora do site", async ({ request }) => {
  const res = await request.get("/auth/confirm?token_hash=x&type=email&next=//evil.com", {
    maxRedirects: 0,
  });
  expect(res.headers()["location"] ?? "").not.toContain("evil.com");
});

test("health responde JSON", async ({ request }) => {
  const res = await request.get("/api/health");
  expect([200, 503]).toContain(res.status());
  expect((await res.json()).status).toBeDefined();
});

test("convite inválido mostra aviso (sem quebrar)", async ({ page }) => {
  await page.goto("/convite/token-que-nao-existe");
  await expect(page.getByRole("heading", { name: "Convite indisponível" })).toBeVisible();
});

test("link de avaliação inválido mostra aviso", async ({ page }) => {
  await page.goto("/nps/nao-e-um-uuid");
  await expect(page.getByRole("heading", { name: "Link indisponível" })).toBeVisible();
});

test("rotas novas do dashboard exigem login", async ({ request }) => {
  for (const path of [
    "/dashboard/equipe",
    "/dashboard/financeiro/recebimentos",
    "/dashboard/financeiro/recebimentos/csv",
    "/dashboard/pacientes/x/prontuario",
  ]) {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status(), path).toBe(307);
    expect(res.headers()["location"], path).toContain("/login");
  }
});
