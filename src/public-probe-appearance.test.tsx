import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { PublicProbeScreen, type PublicProbeState } from "./auth-screens";
import { BrandingProvider, DEFAULT_BRANDING, type Branding } from "./brand";

afterEach(() => { cleanup(); localStorage.clear(); });

const probe: PublicProbeState = {
  enabled: true, show_name: true, show_traffic: true,
  servers: [{ name: "Edge", online: true, traffic_used: 1024, traffic_limit: 4096 }],
};

function page(branding: Branding, state = probe, wallpaper = "") {
  return <BrandingProvider branding={branding}><PublicProbeScreen probe={state} wallpaper={wallpaper} onLogin={() => {}} /></BrandingProvider>;
}

it("uses the default random source and keeps custom backgrounds stable during live updates and filtering", () => {
  const branding = { ...DEFAULT_BRANDING, login_background_mode: "random" };
  const view = render(page(branding));
  expect(view.container.querySelector(".public-probe-bg")).toHaveAttribute("src", expect.stringContaining("https://api.timelessq.com/bing/random?"));
  const custom = { ...branding, login_background_urls: ["https://images.example/random?kind=landscape"] };
  view.rerender(page(custom));
  const image = () => view.container.querySelector(".public-probe-bg")!;
  const source = image().getAttribute("src");
  expect(source).toContain("https://images.example/random?kind=landscape&");
  expect(image()).toHaveAttribute("referrerpolicy", "no-referrer");
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Edge" } });
  fireEvent.click(screen.getByRole("button", { name: "列表视图" }));
  view.rerender(page({ ...custom, login_background_urls: [...custom.login_background_urls] }, { ...probe, servers: [{ ...probe.servers![0], traffic_used: 2048 }] }));
  expect(image()).toHaveAttribute("src", source);
  fireEvent.click(screen.getByRole("button", { name: "随机换壁纸" }));
  expect(image().getAttribute("src")).not.toBe(source);
  expect(screen.getByRole("textbox")).toHaveValue("Edge");
  expect(screen.getByRole("button", { name: "列表视图" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.error(image());
  expect(image()).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "随机换壁纸" }));
  expect(image()).not.toBeNull();
});

it("shares fixed wallpaper verbatim, respects gradient and explicit empty lists", () => {
  const signed = "https://images.example/fixed.jpg?signature=keep-this";
  const view = render(page({ ...DEFAULT_BRANDING, login_background_mode: "fixed" }, probe, signed));
  expect(view.container.querySelector(".public-probe-bg")).toHaveAttribute("src", signed);
  expect(screen.queryByRole("button", { name: "随机换壁纸" })).toBeNull();
  view.rerender(page({ ...DEFAULT_BRANDING, login_background_mode: "gradient" }, probe, signed));
  expect(view.container.querySelector(".public-probe-bg")).toBeNull();
  view.rerender(page({ ...DEFAULT_BRANDING, login_background_mode: "random", login_background_urls: [] }));
  expect(view.container.querySelector(".public-probe-bg")).toBeNull();
  expect(screen.queryByRole("button", { name: "随机换壁纸" })).toBeNull();
});

it.each(["grid", "list"])("shows traffic meters in %s mode including unlimited, empty and exceeded quotas", (layout) => {
  const cases = [
    { name: "Quarter", traffic_used: 1024, traffic_limit: 4096, expected: "25" },
    { name: "Empty", traffic_used: 0, traffic_limit: 4096, expected: "0" },
    { name: "Exceeded", traffic_used: 8192, traffic_limit: 4096, expected: "100" },
    { name: "Unlimited", traffic_used: 1024, traffic_limit: 0, expected: null },
    { name: "Invalid", traffic_used: Infinity, traffic_limit: NaN, expected: null },
  ];
  const view = render(page(DEFAULT_BRANDING, { ...probe, servers: cases }));
  if (layout === "list") fireEvent.click(screen.getByRole("button", { name: "列表视图" }));
  for (const item of cases) {
    const card = screen.getByText(item.name).closest("article")!;
    const meter = within(card).getByRole("progressbar", { name: /^流量 / });
    expect(meter.getAttribute("aria-valuenow")).toBe(item.expected);
    if (item.expected === null) {
      expect(meter).toHaveAttribute("aria-valuetext", "不限额");
      expect(within(card).getByText("不限额")).toBeInTheDocument();
      expect(meter.querySelector("i")).toHaveStyle({ width: "0%" });
    }
  }
  view.rerender(page(DEFAULT_BRANDING, { ...probe, show_traffic: false }));
  expect(screen.queryByRole("progressbar", { name: /^流量 / })).toBeNull();
});
