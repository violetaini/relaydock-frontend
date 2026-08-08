import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Download, FileClock, FileText, Play, RefreshCw, Search, ShieldCheck, Square, Upload } from "lucide-react";
import { api, getToken, request } from "./api";
import { Badge, Button, ConfirmDialog, ErrorState, Field, IconButton, Spinner, Surface, formatBytes } from "./ui";
import "./operations-panels.css";

type Notify = (message: string, tone?: "success" | "error") => void;

function formatDate(value?: string): string {
  if (!value) return "-";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function operationError(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

function downloadFilename(response: Response, fallback: string): string {
  const disposition = response.headers.get("content-disposition") ?? "";
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try { return decodeURIComponent(encoded.replace(/^"|"$/g, "")); } catch { /* Fall back to the regular filename. */ }
  }
  return disposition.match(/filename="?([^";]+)"?/i)?.[1]?.trim() || fallback;
}

async function responseFailure(response: Response, fallback: string): Promise<Error> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = await response.json().catch(() => null) as { error?: string; message?: string } | null;
    return new Error(body?.error || body?.message || fallback);
  }
  const body = await response.text().catch(() => "");
  return new Error(body.trim() || fallback);
}

async function downloadAuthenticated(
  path: string,
  fallbackName: string,
  extraHeaders?: Record<string, string>,
  method: "GET" | "POST" = "GET",
): Promise<string> {
  const headers = new Headers(extraHeaders);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  let response: Response;
  try {
    response = await fetch(path, { method, headers });
  } catch {
    throw new Error("无法连接控制端，请检查网络或服务状态");
  }
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new CustomEvent("arcway:unauthorized"));
    throw await responseFailure(response, `下载失败 (${response.status})`);
  }
  const blob = await response.blob();
  const filename = downloadFilename(response, fallbackName);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  return filename;
}

type ValidatedBackup = { encrypted: boolean; description: string };

export async function validateBackupFile(file: File): Promise<ValidatedBackup> {
  if (!/\.zip(?:\.enc)?$/i.test(file.name)) throw new Error("仅支持 .zip.enc 加密备份或旧版 .zip 备份");
  if (file.size === 0) throw new Error("备份文件为空");
  if (file.size > 257 * 1024 * 1024) throw new Error("备份文件不能超过 257 MB");
  const prefix = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const magic = new TextDecoder().decode(prefix);
  if (magic === "RLDKBKP1" || magic === "RLDKBKP2") {
    if (magic === "RLDKBKP1" && file.size > 64 * 1024 * 1024) throw new Error("旧版加密备份不能超过 64 MB，请使用新版备份格式");
    const minimumSize = magic === "RLDKBKP2" ? 56 : 52;
    if (file.size < minimumSize) throw new Error("加密备份头不完整，文件可能已损坏");
    return { encrypted: true, description: magic === "RLDKBKP2" ? "Arcway 分块加密备份" : "Arcway 加密备份" };
  }
  if (prefix[0] === 0x50 && prefix[1] === 0x4b && file.name.toLowerCase().endsWith(".zip")) {
    return { encrypted: false, description: "旧版明文 ZIP 备份" };
  }
  throw new Error("文件头与 Arcway 备份格式不匹配");
}

