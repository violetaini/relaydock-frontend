import { formatBytes } from "./ui";
import "./traffic-progress.css";

export type TrafficProgressTone = "good" | "warn" | "bad" | "neutral";

export interface TrafficProgressState {
  used: number;
  limit: number;
  percent: number;
  fillPercent: number;
  limited: boolean;
  tone: TrafficProgressTone;
}

export function trafficProgressState(usedValue: number, limitValue: number): TrafficProgressState {
  const rawUsed = Number(usedValue);
  const rawLimit = Number(limitValue);
  const used = Number.isFinite(rawUsed) ? Math.max(0, rawUsed) : 0;
  const limit = Number.isFinite(rawLimit) ? Math.max(0, rawLimit) : 0;
  if (limit === 0) return { used, limit, percent: 0, fillPercent: 0, limited: false, tone: "neutral" };

  const percent = used / limit * 100;
  const tone: TrafficProgressTone = percent >= 85 ? "bad" : percent >= 60 ? "warn" : "good";
  return { used, limit, percent, fillPercent: Math.min(100, percent), limited: true, tone };
}

export function TrafficProgress({
  used,
  limit,
  label,
  compact = false,
  className = "",
}: {
  used: number;
  limit: number;
  label: string;
  compact?: boolean;
  className?: string;
}) {
  const state = trafficProgressState(used, limit);
  const usedText = formatBytes(state.used);
  const limitText = state.limited ? formatBytes(state.limit) : "不限额";
  return (
    <div className={`traffic-progress ${compact ? "is-compact" : ""} ${className}`.trim()} data-tone={state.tone}>
      <div className="traffic-progress-copy">
        <span title={`${usedText} / ${limitText}`}><strong>{usedText}</strong><span> / {limitText}</span></span>
        <small>{state.limited ? `${state.percent.toFixed(1)}%` : "不限额"}</small>
      </div>
      <span
        className="traffic-progress-track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={state.limited ? state.fillPercent : undefined}
        aria-valuetext={state.limited ? `${state.percent.toFixed(1)}%` : "不限额"}
      >
        <span style={{ width: `${state.fillPercent}%` }} />
      </span>
    </div>
  );
}
