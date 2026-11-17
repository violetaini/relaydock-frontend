import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { computeChartScale, formatAxisGb, DailyTrafficBarChart } from "./traffic-chart";

describe("traffic chart scale and Y-axis computation", () => {
  it("formats axis values cleanly with appropriate units", () => {
    expect(formatAxisGb(0)).toBe("0");
    expect(formatAxisGb(0.5)).toBe("512 MB");
    expect(formatAxisGb(1)).toBe("1 GB");
    expect(formatAxisGb(15)).toBe("15 GB");
    expect(formatAxisGb(150)).toBe("150 GB");
    expect(formatAxisGb(1024)).toBe("1 TB");
    expect(formatAxisGb(1536)).toBe("1.5 TB");
  });

  it("handles zero or empty traffic gracefully with standard 1 GB ceiling", () => {
    const scale = computeChartScale(0);
    expect(scale.niceMax).toBe(1);
    expect(scale.ticks).toEqual([
      { value: 1, label: "1 GB", percent: 100 },
      { value: 0.5, label: "0.5 GB", percent: 50 },
      { value: 0, label: "0", percent: 0 },
    ]);
  });

  it("computes nice step intervals and tick marks for typical usage", () => {
    const scale = computeChartScale(149.18);
    expect(scale.niceMax).toBe(150);
    expect(scale.ticks).toEqual([
      { value: 150, label: "150 GB", percent: 100 },
      { value: 100, label: "100 GB", percent: 66.66666666666666 },
      { value: 50, label: "50 GB", percent: 33.33333333333333 },
      { value: 0, label: "0", percent: 0 },
    ]);
  });

  it("computes nice scale for small traffic below 1 GB", () => {
    const scale = computeChartScale(0.8);
    expect(scale.niceMax).toBe(1);
    expect(scale.ticks[0].label).toBe("1 GB");
    expect(scale.ticks[scale.ticks.length - 1].label).toBe("0");
  });

  it("renders Y-axis ticks, reference grid lines, and proportional bars", () => {
    const history = [
      { date: "2026-11-15", used_gb: 50 },
      { date: "2026-11-16", used_gb: 150 },
      { date: "2026-11-17", used_gb: 0 },
    ];

    const { container } = render(
      <DailyTrafficBarChart
        id="dashboard-traffic-chart"
        period="month"
        history={history}
      />
    );

    const yAxis = container.querySelector(".traffic-chart-y-axis");
    expect(yAxis).toBeInTheDocument();
    expect(screen.getByText("150 GB")).toBeInTheDocument();
    expect(screen.getByText("100 GB")).toBeInTheDocument();
    expect(screen.getByText("50 GB")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();

    const gridLines = container.querySelectorAll(".traffic-chart-grid-line");
    expect(gridLines.length).toBe(4);

    const barChart = screen.getByRole("tabpanel", { name: "每日流量消耗图" });
    expect(barChart).toBeInTheDocument();

    const columns = container.querySelectorAll(".bar-column");
    expect(columns.length).toBe(3);

    const bars = container.querySelectorAll(".bar");
    expect(bars[0]).toHaveStyle({ height: "33.33333333333333%" });
    expect(bars[1]).toHaveStyle({ height: "100%" });
    expect(bars[2]).toHaveStyle({ height: "0%" });

    const dates = container.querySelectorAll(".bar-column small");
    expect(dates[0]).toHaveTextContent("15");
    expect(dates[1]).toHaveTextContent("16");
    expect(dates[2]).toHaveTextContent("17");
  });
});
