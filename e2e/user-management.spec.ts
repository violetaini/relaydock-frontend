import { expect, test } from "@playwright/test";
import { settingsGetResponses } from "./mock-fixtures";

for (const viewport of [{ name: "desktop", width: 1440, height: 1050 }, { name: "mobile", width: 390, height: 844 }]) test(`user management on ${viewport.name}`, async ({ page }, info) => {
 await page.setViewportSize(viewport);
 await page.addInitScript(() => { localStorage.setItem("arcway-session-token", "user-design-test"); localStorage.setItem("arcway-theme", "dark"); });
 const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
 const resource = (kind: string, id: number, name: string, used: number, limit: number, source = "manual") => ({ kind, id, name, used, limit, source, expires_at: "2026-12-02T12:00:00Z", reset: "每月 1 日重置", state: "active", related: kind === "subscription" || kind === "package", note: kind === "subscription" ? "订阅关联用量；共享凭据无法区分具体通过哪份订阅使用" : "" });
 const users = [
  { username: "xiaofan", nickname: "小凡", email: "xiaofan@example.com", role: "user", is_active: true, created_at: "2026-11-20T10:00:00Z", package_id: 1, package_name: "全球优质加速套餐", traffic_used: 86.4 * 1024 ** 3, user_short_code: "member", nearest_expiry: "2026-12-02T12:00:00Z", resources: [resource("server", 1, "香港 HKT", 72 * 1024 ** 3, 100 * 1024 ** 3, "package"), resource("node", 2, "日本专线", 14.4 * 1024 ** 3, 50 * 1024 ** 3, "package"), resource("subscription", 3, "全球优选", 86.4 * 1024 ** 3, 0, "package")] },
  { username: "haru", nickname: "Haru", email: "haru@example.com", role: "user", is_active: true, created_at: "2026-11-16T10:00:00Z", traffic_used: 23.5 * 1024 ** 3, user_short_code: "haru01", resources: [resource("server", 1, "香港 HKT", 20 * 1024 ** 3, 100 * 1024 ** 3), resource("node", 2, "日本专线", 3.5 * 1024 ** 3, 50 * 1024 ** 3)] },
  { username: "yuki", nickname: "Yuki", email: "yuki@example.com", role: "user", is_active: false, created_at: "2026-10-12T10:00:00Z", traffic_used: 4 * 1024 ** 3, resources: [], nearest_expiry: "2026-11-20T12:00:00Z" },
 ];
 await page.route("**/api/**", async route => {
  const path = new URL(route.request().url()).pathname;
  const data: Record<string, unknown> = { ...settingsGetResponses,
   "/api/setup/status": { needs_setup: false }, "/api/public/branding": { name: "RelayDock", default_theme: "flat" },
   "/api/user/profile": { username: "admin", nickname: "管理员", role: "admin", is_admin: true }, "/api/user/permissions": { pages: ["users"] },
   "/api/admin/users/management": { users, total: users.length, counts: { total: 3, active: 2 }, page: 1, pages: 1, matching_usernames: users.map(v => v.username), filter_options: { server: [{ id: 1, name: "香港 HKT" }], node: [{ id: 2, name: "日本专线" }], subscription: [{ id: 3, name: "全球优选" }], package: [{ id: 1, name: "全球优质加速套餐" }] } },
   "/api/admin/users/xiaofan/management": { overview: {
    billed_bytes:users[0].traffic_used,activity:{connections:12,active_nodes:2,reported_at:"2026-11-27T04:00:00Z",reporting_servers:1,expected_servers:1,complete:true,max_age_seconds:90},
    expiry:{kind:"package",id:1,name:"全球优质加速套餐",at:"2026-12-02T12:00:00Z",days:5,expired:false},limited_resources:2,unlimited_resources:0,near_limit:0,over_limit:0,unconfirmed:0,billing_resources:2,
    alerts:[{code:"expiring",severity:"warn",kind:"package",id:1,name:"全球优质加速套餐",message:"将在 5 天内到期，请及时安排续期。",tab:"resources"}],top_usage:users[0].resources.filter(v=>v.kind!=="subscription")
   }, user: users[0], resources: [...users[0].resources, resource("package", 1, "全球优质加速套餐", 0, 0, "package")], records: [...Array.from({length:9},()=>({actor:"package",action:"grant.materialized",kind:"server_grant",at:"2026-11-27T05:55:35Z"})), { actor: "admin", action: "batch_append", kind: "server", at: "2026-11-26T10:00:00Z" }], as_of: "2026-11-27T04:00:00Z", usage_note: "总用量来自用户计费记录，订阅及套餐关联用量不重复累加。各资源按自己的重置周期统计。" },
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
 await expect(dialog.getByText("计费用量", { exact: true })).toBeVisible();
 await expect(dialog.getByText("主要用量来源",{exact:true})).toBeVisible();
 await expect(dialog.locator(".um-resource-card")).toHaveCount(0);
 await expect(dialog.getByText("授权概览",{exact:true})).toHaveCount(0);
 await expect(dialog.getByLabel("当前连接情况")).toContainText("12");
 await page.evaluate(()=>document.fonts.ready.then(()=>undefined));
 await dialog.evaluate(element=>element.getAnimations().forEach(animation=>animation.finish()));
 const header=dialog.locator(".dialog-header");
 await expect(header.getByText("已启用",{exact:true})).toBeVisible();
 await expect(header).toContainText("注册于 2026/11/20");
 const headerBox=await header.boundingBox(),avatarBox=await header.locator(".um-detail-avatar").boundingBox();
 expect(avatarBox!.x-headerBox!.x).toBeGreaterThanOrEqual(24);
 expect(avatarBox!.y-headerBox!.y).toBeGreaterThanOrEqual(24);
 expect((await header.getByRole("heading").boundingBox())!.y-headerBox!.y).toBeGreaterThanOrEqual(24);
 const identityBox=await header.locator("p").boundingBox();
 expect(headerBox!.y+headerBox!.height-identityBox!.y-identityBox!.height).toBeGreaterThanOrEqual(24);
 if(viewport.name==="desktop"){
  const tabs=await dialog.locator(".um-detail-tabs").boundingBox(),actions=await dialog.locator(".um-detail-actions").boundingBox();
  expect(Math.abs(tabs!.y+tabs!.height/2-actions!.y-actions!.height/2)).toBeLessThanOrEqual(1);
  const title=await header.getByRole("heading").boundingBox(),status=await header.getByText("已启用",{exact:true}).boundingBox();
  expect(Math.abs(title!.y+title!.height/2-status!.y-status!.height/2)).toBeLessThanOrEqual(1);
 }
 const usagePanel=dialog.locator(".uo-usage-panel"),alertsPanel=dialog.locator(".uo-alerts-panel");
 const usageBox=await usagePanel.boundingBox(),alertsBox=await alertsPanel.boundingBox();
 if(viewport.name==="desktop"){
  expect(Math.abs(usageBox!.height-alertsBox!.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(usageBox!.y-alertsBox!.y)).toBeLessThanOrEqual(1);
 }else{
  expect(alertsBox!.y+alertsBox!.height).toBeLessThanOrEqual(usageBox!.y+1);
 }
 expect(await dialog.locator(".uo-metric-heading").first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(14);
 expect(await usagePanel.locator("h3").evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
 expect(await alertsPanel.locator(".uo-alert small").first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(13);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
 await page.screenshot({ path: info.outputPath("users-detail.png"), fullPage: false, animations: "disabled" });
 await expect(dialog.getByRole("heading", {name:"小凡",exact:true})).toBeVisible();
 await expect(dialog.locator(".dialog-header")).toContainText("@xiaofan · xiaofan@example.com");
 await dialog.getByRole("tab",{name:"操作记录",exact:true}).click();
 const activity=dialog.getByRole("list",{name:"用户授权操作记录"});
 await expect(activity.getByRole("listitem")).toHaveCount(2);
 await expect(activity).toContainText("系统按套餐配置同步服务器授权。");
 await expect(activity).toContainText("已合并 9 条同步记录");
 await expect(activity).toContainText("追加服务器授权");
 await expect(activity).toContainText("操作人：admin");
 await expect(activity).not.toContainText("grant.materialized");
 await expect(activity).not.toContainText("server_grant");
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth)).toBeLessThanOrEqual(1);
 await page.screenshot({path:info.outputPath("users-activity.png"),fullPage:false,animations:"disabled"});
 await dialog.getByRole("tab",{name:"概览",exact:true}).click();
 await dialog.getByRole("button",{name:/全球优质加速套餐：将在/}).click();
 await expect(dialog.getByRole("tab",{name:"授权资源"})).toHaveAttribute("aria-selected","true");
 await expect(dialog.getByRole("button",{name:"套餐",exact:true})).toHaveClass(/is-active/);
 await dialog.getByRole("tab",{name:"概览",exact:true}).click();
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
