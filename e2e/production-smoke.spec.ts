import { expect, test } from "@playwright/test";
import path from "node:path";

const productionURL = process.env.PRODUCTION_BASE_URL;

test.describe("production shell", () => {
  test.skip(!productionURL, "Set PRODUCTION_BASE_URL to run deployment smoke checks");

  for (const viewport of [
    { name: "desktop", width: 1440, height: 900 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    test(`${viewport.name} serves the deployed frontend without browser errors`, async ({ page }) => {
      const pageErrors: string[] = [];
      const failedResponses: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      page.on("response", (response) => {
        if (response.url().startsWith(productionURL!) && response.status() >= 400) {
          failedResponses.push(`${response.status()} ${new URL(response.url()).pathname}`);
        }
      });

      await page.setViewportSize(viewport);
      await page.goto(productionURL!, { waitUntil: "networkidle" });
      await expect(page.locator("main")).toBeVisible();
      await expect
        .poll(async () => {
          const loginVisible = await page.getByRole("heading", { name: "进入控制台" }).isVisible();
          const publicStatusVisible = await page.getByRole("heading", { name: "服务器状态" }).isVisible();
          return loginVisible || publicStatusVisible;
        })
        .toBe(true);
      await expect(page.locator('script[src*="/assets/index-"][src$=".js"]')).toHaveCount(1);
      await expect(page.locator('link[rel="stylesheet"][href*="/assets/index-"][href$=".css"]')).toHaveCount(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
      expect(pageErrors).toEqual([]);
      expect(failedResponses).toEqual([]);
      await page.screenshot({
        path: path.resolve("../docs/change-records/assets/MMX-060", `production-login-${viewport.name}.png`),
        fullPage: true,
      });
    });
  }
});