export function BackupPanel({ notify }: { notify: Notify }) {
  const [downloadPassphrase, setDownloadPassphrase] = useState("");
  const [downloadConfirm, setDownloadConfirm] = useState("");
  const [downloadWorking, setDownloadWorking] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [restoreKind, setRestoreKind] = useState<ValidatedBackup | null>(null);
  const [restorePassphrase, setRestorePassphrase] = useState("");
  const [restoreError, setRestoreError] = useState("");
  const [restoreWorking, setRestoreWorking] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const restoreInput = useRef<HTMLInputElement>(null);

  const createBackup = async (event: FormEvent) => {
    event.preventDefault();
    setDownloadError("");
    if (downloadPassphrase.length < 8) return setDownloadError("备份口令至少需要 8 位");
    if (downloadPassphrase !== downloadConfirm) return setDownloadError("两次输入的备份口令不一致");
    setDownloadWorking(true);
    try {
      const filename = await downloadAuthenticated("/api/admin/backup/download", "arcway-backup.zip.enc", { "X-Backup-Passphrase": downloadPassphrase }, "POST");
      notify(`加密备份已下载：${filename}`);
      setDownloadPassphrase("");
      setDownloadConfirm("");
    } catch (reason) {
      setDownloadError(operationError(reason, "备份下载失败"));
    } finally {
      setDownloadWorking(false);
    }
  };

  const chooseBackup = async (file: File | null) => {
    setRestoreFile(file);
    setRestoreKind(null);
    setRestoreError("");
    if (!file) return;
    try {
      setRestoreKind(await validateBackupFile(file));
    } catch (reason) {
      setRestoreError(operationError(reason, "备份文件校验失败"));
    }
  };

  const requestRestore = async (event: FormEvent) => {
    event.preventDefault();
    setRestoreError("");
    if (!restoreFile) return setRestoreError("请选择备份文件");
    try {
      const validated = await validateBackupFile(restoreFile);
      setRestoreKind(validated);
      if (validated.encrypted && !restorePassphrase) return setRestoreError("加密备份需要输入原备份口令");
      setConfirmRestore(true);
    } catch (reason) {
      setRestoreError(operationError(reason, "备份文件校验失败"));
    }
  };

  const restore = async () => {
    if (!restoreFile) return;
    setRestoreWorking(true);
    setRestoreError("");
    try {
      const form = new FormData();
      form.set("backup", restoreFile);
      if (restorePassphrase) form.set("passphrase", restorePassphrase);
      const response = await request<{ message?: string }>("/api/admin/backup/restore", { method: "POST", body: form });
      notify(response.message || "备份已校验并暂存，必须重启 Arcway 服务后才会应用");
      setConfirmRestore(false);
      setRestoreFile(null);
      setRestoreKind(null);
      setRestorePassphrase("");
      if (restoreInput.current) restoreInput.current.value = "";
    } catch (reason) {
      setRestoreError(operationError(reason, "备份恢复失败"));
      setConfirmRestore(false);
    } finally {
      setRestoreWorking(false);
    }
  };

  return (
    <div className="ops-stack">
      <div className="ops-two-column">
        <Surface className="ops-card">
          <div className="surface-heading"><div><h2><Download size={17} />数据备份</h2><small>数据、订阅文件会使用现场口令加密</small></div></div>
          <form className="ops-form" onSubmit={createBackup}>
            {downloadError ? <ErrorState message={downloadError} /> : null}
            <Field label="备份加密口令" hint="至少 8 位；口令不会保存，恢复时必须再次提供"><input type="password" minLength={8} autoComplete="new-password" value={downloadPassphrase} onChange={(event) => setDownloadPassphrase(event.target.value)} /></Field>
            <Field label="确认备份口令"><input type="password" minLength={8} autoComplete="new-password" value={downloadConfirm} onChange={(event) => setDownloadConfirm(event.target.value)} /></Field>
            <div className="ops-card-actions"><Button type="submit" disabled={downloadWorking}>{downloadWorking ? <Spinner label="正在创建并加密" /> : <><Download size={16} />下载加密备份</>}</Button></div>
          </form>
        </Surface>
        <Surface className="ops-card ops-danger-card">
          <div className="surface-heading"><div><h2><Upload size={17} />恢复备份</h2><small>备份会先校验并暂存；重启 Arcway 服务后才会替换当前数据</small></div></div>
          <form className="ops-form" onSubmit={requestRestore}>
            {restoreError ? <ErrorState message={restoreError} /> : null}
            <Field label="备份文件" hint="新版最大 257 MB，旧版加密备份最大 64 MB；支持 .zip.enc 和旧版 .zip"><input ref={restoreInput} type="file" accept=".zip,.enc,.zip.enc" onChange={(event) => void chooseBackup(event.target.files?.[0] ?? null)} /></Field>
            {restoreFile && restoreKind ? <div className="ops-file-check"><ShieldCheck size={17} /><span><strong>{restoreFile.name}</strong><small>{restoreKind.description} · {formatBytes(restoreFile.size)}</small></span></div> : null}
            <Field label="原备份口令" hint={restoreKind?.encrypted ? "此文件已加密，必须填写" : "旧版明文 ZIP 可留空"}><input type="password" autoComplete="off" value={restorePassphrase} onChange={(event) => setRestorePassphrase(event.target.value)} /></Field>
            <div className="ops-card-actions"><Button type="submit" variant="danger" disabled={restoreWorking || !restoreFile}>{restoreWorking ? <Spinner label="正在暂存" /> : <><Upload size={16} />校验并暂存</>}</Button></div>
          </form>
        </Surface>
      </div>
      {confirmRestore && restoreFile ? <ConfirmDialog title="暂存数据备份" description={`将先校验并暂存“${restoreFile.name}”（${formatBytes(restoreFile.size)}），当前运行中的数据不会立即改变。重启 Arcway 服务后才会原子替换 data 和 subscribes，请在重启后核对节点、用户和订阅。`} confirmLabel="校验并暂存" working={restoreWorking} onCancel={() => setConfirmRestore(false)} onConfirm={() => void restore()} /> : null}
    </div>
  );
}

interface DebugStatus {
  enabled: boolean;
  log_path?: string;
  started_at?: string;
  file_size?: string;
  duration_seconds?: number;
  duration?: string;
}

interface DebugActionResponse {
  status?: string;
  log_path?: string;
  started_at?: string;
  download_url?: string;
}

