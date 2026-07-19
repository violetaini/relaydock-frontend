import { expect, test, type Page, type Route } from "@playwright/test";
import { settingsGetResponses } from "./mock-fixtures";

const profile = {
  username: "admin",
  email: "admin@example.com",
  nickname: "管理员",
  avatar_url: "",
  role: "admin",
  is_admin: true,
};

async function installSettingsAPI(page: Page, setupStatus = 200) {
  let enabled = false;
  await page.addInitScript(() => localStorage.setItem("arcway-session-token", "two-factor-test-token"));
  await page.route("**/api/**", async (route: Route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const key = `${request.method()} ${path}`;
    const responses: Record<string, unknown> = {
      "GET /api/setup/status": { needs_setup: false },
      "GET /api/user/profile": profile,
      ...Object.fromEntries(Object.entries(settingsGetResponses).map(([path, body]) => [`GET ${path}`, body])),
      "GET /api/admin/remote-servers": { success: true, servers: [] },
      "GET /api/system-config/refetch-interval": { refetch_interval_ms: 5000 },
      "POST /api/user/2fa/setup": {
        secret: "JBSWY3DPEHPK3PXP",
        url: "otpauth://totp/Arcway:admin?secret=JBSWY3DPEHPK3PXP&issuer=Arcway",
      },
      "POST /api/user/2fa/verify-setup": {
        recovery_codes: Array.from({ length: 8 }, (_, index) => `recovery-${index + 1}-long-code`),
      },
    };
    if (key === "GET /api/user/2fa/status") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ enabled }) });
      return;
    }
    if (key === "POST /api/user/2fa/setup" && setupStatus !== 200) {
      await route.fulfill({ status: setupStatus, contentType: "application/json", body: JSON.stringify({ error: "当前密码错误" }) });
      return;
    }
    if (key === "POST /api/user/2fa/verify-setup") enabled = true;
    if (!(key in responses)) throw new Error(`Unexpected API request: ${key}`);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(responses[key]) });
  });
}

async function expectNoViewportOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test("mobile 2FA setup stays within the viewport and recovery codes cannot be dismissed accidentally", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installSettingsAPI(page);
  await page.goto("/#/settings");
  await page.getByRole("tab", { name: "账户与 API" }).click();

  await page.getByRole("button", { name: "启用 2FA" }).click();
  await page.getByLabel("当前密码").fill("correct-password");
  await expectNoViewportOverflow(page);
  await page.getByRole("button", { name: "继续" }).click();

  await expect(page.getByText("JBSWY3DPEHPK3PXP", { exact: true })).toBeVisible();
  await expect(page.getByText(/otpauth:\/\/totp\/Arcway:admin/)).toBeVisible();
  await expectNoViewportOverflow(page);
  await page.getByLabel("6 位动态验证码").fill("123456");
  await page.getByRole("button", { name: "验证并启用" }).click();

  const recoveryDialog = page.getByRole("dialog", { name: "保存恢复码" });
  await expect(recoveryDialog).toBeVisible();
  await expect(recoveryDialog.getByRole("button", { name: "关闭", exact: true })).toHaveCount(0);
  await expectNoViewportOverflow(page);
  await page.keyboard.press("Escape");
  await expect(recoveryDialog).toBeVisible();
  await page.locator(".dialog-backdrop").click({ position: { x: 4, y: 4 } });
  await expect(recoveryDialog).toBeVisible();
  await expect(page.getByRole("button", { name: "完成" })).toBeDisabled();
});

test("an invalid setup password does not expire the active admin session", async ({ page }) => {
  await installSettingsAPI(page, 401);
  await page.goto("/#/settings");
  await page.getByRole("tab", { name: "账户与 API" }).click();
  await page.getByRole("button", { name: "启用 2FA" }).click();
  await page.getByLabel("当前密码").fill("wrong-password");
  await page.getByRole("button", { name: "继续" }).click();

  await expect(page.getByRole("alert")).toContainText("当前密码错误");
  await expect(page.getByRole("dialog", { name: "启用双因素认证" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "系统设置" })).toBeVisible();
});
