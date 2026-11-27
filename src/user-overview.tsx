import { useState } from "react";
import { Activity, ArrowDownUp, ArrowUpRight, CalendarClock, CheckCircle2, ChevronDown, ChevronRight, CircleAlert, Gauge, Info, Layers3, Package, Server, ShieldCheck, TriangleAlert } from "lucide-react";
import { Button, formatBytes } from "./ui";
import "./user-overview.css";

type Kind = "node" | "server" | "subscription" | "package" | "forwarding";
export interface OverviewResource {
 kind: Kind; id: number; name: string; source: string; used: number; limit: number;
 limit_note?: string; reset: string; state: string; related: boolean; expires_at?: string; next_reset_at?: string;
}
export interface QuotaLayer {
 key: "package" | "module" | "resource"; title: string; total: number;
 items: {kind: Kind; id: number; name: string; used: number; limit: number; reset?: string}[];
}
export interface OverviewData {
 quota_layers?: QuotaLayer[];
 billed_bytes: number;
 activity: { connections: number | null; active_nodes: number | null; reported_at?: string; reporting_servers: number; expected_servers: number; complete: boolean; max_age_seconds: number };
 expiry: { kind: Kind; id: number; name: string; at: string; days: number; expired: boolean } | null;
 limited_resources: number; unlimited_resources: number; near_limit: number; over_limit: number;
 unconfirmed: number; billing_resources: number;
 alerts: { code: string; severity: string; kind: Kind | ""; id: number; name: string; message: string; tab: string }[];
 top_usage: OverviewResource[];
}

interface Props {
 user: { username: string; is_active: boolean; traffic_used?: number; package_name?: string; package_id?: number };
 resources: OverviewResource[];
 overview?: OverviewData;
 asOf: string;
 receivedAt?: number;
 onNavigate: (tab: "resources" | "traffic", kind?: Kind) => void;
 onSettings: () => void;
 onAuthorize: () => void;
}

function shortDate(value?: string) {
 if (!value) return "未设置";
 const date = new Date(value);
 return Number.isFinite(date.getTime()) ? date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" }) : "未设置";
}
function fullDate(value?: string) {
 return value ? new Date(value).toLocaleDateString("zh-CN") : "未设置";
}
function clockTime(value?: string) {
 return value ? new Date(value).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";
}

