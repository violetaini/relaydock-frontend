import { expect, test, type Page, type Route } from "@playwright/test";
import path from "node:path";

const session = {
  token: "authenticated-session",
  expires_at: "2026-08-19T00:00:00Z",
  username: "admin",
  email: "admin@example.com",
  nickname: "运维管理员",
  avatar_url: "",
  role: "admin",
  is_admin: true,
};

function dashboardResponse(pathname: string): unknown {
  const responses: Record<string, unknown> = {
    "/api/admin/nodes": { nodes: [] },
    "/api/traffic/summary": {
      metrics: { total_limit_gb: 0, total_used_gb: 0, total_remaining_gb: 0, usage_percentage: 0, unlimited_used_gb: 0 },
      history: [],
    },
    "/api/admin/remote-servers": { success: true, servers: [] },
    "/api/admin/users": { users: [session] },
  };
  return responses[pathname];
}

async function fulfill(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function assertViewport(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
}

test("public probe remains separate from the management login", async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (request.method() === "GET" && pathname === "/api/setup/status") return fulfill(route, { needs_setup: false });
    if (request.method() === "GET" && pathname === "/api/public/branding") return fulfill(route, { name: "RelayDock", logo: "", favicon: "" });
    if (request.method() === "GET" && pathname === "/api/public/login-wallpaper") return fulfill(route, { login_wallpaper: "" });
    if (request.method() === "GET" && pathname === "/api/public/probe-servers") return fulfill(route, {
      enabled: true,
      title: "Edge Service Status",
      show_name: true,
      show_cpu: true,
      show_memory: true,
      show_disk: true,
      show_traffic: true,
      show_speed: true,
      servers: [{
        name: "Hong Kong Edge",
        country_code: "HK",
        upload_speed: 1024,
        download_speed: 4096,
        traffic_used: 1048576,
        traffic_limit: 10485760,
        cpu_pct: 12.5,
        loadavg: "0.12 0.08 0.03",
        mem_used: 3 * 1024 ** 3,
        mem_total: 8 * 1024 ** 3,
        disk_used: 18 * 1024 ** 3,
        disk_total: 50 * 1024 ** 3,
        online: true,
      }],
    });
    if (request.method() === "GET" && pathname === "/api/captcha/config") return fulfill(route, { enabled: false, site_key: "" });
    return fulfill(route, { error: `unexpected ${request.method()} ${pathname}` }, 500);
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Edge Service Status" })).toBeVisible();
  await expect(page.getByText("Hong Kong Edge")).toBeVisible();
  await expect(page.getByTitle("HK").locator("img")).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "CPU 13%" })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "内存 38%" })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "磁盘 36%" })).toBeVisible();
  await expect(page.locator(".public-probe-item")).toHaveCSS("opacity", "1");
  await assertViewport(page);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("heading", { name: "进入控制台" })).toBeVisible();
  await assertViewport(page);
});

