import { expect, test } from "@playwright/test";

test("health and readiness endpoints are available", async ({ request }) => {
  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
  await expect(health.json()).resolves.toMatchObject({ status: "healthy" });

  const readiness = await request.get("/api/readiness");
  expect(readiness.status()).toBe(200);
  await expect(readiness.json()).resolves.toMatchObject({ status: "ready", application: "healthy", api: "healthy" });
});

test("desktop sidebar collapses, persists, and exposes build identity", async ({ page }) => {
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".app-frame")).toBeVisible();
  await expect(page.locator(".build-version")).toContainText(/^v/);

  const toggle = page.getByRole("button", { name: "Collapse sidebar" });
  await expect(toggle).toBeVisible();
  await expect(toggle).toBeEnabled();
  await toggle.click();
  await expect(page.locator(".app-frame")).toHaveClass(/sidebar-collapsed/);
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible();

  await page.reload();
  await expect(page.locator(".app-frame")).toHaveClass(/sidebar-collapsed/);
});

test("mobile navigation remains usable without the desktop toggle", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
  await expect(page.getByRole("button", { name: /sidebar/i })).toBeHidden();
});

test("client handoff exposes clean outcome URLs", async ({ page }) => {
  await page.goto("/clients", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "View links" }).first().click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Redirect variables")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Add variable" })).toHaveCount(0);
  const links = dialog.locator(".link-row code");
  await expect(links).toHaveCount(4);

  const values = await links.allTextContents();
  expect(values).toEqual(expect.arrayContaining([
    expect.stringMatching(/\/r\/client\/[^/?]+\/complete\?rid=\{\{respondent_id\}\}&project=\{\{project_id\}\}$/),
    expect.stringMatching(/\/r\/client\/[^/?]+\/terminate\?rid=\{\{respondent_id\}\}&project=\{\{project_id\}\}$/),
    expect.stringMatching(/\/r\/client\/[^/?]+\/quota-full\?rid=\{\{respondent_id\}\}&project=\{\{project_id\}\}$/),
    expect.stringMatching(/\/r\/client\/[^/?]+\/security-terminate\?rid=\{\{respondent_id\}\}&project=\{\{project_id\}\}$/),
  ]));
  for (const value of values) {
    expect(value).toContain("rid={{respondent_id}}");
    expect(value).toContain("project={{project_id}}");
  }
});

test("supplier delivery separates test starts from live metrics", async ({ page }) => {
  await page.goto("/projects/PRJ-1048", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Supplier delivery" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "TST" })).toHaveAttribute("title", /excluded from live metrics/i);
  await expect(page.getByText("Test hits are separated from live delivery and cost.")).toBeVisible();
});

test("project eligibility rules are visible and editable", async ({ page }) => {
  await page.goto("/projects/PRJ-1048", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Eligibility rules" })).toBeVisible();
  await expect(page.getByText("country", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).last().click();
  await expect(page.getByLabel("Eligibility variable 1")).toHaveValue("country");
  await expect(page.getByRole("button", { name: "Save rules" })).toBeVisible();
});