export function UserOverview({ user, resources, overview, asOf, receivedAt, onNavigate, onSettings, onAuthorize }: Props) {
 const [expandedAlerts, setExpandedAlerts] = useState(false);
 const known = Boolean(overview);
 const expiry = overview?.expiry;
 const rawActivity = overview?.activity;
 const serverNow = Date.parse(asOf) + (receivedAt ? Math.max(0, Date.now() - receivedAt) : 0);
 const staleConnections = Boolean(rawActivity?.reported_at && serverNow - Date.parse(rawActivity.reported_at) > rawActivity.max_age_seconds * 1000);
 const activity = staleConnections && rawActivity ? {...rawActivity, connections:null, active_nodes:null, reporting_servers:0, complete:false} : rawActivity;
 const alerts = overview?.alerts || [];
 const visibleAlerts = expandedAlerts ? alerts : alerts.slice(0, 4);
 const topUsage = overview?.top_usage || [];
 const quotaLayers = overview?.quota_layers || [];
 const riskCount = (overview?.near_limit || 0) + (overview?.over_limit || 0);
 const hasServices = resources.length > 0;
 const serverCount = new Set(resources.filter(v => v.kind === "server").map(v => v.id)).size;
 const nodeCount = new Set(resources.filter(v => v.kind === "node").map(v => v.id)).size;
 const subscriptionCount = new Set(resources.filter(v => v.kind === "subscription").map(v => v.id)).size;
 const [amount, unit] = formatBytes(overview?.billed_bytes ?? user.traffic_used ?? 0).split(" ");
 const expiryValue = expiry ? expiry.expired ? "已到期" : `${expiry.days}` : hasServices ? "长期有效" : "暂无服务";
 const quotaValue = !known ? "—" : riskCount ? String(riskCount) : overview!.limited_resources ? "0" : overview!.billing_resources ? "不限额" : "—";
 const connectionValue = activity?.connections == null ? "—" : String(activity.connections);
 const resetLabels = [...new Set(resources.filter(v => v.kind === "server" || v.kind === "node" && !v.related).map(v => v.reset).filter(Boolean))];

 return <div className="uo-root">
  <div className="uo-metrics" aria-label="用户关键数据">
   <button className="uo-metric is-usage" onClick={() => onNavigate("traffic")} aria-label="查看用户流量明细">
    <span className="uo-metric-heading"><span>计费用量</span><span className="uo-metric-icon"><ArrowDownUp size={17}/></span></span>
    <span className="uo-metric-value">{amount}<small>{unit}</small></span>
    <span className="uo-metric-description">当前用户统计周期 <ArrowUpRight size={13}/></span>
   </button>
   <button className={`uo-metric is-expiry ${expiry?.expired ? "is-danger" : expiry && expiry.days <= 7 ? "is-warning" : ""}`} onClick={() => hasServices ? onNavigate("resources") : onAuthorize()} aria-label="查看到期授权">
    <span className="uo-metric-heading"><span>最近到期</span><span className="uo-metric-icon"><CalendarClock size={17}/></span></span>
    <span className="uo-metric-value">{expiryValue}{expiry && !expiry.expired && <small>天</small>}</span>
    <span className="uo-metric-description" title={expiry?.name}>{expiry ? `${shortDate(expiry.at)} · ${expiry.name}` : hasServices ? "当前授权未设置到期日" : "添加授权后开始使用"}</span>
   </button>
   <div className="uo-metric is-connections" aria-label="当前连接情况">
    <span className="uo-metric-heading"><span>当前连接</span><span className="uo-metric-icon"><Activity size={17}/></span></span>
    <span className="uo-metric-value">{connectionValue}{activity?.connections != null && <small>个</small>}{activity && !activity.complete && activity.connections != null && <em>部分上报</em>}</span>
    <span className="uo-metric-description">{activity?.connections != null ? `${activity.active_nodes ?? 0} 个节点活跃 · ${activity.reporting_servers}/${activity.expected_servers} 台服务器已上报` : "未收到近期连接上报"}</span>
   </div>
   <button className={`uo-metric is-quota ${overview?.over_limit ? "is-danger" : riskCount ? "is-warning" : ""}`} onClick={() => onNavigate("traffic")} aria-label="查看资源额度风险">
    <span className="uo-metric-heading"><span>额度风险</span><span className="uo-metric-icon"><Gauge size={17}/></span></span>
    <span className="uo-metric-value">{quotaValue}{known && (riskCount > 0 || overview!.limited_resources > 0) && <small>项</small>}</span>
    <span className="uo-metric-description">{!known ? "风险数据待更新" : riskCount ? `${overview!.over_limit} 项已超额 · ${overview!.near_limit} 项接近限额` : overview!.limited_resources ? `${overview!.limited_resources} 项有限额 · 暂无额度风险` : overview!.billing_resources ? `${overview!.unlimited_resources} 项资源未设流量限额` : "暂无可统计的计费资源"}</span>
   </button>
  </div>

  <div className="uo-service-strip">
   <span className="uo-service-plan">{user.package_id ? <Package size={16}/> : <ShieldCheck size={16}/>}<span>{user.package_name || (user.package_id ? `套餐 #${user.package_id}` : "独立服务授权")}</span></span>
   <span className="uo-service-counts">{serverCount} 服务器<span>·</span>{nodeCount} 节点<span>·</span>{subscriptionCount} 订阅</span>
   <button className="um-text-button" onClick={() => onNavigate("resources")}>查看授权 <ChevronRight size={14}/></button>
  </div>

  {quotaLayers.length > 1 && <section className="uo-quota-summary" aria-labelledby="uo-quota-title"><div className="uo-quota-heading"><h3 id="uo-quota-title">分层用量 <span>{quotaLayers.length} 层额度</span></h3><p>各层限额分别生效，用量不跨层累加</p></div><div className="uo-quota-layers">{quotaLayers.map(layer=><QuotaLayerCard key={layer.key} layer={layer} onNavigate={onNavigate}/>)}</div></section>}

  <div className={`uo-panels ${alerts.length ? "has-alerts" : ""}`}>
   <section className="uo-panel uo-usage-panel" aria-labelledby="uo-usage-title">
    <div className="uo-panel-heading"><div><h3 id="uo-usage-title">主要用量来源</h3><p>按各资源当前周期用量排序</p></div><button className="um-text-button" onClick={() => onNavigate("traffic")}>流量明细 <ArrowUpRight size={14}/></button></div>
    {topUsage.length > 0 ? <ol className="uo-ranking">{topUsage.map((resource, index) => {
     const Icon = resource.kind === "server" ? Server : ShieldCheck;
     return <li key={`${resource.kind}-${resource.id}`}>
      <button className="uo-rank-item" onClick={() => onNavigate("traffic", resource.kind)} aria-label={`查看 ${resource.name} 的用量`}>
       <span className="uo-rank-number">{String(index + 1).padStart(2, "0")}</span><span className="uo-rank-icon"><Icon size={17}/></span>
       <span className="uo-rank-content"><span className="uo-rank-line"><strong title={resource.name}>{resource.name}</strong><span>{formatBytes(resource.used)}</span></span>{resource.limit > 0 && <span className="uo-rank-bar" aria-hidden="true"><i style={{ width: `${Math.min(100, Math.max(0, resource.used / resource.limit * 100))}%` }}/></span>}<span className="uo-rank-detail"><span>{resource.kind === "server" ? "服务器授权" : resource.kind === "forwarding" ? "转发授权" : "固定节点"} · {resource.reset}</span><span>{resource.limit > 0 ? `额度 ${formatBytes(resource.limit)}` : resource.limit_note || "不限额"}</span></span></span><ChevronRight size={14}/>
      </button>
     </li>;
    })}</ol> : <div className="uo-panel-empty"><span><Layers3 size={25}/></span><strong>{hasServices ? "暂无可展示的用量来源" : "还没有分配服务"}</strong><p>{hasServices ? "产生可归属到当前授权的流量后，会展示主要消耗来源。" : "为这个用户添加节点、服务器、订阅或套餐。"}</p>{!hasServices && <Button onClick={onAuthorize}>添加授权</Button>}</div>}
    {topUsage.length > 0 && <p className="uo-panel-footnote"><Info size={13}/>服务器已包含其下所选节点，订阅和套餐不重复计入排行。</p>}
   </section>

   <section className="uo-panel uo-alerts-panel" aria-labelledby="uo-alerts-title">
    <div className="uo-panel-heading"><div><h3 id="uo-alerts-title">需要关注{alerts.length > 0 && <span className="uo-alert-count">{alerts.length}</span>}</h3><p>只展示这个用户需要处理的事项</p></div>{alerts.length === 0 && known && <CheckCircle2 className="uo-ok-icon" size={19}/>}</div>
    {visibleAlerts.length > 0 ? <div className="uo-alert-list">{visibleAlerts.map((alert, i) => <button key={`${alert.code}-${alert.kind}-${alert.id}-${i}`} className={`uo-alert is-${alert.severity}`} aria-label={`${alert.name || "账号状态"}：${alert.message}`} onClick={() => alert.tab === "settings" ? onSettings() : onNavigate(alert.tab === "traffic" ? "traffic" : "resources", alert.kind || undefined)}><span className="uo-alert-icon">{alert.severity === "bad" ? <CircleAlert size={17}/> : <TriangleAlert size={17}/>}</span><span><strong>{alert.name || "账号状态"}</strong><small>{alert.message}</small></span><ChevronRight size={14}/></button>)}</div> : <div className={`uo-all-clear ${known ? "" : "is-unknown"}`}><span>{known ? <CheckCircle2 size={29}/> : <Info size={29}/>}</span><strong>{known ? hasServices ? "暂无已知异常" : "尚未分配服务" : "状态数据待更新"}</strong><p>{known ? hasServices ? "未发现到期、额度或已记录的授权异常。" : "添加服务后，这里会提示到期和额度风险。" : "刷新后查看最新的到期、额度与授权状态。"}</p></div>}
    {alerts.length > 4 && <button className="uo-expand-alerts" onClick={() => setExpandedAlerts(!expandedAlerts)}>{expandedAlerts ? "收起提醒" : `展开其余 ${alerts.length - 4} 项提醒`}<ChevronDown size={14} className={expandedAlerts ? "is-open" : ""}/></button>}
    {(overview?.unconfirmed || 0) > 0 && <p className="uo-unconfirmed"><Info size={14}/>{overview!.unconfirmed} 项授权状态待确认，尚无服务器应用回执。</p>}
   </section>
  </div>

  <div className="uo-context"><div><span>额度重置</span><strong title={resetLabels.join("；")}>{resetLabels.length === 0 ? "跟随资源设置" : resetLabels.length === 1 ? resetLabels[0] : "各资源分别重置"}</strong></div><div><span>数据更新</span><strong>{clockTime(asOf)}</strong></div><div><span>连接上报</span><strong>{activity?.reported_at ? clockTime(activity.reported_at) : "暂无近期上报"}</strong></div></div>
  <details className="uo-accounting-note"><summary><Info size={14}/>统计口径<ChevronDown size={13}/></summary><p>计费用量按用户计费记录汇总；排行按各资源自身周期统计，周期可能不同。服务器内所选节点、订阅及套餐的关联用量不重复累加。连接仅采用最近 {activity?.max_age_seconds || 90} 秒的上报，连接数不等于设备数；部分服务器未上报时，仅显示已知连接。{expiry && ` 最近到期：${fullDate(expiry.at)}。`}</p></details>
 </div>;
}

