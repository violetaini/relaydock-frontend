import type { ForwardingBillingMode } from "./types";

export function normalizeForwardingBillingMode(value: unknown, fallback: unknown = "both"): ForwardingBillingMode {
  if (value === "both" || value === "upload" || value === "download") return value;
  if (fallback === "both" || fallback === "upload" || fallback === "download") return fallback;
  return "both";
}

export function forwardingBillingModeLabel(value: unknown): string {
  switch (normalizeForwardingBillingMode(value)) {
    case "upload": return "仅算上行";
    case "download": return "仅算下行";
    default: return "双向";
  }
}
