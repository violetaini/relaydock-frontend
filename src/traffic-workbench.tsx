import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  CalendarDays,
  ChevronRight,
  Gauge,
  Network,
  RefreshCw,
  Search,
  Server,
  Users,
} from "lucide-react";
import { api, openDashboardSocket } from "./api";
import { TrafficProgress } from "./traffic-progress";
import type { Profile, TrafficSummary } from "./types";
import {
  Badge,
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  IconButton,
  PageHeader,
  Spinner,
  Surface,
  formatBytes,
} from "./ui";
import "./traffic-workbench.css";

type TrafficRange = "cycle" | "today" | "week" | "month";
type AdminView = "users" | "nodes";

interface UserServerTraffic {
  server_id: number;
  username: string;
  uplink: number;
  downlink: number;
  total_uplink: number;
  total_downlink: number;
}

interface UserTrafficSummary {
  username: string;
  total_uplink: number;
  total_downlink: number;
  cycle_uplink: number;
  cycle_downlink: number;
  servers?: UserServerTraffic[];
}

interface UserTrafficSnapshot {
  server_id: number;
  username: string;
  uplink: number;
  downlink: number;
}

interface NodeTrafficTotal {
  node_id: number;
  node_name: string;
  server_name: string;
  node_type: string;
  uplink: number;
  downlink: number;
  last_uplink: number;
  last_downlink: number;
}

interface UserNodeDetail {
  node_id: number;
  node_name: string;
  server_name: string;
  uplink: number;
  downlink: number;
  last_uplink: number;
  last_downlink: number;
}

interface NodeUserDetail {
  username: string;
  uplink: number;
  downlink: number;
  last_uplink: number;
  last_downlink: number;
}

interface AdminTrafficResponse {
  servers?: Array<{ users?: UserServerTraffic[] }>;
}

interface RealtimeTrafficMessage {
  type?: string;
  userConnections?: Record<string, number>;
  trafficSummary?: TrafficSummary;
  adminTraffic?: AdminTrafficResponse;
  nodeTotals?: { items?: NodeTrafficTotal[] };
  nodeTotalsDate?: string;
}

interface DrilldownState {
  kind: "user" | "node";
  id: string;
  title: string;
}

const rangeOptions: Array<{ key: TrafficRange; label: string }> = [
  { key: "cycle", label: "本周期" },
  { key: "today", label: "今日" },
  { key: "week", label: "近 7 日" },
  { key: "month", label: "近 30 日" },
];

function dateDaysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function rangeDate(range: TrafficRange): string {
  if (range === "today") return dateDaysAgo(0);
  if (range === "week") return dateDaysAgo(6);
  if (range === "month") return dateDaysAgo(29);
  return "";
}

function rangeDays(range: TrafficRange): number {
  if (range === "today") return 1;
  if (range === "week") return 7;
  return 30;
}

function trafficURL(path: string, date: string, key?: string, value?: string | number): string {
  const query = new URLSearchParams();
  if (key && value !== undefined) query.set(key, String(value));
  if (date) query.set("date", date);
  const suffix = query.toString();
  return suffix ? `${path}?${suffix}` : path;
}

function clampDelta(current: number, baseline: number): number {
  return Math.max(0, (Number(current) || 0) - (Number(baseline) || 0));
}