export function DebugLogsPanel({ notify }: { notify: Notify }) {
  const [status, setStatus] = useState<DebugStatus | null>(null);
  const [tail, setTail] = useState("");
  const [lineLimit, setLineLimit] = useState("200");
  const [filter, setFilter] = useState("");
  const [downloadURL, setDownloadURL] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const current = await api.get<DebugStatus>("/api/user/debug/status");
      setStatus(current);
      if (current.enabled) {
        const response = await api.get<{ lines?: string; total_size?: number }>(`/api/user/debug/tail?lines=${lineLimit}`);
        setTail(response.lines ?? "");
      } else {
        setTail("");
      }
    } catch (reason) {
      setError(operationError(reason, "主控 Debug 日志加载失败"));
    } finally {
      setLoading(false);
    }
  }, [lineLimit]);

  useEffect(() => { void load(); }, [load]);

  const enable = async () => {
    setWorking(true);
    setError("");
    try {
      await api.post<DebugActionResponse>("/api/user/debug/enable");
      setDownloadURL("");
      notify("主控 Debug 日志已开启，将在 5 分钟后自动停止");
      await load();
    } catch (reason) {
      setError(operationError(reason, "开启主控 Debug 日志失败"));
    } finally {
      setWorking(false);
    }
  };

  const downloadLog = async (path: string) => {
    try {
      const filename = await downloadAuthenticated(path, "arcway-debug-log.txt");
      setDownloadURL("");
      notify(`日志已下载：${filename}；服务端副本将自动清理`);
    } catch (reason) {
      setError(operationError(reason, "主控 Debug 日志下载失败"));
    }
  };

  const disable = async (downloadAfter: boolean) => {
    setWorking(true);
    setError("");
    try {
      const response = await api.post<DebugActionResponse>("/api/user/debug/disable");
      const path = response.download_url ?? "";
      setDownloadURL(path);
      setStatus({ enabled: false });
      setTail("");
      notify("主控 Debug 日志已停止");
      if (downloadAfter && path) await downloadLog(path);
    } catch (reason) {
      setError(operationError(reason, "停止主控 Debug 日志失败"));
    } finally {
      setWorking(false);
    }
  };

  const visibleTail = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return tail;
    return tail.split("\n").filter((line) => line.toLowerCase().includes(query)).join("\n");
  }, [filter, tail]);

  return (
    <div className="ops-stack">
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      <Surface className="ops-debug-surface">
        <div className="surface-heading ops-debug-heading">
          <div><h2><FileText size={17} />主控 Debug 日志</h2><small>临时捕获当前 Arcway 主控的详细运行日志，最长持续 5 分钟</small></div>
          <div className="ops-inline-actions">
            <IconButton label="刷新主控 Debug 日志" onClick={() => void load()} disabled={loading}><RefreshCw size={17} /></IconButton>
            {status?.enabled ? <><Button variant="secondary" onClick={() => void disable(false)} disabled={working}><Square size={15} />停止记录</Button><Button onClick={() => void disable(true)} disabled={working}><Download size={15} />停止并下载</Button></> : <Button onClick={() => void enable()} disabled={working || loading}><Play size={15} />开始记录</Button>}
          </div>
        </div>
        {loading && !status ? <div className="center-state"><Spinner /></div> : <>
          <div className="ops-debug-meta">
            <span><small>状态</small><Badge tone={status?.enabled ? "warn" : "neutral"}>{status?.enabled ? "记录中" : "已停止"}</Badge></span>
            <span><small>开始时间</small><strong>{formatDate(status?.started_at)}</strong></span>
            <span><small>持续时间</small><strong>{status?.duration || (status?.duration_seconds != null ? `${status.duration_seconds} 秒` : "-")}</strong></span>
            <span><small>文件大小</small><strong>{status?.file_size || "-"}</strong></span>
          </div>
          {downloadURL ? <div className="ops-download-ready"><FileClock size={18} /><span><strong>本次日志已停止</strong><small>下载成功后服务端会自动删除该文件</small></span><Button onClick={() => void downloadLog(downloadURL)} disabled={working}><Download size={15} />下载并清理服务端副本</Button></div> : null}
          <div className="ops-log-toolbar">
            <label className="search-box"><Search size={16} /><input aria-label="筛选日志" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="筛选关键字" /></label>
            <Field label="日志行数"><select value={lineLimit} onChange={(event) => setLineLimit(event.target.value)}><option value="100">最近 100 行</option><option value="200">最近 200 行</option><option value="500">最近 500 行</option><option value="1000">最近 1000 行</option></select></Field>
          </div>
          <pre className="ops-log-view" aria-label="主控 Debug 日志内容">{visibleTail || (status?.enabled ? "暂时没有匹配的日志" : "开启记录后可在这里查看实时日志")}</pre>
        </>}
      </Surface>
    </div>
  );
}
