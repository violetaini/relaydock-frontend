import { useState, useEffect, useRef, type FormEvent } from "react";
import {
  ShieldCheck,
  AlertTriangle,
  Check,
  Database,
  Upload,
  FileCode,
  Activity,
  HardDriveUpload,
  ArrowRight,
  Layers,
  Server
} from "lucide-react";
import { api, request } from "./api";
import { Badge, Button, Dialog, EmptyState, ErrorState, Field, Spinner, Surface, Toggle, formatBytes } from "./ui";
import type { RemoteServer } from "./types";
import "./xui-import-dialog.css";

type Notify = (message: string, tone?: "success" | "error") => void;

export interface XUIInboundDetail {
  id: number;
  port: number;
  protocol: string;
  remark: string;
  tag: string;
  network?: string;
  security?: string;
  sni?: string;
  clients_count: number;
  client_emails?: string[];
  compatible: boolean;
  warning?: string;
  port_conflict: boolean;
  existing_conflict?: string;
  matching_server_id?: number;
  matching_server_name?: string;
}

export interface XUIInspectReport {
  total_inbounds: number;
  total_clients: number;
  total_traffic_up: number;
  total_traffic_down: number;
  protocols: Record<string, number>;
  inbound_details: XUIInboundDetail[];
  warnings: string[];
  has_conflicts: boolean;
}

export interface XUIImportResult {
  success: boolean;
  imported_nodes: number;
  imported_clients: number;
  imported_traffic_records: number;
  created_managed_inbounds: number;
  warnings?: string[];
  errors?: string[];
  execution_time: string;
}

export interface RemoteXUIDetection {
  installed: boolean;
  running: boolean;
  db_path?: string;
  binary_path?: string;
  service_unit?: string;
  inbound_count: number;
  client_count: number;
  active_ports: number[];
  detected_at: string;
  is_coexisting: boolean;
  message: string;
}