test("initial setup validates locally and submits the complete contract", async ({ page }) => {
  const requests: Array<{ path: string; method: string; body?: unknown }> = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    requests.push({ path: pathname, method: request.method(), body: request.postDataJSON() });
    if (request.method() === "GET" && pathname === "/api/setup/status") return fulfill(route, { needs_setup: true });
    if (request.method() === "POST" && pathname === "/api/setup/init") return fulfill(route, { success: true });
    if (request.method() === "GET" && pathname === "/api/captcha/config") return fulfill(route, { enabled: false, site_key: "" });
    if (request.method() === "GET" && pathname === "/api/public/branding") return fulfill(route, { name: "RelayDock", logo: "", favicon: "" });
    if (request.method() === "GET" && pathname === "/api/public/login-wallpaper") return fulfill(route, { login_wallpaper: "" });
    if (request.method() === "GET" && pathname === "/api/public/probe-servers") return fulfill(route, { enabled: false, servers: [] });
    return fulfill(route, { error: `unexpected ${request.method()} ${pathname}` }, 500);
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "创建首位管理员" })).toBeVisible();
  await assertViewport(page);
  await page.screenshot({ path: path.resolve("../docs/change-records/assets/MMX-060", "arcway-setup-mobile.png"), fullPage: true });

  await page.getByLabel("邮箱").fill("owner@example.com");
  await page.getByLabel("登录密码").fill("strong-password");
  await page.getByLabel("确认密码").fill("different-password");
  await page.getByRole("button", { name: "创建管理员" }).click();
  await expect(page.getByText("两次输入的密码不一致")).toBeVisible();
  expect(requests.filter((item) => item.path === "/api/setup/init")).toHaveLength(0);

  await page.getByLabel("确认密码").fill("strong-password");
  await page.getByRole("button", { name: "创建管理员" }).click();
  await expect(page.getByRole("heading", { name: "进入控制台" })).toBeVisible();
  expect(requests.find((item) => item.path === "/api/setup/init")?.body).toEqual({
    username: "admin",
    password: "strong-password",
    nickname: "管理员",
    email: "owner@example.com",
    domain: "",
  });
});

for (const recoveryMode of [false, true]) {
  test(`login completes with ${recoveryMode ? "a recovery code" : "a TOTP code"}`, async ({ page }) => {
    const unknown: string[] = [];
    const verificationBodies: unknown[] = [];
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const pathname = new URL(request.url()).pathname;
      const key = `${request.method()} ${pathname}`;
      if (key === "GET /api/setup/status") return fulfill(route, { needs_setup: false });
      if (key === "GET /api/captcha/config") return fulfill(route, { enabled: false, site_key: "" });
      if (key === "GET /api/public/branding") return fulfill(route, { name: "RelayDock", logo: "", favicon: "" });
      if (key === "GET /api/public/login-wallpaper") return fulfill(route, { login_wallpaper: "" });
      if (key === "GET /api/public/probe-servers") return fulfill(route, { enabled: false, servers: [] });
      if (key === "POST /api/login") {
        expect(request.postDataJSON()).toEqual({ username: "admin", password: "correct-password", remember_me: true, turnstile_token: "" });
        return fulfill(route, { requires_2fa: true, two_factor_token: "two-factor-challenge" });
      }
      if (key === "POST /api/login/2fa" || key === "POST /api/login/recovery") {
        verificationBodies.push(request.postDataJSON());
        return fulfill(route, session);
      }
      const dashboard = dashboardResponse(pathname);
      if (request.method() === "GET" && dashboard !== undefined) return fulfill(route, dashboard);
      unknown.push(key);
      return fulfill(route, { error: `unexpected ${key}` }, 500);
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "进入控制台" })).toBeVisible();
    if (!recoveryMode) {
      await page.screenshot({ path: path.resolve("../docs/change-records/assets/MMX-060", "arcway-login-desktop.png"), fullPage: true });
    }
    await page.getByLabel("账号").fill("admin");
    await page.getByLabel("密码").fill("correct-password");
    await page.getByRole("button", { name: "登录" }).click();
    await expect(page.getByRole("heading", { name: "验证第二因素" })).toBeVisible();

    if (recoveryMode) await page.getByRole("button", { name: "使用恢复码" }).click();
    await page.getByLabel(recoveryMode ? "恢复码" : "动态验证码").fill(recoveryMode ? "ABCD-EFGH" : "123456");
    await page.getByRole("button", { name: "验证并登录" }).click();
    await expect(page.getByRole("heading", { name: "流量信息" })).toBeAttached();
    await expect(page.getByRole("button", { name: "服务管理" })).toBeVisible();
    await assertViewport(page);
    expect(verificationBodies).toEqual([recoveryMode
      ? { two_factor_token: "two-factor-challenge", recovery_code: "ABCD-EFGH" }
      : { two_factor_token: "two-factor-challenge", code: "123456" }]);
    expect(unknown).toEqual([]);
  });
}
