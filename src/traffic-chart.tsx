import { useMemo, type ReactNode } from "react";

export interface ChartTick {
  value: number;
  label: string;
  percent: number; // 0 to 100
}

export interface ChartScale {
  niceMax: number;
  ticks: ChartTick[];
}

export function formatAxisGb(gb: number): string {
  if (gb <= 0) return "0";
  if (gb >= 1024) {
    const tb = gb / 1024;
    return `${Number(tb.toFixed(tb >= 10 ? 0 : 1))} TB`;
  }
  if (gb >= 1) {
    return `${Number(gb.toFixed(gb >= 10 ? 0 : 1))} GB`;
  }
  const mb = Math.round(gb * 1024);
  return `${mb} MB`;
}

export function computeChartScale(maxValue: number, targetIntervals = 3): ChartScale {
  const safeMax = Math.max(0, Number(maxValue) || 0);
  if (safeMax <= 0) {
    const defaultMax = 1;
    return {
      niceMax: defaultMax,
      ticks: [
        { value: 1, label: "1 GB", percent: 100 },
        { value: 0.5, label: "0.5 GB", percent: 50 },
        { value: 0, label: "0", percent: 0 },
      ],
    };
  }

  const intervals = Math.max(1, targetIntervals);
  const rawStep = safeMax / intervals;
  const power = Math.floor(Math.log10(rawStep));
  const base = Math.pow(10, power);
  const fraction = rawStep / base;

  let niceFraction: number;
  if (fraction <= 1) niceFraction = 1;
  else if (fraction <= 2) niceFraction = 2;
  else if (fraction <= 2.5) niceFraction = 2.5;
  else if (fraction <= 5) niceFraction = 5;
  else niceFraction = 10;

  const step = niceFraction * base;
  const numSteps = Math.max(1, Math.ceil(safeMax / step));
  const niceMax = numSteps * step;

  const ticks: ChartTick[] = [];
  for (let i = numSteps; i >= 0; i--) {
    const value = Math.round(i * step * 1000) / 1000;
    const percent = Math.min(100, Math.max(0, (value / niceMax) * 100));
    ticks.push({
      value,
      label: formatAxisGb(value),
      percent,
    });
  }

  return { niceMax, ticks };
}

export interface TrafficHistoryPoint {
  date: string;
  used_gb: number;
}

export interface DailyTrafficBarChartProps {
  id?: string;
  role?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  period?: string;
  className?: string;
  history: TrafficHistoryPoint[];
  formatDate?: (date: string) => string;
}

export function DailyTrafficBarChart({
  id = "dashboard-traffic-chart",
  role = "tabpanel",
  ariaLabel = "每日流量消耗图",
  ariaLabelledBy,
  period,
  className = "",
  history,
  formatDate = (d) => d.slice(-2),
}: DailyTrafficBarChartProps) {
  const maxVal = Math.max(0, ...history.map((item) => Number(item.used_gb) || 0));
  const scale = useMemo(() => computeChartScale(maxVal), [maxVal]);

  const periodClass = period ? `period-${period}` : "";
  const containerClass = `traffic-chart-container ${periodClass} ${className}`.trim();

  return (
    <div className={containerClass}>
      <div className="traffic-chart-y-axis" aria-hidden="true">
        {scale.ticks.map((tick) => (
          <div
            key={tick.value}
            className="traffic-chart-y-tick"
            style={{ bottom: `${tick.percent}%` }}
          >
            <span>{tick.label}</span>
          </div>
        ))}
      </div>

      <div className="traffic-chart-plot">
        <div className="traffic-chart-grid" aria-hidden="true">
          {scale.ticks.map((tick) => (
            <div
              key={tick.value}
              className={`traffic-chart-grid-line ${tick.percent === 0 ? "is-baseline" : ""}`}
              style={{ bottom: `${tick.percent}%` }}
            />
          ))}
        </div>

        <div
          id={id}
          className={`bar-chart ${periodClass}`.trim()}
          role={role}
          aria-label={ariaLabelledBy ? undefined : ariaLabel}
          aria-labelledby={ariaLabelledBy}
        >
          <span className="sr-only">
            {history.map((item) => `${item.date} ${item.used_gb} GB`).join("；")}
          </span>
          {history.map((item) => {
            const used = Number(item.used_gb) || 0;
            const barHeight = scale.niceMax > 0 ? (used / scale.niceMax) * 100 : 0;
            const safeHeight = used > 0 ? Math.max(3, Math.min(100, barHeight)) : 0;

            return (
              <div
                className="bar-column"
                key={item.date}
                title={`${item.date}: ${item.used_gb} GB`}
              >
                <div className="bar-track">
                  <span
                    className="bar-value"
                    style={{ bottom: `calc(${safeHeight}% + 4px)` }}
                  >
                    {used > 0 ? used : ""}
                  </span>
                  <span
                    className="bar"
                    style={{ height: `${safeHeight}%` }}
                  />
                </div>
                <small>{formatDate(item.date)}</small>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