function applyUserBaselines(users: UserTrafficSummary[], snapshots: UserTrafficSnapshot[]): UserTrafficSummary[] {
  if (snapshots.length === 0) return users;
  const baseline = new Map<string, { uplink: number; downlink: number }>();
  for (const item of snapshots) {
    const key = `${item.server_id}|${item.username}`;
    const current = baseline.get(key) ?? { uplink: 0, downlink: 0 };
    current.uplink += Number(item.uplink) || 0;
    current.downlink += Number(item.downlink) || 0;
    baseline.set(key, current);
  }
  return users.map((user) => {
    let uplinkBaseline = 0;
    let downlinkBaseline = 0;
    if (user.servers?.length) {
      for (const server of user.servers) {
        const item = baseline.get(`${server.server_id}|${user.username}`);
        uplinkBaseline += item?.uplink ?? 0;
        downlinkBaseline += item?.downlink ?? 0;
      }
    } else {
      for (const [key, item] of baseline) {
        if (key.endsWith(`|${user.username}`)) {
          uplinkBaseline += item.uplink;
          downlinkBaseline += item.downlink;
        }
      }
    }
    return {
      ...user,
      cycle_uplink: clampDelta(user.cycle_uplink, uplinkBaseline),
      cycle_downlink: clampDelta(user.cycle_downlink, downlinkBaseline),
    };
  });
}

function aggregateRealtimeUsers(response: AdminTrafficResponse): UserTrafficSummary[] {
  const users = new Map<string, UserTrafficSummary>();
  for (const server of response.servers ?? []) {
    for (const item of server.users ?? []) {
      const current = users.get(item.username) ?? {
        username: item.username,
        total_uplink: 0,
        total_downlink: 0,
        cycle_uplink: 0,
        cycle_downlink: 0,
        servers: [],
      };
      current.total_uplink += Number(item.total_uplink) + Number(item.uplink);
      current.total_downlink += Number(item.total_downlink) + Number(item.downlink);
      current.cycle_uplink += Number(item.uplink) || 0;
      current.cycle_downlink += Number(item.downlink) || 0;
      current.servers?.push(item);
      users.set(item.username, current);
    }
  }
  return [...users.values()];
}

function TrafficMetric({ icon, label, value, detail, tone }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
  tone: "good" | "info" | "accent" | "warn";
}) {
  return (
    <Surface className={`metric metric-${tone}`}>
      <span className="metric-top"><span className="metric-icon">{icon}</span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </Surface>
  );
}

