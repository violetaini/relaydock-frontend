import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { AlertTriangle, ArrowRight, Check, Database, HardDriveUpload, RefreshCw, Server, ShieldCheck, Upload } from "lucide-react";
import { api, request } from "./api";
import { Badge, Button, Dialog, EmptyState, ErrorState, Field, Spinner, Surface, formatBytes } from "./ui";
import "./migration-workbench.css";

type Notify = (message: string, tone?: "success" | "error") => void;

interface PreparedBackup {
  success: boolean;
  migration_id?: string;
  backup_path?: string;
  db_path?: string;
  subscribes_dir?: string;
  subscribe_count: number;
  size_bytes: number;
  db_size_bytes: number;
}

interface ImportReport {
  users: number;
  user_tokens: number;
  nodes: number;
  subscribe_files: number;
  user_subscriptions: number;
  user_settings: number;
  templates: number;
  custom_rules: number;
  override_scripts: number;
  external_subscriptions: number;
  warnings?: string[];
}

interface ImportResult {
  success: boolean;
  report: ImportReport;
  owned_by_admin: string;
  subscribes_copied: number;
  subscribes_skipped?: string[];
}

interface TakeoverResult {
  server_id?: number;
  server_name?: string;
  success?: boolean;
  error?: string;
  message?: string;
  restarted?: boolean;
  detected?: boolean;
}

interface RepairSummary {
  kind: "takeover" | "patch";
  total: number;
  succeeded: number;
  failed: number;
  patched: number;
  linked: number;
  errors: string[];
}

interface DistinctServer {
  address: string;
  node_count: number;
  ports: number[];
  protocols: string[];
  existing_server: boolean;
  existing_server_id?: number;
  sample_node_name: string;
}

type PendingAction = "import" | "takeover" | "patch";

function ensureSuccess(response: { success?: boolean; error?: string; message?: string }, fallback: string) {
  if (response.success === false) throw new Error(response.error || response.message || fallback);
}

export function validateMigrationSource(raw: string): { url: string; allowInsecureLoopback: boolean } {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new Error("请输入有效的源面板 URL");
  }
  if (!parsed.hostname || parsed.username || parsed.password) throw new Error("源面板 URL 不得包含账号或密码");
  if ((parsed.pathname && parsed.pathname !== "/") || parsed.search || parsed.hash) throw new Error("源面板 URL 只能包含协议、主机和端口");
  parsed.pathname = "";
  const scheme = parsed.protocol.toLowerCase();
  if (scheme === "https:") return { url: parsed.toString().replace(/\/$/, ""), allowInsecureLoopback: false };
  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const ipv4 = host.split(".").map(Number);
  const loopbackV4 = ipv4.length === 4 && ipv4[0] === 127 && ipv4.every((part) => Number.isInteger(part) && part >= 0 && part <= 255);
  const loopback = host === "localhost" || host === "::1" || loopbackV4;
  if (scheme === "http:" && loopback) return { url: parsed.toString().replace(/\/$/, ""), allowInsecureLoopback: true };
  throw new Error("远程源地址必须使用 HTTPS；HTTP 仅允许 localhost/loopback");
}

function summarizeRepair(kind: "takeover" | "patch", response: Record<string, unknown>): RepairSummary {
  if (kind === "takeover") {
    const rows = Array.isArray(response.results) ? response.results as TakeoverResult[] : [];
    const errors = rows.flatMap((row) => {
      if (row.error || row.success === false) return [`${row.server_name || `服务器 ${row.server_id ?? ""}`}: ${row.error || row.message || "远端返回 success=false"}`];
      return [];
    });
    const total = Number(response.servers_scanned ?? rows.length) || rows.length;
    return { kind, total, succeeded: Math.max(0, rows.length - errors.length), failed: errors.length + Math.max(0, total - rows.length), patched: 0, linked: 0, errors };
  }
  const errors = Array.isArray(response.server_errors) ? response.server_errors.map(String) : [];
  const total = Number(response.servers_scanned ?? 0) || 0;
  return {
    kind,
    total,
    succeeded: Math.max(0, total - errors.length),
    failed: errors.length,
    patched: Array.isArray(response.clients_patched) ? response.clients_patched.length : 0,
    linked: Array.isArray(response.admin_subaccounts_linked) ? response.admin_subaccounts_linked.length : 0,
    errors,
  };
}

