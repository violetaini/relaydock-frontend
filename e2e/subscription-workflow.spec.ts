import { expect, test } from "@playwright/test";
import { settingsGetResponses } from "./mock-fixtures";

for (const view of [{ name: "desktop", width: 1440, height: 1000 }, { name: "mobile", width: 390, height: 844 }]) {
  test(`subscription composition is usable on ${view.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(view);
    await page.addInitScript(() => { localStorage.setItem("arcway-session-token", "subscription-e2e"); localStorage.setItem("arcway-theme", "dark"); });
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    const files: Record<string, unknown>[] = [
      { id: 1, name: "机场 A", filename: "airport.yaml", type: "import", url: "https://example.com/sub", auto_update_interval: 21600, auto_sync_custom_rules: false },
      { id: 2, name: "自建专线", filename: "custom.yaml", type: "create", selected_node_ids: [7, 8], auto_sync_custom_rules: false },
    ];
    let saved: Record<string, unknown> | null = null;
    await page.route("**/api/**", async route => {
      const url = new URL(route.request().url()); const path = url.pathname;
      const replies: Record<string, unknown> = {
        ...settingsGetResponses,
        "/api/setup/status": { needs_setup: false },
        "/api/user/profile": { username: "admin", nickname: "Chitanda", role: "admin", is_admin: true, email: "admin@example.com" },
        "/api/public/branding": { name: "RelayDock", logo: "", favicon: "", login_background_mode: "gradient", font_preset: "classic-serif" },
        "/api/ws/ticket": { ticket: "test-ticket" },
        "/api/admin/subscribe-files": { files },
        "/api/admin/nodes": { nodes: [{ id: 7, node_name: "HKT 03", protocol: "ss", enabled: true, clash_config: "{}" }, { id: 8, node_name: "DMIT HK", protocol: "vless", enabled: true, clash_config: "{}" }] },
        "/api/admin/rule-templates": { templates: ["custom-v3.yaml"] },
        "/api/user/token": { token: "example-test-token" },
        "/api/user/proxy-provider-configs": [],
        "/api/user/external-subscriptions": [],
        "/api/admin/custom-rules": [],
        "/api/admin/override-scripts": [],
        "/api/admin/remote-servers": { servers: [] },
      };
      let response = replies[path] || {};
      if (path === "/api/admin/subscribe-files/generation/preview") response = { input: 30, duplicate: 2, filtered: 0, dead: 1, unknown: 3, output: 27, warnings: [], client: "clashmeta", content: "proxies: []\nrules: [MATCH,PROXY]" };
      if (path === "/api/admin/subscribe-files/generation") {
        saved = route.request().postDataJSON();
        files.push({ id: 3, type: "create", filename: "daily.yaml", ...saved }); response = { file: files[2] };
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(response) });
    });
    await page.goto("/#/subscribeFiles");
    await expect(page.getByRole("heading", { name: "订阅管理" })).toBeVisible();
    await page.getByRole("checkbox", { name: "选择来源 机场 A" }).check();
    await page.getByRole("checkbox", { name: "选择来源 自建专线" }).check();
    await page.getByRole("button", { name: "用所选来源创建策略" }).click();
    const dialog = page.getByRole("dialog", { name: "创建策略订阅" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "下一步" }).click();
    await dialog.getByRole("switch", { name: "自动剔除失效节点" }).check();
    await dialog.getByRole("button", { name: "下一步" }).click();
    await expect(dialog.getByRole("combobox", { name: /^规则模板/ })).toHaveValue("__relaydock_balanced__");
    await page.screenshot({ path: testInfo.outputPath(`subscription-${view.name}-templates.png`), fullPage: true });
    const bounds = await dialog.boundingBox(); expect(bounds).not.toBeNull(); expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(view.width + 1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await dialog.getByRole("button", { name: "生成预览" }).click();
    await dialog.getByRole("textbox", { name: "订阅名称", exact: true }).fill("日常多线订阅");
    await dialog.getByRole("button", { name: "保存订阅" }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByText("日常多线订阅", { exact: true })).toBeVisible();
    expect((saved as Record<string, unknown> | null)?.generation).toMatchObject({ source_ids: [1, 2], processing: { remove_dead: true } });
    await page.screenshot({ path: testInfo.outputPath(`subscription-${view.name}-list.png`), fullPage: true });
    expect(errors).toEqual([]);
  });
}
