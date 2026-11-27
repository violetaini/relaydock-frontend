import { expect, test } from "@playwright/test";
import { settingsGetResponses } from "./mock-fixtures";

for (const viewport of [{ name: "desktop", width: 1440, height: 1050 }, { name: "mobile", width: 390, height: 844 }]) test(`user management on ${viewport.name}`, async ({ page }, info) => {
 await page.setViewportSize(viewport);
 await page.addInitScript(() => { localStorage.setItem("arcway-session-token", "user-design-test"); localStorage.setItem("arcway-theme", "dark"); });
 const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
 const resource = (kind: string, id: number, name: string, used: number, limit: number, source = "manual") => ({ kind, id, name, used, limit, source, expires_at: "2026-12-26T12:00:00Z", reset: "每月 1 日重置", state: "active", related: kind === "subscription" || kind === "package", note: kind === "subscription" ? "订阅关联用量；共享凭据无法区分具体通过哪份订阅使用" : "" });
 const users = [
  { username: "xiaofan", nickname: "小凡", email: "xiaofan@example.com", role: "user", is_active: true, created_at: "2026-11-20T10:00:00Z", package_id: 1, package_name: "全球优质加速套餐", traffic_used: 86.4 * 1024 ** 3, user_short_code: "member", nearest_expiry: "2026-12-26T12:00:00Z", resources: [resource("server", 1, "香港 HKT", 72 * 1024 ** 3, 100 * 1024 ** 3, "package"), resource("node", 2, "日本专线", 14.4 * 1024 ** 3, 50 * 1024 ** 3, "package"), resource("subscription", 3, "全球优选", 86.4 * 1024 ** 3, 0, "package")] },
  { username: "haru", nickname: "Haru", email: "haru@example.com", role: "user", is_active: true, created_at: "2026-11-16T10:00:00Z", traffic_used: 23.5 * 1024 ** 3, user_short_code: "haru01", resources: [resource("server", 1, "香港 HKT", 20 * 1024 ** 3, 100 * 1024 ** 3), resource("node", 2, "日本专线", 3.5 * 1024 ** 3, 50 * 1024 ** 3)] },
  { username: "yuki", nickname: "Yuki", email: "yuki@example.com", role: "user", is_active: false, created_at: "2026-10-12T10:00:00Z", traffic_used: 4 * 1024 ** 3, resources: [], nearest_expiry: "2026-11-20T12:00:00Z" },
 ];
 await page.route("**/api/**", async route => {
  const path = new URL(route.request().url()).pathname;
  const data: Record<string, unknown> = { ...settingsGetResponses,
   "/api/setup/status": { needs_setup: false }, "/api/public/branding": { name: "RelayDock", default_theme: "flat" },
   "/api/user/profile": { username: "admin", nickname: "管理员", role: "admin", is_admin: true }, "/api/user/permissions": { pages: ["users"] },
   "/api/admin/users/management": { users, total: users.length, counts: { total: 3, active: 2 }, page: 1, pages: 1, matching_usernames: users.map(v => v.username), filter_options: { server: [{ id: 1, name: "香港 HKT" }], node: [{ id: 2, name: "日本专线" }], subscription: [{ id: 3, name: "全球优选" }], package: [{ id: 1, name: "全球优质加速套餐" }] } },
   "/api/admin/users/xiaofan/management": { user: users[0], resources: [...users[0].resources, resource("package", 1, "全球优质加速套餐", 0, 0, "package")], records: [{ actor: "admin", action: "batch_append", kind: "server", at: "2026-11-26T10:00:00Z" }], as_of: "2026-11-26T10:00:00Z", usage_note: "总用量来自用户计费记录，订阅及套餐关联用量不重复累加。各资源按自己的重置周期统计。" },
   "/api/admin/nodes": { nodes: [{ id: 2, node_name: "日本专线", enabled: true, direct_grant_eligible: true }] },
   "/api/admin/remote-servers": { servers: [{ id: 1, name: "香港 HKT" }] },
   "/api/admin/subscribe-files": { files: [{ id: 3, name: "全球优选" }] },
   "/api/admin/packages": { packages: [{ id: 1, name: "全球优质加速套餐" }] },
  };
  if (path === "/api/admin/users/management/batch") { await route.fulfill({ json: { success: true, results: users.slice(0, 1).map(v => ({ username: v.username, status: "ready" })) } }); return; }
  await route.fulfill({ json: data[path] || {} });
 });
 await page.goto("/#/users");
 await expect(page.getByRole("heading", { name: "用户管理" })).toBeVisible();
 await expect(page.getByText("全球优质加速套餐", { exact: true })).toBeVisible();
 expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
 await page.screenshot({ path: info.outputPath("users-list.png"), fullPage: true });
 await page.getByRole("button", { name: "筛选", exact: true }).click();
 await expect(page.getByLabel("注册开始日期")).toBeVisible();
 await page.screenshot({ path: info.outputPath("users-filters.png"), fullPage: true });
 await page.getByRole("button", { name: /小凡.*xiaofan@example/ }).click();
 const dialog = page.getByRole("dialog");
 await expect(dialog.getByText("用户计费用量", { exact: true })).toBeVisible();
 await page.screenshot({ path: info.outputPath("users-detail.png"), fullPage: true });
 await dialog.getByRole("tab", { name: "流量明细" }).click();
 await expect(dialog.getByRole("progressbar")).toHaveCount(2);
 await page.screenshot({ path: info.outputPath("users-traffic.png"), fullPage: true });
 expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
 await dialog.getByRole("button", { name: "管理授权" }).click();
 const wizard = page.getByRole("dialog");
 await expect(wizard.getByLabel("日本专线", { exact: true })).toBeVisible();
 await wizard.getByLabel("日本专线", { exact: true }).check();
 await wizard.getByRole("button", { name: "下一步" }).click();
 await wizard.getByLabel("每用户资源额度").fill("100");
 await page.screenshot({ path: info.outputPath("users-batch-limits.png"), fullPage: true });
 await wizard.getByRole("button", { name: "预览变更" }).click();
 await expect(wizard.getByRole("button", { name: "确认应用" })).toBeEnabled();
 expect(errors).toEqual([]);
});