function QuotaLayerCard({layer,onNavigate}:{layer:QuotaLayer;onNavigate:Props["onNavigate"]}) {
 const [expanded,setExpanded]=useState(false);
 const visible=expanded?layer.items:layer.items.slice(0,3);
 const Icon=layer.key==="package"?Package:layer.key==="module"?Layers3:ShieldCheck;
 return <article className={`uo-quota-layer is-${layer.key}`}>
  <div className="uo-quota-layer-title"><span><Icon size={17}/>{layer.title}</span><small>{layer.items.length} 项限额</small></div>
  <div className="uo-quota-items">{visible.map(item=>{
   const ratio=item.limit>0?item.used/item.limit:0;
   return <button className={`uo-quota-item ${ratio>=1?"is-full":ratio>=.8?"is-near":""}`} key={`${item.kind}-${item.id}`} onClick={()=>onNavigate("traffic",item.kind)} aria-label={`查看${item.name}额度`}>
    <span className="uo-quota-item-name"><strong title={item.name}>{item.name}</strong><ChevronRight size={13}/></span>
    <span className="uo-quota-amount"><strong>{formatBytes(item.used)}</strong><span>/ {formatBytes(item.limit)}</span></span>
    <span className="uo-quota-progress" role="progressbar" aria-label={`${item.name}额度使用率`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100,Math.round(ratio*100))}><i style={{width:`${Math.min(100,Math.max(0,ratio*100))}%`}}/></span>
    <span className="uo-quota-remaining">{ratio>=1?`已超出 ${formatBytes(Math.max(0,item.used-item.limit))}`:`剩余 ${formatBytes(Math.max(0,item.limit-item.used))}`}<span>{(ratio*100).toFixed(1)}%</span></span>
   </button>;
  })}</div>
  {layer.items.length>3&&<button className="uo-quota-expand" onClick={()=>setExpanded(!expanded)}>{expanded?"收起明细":`展开其余 ${layer.items.length-3} 项`}<ChevronDown size={13}/></button>}
  <p className="uo-quota-layer-note">{layer.key==="package"?"汇总节点、服务器和转发模块用量":layer.key==="module"?"模块额度耗尽时，该模块内资源受限":`${layer.total} 项资源中，${layer.items.length} 项设有单独限额`}</p>
 </article>;
}
