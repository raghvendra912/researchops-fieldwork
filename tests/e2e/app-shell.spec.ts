import { expect, test } from "@playwright/test";

test("health and readiness endpoints are available", async ({ request }) => {
  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
  await expect(health.json()).resolves.toMatchObject({ status: "healthy" });

  const readiness = await request.get("/api/readiness");
  expect(readiness.status()).toBe(200);
  await expect(readiness.json()).resolves.toMatchObject({ status: "ready", application: "healthy", api: "healthy" });
});

async function waitForHydration(page: import("@playwright/test").Page) {
  await expect(page.locator(".app-frame")).toHaveAttribute("data-hydrated", "true", { timeout: 60_000 });
}

test("desktop unified navigation and build identity are visible", async ({ page }) => {
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".app-frame")).toBeVisible();
  await waitForHydration(page);
  await expect(page.locator(".build-version")).toContainText(/^v/);
  await expect(page.getByRole("navigation", { name: "Workspace navigation" })).toBeVisible();
  const workspaceNavigation = page.getByRole("navigation", { name: "Workspace navigation" });
  await expect(workspaceNavigation.getByText("Project Center", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open ResearchOps Copilot" })).toBeVisible();
  await page.getByRole("button", { name: "Open ResearchOps Copilot" }).click();
  await expect(page.getByLabel("ResearchOps AI assistant")).toBeVisible();
});

test("workspace navigation changes routes without reloading the document", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  await page.evaluate(() => {
    (window as Window & { __researchOpsNavigationProof?: string }).__researchOpsNavigationProof = "mounted";
    document.querySelector<HTMLElement>(".app-frame")!.dataset.navigationProof = "same-shell";
  });
  const workspaceNavigation = page.getByRole("navigation", { name: "Workspace navigation" });
  await workspaceNavigation.getByText("Project Center", { exact: true }).click();
  const projectMenu = workspaceNavigation.locator("details").filter({ hasText: "Project Center" });
  await expect(projectMenu).toHaveAttribute("open", "");
  await workspaceNavigation.getByRole("link", { name: "All projects", exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/);
  await expect(projectMenu).not.toHaveAttribute("open", "");
  await expect.poll(() => page.evaluate(() => (window as Window & { __researchOpsNavigationProof?: string }).__researchOpsNavigationProof)).toBe("mounted");
  await expect(page.locator(".app-frame")).toHaveAttribute("data-navigation-proof", "same-shell");
});

test("mobile navigation remains usable without the desktop toggle", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("navigation", { name: "Primary navigation" })).toBeVisible();
  await expect(page.getByRole("button", { name: /sidebar/i })).toBeHidden();
});