export function TrafficWorkbenchPage({ profile }: { profile: Profile }) {
  const [summary, setSummary] = useState<TrafficSummary | null>(null);
  const [rawUsers, setRawUsers] = useState<UserTrafficSummary[]>([]);
  const [userSnapshots, setUserSnapshots] = useState<UserTrafficSnapshot[]>([]);
  const [nodes, setNodes] = useState<NodeTrafficTotal[]>([]);
  const [connections, setConnections] = useState<Record<string, number>>({});
  const [range, setRange] = useState<TrafficRange>("cycle");
  const [view, setView] = useState<AdminView>("users");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [drilldown, setDrilldown] = useState<DrilldownState | null>(null);

  const date = rangeDate(range);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      if (!profile.is_admin) {
        setSummary(await api.get<TrafficSummary>("/api/traffic/summary"));
        return;
      }
      const requests: [
        Promise<TrafficSummary>,
        Promise<{ users?: UserTrafficSummary[] }>,
        Promise<{ items?: NodeTrafficTotal[] }>,
        Promise<{ connections?: Record<string, number> }>,
        Promise<{ snapshots?: UserTrafficSnapshot[] }>,
      ] = [
        api.get<TrafficSummary>("/api/traffic/summary"),
        api.get<{ users?: UserTrafficSummary[] }>("/api/admin/traffic/users"),
        api.get<{ items?: NodeTrafficTotal[] }>(trafficURL("/api/admin/traffic/node-totals", date)),
        api.get<{ connections?: Record<string, number> }>("/api/admin/traffic/user-connections"),
        date
          ? api.get<{ snapshots?: UserTrafficSnapshot[] }>(trafficURL("/api/admin/traffic/user-snapshots", date))
          : Promise.resolve({ snapshots: [] }),
      ];
      const [summaryResponse, usersResponse, nodesResponse, connectionsResponse, snapshotsResponse] = await Promise.all(requests);
      setSummary(summaryResponse);
      setRawUsers(usersResponse.users ?? []);
      setNodes(nodesResponse.items ?? []);
      setConnections(connectionsResponse.connections ?? {});
      setUserSnapshots(snapshotsResponse.snapshots ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "流量数据加载失败");
    } finally {
      setLoading(false);
    }
  }, [date, profile.is_admin]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!profile.is_admin) return;
    return openDashboardSocket((payload) => {
      const message = payload as RealtimeTrafficMessage;
      if (message.type !== "realtime") return;
      if (message.trafficSummary) setSummary(message.trafficSummary);
      if (message.userConnections) setConnections(message.userConnections);
      if (message.adminTraffic) setRawUsers(aggregateRealtimeUsers(message.adminTraffic));
      if (message.nodeTotals && range === "today" && message.nodeTotalsDate === date) {
        setNodes(message.nodeTotals.items ?? []);
      }
    });
  }, [date, profile.is_admin, range]);

  const users = useMemo(() => applyUserBaselines(rawUsers, userSnapshots), [rawUsers, userSnapshots]);
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const filteredUsers = useMemo(() => users
    .filter((item) => item.username.toLocaleLowerCase().includes(normalizedSearch))
    .sort((left, right) => (right.cycle_uplink + right.cycle_downlink) - (left.cycle_uplink + left.cycle_downlink)), [normalizedSearch, users]);
  const filteredNodes = useMemo(() => nodes
    .filter((item) => `${item.node_name} ${item.server_name} ${item.node_type}`.toLocaleLowerCase().includes(normalizedSearch))
    .sort((left, right) => (right.uplink + right.downlink) - (left.uplink + left.downlink)), [nodes, normalizedSearch]);
  const history = useMemo(() => (summary?.history ?? []).slice(-rangeDays(range)), [range, summary?.history]);
  const maxHistory = Math.max(1, ...history.map((item) => Number(item.used_gb) || 0));
  const activeConnections = Object.values(connections).reduce((total, value) => total + Math.max(0, Number(value) || 0), 0);
  const activeUsers = Object.values(connections).filter((value) => Number(value) > 0).length;

  return (
    <div className="traffic-workbench">
      <PageHeader
        title="流量明细"
        description={profile.is_admin ? "按用户和节点核对计费流量与实时并发" : "查看当前套餐周期与最近用量"}
        actions={<IconButton label="刷新流量数据" onClick={() => void load()} disabled={loading}><RefreshCw size={18} /></IconButton>}
      />
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

      <div className="metric-grid traffic-workbench-metrics">
        <TrafficMetric icon={<ArrowUpFromLine size={19} />} label="总流量配额" value={loading ? "--" : `${summary?.metrics.total_limit_gb ?? 0} GB`} detail="当前计费周期" tone="info" />
        <TrafficMetric icon={<Activity size={19} />} label="已用流量" value={loading ? "--" : `${summary?.metrics.total_used_gb ?? 0} GB`} detail={profile.is_admin && summary?.metrics.unlimited_used_gb ? `另有不限额 ${summary.metrics.unlimited_used_gb} GB` : "按套餐口径统计"} tone="accent" />
        <TrafficMetric icon={<ArrowDownToLine size={19} />} label="剩余流量" value={loading ? "--" : `${summary?.metrics.total_remaining_gb ?? 0} GB`} detail="不低于 0 GB" tone="good" />
        <TrafficMetric icon={<Gauge size={19} />} label={profile.is_admin ? "实时连接" : "使用率"} value={loading ? "--" : profile.is_admin ? String(activeConnections) : `${summary?.metrics.usage_percentage ?? 0}%`} detail={profile.is_admin ? `${activeUsers} 个活跃用户` : "当前周期"} tone="warn" />
      </div>

      {!profile.is_admin ? <Surface className="member-traffic-progress">
        <div className="member-traffic-progress-heading"><span><Gauge size={18} /></span><span><strong>本期流量</strong><small>当前账号套餐用量</small></span></div>
        {loading ? <Spinner label="正在汇总流量" /> : <TrafficProgress used={Number(summary?.metrics.total_used_gb || 0) * 1024 ** 3} limit={Number(summary?.metrics.total_limit_gb || 0) * 1024 ** 3} label="本期流量使用率" />}
      </Surface> : null}

      <Surface className="traffic-history-surface">
        <div className="surface-heading">
          <div><h2><CalendarDays size={17} />30 日用量趋势</h2><small>每日新增计费用量</small></div>
          <Badge tone="neutral">{rangeOptions.find((item) => item.key === range)?.label}</Badge>
        </div>
        <div className="traffic-range" role="tablist" aria-label="流量统计周期">
          {rangeOptions.map((item) => <Button key={item.key} role="tab" aria-selected={range === item.key} variant={range === item.key ? "primary" : "secondary"} onClick={() => setRange(item.key)}>{item.label}</Button>)}
        </div>
        {loading ? <div className="center-state"><Spinner /></div> : history.length === 0 ? <EmptyState icon={<Activity size={23} />} title="暂无历史记录" description="采集到每日快照后会在这里形成趋势" /> : (
          <div className="traffic-history-chart" aria-label="每日流量趋势图">
            {history.map((item) => {
              const height = Math.max(3, (Number(item.used_gb) || 0) / maxHistory * 100);
              return <div className="traffic-history-column" key={item.date} title={`${item.date}: ${item.used_gb} GB`}><span>{item.used_gb > 0 ? `${item.used_gb}` : ""}</span><i style={{ height: `${height}%` }} /><small>{item.date.slice(5)}</small></div>;
            })}
          </div>
        )}
      </Surface>

      {profile.is_admin ? (
        <Surface className="table-surface traffic-admin-surface">
          <div className="traffic-admin-heading">
            <div className="traffic-admin-tabs" role="tablist" aria-label="流量汇总维度">
              <button type="button" role="tab" aria-selected={view === "users"} className={view === "users" ? "is-active" : ""} onClick={() => setView("users")}><Users size={16} />用户汇总</button>
              <button type="button" role="tab" aria-selected={view === "nodes"} className={view === "nodes" ? "is-active" : ""} onClick={() => setView("nodes")}><Network size={16} />节点汇总</button>
            </div>
            <label className="traffic-search"><Search size={16} /><input aria-label={view === "users" ? "搜索用户流量" : "搜索节点流量"} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={view === "users" ? "搜索用户" : "搜索节点或服务器"} /></label>
          </div>
          {loading ? <div className="center-state"><Spinner /></div> : view === "users" ? (
            filteredUsers.length === 0 ? <EmptyState icon={<Users size={23} />} title={search ? "没有匹配的用户" : "暂无用户流量"} /> : (
              <div className="table-wrap"><table><thead><tr><th>用户</th><th>当前连接</th><th>周期上行</th><th>周期下行</th><th>周期合计</th><th>历史总量</th><th aria-label="操作" /></tr></thead><tbody>{filteredUsers.map((item) => (
                <tr key={item.username}>
                  <td><div className="primary-cell"><span className="user-avatar">{item.username.slice(0, 1).toUpperCase()}</span><span><strong>{item.username}</strong><small>{connections[item.username] > 0 ? "正在使用" : "当前无连接"}</small></span></div></td>
                  <td><Badge tone={connections[item.username] > 0 ? "good" : "neutral"}>{connections[item.username] ?? 0}</Badge></td>
                  <td>{formatBytes(item.cycle_uplink)}</td>
                  <td>{formatBytes(item.cycle_downlink)}</td>
                  <td><strong>{formatBytes(item.cycle_uplink + item.cycle_downlink)}</strong></td>
                  <td>{formatBytes(item.total_uplink + item.total_downlink)}</td>
                  <td className="actions-cell"><IconButton label={`查看 ${item.username} 节点流量`} onClick={() => setDrilldown({ kind: "user", id: item.username, title: item.username })}><ChevronRight size={17} /></IconButton></td>
                </tr>
              ))}</tbody></table></div>
            )
          ) : filteredNodes.length === 0 ? <EmptyState icon={<Server size={23} />} title={search ? "没有匹配的节点" : "暂无节点流量"} /> : (
            <div className="table-wrap"><table><thead><tr><th>节点</th><th>服务器</th><th>类型</th><th>上行</th><th>下行</th><th>合计</th><th aria-label="操作" /></tr></thead><tbody>{filteredNodes.map((item) => (
              <tr key={item.node_id}>
                <td><strong>{item.node_name}</strong></td>
                <td>{item.server_name || "-"}</td>
                <td><Badge tone={item.node_type === "routed" ? "info" : "neutral"}>{item.node_type === "routed" ? "路由节点" : "入站节点"}</Badge></td>
                <td>{formatBytes(item.uplink)}</td>
                <td>{formatBytes(item.downlink)}</td>
                <td><strong>{formatBytes(item.uplink + item.downlink)}</strong></td>
                <td className="actions-cell"><IconButton label={`查看 ${item.node_name} 用户流量`} onClick={() => setDrilldown({ kind: "node", id: String(item.node_id), title: item.node_name })}><ChevronRight size={17} /></IconButton></td>
              </tr>
            ))}</tbody></table></div>
          )}
        </Surface>
      ) : null}

      {drilldown ? <TrafficDrilldown state={drilldown} date={date} connections={connections} onClose={() => setDrilldown(null)} /> : null}
    </div>
  );
}

