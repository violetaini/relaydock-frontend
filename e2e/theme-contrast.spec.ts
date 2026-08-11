import { expect, test, type Locator, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

const fixtureCSS = [
  "styles.css",
  "modern-theme.css",
  "content-workbench.css",
  "rules-workbench.css",
  "services-workbench.css",
].map((file) => readFileSync(path.resolve("src", file), "utf8")).join("\n");

const fixture = `
  <style>
    ${fixtureCSS}
    body { padding: 24px; }
    main { display: grid; gap: 16px; }
    * { transition: none !important; }
  </style>
  <main>
    <div class="cw-tabs"><button class="is-active">订阅生成</button></div>
    <div class="cw-mode"><button class="is-active">自定义规则</button><button>使用模板</button></div>
    <div class="rw-filter"><button class="is-active">全部规则 <span>12</span></button></div>
    <div class="rw-kind-picker"><button class="is-active">自定义规则</button><button>规则集</button></div>
    <button class="button button-primary">保存更改</button>
    <div class="xray-security-segments"><button class="is-active">Reality</button><button>TLS</button></div>
  </main>
`;

function channelToLinear(channel: number) {
  const normalized = channel / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function luminance(value: string) {
  const channels = value.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  if (!channels || channels.length !== 3) throw new Error(`Unsupported color: ${value}`);
  const [red, green, blue] = channels.map(channelToLinear);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(foreground: string, background: string) {
  const lighter = Math.max(luminance(foreground), luminance(background));
  const darker = Math.min(luminance(foreground), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

async function expectReadable(locator: Locator, label: string) {
  const colors = await locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return { foreground: style.color, background: style.backgroundColor };
  });
  expect(
    contrastRatio(colors.foreground, colors.background),
    `${label}: ${colors.foreground} on ${colors.background}`,
  ).toBeGreaterThanOrEqual(4.5);
}

async function setTheme(page: Page, mode: "light" | "dark", style: "pixel" | "anime" | "flat") {
  await page.setContent(fixture);
  await page.evaluate(({ mode, style }) => {
    document.documentElement.dataset.theme = mode;
    document.documentElement.dataset.styleTheme = style;
  }, { mode, style });
}

for (const mode of ["light", "dark"] as const) {
  for (const style of ["pixel", "anime", "flat"] as const) {
    test(`${mode} ${style} controls keep readable text`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await setTheme(page, mode, style);

      const controls = [
        [page.locator(".cw-tabs .is-active"), "content tab"],
        [page.locator(".cw-mode .is-active"), "content mode"],
        [page.locator(".rw-filter .is-active"), "rule filter"],
        [page.locator(".rw-filter .is-active span"), "rule count"],
        [page.locator(".rw-kind-picker .is-active"), "rule kind"],
        [page.locator(".xray-security-segments .is-active"), "security segment"],
      ] as const;

      for (const [control, label] of controls) await expectReadable(control, label);

      const primary = page.locator(".button-primary");
      await expectReadable(primary, "primary button");
      await primary.hover();
      await expectReadable(primary, "primary button hover");

      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    });
  }
}
