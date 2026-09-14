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
    expect.stringMatching(/\/r\/client\/[^/?]+\/complete\?rid=\{\{respondent_id\}\}$/),
    expect.stringMatching(/\/r\/client\/[^/?]+\/terminate\?rid=\{\{respondent_id\}\}$/),
    expect.stringMatching(/\/r\/client\/[^/?]+\/quota-full\?rid=\{\{respondent_id\}\}$/),
    expect.stringMatching(/\/r\/client\/[^/?]+\/security-terminate\?rid=\{\{respondent_id\}\}$/),
  ]));
  for (const value of values) {
    expect(value).toContain("rid={{respondent_id}}");
    expect(value).not.toContain("project=");
  }
});

test("project search, refresh, clear filters, metric views, and CSV download work", async ({ page }) => {
  await page.goto("/projects", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("All workspace studies, delivery risk, and fieldwork controls.")).toBeVisible();
  await page.getByLabel("Internal project ID").fill("PRJ-1048");
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await expect(page.getByRole("link", { name: "PRJ-1048" })).toBeVisible();
  await expect(page.getByText("PRJ-1047", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Test metrics" }).click();
  await expect(page.getByRole("columnheader", { name: "Test QT" })).toBeVisible();
  await page.getByRole("button", { name: "Live metrics" }).click();
  await expect(page.getByRole("columnheader", { name: "CV%" })).toBeVisible();

  await page.getByRole("button", { name: "Refresh", exact: true }).last().click();
  await expect(page.getByRole("link", { name: "PRJ-1048" })).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByLabel("Internal project ID")).toHaveValue("");
  await expect(page.getByText("PRJ-1047", { exact: true })).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("researchops-projects.csv");
});

test("supplier delivery separates test starts from live metrics", async ({ page }) => {
  await page.goto("/projects/PRJ-1048", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Supplier delivery" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "TST" })).toHaveAttribute("title", /excluded from live metrics/i);
  await expect(page.getByText("Test hits are separated from live delivery and cost.")).toBeVisible();
});

test("supplier routing links open in a separated bordered dialog", async ({ page }) => {
  await page.goto("/projects/PRJ-1048", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Links" }).click();

  const dialog = page.getByRole("dialog", { name: "CPX Research links" });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".supplier-link-card.test")).toContainText("Test respondent link");
  await expect(dialog.locator(".supplier-link-card.live")).toContainText("Live supplier template");
  await expect(dialog.getByRole("button", { name: "Copy test" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Open test" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Copy live" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("project eligibility rules are visible and editable", async ({ page }) => {
  await page.goto("/projects/PRJ-1048", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Eligibility rules" })).toBeVisible();
  await expect(page.getByText("country", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).last().click();
  await expect(page.getByLabel("Eligibility variable 1")).toHaveValue("country");
  await expect(page.getByRole("button", { name: "Save rules" })).toBeVisible();
});

test("interlocked quota cells are visible and editable", async ({ page }) => {
  await page.goto("/projects/PRJ-1048", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Interlocked quota cells" })).toBeVisible();
  await expect(page.getByText("India · age 21–34", { exact: true })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Filled" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Reserved" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Remaining" })).toBeVisible();
  await page.getByRole("button", { name: "Edit quotas" }).click();
  await expect(page.getByLabel("Quota cell name 1")).toHaveValue("India · age 21–34");
  await expect(page.getByRole("button", { name: "Save quota cells" })).toBeVisible();
});

test("project leads can manage role-compatible project access", async ({ page }) => {
  await page.goto("/projects/PRJ-1048", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Project team access" })).toBeVisible();
  await expect(page.getByText("Kabir Rao", { exact: true })).toBeVisible();
  await expect(page.getByText("REVIEWER", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit access" }).click();
  await expect(page.getByLabel("Project role 1")).toHaveValue("REVIEWER");
  await expect(page.getByRole("button", { name: "Save access" })).toBeVisible();
});

test("new project market selection covers all countries and preferred languages", async ({ page }) => {
  await page.goto("/projects/new", { waitUntil: "domcontentloaded" });
  const country = page.getByLabel("Country");
  await expect(country.locator("option")).toHaveCount(249);
  await country.selectOption("JP");
  await expect(country).toHaveValue("JP");
  await expect(page.getByLabel("Language").locator('optgroup[label^="Common in Japan"] option')).toHaveCount(1);
  await expect(page.getByLabel("Language")).toHaveValue("ja");
  await country.selectOption("CA");
  await expect(page.getByLabel("Language")).toHaveValue("en");
  await expect(page.getByLabel("Language").locator('optgroup[label^="Common in Canada"] option')).toHaveCount(2);
  await expect(page.getByLabel("Live survey URL")).toBeVisible();
  await expect(page.getByLabel("Test survey URL (optional)")).toBeVisible();
  await expect(page.getByLabel("Survey parameter name 1")).toHaveValue("PID");
  await expect(page.getByLabel("Survey parameter value 2")).toHaveValue("{{respondent_id}}");
  await page.getByText("Select suppliers", { exact: true }).click();
  await page.getByLabel("Assign CPX Research").check();
  await expect(page.getByLabel("CPX Research supplier CPI")).toBeEnabled();
  await expect(page.getByLabel("Project security terminate URL (optional)")).toHaveCount(0);
});