function TrafficDrilldown({ state, date, connections, onClose }: {
  state: DrilldownState;
  date: string;
  connections: Record<string, number>;
  onClose: () => void;
}) {
  const [items, setItems] = useState<Array<UserNodeDetail | NodeUserDetail>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      if (state.kind === "user") {
        const response = await api.get<{ items?: UserNodeDetail[] }>(trafficURL("/api/admin/traffic/user-nodes", date, "username", state.id));
        setItems(response.items ?? []);
      } else {
        const response = await api.get<{ items?: NodeUserDetail[] }>(trafficURL("/api/admin/traffic/node-users", date, "node_id", state.id));
        setItems(response.items ?? []);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "流量明细加载失败");
    } finally {
      setLoading(false);
    }
  }, [date, state.id, state.kind]);

  useEffect(() => { void load(); }, [load]);

  return (
    <Dialog title={state.kind === "user" ? `${state.title} 的节点流量` : `${state.title} 的用户流量`} description={date ? `统计基线 ${date}` : "当前计费周期"} onClose={onClose} wide>
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      {loading ? <div className="center-state"><Spinner /></div> : items.length === 0 ? <EmptyState icon={state.kind === "user" ? <Network size={22} /> : <Users size={22} />} title="暂无可归因流量" description="只有已上报且能归属到用户和节点的流量会显示" /> : (
        <div className="table-wrap traffic-drilldown-table"><table><thead><tr><th>{state.kind === "user" ? "节点" : "用户"}</th>{state.kind === "user" ? <th>服务器</th> : <th>当前连接</th>}<th>上行</th><th>下行</th><th>合计</th></tr></thead><tbody>{items.map((item) => {
          const userItem = item as NodeUserDetail;
          const nodeItem = item as UserNodeDetail;
          const key = state.kind === "user" ? String(nodeItem.node_id) : userItem.username;
          return <tr key={key}><td><strong>{state.kind === "user" ? nodeItem.node_name : userItem.username}</strong></td><td>{state.kind === "user" ? nodeItem.server_name || "-" : <Badge tone={connections[userItem.username] > 0 ? "good" : "neutral"}>{connections[userItem.username] ?? 0}</Badge>}</td><td>{formatBytes(item.uplink)}</td><td>{formatBytes(item.downlink)}</td><td><strong>{formatBytes(item.uplink + item.downlink)}</strong></td></tr>;
        })}</tbody></table></div>
      )}
    </Dialog>
  );
}