test("client handoff exposes clean outcome URLs", async ({ page }) => {
  await page.goto("/clients", { waitUntil: "domcontentloaded" });
  await waitForHydration(page);
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
  await waitForHydration(page);
  await expect(page.getByRole("navigation", { name: "Workspace navigation" })).toBeVisible();
  await page.getByLabel("Project ID", { exact: true }).fill("PRJ-1048");
  await page.getByRole("button", { name: "Search projects" }).click();
  await expect(page.getByRole("link", { name: "PRJ-1048-IN" })).toBeVisible();
  await expect(page.getByText("PRJ-1047", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Test metrics" }).click();
  await expect(page.getByRole("columnheader", { name: "Test QT" })).toBeVisible();
  await page.getByRole("button", { name: "Live metrics" }).click();
  await expect(page.getByRole("columnheader", { name: "CO (%)" })).toBeVisible();

  await page.getByRole("button", { name: "Refresh projects" }).click();
  await expect(page.getByRole("link", { name: "PRJ-1048-IN" })).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await expect(page.getByLabel("Project ID", { exact: true })).toHaveValue("");
  await expect(page.getByText("PRJ-1047-US", { exact: true })).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByLabel("Download projects").click();
  await page.getByRole("button", { name: "Download CSV" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("researchops-projects.csv");
});

test("supplier directory explains its two base routes and copies both", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/suppliers", { waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  await page.getByRole("button", { name: "View links" }).first().click();
  const dialog = page.getByRole("dialog", { name: "CPX Research links" });
  await expect(dialog.getByRole("heading", { name: "CPX Research entry routes" })).toBeVisible();
  await expect(dialog.getByText("Return URL check")).toBeVisible();
  await expect(dialog.getByText("Launch route base")).toBeVisible();
  await expect(dialog.locator(".link-row code")).toHaveCount(2);
  await dialog.getByRole("button", { name: "Copy all 2 routes" }).click();
  await expect(dialog.getByRole("button", { name: "Copied all" })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied.split("\n")).toHaveLength(2);
  expect(copied).toContain("/test");
  expect(copied).toContain("/live");
});

test("respondent operations can refresh newly routed statuses", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/respondents", { waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  await expect(page.getByText("Auto-refreshes every 30 seconds.")).toBeVisible();
  const refreshed = page.waitForResponse((response) => response.url().includes("/api/respondents?") && response.status() === 200);
  await page.getByRole("button", { name: "Refresh respondents" }).click();
  await refreshed;
  await expect(page.getByRole("heading", { name: "Session explorer" })).toBeVisible();
});

test("secondary PM and sales ownership can be edited in demo mode", async ({ page }) => {
  await page.goto("/projects/PRJ-1048", { waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  await page.getByLabel("Tool").selectOption("ownership");
  await expect(page.getByRole("heading", { name: "Project ownership" })).toBeVisible();
  await page.getByRole("button", { name: "Edit ownership" }).click();
  await page.getByLabel("Secondary PM").selectOption("00000000-0000-4000-8000-000000000012");
  await page.getByLabel("Sales Person").selectOption("00000000-0000-4000-8000-000000000013");
  await page.getByRole("button", { name: "Save ownership" }).click();
  await expect(page.getByText("Project ownership saved.")).toBeVisible();
});

test("Flamingo Tool is a planned integration placeholder", async ({ page }) => {
  await page.goto("/flamingo", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Flamingo Tool" })).toBeVisible();
  await expect(page.getByText(/integration plan is ready/i)).toBeVisible();
});

test("supplier delivery separates test starts from live metrics", async ({ page }) => {
  await page.goto("/projects/PRJ-1048", { waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  await page.getByLabel("Tool").selectOption("suppliers");
  await expect(page.getByRole("heading", { name: "Supplier delivery" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "TST" })).toHaveAttribute("title", "Test starts");
  await expect(page.getByText("Test hits are separated from live delivery and cost.")).toBeVisible();
});

test("supplier routing links open in a separated bordered dialog", async ({ page }) => {
  await page.goto("/projects/PRJ-1048", { waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  await page.getByLabel("Tool").selectOption("suppliers");
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
  await waitForHydration(page);
  await page.getByLabel("Tool").selectOption("eligibility");
  await expect(page.getByRole("heading", { name: "Eligibility rules" })).toBeVisible();
  await expect(page.getByText("country", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).last().click();
  await expect(page.getByLabel("Eligibility variable 1")).toHaveValue("country");
  await expect(page.getByRole("button", { name: "Save rules" })).toBeVisible();
});

test("interlocked quota cells are visible and editable", async ({ page }) => {
  await page.goto("/projects/PRJ-1048", { waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  await page.getByLabel("Tool").selectOption("quotas");
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
  await waitForHydration(page);
  await page.getByLabel("Tool").selectOption("access");
  await expect(page.getByRole("heading", { name: "Project team access" })).toBeVisible();
  await expect(page.getByText("Kabir Rao", { exact: true })).toBeVisible();
  await expect(page.getByText("REVIEWER", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit access" }).click();
  await expect(page.getByLabel("Project role 1")).toHaveValue("REVIEWER");
  await expect(page.getByRole("button", { name: "Save access" })).toBeVisible();
});

test("new project matches the compact survey-creation reference", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/projects/new", { waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  const country = page.getByLabel("Country");
  await expect(country.locator("option")).toHaveCount(250);
  await country.selectOption("JP");
  await expect(country).toHaveValue("JP");
  await page.getByRole("button", { name: "Add More Field" }).click();
  await expect(page.getByLabel("Country")).toHaveCount(2);
  await page.getByRole("button", { name: "Remove market 2" }).click();
  await expect(page.getByLabel("Country")).toHaveCount(1);
  await expect(page.getByLabel("Survey Name")).toBeVisible();
  await expect(page.getByLabel("Survey Multi Link")).toBeVisible();
  await expect(page.getByText("AI Pre-Screening Questions:", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Variable")).toBeVisible();
  await expect(page.getByLabel("Survey Link").first()).toBeVisible();
  await expect(page.getByText("ADD Supplier :", { exact: true })).toBeVisible();
  const supplierSelect = page.getByLabel("Name (select multiple)");
  await expect(supplierSelect).toBeVisible();
  await expect(supplierSelect).toHaveAttribute("multiple", "");
  await supplierSelect.selectOption(["CPX Research"]);
  await expect(page.getByText("Selected Supplier", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Test survey URL (optional)")).toHaveCount(0);
  await page.getByLabel("Survey Name").fill("Tab state retention proof");
  await page.getByRole("tab", { name: "Security" }).click();
  await expect(page.getByLabel("Initial Status")).toBeVisible();
  await expect(page.getByLabel("Geo Security")).toBeVisible();
  await expect(page.getByLabel("FraudGuard")).toBeVisible();
  await page.getByRole("tab", { name: "Project setup" }).click();
  await expect(page.getByLabel("Survey Name")).toHaveValue("Tab state retention proof");
  await page.getByLabel("Project Type").selectOption("B2C");
  await page.getByLabel("Client", { exact: true }).selectOption("Northstar Bank");
  await page.getByLabel("Quota", { exact: true }).fill("100");
  await page.getByLabel("IR", { exact: true }).fill("40");
  await page.getByLabel("LOI", { exact: true }).fill("10");
  await page.getByLabel("CPI", { exact: true }).fill("8.5");
  await page.getByRole("button", { name: "Create Project" }).click();
  await expect(page).toHaveURL(/\/projects\/ROP-1049$/);
});

test("project supplier comparison matrix and URLs open in separate views", async ({ page, context }) => {
  test.setTimeout(120_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/projects", { waitUntil: "domcontentloaded" });
  await waitForHydration(page);
  await expect(page.getByRole("button", { name: "URLs" })).toHaveCount(0);
  await page.locator(".project-supplier-trigger").first().click();
  const statsDialog = page.getByRole("dialog", { name: /.+/ });
  await expect(statsDialog.getByText("Suppliers view", { exact: true })).toBeVisible();
  const matrix = statsDialog.locator(".supplier-matrix");
  await expect(matrix).toBeVisible();
  await expect(matrix.getByRole("columnheader", { name: "Metric" })).toBeVisible();
  await expect(matrix.getByRole("columnheader", { name: /CPX Research/ })).toBeVisible();
  await expect(matrix.getByRole("rowheader", { name: "Supplier code" })).toBeVisible();
  await expect(statsDialog.getByText("CPX Research", { exact: false })).toBeVisible();
  await expect(statsDialog.getByText("Live starts", { exact: true })).toBeVisible();
  await expect(statsDialog.getByText("Reached client", { exact: true })).toBeVisible();
  await expect(statsDialog.getByText("Test link", { exact: true })).toHaveCount(0);
  const downloadPromise = page.waitForEvent("download");
  await statsDialog.getByRole("button", { name: "Download CSV" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain("supplier-stats-links.csv");
  await statsDialog.getByRole("button", { name: "URLs" }).click();
  const linksDialog = page.getByRole("dialog", { name: /.+/ });
  await expect(linksDialog.getByText("Test link", { exact: true })).toBeVisible();
  await expect(linksDialog.getByText("Live link", { exact: true })).toBeVisible();
  await expect(linksDialog.getByText("Live starts", { exact: true })).toHaveCount(0);
  await expect(linksDialog.locator("code").first()).toContainText("/l/");
  await linksDialog.getByRole("button", { name: "Copy test" }).click();
  await expect(linksDialog.getByRole("button", { name: "Copied" })).toBeVisible();
});
