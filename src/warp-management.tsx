import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Cloud, RefreshCw, TicketCheck, Trash2, TriangleAlert } from "lucide-react";
import { api } from "./api";
import type { RemoteServer } from "./types";
import { Badge, Button, ConfirmDialog, Dialog, ErrorState, Field, IconButton, Spinner, Surface } from "./ui";

type Notify = (message: string, tone?: "success" | "error") => void;
type RemoteActionResponse = { success?: boolean; message?: string; error?: string; warning?: string; runtime_warning?: string };

function assertRemoteActionSucceeded(response: RemoteActionResponse, fallback: string) {
  if (response.success !== true) throw new Error(response.error || response.message || fallback);
  if (response.runtime_warning?.trim() || response.warning?.trim()) {
    throw new Error(response.runtime_warning?.trim() || response.message?.trim() || response.warning?.trim() || fallback);
  }
}

function readString(value: Record<string, unknown> | null, keys: string[]): string {
  if (!value) return "";
  for (const key of keys) {
    const item = value[key];
    if (typeof item === "string" && item.trim()) return item;
  }
  return "";
}

export function WarpManagement({ server, notify, configDirty, onChanged }: {
  server: RemoteServer;
  notify: Notify;
  configDirty: boolean;
  onChanged: () => Promise<void>;
}) {
  const [status, setStatus] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<"install" | "license" | "remove" | null>(null);
  const [pendingAction, setPendingAction] = useState<"install" | "remove" | null>(null);
  const [licenseOpen, setLicenseOpen] = useState(false);
  const [license, setLicense] = useState("");
  const [error, setError] = useState("");
  const statusRequest = useRef(0);

  const loadStatus = useCallback(async () => {
    const requestID = ++statusRequest.current;
    setLoading(true);
    setError("");
    try {
      const response = await api.get<Record<string, unknown>>(`/api/admin/remote/warp/status?server_id=${server.id}`);
      if (statusRequest.current === requestID) setStatus(response);
    } catch (reason) {
      if (statusRequest.current === requestID) setError(reason instanceof Error ? reason.message : "WARP 状态加载失败");
    } finally {
      if (statusRequest.current === requestID) setLoading(false);
    }
  }, [server.id]);

  useEffect(() => {
    setLicense("");
    setLicenseOpen(false);
    setPendingAction(null);
    void loadStatus();
    return () => { statusRequest.current++; };
  }, [loadStatus]);

  const closeLicense = () => {
    setLicense("");
    setLicenseOpen(false);
  };

  const runAction = async (action: "install" | "license" | "remove") => {
    if (working || configDirty) return;
    setWorking(action);
    setError("");
    try {
      const body = action === "license" ? { license: license.trim() } : undefined;
      const response = await api.post<RemoteActionResponse>(`/api/admin/remote/warp/${action}?server_id=${server.id}`, body);
      assertRemoteActionSucceeded(response, "WARP 操作失败");
      setPendingAction(null);
      if (action === "license") closeLicense();
      await loadStatus();
      await onChanged();
      notify(action === "install" ? "WARP 已安装" : action === "license" ? "WARP License 已更新" : "WARP 已移除");
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "WARP 操作失败";
      setPendingAction(null);
      if (action === "license") closeLicense();
      await loadStatus();
      setError(message);
      notify(message, "error");
    } finally {
      setWorking(null);
    }
  };

  const installed = Boolean(status?.installed ?? status?.warp_installed ?? status?.registered ?? status?.enabled ?? server.warp_installed);
  const addressV4 = readString(status, ["addr_v4", "ipv4", "warp_ipv4", "address_v4"]);
  const addressV6 = readString(status, ["addr_v6", "ipv6", "warp_ipv6", "address_v6"]);
  const account = status?.license_active === true ? "License 已配置" : readString(status, ["account_type", "plan", "account"]) || (installed ? "标准账户" : "");
  const stateLabel = readString(status, ["status", "state", "message"]);
  const connected = server.ws_connected || server.status === "connected" || server.status === "online";
  const blocked = configDirty || !connected;

  return (
    <div className="warp-management-stack">
      {configDirty ? <div className="warp-draft-warning" role="note"><TriangleAlert size={18} /><span><strong>存在未保存的 Xray 更改</strong><small>请先保存或重新读取配置，再管理 WARP，避免覆盖当前草稿或刚生成的出站。</small></span></div> : null}
      {error ? <ErrorState message={error} onRetry={() => void loadStatus()} /> : null}
      <Surface className="warp-management-surface">
        <div className="surface-heading control-heading"><div><h2>WARP 出站</h2><small>{server.name} · 安装、License 与出站生命周期</small></div><IconButton label="刷新 WARP 状态" onClick={() => void loadStatus()} disabled={loading}><RefreshCw size={17} /></IconButton></div>
        {loading ? <div className="center-state"><Spinner label="正在读取 WARP 状态" /></div> : (
          <div className="warp-layout">
            <div className={`warp-state ${installed ? "is-ready" : ""}`}><span><Cloud size={30} /></span><div><Badge tone={installed ? "good" : "neutral"}>{installed ? "已注册" : "未注册"}</Badge><h3>{server.name}</h3><p>{stateLabel || (installed ? "WARP 账户已注册" : "尚未注册 WARP")}</p></div></div>
            <div className="warp-facts"><div><small>IPv4</small><strong>{addressV4 || "-"}</strong></div><div><small>IPv6</small><strong>{addressV6 || "-"}</strong></div><div><small>账户类型</small><strong>{account || "-"}</strong></div></div>
            <div className="warp-actions">
              {!installed ? <Button disabled={working !== null || blocked} onClick={() => setPendingAction("install")}><Cloud size={16} />安装 WARP</Button> : <>
                <Button variant="secondary" disabled={working !== null || configDirty} onClick={() => setLicenseOpen(true)}><TicketCheck size={16} />更新 License</Button>
                <Button variant="danger" disabled={working !== null || configDirty} onClick={() => setPendingAction("remove")}><Trash2 size={16} />移除 WARP</Button>
              </>}
            </div>
          </div>
        )}
      </Surface>
      {licenseOpen ? <Dialog title="更新 WARP License" description={`应用到 ${server.name}`} onClose={closeLicense} dismissible={working !== "license"}>
        <form className="form-stack" onSubmit={(event: FormEvent) => { event.preventDefault(); void runAction("license"); }}>
          <Field label="License Key" hint="密钥只会发送给当前服务器，不会显示在状态页"><input autoFocus required type="password" autoComplete="off" value={license} onChange={(event) => setLicense(event.target.value)} /></Field>
          <div className="dialog-actions"><Button type="button" variant="secondary" disabled={working !== null} onClick={closeLicense}>取消</Button><Button type="submit" disabled={working !== null || !license.trim()}>{working === "license" ? <Spinner label="正在更新" /> : "确认更新"}</Button></div>
        </form>
      </Dialog> : null}
      {pendingAction ? <ConfirmDialog
        title={pendingAction === "install" ? "安装 WARP" : "移除 WARP"}
        description={pendingAction === "install" ? `将在 ${server.name} 注册 WARP，并写入 warp-v4 与 warp-v6 出站。` : `将从 ${server.name} 注销 WARP，并移除对应 Xray 出站。使用这些出站的路由会失效。`}
        confirmLabel={pendingAction === "install" ? "确认安装" : "确认移除"}
        tone={pendingAction === "install" ? "primary" : "danger"}
        working={working !== null}
        onCancel={() => setPendingAction(null)}
        onConfirm={() => void runAction(pendingAction)}
      /> : null}
    </div>
  );
}
