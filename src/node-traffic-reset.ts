import type { NodeTrafficResetPeriod, PackageItem } from "./types";

export function normalizeNodeTrafficResetPeriod(
  value: PackageItem["node_traffic_reset_period"],
): NodeTrafficResetPeriod {
  return value === "quarterly" || value === "yearly" ? value : "monthly";
}

export function packageNodeTrafficResetSummary(item: PackageItem): string {
  if (!item.is_reset) return "固定节点按套餐授权周期重置";
  const day = Math.min(31, Math.max(1, Math.floor(Number(item.reset_day) || 1)));
  const period = normalizeNodeTrafficResetPeriod(item.node_traffic_reset_period);
  if (period === "quarterly") return `固定节点每个自然季度首月 ${day} 日重置`;
  if (period === "yearly") return `固定节点每个自然年 1 月 ${day} 日重置`;
  return `固定节点每月 ${day} 日重置`;
}