export function MmwMigrationDialog({ notify, onClose }: { notify: Notify; onClose: () => void }) {
  const [source, setSource] = useState<"remote" | "upload">("remote");
  const [remote, setRemote] = useState({ url: "", username: "", password: "", totp: "" });
  const [file, setFile] = useState<File | null>(null);
  const [backup, setBackup] = useState<PreparedBackup | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [servers, setServers] = useState<DistinctServer[]>([]);
  const [selectedServerIDs, setSelectedServerIDs] = useState<number[]>([]);
  const [repairResult, setRepairResult] = useState<Record<string, unknown> | null>(null);
  const [repairSummary, setRepairSummary] = useState<RepairSummary | null>(null);
  const [working, setWorking] = useState<string | null>(null);
  const [loadingServers, setLoadingServers] = useState(false);
  const [serverLoadError, setServerLoadError] = useState("");
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [error, setError] = useState("");
  const mountedRef = useRef(true);
  const operationRef = useRef<string | null>(null);
  const activeMigrationRef = useRef<string | null>(null);
  const serverRequestRef = useRef(0);
  const serverLoadingRef = useRef(false);
  const cleanupStartedRef = useRef(new Set<string>());

  const busy = working !== null || loadingServers;

  const beginOperation = (name: string) => {
    if (operationRef.current !== null || serverLoadingRef.current) return false;
    operationRef.current = name;
    setWorking(name);
    return true;
  };

  const endOperation = (name: string) => {
    if (operationRef.current !== name) return;
    operationRef.current = null;
    if (mountedRef.current) setWorking(null);
  };

  const cleanupMigration = useCallback(async (migrationID: string | null, surfaceError = false) => {
    if (!migrationID || cleanupStartedRef.current.has(migrationID)) return true;
    cleanupStartedRef.current.add(migrationID);
    if (activeMigrationRef.current === migrationID) activeMigrationRef.current = null;
    try {
      await api.delete("/api/admin/migrate/cleanup", { migration_id: migrationID });
      return true;
    } catch (reason) {
      if (surfaceError && mountedRef.current) {
        const message = reason instanceof Error ? reason.message : "迁移临时文件清理失败";
        setError(`数据已处理，但临时文件清理失败：${message}`);
        notify("迁移临时文件清理失败", "error");
      }
      return false;
    }
  }, [notify]);

  useEffect(() => () => {
    mountedRef.current = false;
    serverRequestRef.current += 1;
    const migrationID = activeMigrationRef.current;
    // An import/prepare still using the files must finish or be expired by the
    // backend TTL; deleting here would race the in-flight request.
    if (migrationID && operationRef.current === null && !cleanupStartedRef.current.has(migrationID)) {
      cleanupStartedRef.current.add(migrationID);
      void api.delete("/api/admin/migrate/cleanup", { migration_id: migrationID });
    }
  }, []);

  const requestClose = () => {
    if (operationRef.current !== null || serverLoadingRef.current) return;
    const migrationID = activeMigrationRef.current;
    if (migrationID) void cleanupMigration(migrationID);
    onClose();
  };

  const prepareRemote = async (event: FormEvent) => {
    event.preventDefault();
    if (!beginOperation("prepare")) return;
    setError("");
    try {
      const sourceURL = validateMigrationSource(remote.url);
      const response = await api.post<PreparedBackup>("/api/admin/migrate/fetch-mmw-backup", {
        url: sourceURL.url, allow_insecure_loopback: sourceURL.allowInsecureLoopback,
        username: remote.username.trim(), password: remote.password, totp: remote.totp.trim(),
      });
      ensureSuccess(response, "备份拉取失败");
      if (!response.migration_id && !response.db_path) throw new Error("服务端未返回迁移会话 ID");
      if (!mountedRef.current) {
        if (response.migration_id) await api.delete("/api/admin/migrate/cleanup", { migration_id: response.migration_id }).catch(() => undefined);
        return;
      }
      setBackup(response);
      activeMigrationRef.current = response.migration_id ?? null;
      setRemote((current) => ({ ...current, password: "", totp: "" }));
      notify("妙妙屋备份已准备");
    } catch (reason) {
      if (mountedRef.current) setError(reason instanceof Error ? reason.message : "备份拉取失败");
    } finally {
      endOperation("prepare");
    }
  };

  const prepareUpload = async (event: FormEvent) => {
    event.preventDefault();
    if (!beginOperation("prepare")) return;
    setError("");
    try {
      if (!file) throw new Error("请选择妙妙屋 ZIP 备份");
      if (!/\.zip$/i.test(file.name)) throw new Error("只支持 .zip 备份");
      if (file.size === 0 || file.size > 500 * 1024 ** 2) throw new Error("备份必须大于 0 且不超过 500 MB");
      const form = new FormData();
      form.set("backup", file);
      const response = await request<PreparedBackup>("/api/admin/migrate/upload-mmw-backup", { method: "POST", body: form });
      ensureSuccess(response, "备份上传失败");
      if (!response.migration_id && !response.db_path) throw new Error("服务端未返回迁移会话 ID");
      if (!mountedRef.current) {
        if (response.migration_id) await api.delete("/api/admin/migrate/cleanup", { migration_id: response.migration_id }).catch(() => undefined);
        return;
      }
      setBackup(response);
      activeMigrationRef.current = response.migration_id ?? null;
      notify("妙妙屋备份已上传并校验");
    } catch (reason) {
      if (mountedRef.current) setError(reason instanceof Error ? reason.message : "备份上传失败");
    } finally {
      endOperation("prepare");
    }
  };

  const loadDistinctServers = async (surfaceError = true) => {
    if (serverLoadingRef.current) return false;
    serverLoadingRef.current = true;
    const requestID = ++serverRequestRef.current;
    if (mountedRef.current) {
      setLoadingServers(true);
      setServerLoadError("");
    }
    try {
      const response = await api.get<{ success: boolean; servers?: DistinctServer[] }>("/api/admin/migrate/distinct-node-servers");
      ensureSuccess(response, "待关联服务器加载失败");
      if (!mountedRef.current || requestID !== serverRequestRef.current) return false;
      const list = response.servers ?? [];
      setServers(list);
      setSelectedServerIDs(list.flatMap((item) => item.existing_server_id ? [item.existing_server_id] : []));
      return true;
    } catch (reason) {
      if (mountedRef.current && requestID === serverRequestRef.current) {
        const message = reason instanceof Error ? reason.message : "待关联服务器加载失败";
        setServerLoadError(message);
        if (surfaceError) notify(message, "error");
      }
      return false;
    } finally {
      if (requestID === serverRequestRef.current) {
        serverLoadingRef.current = false;
        if (mountedRef.current) setLoadingServers(false);
      }
    }
  };

  const runImport = async () => {
    if (!backup || !beginOperation("import")) return;
    setError("");
    try {
      const body = backup.migration_id
        ? { migration_id: backup.migration_id }
        : { db_path: backup.db_path, subscribes_dir: backup.subscribes_dir };
      const response = await api.post<ImportResult>("/api/admin/migrate/import-mmw", body);
      ensureSuccess(response, "数据导入失败");
      const cleaned = await cleanupMigration(backup.migration_id ?? null, true);
      setResult(response);
      setPending(null);
      endOperation("import");
      await loadDistinctServers(false);
      if (cleaned) notify("妙妙屋数据导入完成");
    } catch (reason) {
      if (mountedRef.current) setError(reason instanceof Error ? reason.message : "数据导入失败");
      setPending(null);
      endOperation("import");
    }
  };

  const runRepair = async (kind: "takeover" | "patch") => {
    if (!selectedServerIDs.length || !beginOperation(kind)) return;
    setError("");
    try {
      const endpoint = kind === "takeover" ? "takeover-external-xray" : "patch-client-emails";
      const response = await api.post<Record<string, unknown>>(`/api/admin/migrate/${endpoint}`, { server_ids: selectedServerIDs });
      ensureSuccess(response as { success?: boolean; error?: string; message?: string }, "迁移修复失败");
      const summary = summarizeRepair(kind, response);
      setRepairResult(response);
      setRepairSummary(summary);
      setPending(null);
      if (summary.failed > 0) {
        notify(`${kind === "takeover" ? "外置 Xray 接管" : "客户端归属修复"}部分完成：${summary.failed} 项失败`, "error");
      } else {
        notify(kind === "takeover" ? "外置 Xray 接管完成" : "客户端归属修复完成");
      }
    } catch (reason) {
      if (mountedRef.current) setError(reason instanceof Error ? reason.message : "迁移修复失败");
      setPending(null);
    } finally {
      endOperation(kind);
    }
  };

  const reportItems: Array<[string, number]> = result ? [
    ["用户", result.report.users], ["用户令牌", result.report.user_tokens], ["节点", result.report.nodes],
    ["订阅文件", result.report.subscribe_files], ["用户订阅", result.report.user_subscriptions],
    ["用户设置", result.report.user_settings], ["模板", result.report.templates], ["覆写规则", result.report.custom_rules],
    ["覆写脚本", result.report.override_scripts], ["外部订阅", result.report.external_subscriptions],
  ] : [];
  const summaryLabel = repairSummary?.kind === "takeover" ? "外置 Xray 接管" : "客户端归属修复";

  return <>
    <Dialog title="从妙妙屋迁移" description="仅适用于空白 Arcway 实例；导入前请先完成备份" onClose={requestClose} dismissible={!busy} wide>
      <div className="migration-stack">
        <div className="migration-steps" aria-label="迁移进度">
          {["准备备份", "导入数据", "接管节点"].map((label, index) => <span key={label} className={(index === 0 || backup && index === 1 || result && index === 2) ? "is-active" : ""}><b>{index + 1}</b>{label}</span>)}
        </div>
        {error ? <ErrorState message={error} /> : null}

        {!backup ? <Surface className="migration-section">
          <div className="migration-source-tabs" role="tablist" aria-label="备份来源">
            <button type="button" role="tab" aria-selected={source === "remote"} className={source === "remote" ? "is-active" : ""} onClick={() => setSource("remote")}><Database size={17} />远程拉取</button>
            <button type="button" role="tab" aria-selected={source === "upload"} className={source === "upload" ? "is-active" : ""} onClick={() => setSource("upload")}><HardDriveUpload size={17} />上传备份</button>
          </div>
          {source === "remote" ? <form className="form-stack migration-form" onSubmit={prepareRemote}>
            <Field label="妙妙屋地址"><input required type="url" placeholder="https://panel.example.com" value={remote.url} onChange={(event) => setRemote({ ...remote, url: event.target.value })} /></Field>
            <div className="form-grid"><Field label="管理员用户名"><input required autoComplete="username" value={remote.username} onChange={(event) => setRemote({ ...remote, username: event.target.value })} /></Field><Field label="管理员密码"><input required type="password" autoComplete="new-password" value={remote.password} onChange={(event) => setRemote({ ...remote, password: event.target.value })} /></Field></div>
            <Field label="两步验证码" hint="源面板未启用 2FA 时留空"><input inputMode="numeric" autoComplete="one-time-code" value={remote.totp} onChange={(event) => setRemote({ ...remote, totp: event.target.value })} /></Field>
            <div className="dialog-actions"><Button type="submit" disabled={working !== null}>{working === "prepare" ? <Spinner label="正在拉取" /> : <><RefreshCw size={16} />拉取并校验</>}</Button></div>
          </form> : <form className="form-stack migration-form" onSubmit={prepareUpload}>
            <Field label="妙妙屋 ZIP 备份" hint="最大 500 MB"><input required type="file" accept=".zip,application/zip" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></Field>
            <div className="dialog-actions"><Button type="submit" disabled={working !== null || !file}>{working === "prepare" ? <Spinner label="正在上传" /> : <><Upload size={16} />上传并校验</>}</Button></div>
          </form>}
        </Surface> : null}

        {backup && !result ? <Surface className="migration-section migration-ready">
          <span className="migration-status-icon"><Check size={22} /></span><div><h3>备份已准备</h3><p>{formatBytes(backup.size_bytes)} ZIP · {formatBytes(backup.db_size_bytes)} 数据库 · {backup.subscribe_count} 个订阅文件</p></div>
          <Button variant="secondary" disabled={busy} onClick={() => { if (busy) return; const id = activeMigrationRef.current; setBackup(null); setFile(null); setError(""); void cleanupMigration(id, true); }}>重新选择</Button><Button disabled={busy} onClick={() => setPending("import")}><ArrowRight size={16} />开始导入</Button>
        </Surface> : null}

        {result ? <>
          <Surface className="migration-section"><div className="migration-section-heading"><div><h3>数据导入结果</h3><p>资源归属：{result.owned_by_admin || "管理员"} · 复制订阅 {result.subscribes_copied} 个</p></div><Badge tone="good">导入完成</Badge></div><div className="migration-report-grid">{reportItems.map(([label, value]) => <div key={label}><small>{label}</small><strong>{value}</strong></div>)}</div>{result.report.warnings?.length ? <div className="migration-warnings" role="alert">{result.report.warnings.map((warning) => <span key={warning}>{warning}</span>)}</div> : null}</Surface>
          <Surface className="migration-section"><div className="migration-section-heading"><div><h3>待接管节点服务器</h3><p>仅已添加到服务管理的服务器可以执行接管和归属修复</p></div><Button variant="secondary" disabled={busy} onClick={() => void loadDistinctServers()}>{loadingServers ? <Spinner label="正在刷新" /> : <><RefreshCw size={15} />刷新</>}</Button></div>
            {serverLoadError ? <ErrorState message={serverLoadError} onRetry={() => void loadDistinctServers()} /> : servers.length ? <div className="table-wrap migration-server-table"><table><thead><tr><th>选择</th><th>地址</th><th>节点</th><th>协议 / 端口</th><th>状态</th></tr></thead><tbody>{servers.map((item) => <tr key={item.address}><td><input type="checkbox" aria-label={`选择服务器 ${item.address}`} disabled={!item.existing_server_id || busy} checked={Boolean(item.existing_server_id && selectedServerIDs.includes(item.existing_server_id))} onChange={() => item.existing_server_id && setSelectedServerIDs((current) => current.includes(item.existing_server_id!) ? current.filter((id) => id !== item.existing_server_id) : [...current, item.existing_server_id!])} /></td><td><strong>{item.address}</strong><small className="cell-note">{item.sample_node_name}</small></td><td>{item.node_count}</td><td>{item.protocols.join(" / ") || "-"}<small className="cell-note">{item.ports.join(", ")}</small></td><td><Badge tone={item.existing_server ? "good" : "warn"}>{item.existing_server ? "已接入" : "待添加"}</Badge></td></tr>)}</tbody></table></div> : <EmptyState icon={<Server size={22} />} title="没有待关联的外部节点" />}
            <div className="migration-repair-actions"><Button variant="secondary" disabled={busy} onClick={() => { location.hash = "/servers"; requestClose(); }}><Server size={16} />打开服务管理</Button><Button variant="secondary" disabled={!selectedServerIDs.length || busy} onClick={() => setPending("takeover")}><ShieldCheck size={16} />接管外置 Xray</Button><Button disabled={!selectedServerIDs.length || busy} onClick={() => setPending("patch")}><Check size={16} />修复客户端归属</Button></div>
            {repairSummary ? <div className={`migration-repair-summary ${repairSummary.failed ? "has-failures" : ""}`} role={repairSummary.failed ? "alert" : "status"}><div className="migration-section-heading"><div><h3>{summaryLabel}结果</h3><p>结构化汇总，不以部分成功冒充全部成功</p></div><Badge tone={repairSummary.failed ? "warn" : "good"}>{repairSummary.failed ? "部分失败" : "全部完成"}</Badge></div><div className="migration-report-grid"><div><small>处理服务器</small><strong>{repairSummary.total}</strong></div><div><small>成功</small><strong>{repairSummary.succeeded}</strong></div><div><small>失败</small><strong>{repairSummary.failed}</strong></div>{repairSummary.kind === "patch" ? <><div><small>补齐客户端</small><strong>{repairSummary.patched}</strong></div><div><small>绑定归属</small><strong>{repairSummary.linked}</strong></div></> : null}</div>{repairSummary.errors.length ? <ul className="migration-failure-list">{repairSummary.errors.map((item) => <li key={item}>{item}</li>)}</ul> : null}</div> : null}
            {repairResult ? <details className="migration-result"><summary>查看原始操作结果</summary><pre>{JSON.stringify(repairResult, null, 2)}</pre></details> : null}
          </Surface>
        </> : null}
      </div>
    </Dialog>
    {pending === "import" ? <MigrationConfirmDialog title="导入妙妙屋数据" description="仅允许导入到空白 Arcway 实例。现有用户、节点、订阅或模板会触发后端 409 阻断，不能合并；请先完成备份。" confirmLabel="确认导入" tone="primary" working={working === "import"} onCancel={() => setPending(null)} onConfirm={() => void runImport()} /> : null}
    {pending === "takeover" ? <MigrationConfirmDialog title="接管外置 Xray" description={`将在 ${selectedServerIDs.length} 台服务器上合并外置 Xray 配置、创建远端备份并重启 Xray。`} confirmLabel="确认接管" working={working === "takeover"} onCancel={() => setPending(null)} onConfirm={() => void runRepair("takeover")} /> : null}
    {pending === "patch" ? <MigrationConfirmDialog title="修复客户端归属" description={`将在 ${selectedServerIDs.length} 台服务器上补齐缺失的客户端 email，并将凭据绑定给当前管理员。`} confirmLabel="确认修复" working={working === "patch"} onCancel={() => setPending(null)} onConfirm={() => void runRepair("patch")} /> : null}
  </>;
}

function MigrationConfirmDialog({ title, description, confirmLabel, tone = "danger", working, onCancel, onConfirm }: { title: string; description: string; confirmLabel: string; tone?: "danger" | "primary"; working: boolean; onCancel: () => void; onConfirm: () => void }) {
  const descriptionID = useId();
  return <Dialog title={title} description="请确认操作影响" describedBy={descriptionID} dismissible={!working} onClose={onCancel}>
    <div className="confirm-content"><span className="confirm-icon"><AlertTriangle size={22} /></span><p id={descriptionID}>{description}</p></div>
    <div className="dialog-actions"><Button type="button" variant="secondary" onClick={onCancel} disabled={working}>取消</Button><Button type="button" variant={tone} onClick={onConfirm} disabled={working}>{working ? <Spinner label="正在处理" /> : confirmLabel}</Button></div>
  </Dialog>;
}