export function XUIImportDialog({
  notify,
  onClose,
  initialServerId
}: {
  notify: Notify;
  onClose: () => void;
  initialServerId?: number;
}) {
  const [tab, setTab] = useState<"upload" | "json" | "detect">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [rawJSON, setRawJSON] = useState("");
  const [servers, setServers] = useState<RemoteServer[]>([]);
  const [selectedServerID, setSelectedServerID] = useState<number>(initialServerId || 0);

  // Inspection & execution state
  const [loading, setLoading] = useState(false);
  const [inspectReport, setInspectReport] = useState<XUIInspectReport | null>(null);
  const [migrationId, setMigrationId] = useState<string>("");
  const [sourceDesc, setSourceDesc] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [result, setResult] = useState<XUIImportResult | null>(null);

  // Settings
  const [importTraffic, setImportTraffic] = useState(true);
  const [createResources, setCreateResources] = useState(true);

  // Remote probe state
  const [detecting, setDetecting] = useState(false);
  const [detectionResult, setDetectionResult] = useState<RemoteXUIDetection | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load available remote servers
  useEffect(() => {
    let active = true;
    api.get<{ servers?: RemoteServer[] }>("/api/admin/remote-servers")
      .then((res) => {
        if (!active) return;
        const list = res.servers || [];
        setServers(list);
        if (list.length > 0 && !selectedServerID) {
          setSelectedServerID(list[0].id);
        }
      })
      .catch(() => {
        // Fallback or ignore
      });
    return () => {
      active = false;
    };
  }, []);

  const handleFileUpload = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) return;

    setLoading(true);
    setError("");
    setInspectReport(null);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const resp = await request<{
        success: boolean;
        migration_id: string;
        filename: string;
        source: string;
        report: XUIInspectReport;
      }>("/api/admin/migrate/xui/upload", {
        method: "POST",
        body: formData
      });

      setMigrationId(resp.migration_id);
      setSourceDesc(`文件: ${resp.filename} (${resp.source})`);
      setInspectReport(resp.report);
      notify("3x-ui 数据预检分析完成", "success");
    } catch (err: any) {
      setError(err?.message || "上传解析 3x-ui 数据失败");
      notify("上传解析失败", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleRawJSONInspect = async (e: FormEvent) => {
    e.preventDefault();
    if (!rawJSON.trim()) return;

    setLoading(true);
    setError("");
    setInspectReport(null);

    try {
      const resp = await api.post<{
        success: boolean;
        report: XUIInspectReport;
      }>("/api/admin/migrate/xui/inspect", {
        raw_json: rawJSON.trim()
      });

      setMigrationId("");
      setSourceDesc("直接粘贴的 3x-ui JSON 数据");
      setInspectReport(resp.report);
      notify("3x-ui JSON 预检分析完成", "success");
    } catch (err: any) {
      setError(err?.message || "解析 3x-ui JSON 失败");
      notify("JSON 解析失败", "error");
    } finally {
      setLoading(false);
    }
  };

  const handleRemoteDetect = async () => {
    if (!selectedServerID) return;
    setDetecting(true);
    setError("");
    setDetectionResult(null);

    try {
      const resp = await api.get<RemoteXUIDetection>(
        `/api/admin/remote-servers/xui/detect?server_id=${selectedServerID}`
      );
      setDetectionResult(resp);
      if (resp.installed) {
        notify("已成功探测到远程 3x-ui 状态", "success");
      } else {
        notify("该节点未发现运行中的 3x-ui 实例", "success");
      }
    } catch (err: any) {
      setError(err?.message || "探测远程节点 3x-ui 失败");
      notify("探测失败", "error");
    } finally {
      setDetecting(false);
    }
  };

  const handleExecuteImport = async () => {
    setLoading(true);
    setError("");

    try {
      const payload: any = {
        migration_id: migrationId,
        raw_json: migrationId ? undefined : rawJSON.trim(),
        default_server_id: selectedServerID || (servers[0]?.id || 0),
        import_historical_traffic: importTraffic,
        create_managed_resources: createResources
      };

      const resp = await api.post<XUIImportResult>("/api/admin/migrate/xui/import", payload);
      setResult(resp);
      notify(`导入成功: 新增 ${resp.imported_nodes} 节点, ${resp.imported_clients} 用户`, "success");
    } catch (err: any) {
      setError(err?.message || "导入执行失败");
      notify("导入失败", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      title="3x-ui 深度评估与平滑接管中心"
      description="只读安全预检冲突，备战导入至 RelayDock，绝不干扰现网运行中的 3x-ui 业务"
      onClose={onClose}
      wide
    >
      <div className="xui-dialog-stack">
        {/* Strict Non-Destructive Guarantee Banner */}
        <div className="xui-coexistence-banner">
          <ShieldCheck size={22} className="text-accent" style={{ flexShrink: 0, marginTop: 2 }} />
          <div>
            <strong>100% 安全共存保证（先不替代现网业务）</strong>
            本中心所有分析与导入操作均遵循<strong>非侵入式只读/共存机制</strong>。数据导入仅在 RelayDock 数据库中建立镜像节点资产与订阅，<strong>绝不会向远程 VPS 发送停止、杀死或覆盖 3x-ui 进程的指令</strong>。您的业务 3x-ui 在整个评估与导入期间将持续 100% 独立稳定运行。
          </div>
        </div>

        {error ? <ErrorState message={error} onRetry={() => setError("")} /> : null}

        {result ? (
          <div className="xui-success-card">
            <Check size={36} color="var(--green)" style={{ margin: "0 auto" }} />
            <h3>3x-ui 节点与用户备战导入完成！</h3>
            <p style={{ margin: 0, fontSize: 13, color: "var(--text-soft)" }}>
              耗时: {result.execution_time} | 现网 3x-ui 依然无扰并行运作
            </p>
            <div className="xui-metric-row">
              <div className="xui-metric-card">
                <small>导入节点数</small>
                <strong>{result.imported_nodes} 个</strong>
              </div>
              <div className="xui-metric-card">
                <small>绑入客户端</small>
                <strong>{result.imported_clients} 个</strong>
              </div>
              <div className="xui-metric-card">
                <small>迁移流量记录</small>
                <strong>{result.imported_traffic_records} 条</strong>
              </div>
              <div className="xui-metric-card">
                <small>受管入站资产</small>
                <strong>{result.created_managed_inbounds} 个</strong>
              </div>
            </div>
            <div style={{ marginTop: 14, display: "flex", justifyContent: "center", gap: 10 }}>
              <Button type="button" variant="primary" onClick={onClose}>
                完成并关闭
              </Button>
            </div>
          </div>
        ) : (
          <>
            {/* Source tabs */}
            {!inspectReport ? (
              <>
                <div className="xui-tabs">
                  <button
                    type="button"
                    className={`xui-tab-btn ${tab === "upload" ? "is-active" : ""}`}
                    onClick={() => setTab("upload")}
                  >
                    <HardDriveUpload size={15} /> 上传 x-ui.db / 备份压缩包
                  </button>
                  <button
                    type="button"
                    className={`xui-tab-btn ${tab === "json" ? "is-active" : ""}`}
                    onClick={() => setTab("json")}
                  >
                    <FileCode size={15} /> 粘贴 3x-ui JSON 数据
                  </button>
                  <button
                    type="button"
                    className={`xui-tab-btn ${tab === "detect" ? "is-active" : ""}`}
                    onClick={() => setTab("detect")}
                  >
                    <Activity size={15} /> 探测节点 3x-ui 现状
                  </button>
                </div>

                {tab === "upload" && (
                  <form onSubmit={handleFileUpload} style={{ display: "grid", gap: 12 }}>
                    <div
                      className="xui-upload-dropzone"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Upload size={32} style={{ margin: "0 auto 8px", color: "var(--text-soft)" }} />
                      <div style={{ fontWeight: 500, fontSize: 14 }}>
                        {file ? file.name : "点击选择 x-ui.db, .zip, .tar.gz 或 .json 备份"}
                      </div>
                      <small style={{ color: "var(--text-soft)" }}>
                        {file
                          ? `${formatBytes(file.size)} - 点击可更换`
                          : "支持 3x-ui 原生 SQLite 数据库及后台导出的 JSON 配置包"}
                      </small>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".db,.sqlite,.zip,.tar.gz,.tgz,.json"
                        style={{ display: "none" }}
                        onChange={(e) => {
                          if (e.target.files && e.target.files[0]) {
                            setFile(e.target.files[0]);
                          }
                        }}
                      />
                    </div>
                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                      <Button
                        type="submit"
                        variant="primary"
                        disabled={!file || loading}
                      >
                        {loading ? <Spinner label="分析中..." /> : <Layers size={14} />}
                        开始只读预检分析
                      </Button>
                    </div>
                  </form>
                )}

                {tab === "json" && (
                  <form onSubmit={handleRawJSONInspect} style={{ display: "grid", gap: 12 }}>
                    <Field label="3x-ui 导出的 JSON 内容" hint="粘贴 /xui/API/inbounds/list 的返回结果或备份 JSON">
                      <textarea
                        className="field-input"
                        rows={8}
                        value={rawJSON}
                        onChange={(e) => setRawJSON(e.target.value)}
                        placeholder='{"success": true, "obj": [{"port": 443, "protocol": "vless", ...}]}'
                        style={{ fontFamily: "monospace", fontSize: 12 }}
                      />
                    </Field>
                    <div style={{ display: "flex", justifyContent: "flex-end" }}>
                      <Button
                        type="submit"
                        variant="primary"
                        disabled={!rawJSON.trim() || loading}
                      >
                        {loading ? <Spinner label="分析中..." /> : <Layers size={14} />}
                        开始只读预检分析
                      </Button>
                    </div>
                  </form>
                )}

                {tab === "detect" && (
                  <div style={{ display: "grid", gap: 12 }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
                      <div style={{ flex: 1 }}>
                        <Field label="选择已连接的 Edge 边缘节点" hint="向对应节点的 RelayDock Agent 发送只读状态查询">
                          <select
                            className="field-input"
                            value={selectedServerID}
                            onChange={(e) => setSelectedServerID(Number(e.target.value))}
                          >
                            {servers.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name} ({s.ip_address || "未指定 IP"})
                              </option>
                            ))}
                          </select>
                        </Field>
                      </div>
                      <Button
                        type="button"
                        variant="primary"
                        onClick={handleRemoteDetect}
                        disabled={detecting || !selectedServerID}
                      >
                        {detecting ? <Spinner label="探测中..." /> : <Activity size={14} />}
                        探测节点 3x-ui 状态
                      </Button>
                    </div>

                    {detectionResult && (
                      <div className="xui-probe-result-box">
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontWeight: 600 }}>探测反馈:</span>
                          {detectionResult.is_coexisting ? (
                            <Badge tone="good">平稳共存模式运行中</Badge>
                          ) : detectionResult.installed ? (
                            <Badge tone="warn">已安装但未启动</Badge>
                          ) : (
                            <Badge tone="neutral">未安装 3x-ui</Badge>
                          )}
                        </div>
                        <div>{detectionResult.message}</div>
                        {detectionResult.installed && (
                          <div className="xui-metric-row">
                            <div className="xui-metric-card">
                              <small>入站数量</small>
                              <strong>{detectionResult.inbound_count} 个</strong>
                            </div>
                            <div className="xui-metric-card">
                              <small>配置用户数</small>
                              <strong>{detectionResult.client_count} 个</strong>
                            </div>
                            <div className="xui-metric-card">
                              <small>占用端口数</small>
                              <strong>{detectionResult.active_ports.length} 个</strong>
                            </div>
                            <div className="xui-metric-card">
                              <small>数据库路径</small>
                              <strong style={{ fontSize: 11, wordBreak: "break-all" }}>
                                {detectionResult.db_path || "默认路径"}
                              </strong>
                            </div>
                          </div>
                        )}
                        {detectionResult.active_ports.length > 0 && (
                          <div style={{ fontSize: 12, color: "var(--text-soft)", marginTop: 4 }}>
                            3x-ui 当前监听端口: {detectionResult.active_ports.join(", ")}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              /* Pre-flight Audit Report View */
              <div style={{ display: "grid", gap: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <h3 style={{ margin: 0, fontSize: 16 }}>预检审计报告</h3>
                    <small style={{ color: "var(--text-soft)" }}>{sourceDesc}</small>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setInspectReport(null);
                      setMigrationId("");
                    }}
                  >
                    重新选择数据源
                  </Button>
                </div>

                <div className="xui-metric-row">
                  <div className="xui-metric-card">
                    <small>待导入入站</small>
                    <strong>{inspectReport.total_inbounds} 个</strong>
                  </div>
                  <div className="xui-metric-card">
                    <small>关联总用户数</small>
                    <strong>{inspectReport.total_clients} 个</strong>
                  </div>
                  <div className="xui-metric-card">
                    <small>历史上传流量</small>
                    <strong>{formatBytes(inspectReport.total_traffic_up)}</strong>
                  </div>
                  <div className="xui-metric-card">
                    <small>历史下载流量</small>
                    <strong>{formatBytes(inspectReport.total_traffic_down)}</strong>
                  </div>
                </div>

                <div className="xui-protocol-chips">
                  <span style={{ fontSize: 12, color: "var(--text-soft)", alignSelf: "center", marginRight: 4 }}>
                    协议分布:
                  </span>
                  {Object.entries(inspectReport.protocols).map(([proto, count]) => (
                    <Badge key={proto} tone="info">
                      {proto.toUpperCase()}: {count}
                    </Badge>
                  ))}
                </div>

                {/* Inbound Inspection Table */}
                <Surface style={{ maxHeight: 280, overflowY: "auto", border: "1px solid var(--border)" }}>
                  <table className="xui-inbound-table">
                    <thead>
                      <tr>
                        <th>端口</th>
                        <th>协议</th>
                        <th>备注/标签</th>
                        <th>网络/安全</th>
                        <th>客户端</th>
                        <th>冲突评估</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inspectReport.inbound_details.map((ib) => (
                        <tr key={ib.id}>
                          <td><strong>{ib.port}</strong></td>
                          <td><Badge tone="neutral">{ib.protocol}</Badge></td>
                          <td>{ib.remark || ib.tag || "-"}</td>
                          <td>
                            <span style={{ fontSize: 11, color: "var(--text-soft)" }}>
                              {ib.network || "tcp"} / {ib.security || "none"}
                              {ib.sni ? ` (${ib.sni})` : ""}
                            </span>
                          </td>
                          <td>{ib.clients_count} 人</td>
                          <td>
                            {ib.port_conflict ? (
                              <span className="xui-conflict-badge has-conflict">
                                <AlertTriangle size={12} /> 端口占用: {ib.existing_conflict}
                              </span>
                            ) : (
                              <span className="xui-conflict-badge is-safe">
                                <Check size={12} /> 端口空闲 / 可共存
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Surface>

                {inspectReport.has_conflicts && (
                  <div style={{ padding: "8px 12px", background: "var(--amber-soft)", border: "1px solid var(--amber)", borderRadius: "var(--radius-sm)", fontSize: 12, color: "var(--amber)" }}>
                    ⚠️ 检测到部分端口在选定的目标服务器上有重叠。导入会将节点录入 RelayDock 数据库作为备战节点，但不会触碰现网 3x-ui。未来在切换接管时建议先做平滑端口错峰或直接平替。
                  </div>
                )}

                {/* Import options */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 4 }}>
                  <Field label="目标承载服务器" hint="导入节点将归属至此远程服务器资产">
                    <select
                      className="field-input"
                      value={selectedServerID}
                      onChange={(e) => setSelectedServerID(Number(e.target.value))}
                    >
                      {servers.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.ip_address || "未指定 IP"})
                        </option>
                      ))}
                    </select>
                  </Field>

                  <div style={{ display: "flex", flexDirection: "column", gap: 8, justifyContent: "center" }}>
                    <Toggle
                      checked={importTraffic}
                      onChange={setImportTraffic}
                      label="保留并导入历史已用流量"
                    />
                    <Toggle
                      checked={createResources}
                      onChange={setCreateResources}
                      label="同步建立 RelayDock 受管入站"
                    />
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, marginTop: 10 }}>
                  <Button type="button" variant="secondary" onClick={onClose}>
                    取消
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    onClick={handleExecuteImport}
                    disabled={loading}
                  >
                    {loading ? <Spinner label="导入中..." /> : <Check size={14} />}
                    确认非侵入式备战导入
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
