import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Clock3, Plus, RefreshCw, RotateCw, Server, ShieldCheck, Trash2 } from "lucide-react";
import { api } from "./api";
import type { NodeItem, NodeListResponse } from "./types";
import { Badge, Button, EmptyState, ErrorState, Field, IconButton, Spinner } from "./ui";
import "./node-grants.css";

type Notify = (message: string, tone?: "success" | "error") => void;

interface NodeGrant {
  id: number;
  username: string;
  node_id: number;
  node_name: string;
  protocol: string;
  server_id: number;
  server_name: string;
  inbound_tag: string;
  source_type: "manual" | string;
  desired_state: "active" | "inactive" | string;
  observed_state: string;
  state: string;
  expires_at?: string | null;
  last_error?: string;
}

function messageOf(reason: unknown, fallback: string) {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

function datetimeLocal(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function formatExpiry(value?: string | null) {
  if (!value) return "长期有效";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date)
    : "到期时间未知";
}

function stateMeta(state: string) {
  if (state === "active") return { label: "已生效", tone: "good" as const };
  if (["provisioning", "pending", "suspending"].includes(state)) return { label: "等待同步", tone: "warn" as const };
  if (state === "inactive") return { label: "已撤销", tone: "neutral" as const };
  if (state === "expired") return { label: "已到期", tone: "bad" as const };
  if (state === "error") return { label: "同步失败", tone: "bad" as const };
  return { label: state || "未知", tone: "neutral" as const };
}

function isFixedNode(node: NodeItem) {
  return node.enabled && node.node_type !== "routed" && node.direct_grant_eligible === true && Boolean(node.original_server && node.inbound_tag);
}

export function UserNodeGrantsPanel({ username, notify }: { username: string; notify: Notify }) {
  const base = `/api/admin/users/${encodeURIComponent(username)}/node-grants`;
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [grants, setGrants] = useState<NodeGrant[]>([]);
  const [nodeID, setNodeID] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError("");
    try {
      const [nodePayload, grantPayload] = await Promise.all([
        api.get<NodeListResponse>("/api/admin/nodes"),
        api.get<{ items?: NodeGrant[] }>(base),
      ]);
      setNodes(nodePayload.nodes ?? []);
      setGrants(grantPayload.items ?? []);
    } catch (reason) {
      setError(messageOf(reason, "固定节点授权加载失败"));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [base]);

  useEffect(() => { void load(); }, [load]);

  const manualGrants = useMemo(() => grants.filter((grant) => grant.source_type === "manual"), [grants]);
  const activeNodeIDs = useMemo(() => new Set(grants.filter((grant) => grant.desired_state === "active").map((grant) => grant.node_id)), [grants]);
  const candidates = useMemo(() => nodes.filter(isFixedNode).filter((node) => !activeNodeIDs.has(node.id)), [activeNodeIDs, nodes]);

  useEffect(() => {
    if (nodeID && candidates.some((node) => node.id === Number(nodeID))) return;
    setNodeID(candidates[0] ? String(candidates[0].id) : "");
  }, [candidates, nodeID]);

  const grant = async (event: FormEvent) => {
    event.preventDefault();
    if (!nodeID) return;
    setWorking("create");
    setError("");
    try {
      await api.post(base, {
        node_id: Number(nodeID),
        expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
      });
      setExpiresAt("");
      notify("固定节点授权已提交下发");
      await load(true);
    } catch (reason) {
      setError(messageOf(reason, "固定节点授权失败"));
    } finally {
      setWorking("");
    }
  };

  const revoke = async (item: NodeGrant) => {
    setWorking(`revoke-${item.id}`);
    try {
      await api.delete(`${base}/${item.id}`);
      notify(`${item.node_name} 的固定节点授权已撤销`);
      await load(true);
    } catch (reason) {
      setError(messageOf(reason, "撤销固定节点授权失败"));
    } finally {
      setWorking("");
    }
  };

  const retry = async (item: NodeGrant) => {
    setWorking(`retry-${item.id}`);
    try {
      await api.post(`${base}/${item.id}/retry`, {});
      notify("固定节点授权已重新提交同步");
      await load(true);
    } catch (reason) {
      setError(messageOf(reason, "重试固定节点授权失败"));
    } finally {
      setWorking("");
    }
  };

  return <div className="ng-layout">
    <div className="ng-toolbar"><div><strong>个性化固定节点</strong><span>直接把现有节点授权给账号，不需要先分配套餐。</span></div><IconButton label="刷新固定节点授权" onClick={() => void load()} disabled={loading}><RefreshCw size={17} /></IconButton></div>
    {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
    {loading ? <div className="ng-center"><Spinner label="正在加载固定节点授权" /></div> : <>
      <form className="ng-create" onSubmit={(event) => void grant(event)}>
        <Field label="候选固定节点" hint="仅显示已启用的入站节点；服务器需支持面板托管凭据"><select aria-label="候选固定节点" value={nodeID} onChange={(event) => setNodeID(event.target.value)} disabled={!candidates.length}><option value="">{candidates.length ? "请选择节点" : "暂无可新增的固定节点"}</option>{candidates.map((node) => <option key={node.id} value={node.id}>{node.node_name} · {node.protocol} · {node.original_server}</option>)}</select></Field>
        <Field label="到期时间" hint="留空表示长期有效"><input aria-label="固定节点到期时间" type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></Field>
        <Button type="submit" disabled={working === "create" || !nodeID}>{working === "create" ? <Spinner label="正在授权" /> : <><Plus size={16} />授权节点</>}</Button>
      </form>

      <section className="ng-section" aria-label="手工固定节点授权">
        <div className="ng-section-heading"><div><h3>手工授权</h3><p>可单独撤销；套餐内的制式节点由“套餐授权”统一维护。</p></div><Badge tone="info">{manualGrants.length}</Badge></div>
        {!manualGrants.length ? <EmptyState icon={<ShieldCheck size={23} />} title="暂无手工固定节点授权" description="从上方候选节点中选择后即可下发给该账号。" /> : <div className="ng-list">{manualGrants.map((item) => <NodeGrantRow key={item.id} item={item} busy={working} onRevoke={revoke} onRetry={retry} />)}</div>}
      </section>
    </>}</div>;
}

function NodeGrantRow({ item, busy, onRevoke, onRetry }: { item: NodeGrant; busy: string; onRevoke: (item: NodeGrant) => void; onRetry: (item: NodeGrant) => void }) {
  const meta = stateMeta(item.state);
  const pending = ["provisioning", "pending", "suspending", "error"].includes(item.state);
  return <article className="ng-row"><span className="ng-node-icon"><Server size={18} /></span><span className="ng-node-main"><strong>{item.node_name || `节点 #${item.node_id}`}</strong><small>{item.protocol || "未知协议"} · {item.server_name || `服务器 #${item.server_id}`} · {item.inbound_tag}</small><span><Clock3 size={12} />{formatExpiry(item.expires_at)}</span>{item.last_error ? <em>{item.last_error}</em> : null}</span><Badge tone={meta.tone}>{meta.label}</Badge><span className="ng-actions">{pending ? <IconButton label={`重试 ${item.node_name} 的固定节点授权`} onClick={() => void onRetry(item)} disabled={busy === `retry-${item.id}`}><RotateCw size={16} /></IconButton> : null}<IconButton className="is-danger" label={`撤销 ${item.node_name} 的固定节点授权`} onClick={() => void onRevoke(item)} disabled={busy === `revoke-${item.id}`}><Trash2 size={16} /></IconButton></span></article>;
}
