import { expect, test } from "@playwright/test";
import { settingsGetResponses } from "./mock-fixtures";

for (const view of [{ name: "desktop", width: 1440, height: 1000 }, { name: "mobile", width: 390, height: 844 }]) {
  for (const manage of [false, true]) test(`unified inventory on ${view.name} with ${manage ? "manage" : "view"} permission`, async ({ page }, info) => {
    await page.setViewportSize(view);
    await page.addInitScript(() => { localStorage.setItem("arcway-session-token", "inventory-test"); localStorage.setItem("arcway-theme", "dark"); });
    const calls: string[] = [];
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    const own = { id: 2, name: "我的机场", filename: "mine.yaml", type: "upload", kind: "external", access_source: "owned", auto_sync_custom_rules: false, generation: { kind: "external", source_ids: [], processing: {}, outputs: [{ client: "v2ray", mode: "nodes" }] } };
    const shared = { id: 1, name: "管理员线路", filename: "shared.yaml", type: "create", kind: "strategy", access_source: "assigned", file_short_code: "shared", available_clients: ["clashmeta", "clash-to-shadowrocket"] };
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname; calls.push(path);
      const responses: Record<string, unknown> = { ...settingsGetResponses,
        "/api/setup/status": { needs_setup: false }, "/api/public/branding": { name: "RelayDock" },
        "/api/user/profile": { username: "alice", nickname: "Alice", role: "user", is_admin: false },
        "/api/user/permissions": { pages: manage ? ["subscription", "subscribe-files"] : ["subscription"] },
        "/api/subscriptions": { subscriptions: [shared, { ...own, generation: undefined, available_clients: ["v2ray"] }] },
        "/api/user/token": { token: "recipient-token", user_short_code: "member" },
        "/api/admin/subscribe-files": { files: [own] }, "/api/admin/nodes": { nodes: [] },
        "/api/admin/rule-templates": { templates: [] }, "/api/admin/custom-rules": [], "/api/admin/override-scripts": [],
      };
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(responses[path] || {}) });
    });
    await page.goto("/#/subscriptions");
    await expect(page).toHaveURL(/#\/subscribeFiles$/);
    await expect(page.getByRole("heading", { name: "订阅管理" })).toBeVisible();
    await expect(page.getByText("管理员线路", { exact: true })).toBeVisible();
    await expect(page.getByText("我的机场", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "订阅链接", exact: true })).toHaveCount(0);
    await expect(page.getByLabel("编辑 管理员线路", { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("选择来源 管理员线路", { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("编辑 我的机场", { exact: true })).toHaveCount(manage ? 1 : 0);
    if (!manage) expect(calls).not.toContain("/api/admin/subscribe-files");
    await page.getByRole("combobox", { name: "订阅归属" }).selectOption("assigned");
    await expect(page.getByText("我的机场", { exact: true })).toHaveCount(0);
    const row = page.getByRole("row").filter({ hasText: "管理员线路" });
    await row.getByLabel("更多操作 管理员线路", { exact: true }).click();
    await expect(row.getByText("删除订阅", { exact: true })).toHaveCount(0);
    await row.getByRole("button", { name: "客户端订阅链接" }).click();
    const dialog = page.getByRole("dialog", { name: "管理员线路 · 订阅链接" });
    await expect(dialog.getByRole("option")).toHaveCount(2);
    await dialog.getByRole("combobox", { name: "客户端" }).selectOption("clash-to-shadowrocket");
    await expect(dialog.getByLabel("订阅地址")).toHaveValue(/\/x\/sharedmember\?t=clash-to-shadowrocket$/);
    await dialog.getByRole("button", { name: "二维码", exact: true }).click();
    await expect(dialog.getByAltText("管理员线路 订阅二维码")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: info.outputPath("unified-subscription-delivery.png"), fullPage: true });
    expect(errors).toEqual([]);
  });
}
