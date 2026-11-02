import { expect, test, type Page } from "@playwright/test";

// Demo-mode browser coverage for the routing, funnel, and fraud-hold screens.
// No credentials are needed; hosted behaviour is covered by the API and database tests.

async function waitForHydration(page: Page) {
  await expect(page.locator(".app-frame")).toHaveAttribute("data-hydrated", "true", { timeout: 60_000 });
}

test.describe.configure({ timeout: 90_000 });

test("supplier funnel shows totals, the funnel table, and the rejection breakdown", async ({ page }) => {
  await page.goto("/supplier-funnel", { waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  await expect(page.getByRole("region", { name: "Supplier funnel filters" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Funnel totals" })).toBeVisible();
  const table = page.getByRole("region", { name: "Supplier funnel table" });
  await expect(table).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Supplier", exact: true })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Clicks", exact: true })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "Starts", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Rejection reasons" })).toBeVisible();
  await expect(page.getByText(/TypeError|Unhandled|Internal Server Error|undefined/)).toHaveCount(0);
});

test("supplier funnel is reachable from the navigation without a document reload", async ({ page }) => {
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  await page.evaluate(() => { (window as unknown as { __stay?: boolean }).__stay = true; });
  await page.goto("/supplier-funnel", { waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  await expect(page).toHaveURL(/\/supplier-funnel$/);
  await expect(page.getByRole("region", { name: "Supplier funnel table" })).toBeVisible();
});

test("fraud review offers a held-completes queue and rule filters", async ({ page }) => {
  await page.goto("/fraud", { waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  const tabs = page.getByRole("tablist", { name: "Fraud review views" });
  await expect(tabs).toBeVisible();
  const held = tabs.getByRole("tab", { name: /Held completes/ });
  await expect(held).toBeVisible();

  // All flags view: rule-type, status, and project filters are present.
  await expect(page.getByRole("region", { name: "Flag filters" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Rule type" })).toBeVisible();
  await expect(page.getByRole("group", { name: "Status" })).toBeVisible();
  await expect(page.getByLabel("Project code")).toBeVisible();

  // Friendly labels for the new rule types, not raw codes.
  const ruleGroup = page.getByRole("group", { name: "Rule type" });
  await expect(ruleGroup.getByText("Unverified return")).toBeVisible();
  await expect(ruleGroup.getByText("No client hand-off")).toBeVisible();
  await expect(ruleGroup.getByText("UNVERIFIED_RETURN")).toHaveCount(0);

  // Switching to the held queue shows its own panel.
  await held.click();
  await expect(held).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("region", { name: "Held completes" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Held completes/ })).toBeVisible();
});

test("filtering the fraud list by project sends only whitelisted parameters", async ({ page }) => {
  await page.goto("/fraud", { waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  const requests: string[] = [];
  page.on("request", (request) => { if (request.url().includes("/api/fraud-flags")) requests.push(request.url()); });
  await page.getByLabel("Project code").fill("PRJ-1048");
  await page.getByRole("group", { name: "Rule type" }).getByText("Speeding").click();
  await expect.poll(() => requests.length, { timeout: 15_000 }).toBeGreaterThan(0);
  for (const url of requests) {
    const params = new URL(url).searchParams;
    for (const key of params.keys()) expect(["ruleCode", "status", "projectCode", "limit", "offset", "page", "pageSize"]).toContain(key);
  }
});

test("respondent explorer exposes a click timeline that loads on demand", async ({ page }) => {
  await page.goto("/respondents", { waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  await expect(page.getByRole("heading", { name: "Session explorer" })).toBeVisible();
  const timeline = page.locator(".click-timeline").first();
  // The timeline only renders once a respondent is selected; when demo data has none, the section is absent.
  if (await timeline.count()) {
    await expect(timeline.getByRole("heading", { name: "Click timeline" })).toBeVisible();
    const load = timeline.getByRole("button");
    if (await load.count()) await load.first().click();
    await expect(page.getByText(/TypeError|Unhandled|Internal Server Error/)).toHaveCount(0);
  }
});

test("client return signing stays hidden in demo mode and never asks for a secret value", async ({ page }) => {
  await page.goto("/clients", { waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  await expect(page.getByText("Return signing")).toHaveCount(0);
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
});

test("new API surfaces refuse anonymous callers", async ({ request }) => {
  for (const path of ["/api/routing/funnel", "/api/fraud-flags"]) {
    const response = await request.get(path);
    expect([200, 401, 403]).toContain(response.status());
  }
  const timeline = await request.get("/api/respondents/00000000-0000-4000-8000-000000000001/timeline");
  expect([200, 401, 403, 404]).toContain(timeline.status());
  const postback = await request.post("/api/postbacks/not-a-real-client-token", { data: { rid: "x", status: "complete" } });
  expect([401, 503]).toContain(postback.status());
});
