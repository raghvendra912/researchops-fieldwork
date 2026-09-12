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
