import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TrafficProgress, trafficProgressState } from "./traffic-progress";

vi.hoisted(() => {
  (globalThis as unknown as { process: { env: { NODE_ENV?: string } } }).process.env.NODE_ENV = "test";
});

afterEach(cleanup);

describe("traffic progress", () => {
  it.each([
    [59, "good"],
    [60, "warn"],
    [84.9, "warn"],
    [85, "bad"],
  ] as const)("uses the expected warning tone at %s%%", (used, tone) => {
    expect(trafficProgressState(used, 100).tone).toBe(tone);
  });

  it("renders an accessible, clamped quota bar", () => {
    render(<TrafficProgress used={120 * 1024 ** 3} limit={100 * 1024 ** 3} label="套餐流量使用率" />);

    const bar = screen.getByRole("progressbar", { name: "套餐流量使用率" });
    expect(bar).toHaveAttribute("aria-valuenow", "100");
    expect(bar).toHaveAttribute("aria-valuetext", "120.0%");
    expect(bar.closest(".traffic-progress")).toHaveAttribute("data-tone", "bad");
  });

  it("labels a zero limit as unlimited", () => {
    expect(trafficProgressState(12 * 1024 ** 3, 0)).toMatchObject({ limited: false, tone: "neutral" });
    render(<TrafficProgress used={12 * 1024 ** 3} limit={0} label="不限额流量" />);

    const progress = screen.getByRole("progressbar", { name: "不限额流量" });
    expect(screen.getByText("不限额")).toBeInTheDocument();
    expect(progress).toHaveAttribute("aria-valuetext", "不限额");
    expect(progress).not.toHaveAttribute("aria-valuenow");
    expect(progress.closest(".traffic-progress")).toHaveAttribute("data-tone", "neutral");
  });

  it("normalizes non-finite API values", () => {
    expect(trafficProgressState(Number.POSITIVE_INFINITY, Number.NaN)).toMatchObject({
      used: 0,
      limit: 0,
      percent: 0,
      fillPercent: 0,
      tone: "neutral",
    });
  });
});
