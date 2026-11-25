import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Braces,
  Clock3,
  Code2,
  FileCode2,
  FileText,
  History,
  Layers,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import { api } from "./api";
import {
  Badge,
  Button,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  IconButton,
  PageHeader,
  Spinner,
  Surface,
  Toggle,
  formatBytes,
} from "./ui";
import "./rules-workbench.css";

type Notify = (message: string, tone?: "success" | "error") => void;
type RuleType = "dns" | "rules" | "rule-providers";
type RuleMode = "replace" | "prepend" | "append";
type ScriptHook = "post_fetch" | "pre_save_nodes";
type CustomFilter = "all" | RuleType | "scripts";

interface CustomRule {
  id: number;
  name: string;
  type: RuleType;
  mode: RuleMode;
  content: string;
  enabled: boolean;
  created_at?: string;
  updated_at?: string;
}

interface OverrideScript {
  id: number;
  name: string;
  hook: ScriptHook;
  content: string;
  enabled: boolean;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
}

interface RuleFile {
  name: string;
  size: number;
  mod_time: number;
  latest_version: number;
}

interface RuleDocument {
  name: string;
  content: string;
  latest_version: number;
}

interface RuleDocumentEditor extends RuleDocument {
  originalContent: string;
  loading: boolean;
  error: string;
}

interface RuleVersionWire {
  Filename?: string;
  Version?: number;
  Content?: string;
  CreatedBy?: string;
  CreatedAt?: string;
  filename?: string;
  version?: number;
  content?: string;
  created_by?: string;
  created_at?: string;
}

interface RuleVersion {
  filename: string;
  version: number;
  content: string;
  createdBy: string;
  createdAt: string;
}

interface CustomEditorState {
  kind: "rule" | "script";
  id?: number;
  name: string;
  type: RuleType;
  mode: RuleMode;
  hook: ScriptHook;
  content: string;
  enabled: boolean;
  sortOrder: number;
}

type DeleteTarget =
  | { kind: "rule"; item: CustomRule }
  | { kind: "script"; item: OverrideScript };

const noop: Notify = () => undefined;

const typeLabels: Record<RuleType, string> = {
  dns: "DNS",
  rules: "规则",
  "rule-providers": "规则提供者",
};

const modeLabels: Record<RuleMode, string> = {
  replace: "替换",
  prepend: "前置",
  append: "追加",
};

const hookLabels: Record<ScriptHook, string> = {
  post_fetch: "订阅生成后",
  pre_save_nodes: "节点保存前",
};

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

function formatDate(value?: string | number): string {
  if (value === undefined || value === null || value === "") return "-";
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function defaultRuleContent(type: RuleType): string {
  if (type === "dns") return "dns:\n  enable: true\n";
  if (type === "rule-providers") return "rule-providers:\n  example:\n    type: http\n    behavior: domain\n    url: https://example.com/rules.yaml\n";
  return "- DOMAIN-SUFFIX,example.com,DIRECT\n";
}

function createEditor(nextSortOrder: number): CustomEditorState {
  return {
    kind: "rule",
    name: "",
    type: "rules",
    mode: "prepend",
    hook: "post_fetch",
    content: defaultRuleContent("rules"),
    enabled: true,
    sortOrder: nextSortOrder,
  };
}

function mergeModeGuide(type: RuleType, mode: RuleMode): {
  title: string;
  beforeLabel: string;
  afterLabel: string;
  description: string;
  tone: "info" | "warn" | "good";
} {
  if (type === "dns") {
    return {
      title: "完全替换目标订阅的 DNS 配置",
      beforeLabel: "原有内容：模板或上游自带的 dns: {...} 配置",
      afterLabel: "替换为：完全使用下方定义的 dns: {...} 配置",
      description: "DNS 配置为整段对象，启用后将覆盖原订阅的 DNS 解析与 Fake-IP 规则。",
      tone: "warn",
    };
  }
  if (type === "rule-providers") {
    if (mode === "replace") {
      return {
        title: "清空并替换全部规则提供者",
        beforeLabel: "原有内容：订阅自带的 rule-providers 集合",
        afterLabel: "替换为：仅保留下方定义的 rule-providers",
        description: "⚠️ 注意：订阅原有的全部远程规则集将被清空，请确认规则中引用的 provider 均已在此定义。",
        tone: "warn",
      };
    }
    return {
      title: "保留现有规则提供者并前置合并",
      beforeLabel: "原有内容：订阅现有的 rule-providers 集合",
      afterLabel: "合并结果：[你的 rule-providers] + [原有 rule-providers]",
      description: "在原有规则集基础上补充新的远程规则集；若名称相同，以你定义的为准。",
      tone: "info",
    };
  }
  if (mode === "replace") {
    return {
      title: "清空并替换整套分流规则",
      beforeLabel: "原有内容：模板或上游订阅的全部 rules 分流列表",
      afterLabel: "替换为：仅使用下方定义的规则（原规则全部失效）",
      description: "⚠️ 高风险操作：适合完全接管分流逻辑，建议在末尾保留兜底规则（如 MATCH,PROXY）。",
      tone: "warn",
    };
  }
  if (mode === "append") {
    return {
      title: "追加到原有规则末尾（兜底前/后）",
      beforeLabel: "原有内容：[第 1 条原规则 ... 第 N 条原规则]",
      afterLabel: "合并结果：[原有规则...] → [你的覆写规则]",
      description: "当请求未命中原订阅规则时才会执行你的规则（注意：若原订阅末尾已有 MATCH，追加在 MATCH 之后将不会生效）。",
      tone: "info",
    };
  }
  return {
    title: "插入到原有规则最前面（最高优先级）",
    beforeLabel: "原有内容：[原有分流规则...]",
    afterLabel: "合并结果：[你的覆写规则] → [原有分流规则...]",
    description: "流量会最先匹配这里定义的规则，命中后立即执行对应动作；若需按关键字精准替换原有某条规则，请使用上方的「JavaScript 处理脚本」。",
    tone: "good",
  };
}

function normalizeRuleVersion(item: RuleVersionWire): RuleVersion {
  return {
    filename: item.filename ?? item.Filename ?? "",
    version: item.version ?? item.Version ?? 0,
    content: item.content ?? item.Content ?? "",
    createdBy: item.created_by ?? item.CreatedBy ?? "-",
    createdAt: item.created_at ?? item.CreatedAt ?? "",
  };
}

function rulePayload(editor: CustomEditorState) {
  return {
    name: editor.name.trim(),
    type: editor.type,
    mode: editor.mode,
    content: editor.content,
    enabled: editor.enabled,
  };
}

function scriptPayload(editor: CustomEditorState) {
  return {
    name: editor.name.trim(),
    hook: editor.hook,
    content: editor.content,
    enabled: editor.enabled,
    sort_order: editor.sortOrder,
  };
}

export function CustomRulesWorkbenchPage({ notify = noop }: { notify?: Notify }) {
  const [rules, setRules] = useState<CustomRule[]>([]);
  const [scripts, setScripts] = useState<OverrideScript[]>([]);
  const [filter, setFilter] = useState<CustomFilter>("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editor, setEditor] = useState<CustomEditorState | null>(null);
  const [editorError, setEditorError] = useState("");
  const [saving, setSaving] = useState(false);
  const [updating, setUpdating] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [ruleItems, scriptItems] = await Promise.all([
        api.get<CustomRule[]>("/api/admin/custom-rules"),
        api.get<OverrideScript[]>("/api/admin/override-scripts"),
      ]);
      setRules(Array.isArray(ruleItems) ? ruleItems : []);
      setScripts(Array.isArray(scriptItems) ? scriptItems : []);
    } catch (reason) {
      setError(errorMessage(reason, "自定义规则加载失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => ({
    all: rules.length + scripts.length,
    dns: rules.filter((item) => item.type === "dns").length,
    rules: rules.filter((item) => item.type === "rules").length,
    "rule-providers": rules.filter((item) => item.type === "rule-providers").length,
    scripts: scripts.length,
  }), [rules, scripts]);

  const visibleItems = useMemo(() => {
    const query = search.trim().toLowerCase();
    const ruleItems = rules
      .filter((item) => filter === "all" || filter === item.type)
      .map((item) => ({ key: `rule-${item.id}`, kind: "rule" as const, item }));
    const scriptItems = (filter === "all" || filter === "scripts")
      ? scripts.map((item) => ({ key: `script-${item.id}`, kind: "script" as const, item }))
      : [];
    return [...ruleItems, ...scriptItems]
      .filter(({ item }) => !query || [item.name, item.content, "hook" in item ? hookLabels[item.hook] : typeLabels[item.type]]
        .some((value) => value.toLowerCase().includes(query)))
      .sort((a, b) => {
        if (a.kind === "script" && b.kind === "script") return a.item.sort_order - b.item.sort_order || a.item.name.localeCompare(b.item.name);
        return a.item.name.localeCompare(b.item.name);
      });
  }, [filter, rules, scripts, search]);

  const nextSortOrder = useMemo(() => Math.max(0, ...scripts.map((item) => item.sort_order)) + 10, [scripts]);

  const openNewEditor = () => {
    setEditorError("");
    setEditor(createEditor(nextSortOrder));
  };

  const openRuleEditor = (item: CustomRule) => {
    setEditorError("");
    setEditor({
      kind: "rule",
      id: item.id,
      name: item.name,
      type: item.type,
      mode: item.mode,
      hook: "post_fetch",
      content: item.content,
      enabled: item.enabled,
      sortOrder: nextSortOrder,
    });
  };

  const openScriptEditor = (item: OverrideScript) => {
    setEditorError("");
    setEditor({
      kind: "script",
      id: item.id,
      name: item.name,
      type: "rules",
      mode: "append",
      hook: item.hook,
      content: item.content,
      enabled: item.enabled,
      sortOrder: item.sort_order,
    });
  };

  const saveEditor = async (event: FormEvent) => {
    event.preventDefault();
    if (!editor) return;
    setSaving(true);
    setEditorError("");
    try {
      if (editor.kind === "rule") {
        const path = editor.id ? `/api/admin/custom-rules/${editor.id}` : "/api/admin/custom-rules";
        const saved = editor.id
          ? await api.put<CustomRule>(path, rulePayload(editor))
          : await api.post<CustomRule>(path, rulePayload(editor));
        setRules((items) => editor.id ? items.map((item) => item.id === editor.id ? saved : item) : [...items, saved]);
        notify(editor.id ? "规则已更新" : "规则已创建");
      } else {
        const path = editor.id ? `/api/admin/override-scripts/${editor.id}` : "/api/admin/override-scripts";
        const saved = editor.id
          ? await api.put<OverrideScript>(path, scriptPayload(editor))
          : await api.post<OverrideScript>(path, scriptPayload(editor));
        setScripts((items) => editor.id ? items.map((item) => item.id === editor.id ? saved : item) : [...items, saved]);
        notify(editor.id ? "覆写脚本已更新" : "覆写脚本已创建");
      }
      setEditor(null);
    } catch (reason) {
      setEditorError(errorMessage(reason, "保存失败"));
    } finally {
      setSaving(false);
    }
  };

  const toggleRule = async (item: CustomRule, enabled: boolean) => {
    const key = `rule-${item.id}`;
    setUpdating(key);
    try {
      const updated = await api.put<CustomRule>(`/api/admin/custom-rules/${item.id}`, { ...rulePayload({
        kind: "rule", id: item.id, name: item.name, type: item.type, mode: item.mode,
        hook: "post_fetch", content: item.content, enabled, sortOrder: 0,
      }) });
      setRules((items) => items.map((entry) => entry.id === item.id ? updated : entry));
      notify(enabled ? "规则已启用" : "规则已停用");
    } catch (reason) {
      notify(errorMessage(reason, "状态更新失败"), "error");
    } finally {
      setUpdating("");
    }
  };

  const toggleScript = async (item: OverrideScript, enabled: boolean) => {
    const key = `script-${item.id}`;
    setUpdating(key);
    try {
      const updated = await api.put<OverrideScript>(`/api/admin/override-scripts/${item.id}`, {
        name: item.name,
        hook: item.hook,
        content: item.content,
        enabled,
        sort_order: item.sort_order,
      });
      setScripts((items) => items.map((entry) => entry.id === item.id ? updated : entry));
      notify(enabled ? "覆写脚本已启用" : "覆写脚本已停用");
    } catch (reason) {
      notify(errorMessage(reason, "状态更新失败"), "error");
    } finally {
      setUpdating("");
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setSaving(true);
    try {
      if (deleteTarget.kind === "rule") {
        await api.delete<void>(`/api/admin/custom-rules/${deleteTarget.item.id}`);
        setRules((items) => items.filter((item) => item.id !== deleteTarget.item.id));
        notify("规则已删除");
      } else {
        await api.delete<{ status: string }>(`/api/admin/override-scripts/${deleteTarget.item.id}`);
        setScripts((items) => items.filter((item) => item.id !== deleteTarget.item.id));
        notify("覆写脚本已删除");
      }
      setDeleteTarget(null);
    } catch (reason) {
      notify(errorMessage(reason, "删除失败"), "error");
    } finally {
      setSaving(false);
    }
  };

  const filters: Array<{ key: CustomFilter; label: string }> = [
    { key: "all", label: "全部" },
    { key: "dns", label: "DNS" },
    { key: "rules", label: "规则" },
    { key: "rule-providers", label: "规则提供者" },
    { key: "scripts", label: "脚本" },
  ];

  return (
    <div className="rw-page">
      <PageHeader
        title="覆写管理"
        description="管理订阅生成时的 YAML 覆写规则和 JavaScript 处理脚本"
        actions={<>
          <IconButton label="重新加载规则" onClick={() => void load()} disabled={loading}><RefreshCw size={18} /></IconButton>
          <Button onClick={openNewEditor}><Plus size={17} />新建覆写</Button>
        </>}
      />

      <div className="rw-controls">
        <div className="rw-filter" role="tablist" aria-label="规则类型筛选">
          {filters.map((item) => (
            <button key={item.key} type="button" role="tab" aria-selected={filter === item.key} className={filter === item.key ? "is-active" : ""} onClick={() => setFilter(item.key)}>
              {item.label}<span>{counts[item.key]}</span>
            </button>
          ))}
        </div>
        <div className="search-box rw-search">
          <Search size={17} />
          <input aria-label="搜索自定义规则" placeholder="搜索名称或内容" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
      </div>

      <Surface className="table-surface rw-table-surface">
        {loading ? (
          <div className="rw-loading"><Spinner label="正在加载规则" /></div>
        ) : error ? (
          <div className="rw-surface-error"><ErrorState message={error} onRetry={() => void load()} /></div>
        ) : visibleItems.length === 0 ? (
          <EmptyState
            icon={search ? <Search size={23} /> : <Braces size={23} />}
            title={search ? "没有匹配的规则" : counts.all === 0 ? "暂无自定义规则" : "当前分类为空"}
            description={counts.all === 0 ? "创建 YAML 规则或 JavaScript 脚本后会显示在这里" : undefined}
            action={counts.all === 0 ? <Button onClick={openNewEditor}><Plus size={16} />新建覆写</Button> : undefined}
          />
        ) : (
          <div className="table-wrap">
            <table className="rw-table">
              <thead><tr><th>名称</th><th>类型 / 阶段</th><th>应用策略</th><th>状态</th><th>最近更新</th><th aria-label="操作" /></tr></thead>
              <tbody>
                {visibleItems.map((entry) => {
                  const isScript = entry.kind === "script";
                  const item = entry.item;
                  return (
                    <tr key={entry.key}>
                      <td>
                        <div className="rw-name">
                          <span className="rw-file-icon">{isScript ? <Code2 size={17} /> : <FileCode2 size={17} />}</span>
                          <span><strong>{item.name}</strong><small>#{item.id} · {item.content.length.toLocaleString("zh-CN")} 字符</small></span>
                        </div>
                      </td>
                      <td>{isScript ? <><Badge tone="info">JavaScript</Badge><small className="rw-cell-note">{hookLabels[(item as OverrideScript).hook]}</small></> : <Badge>{typeLabels[(item as CustomRule).type]}</Badge>}</td>
                      <td>{isScript ? <><strong>顺序 {(item as OverrideScript).sort_order}</strong><small className="rw-cell-note">由小到大执行</small></> : <Badge tone={(item as CustomRule).mode === "replace" ? "warn" : "neutral"}>{modeLabels[(item as CustomRule).mode]}</Badge>}</td>
                      <td>
                        <div className={updating === entry.key ? "rw-updating" : ""}>
                          <Toggle
                            checked={item.enabled}
                            onChange={(enabled) => isScript ? void toggleScript(item as OverrideScript, enabled) : void toggleRule(item as CustomRule, enabled)}
                            label={item.enabled ? "已启用" : "已停用"}
                          />
                        </div>
                      </td>
                      <td><span className="rw-date"><Clock3 size={14} />{formatDate(item.updated_at)}</span></td>
                      <td>
                        <div className="rw-actions">
                          <IconButton label={`编辑 ${item.name}`} onClick={() => isScript ? openScriptEditor(item as OverrideScript) : openRuleEditor(item as CustomRule)}><Pencil size={16} /></IconButton>
                          <IconButton label={`删除 ${item.name}`} onClick={() => setDeleteTarget(isScript ? { kind: "script", item: item as OverrideScript } : { kind: "rule", item: item as CustomRule })}><Trash2 size={16} /></IconButton>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Surface>

      {editor ? (
        <Dialog title={editor.id ? `编辑 ${editor.name}` : "新建覆写"} description="保存前会由服务端校验 YAML 或 JavaScript 语法" onClose={() => !saving && setEditor(null)} wide dismissible={!saving}>
          <form className="rw-editor-form" onSubmit={saveEditor}>
            {editorError ? <ErrorState message={editorError} /> : null}
            {!editor.id ? (
              <div className="rw-kind-picker" role="group" aria-label="覆写类型">
                <button type="button" className={editor.kind === "rule" ? "is-active" : ""} onClick={() => setEditor({ ...editor, kind: "rule", content: defaultRuleContent(editor.type) })}><FileText size={18} />YAML 覆写规则</button>
                <button type="button" className={editor.kind === "script" ? "is-active" : ""} onClick={() => setEditor({ ...editor, kind: "script", content: "function main(value) {\n  return value;\n}\n" })}><Code2 size={18} />JavaScript 处理脚本</button>
              </div>
            ) : null}
            <div className="rw-form-grid">
              <Field label="名称"><input autoFocus required placeholder={editor.kind === "rule" ? "例如：公司内网直连 / 屏蔽广告域名" : "例如：按关键字替换单条规则"} value={editor.name} onChange={(event) => setEditor({ ...editor, name: event.target.value })} /></Field>
              {editor.kind === "rule" ? (
                <Field label="规则类型">
                  <select value={editor.type} onChange={(event) => {
                    const type = event.target.value as RuleType;
                    const validMode = type === "dns" ? "replace" : type === "rule-providers" && editor.mode === "append" ? "prepend" : editor.mode;
                    const nextContent = editor.id ? editor.content : defaultRuleContent(type);
                    setEditor({ ...editor, type, mode: validMode, content: nextContent });
                  }}>
                    <option value="rules">分流规则 (rules)</option>
                    <option value="dns">DNS 解析 (dns)</option>
                    <option value="rule-providers">规则提供者 (rule-providers)</option>
                  </select>
                </Field>
              ) : (
                <Field label="执行阶段">
                  <select value={editor.hook} onChange={(event) => setEditor({ ...editor, hook: event.target.value as ScriptHook })}>
                    <option value="post_fetch">订阅生成后（post_fetch）</option><option value="pre_save_nodes">节点保存前（pre_save_nodes）</option>
                  </select>
                </Field>
              )}
            </div>
            <div className="rw-form-grid">
              {editor.kind === "rule" ? (
                <Field label="合并方式">
                  <select value={editor.mode} onChange={(event) => setEditor({ ...editor, mode: event.target.value as RuleMode })}>
                    <option value="prepend">插入到现有内容前（最高优先级）</option>
                    <option value="append" disabled={editor.type !== "rules"}>追加到现有内容后（兜底前）</option>
                    <option value="replace">替换现有内容（覆盖清空原配置）</option>
                  </select>
                </Field>
              ) : (
                <Field label="执行顺序" hint="数字越小越先执行"><input type="number" step="1" value={editor.sortOrder} onChange={(event) => setEditor({ ...editor, sortOrder: Number(event.target.value) })} /></Field>
              )}
              <div className="rw-toggle-field"><Toggle checked={editor.enabled} onChange={(enabled) => setEditor({ ...editor, enabled })} label="创建后立即启用" /></div>
            </div>

            {editor.kind === "rule" ? (() => {
              const guide = mergeModeGuide(editor.type, editor.mode);
              return (
                <div className={`rw-merge-guide is-${guide.tone}`}>
                  <div className="rw-merge-guide-head">
                    {guide.tone === "warn" ? <AlertTriangle size={16} /> : <Layers size={16} />}
                    <strong>{guide.title}</strong>
                  </div>
                  <div className="rw-merge-flow">
                    <div className="rw-merge-step is-before">
                      <small>原有内容</small>
                      <span>{guide.beforeLabel.replace(/^原有内容：/, "")}</span>
                    </div>
                    <ArrowRight size={16} className="rw-merge-arrow" />
                    <div className="rw-merge-step is-after">
                      <small>生效结果</small>
                      <span>{guide.afterLabel.replace(/^(替换为|合并结果)：/, "")}</span>
                    </div>
                  </div>
                  <p className="rw-merge-desc">{guide.description}</p>
                </div>
              );
            })() : (
              <div className="rw-merge-guide is-info">
                <div className="rw-merge-guide-head">
                  <Code2 size={16} />
                  <strong>{editor.hook === "post_fetch" ? "订阅生成后（post_fetch）" : "节点保存前（pre_save_nodes）"}</strong>
                </div>
                <p className="rw-merge-desc">
                  {editor.hook === "post_fetch"
                    ? "在客户端配置生成完毕后执行，入参 value 为完整的 Clash 配置对象（包含 proxies、proxy-groups、rules 等），返回修改后的配置对象。"
                    : "在拉取或解析外部节点后、写入前执行，入参 value 为节点数组，可用于批量过滤或正则重命名节点。"}
                </p>
              </div>
            )}

            {editor.kind === "rule" && editor.type === "dns" ? (
              <div className="rw-preset-bar">
                <span><Sparkles size={14} />快速模板：</span>
                <button type="button" onClick={() => setEditor({ ...editor, content: "dns:\n  enable: true\n  enhanced-mode: fake-ip\n  fake-ip-range: 198.18.0.1/16\n  nameserver:\n    - https://doh.pub/dns-query\n    - https://dns.alidns.com/dns-query\n  fallback:\n    - https://dns.google/dns-query\n" })}>Fake-IP 防泄漏模板</button>
                <button type="button" onClick={() => setEditor({ ...editor, content: "dns:\n  enable: true\n  enhanced-mode: redir-host\n  nameserver:\n    - 223.5.5.5\n    - 119.29.29.29\n" })}>Redir-Host 纯净模板</button>
              </div>
            ) : editor.kind === "script" ? (
              <div className="rw-preset-bar">
                <span><Sparkles size={14} />常用脚本示例：</span>
                <button type="button" onClick={() => setEditor({ ...editor, content: "function main(config) {\n  if (Array.isArray(config.rules)) {\n    config.rules = config.rules.map(function (rule) {\n      if (String(rule).indexOf('example.com') !== -1) {\n        return 'DOMAIN-SUFFIX,example.com,DIRECT';\n      }\n      return rule;\n    });\n  }\n  return config;\n}\n" })}>按关键字替换单条规则</button>
                <button type="button" onClick={() => setEditor({ ...editor, content: "function main(config) {\n  if (Array.isArray(config.proxies)) {\n    config.proxies = config.proxies.map(function (p) {\n      p.name = String(p.name || '').replace(/\\s*\\|\\s*官网.*$/i, '');\n      return p;\n    });\n  }\n  return config;\n}\n" })}>清理节点广告后缀</button>
                <button type="button" onClick={() => setEditor({ ...editor, content: "function main(config) {\n  if (Array.isArray(config.proxies)) {\n    config.proxies = config.proxies.filter(function (p) {\n      return !/过期|剩余流量|官网/i.test(String(p.name || ''));\n    });\n  }\n  return config;\n}\n" })}>过滤提示信息节点</button>
              </div>
            ) : null}
            <Field label={editor.kind === "rule" ? "YAML 内容" : "JavaScript 内容"} hint={editor.kind === "script" ? "脚本必须声明 main(value) 并返回处理结果" : undefined}>
              <textarea className="rw-code-editor" required spellCheck={false} value={editor.content} onChange={(event) => setEditor({ ...editor, content: event.target.value })} />
            </Field>

            <div className="dialog-actions">
              <Button type="button" variant="secondary" onClick={() => setEditor(null)} disabled={saving}>取消</Button>
              <Button type="submit" disabled={saving || !editor.name.trim() || !editor.content.trim()}>{saving ? <Spinner label="正在保存" /> : <><Save size={16} />保存</>}</Button>
            </div>
          </form>
        </Dialog>
      ) : null}

      {deleteTarget ? (
        <ConfirmDialog
          title={deleteTarget.kind === "script" ? "删除覆写脚本" : "删除自定义规则"}
          description={`确认删除“${deleteTarget.item.name}”？引用它的订阅将不再应用这项覆写，此操作无法撤销。`}
          confirmLabel="确认删除"
          working={saving}
          onCancel={() => !saving && setDeleteTarget(null)}
          onConfirm={() => void confirmDelete()}
        />
      ) : null}
    </div>
  );
}

export function RulesConfigWorkbenchPage({ notify = noop }: { notify?: Notify }) {
  const [files, setFiles] = useState<RuleFile[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [document, setDocument] = useState<RuleDocumentEditor | null>(null);
  const [saving, setSaving] = useState(false);
  const [discardDocumentConfirm, setDiscardDocumentConfirm] = useState(false);
  const [historyFile, setHistoryFile] = useState<RuleFile | null>(null);
  const [history, setHistory] = useState<RuleVersion[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [selectedVersion, setSelectedVersion] = useState<RuleVersion | null>(null);
  const documentRequestGeneration = useRef(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await api.get<{ files?: RuleFile[] }>("/api/admin/rules/");
      setFiles(response.files ?? []);
    } catch (reason) {
      setError(errorMessage(reason, "规则文件加载失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => () => {
    documentRequestGeneration.current += 1;
  }, []);

  const visibleFiles = useMemo(() => {
    const query = search.trim().toLowerCase();
    return files.filter((item) => !query || item.name.toLowerCase().includes(query));
  }, [files, search]);

  const documentDirty = Boolean(document && !document.loading && document.content !== document.originalContent);

  const discardDocument = () => {
    documentRequestGeneration.current += 1;
    setDiscardDocumentConfirm(false);
    setDocument(null);
  };

  const requestDocumentClose = () => {
    if (saving) return;
    if (documentDirty) {
      setDiscardDocumentConfirm(true);
      return;
    }
    discardDocument();
  };

  const openDocument = async (file: RuleFile) => {
    const generation = ++documentRequestGeneration.current;
    setDiscardDocumentConfirm(false);
    setDocument({ name: file.name, content: "", originalContent: "", latest_version: file.latest_version, loading: true, error: "" });
    try {
      const response = await api.get<RuleDocument>(`/api/admin/rules/${encodeURIComponent(file.name)}`);
      if (generation !== documentRequestGeneration.current) return;
      setDocument({ ...response, name: file.name, originalContent: response.content, loading: false, error: "" });
    } catch (reason) {
      if (generation !== documentRequestGeneration.current) return;
      setDocument((current) => current ? { ...current, loading: false, error: errorMessage(reason, "规则文件读取失败") } : null);
    }
  };

  const saveDocument = async (event: FormEvent) => {
    event.preventDefault();
    if (!document) return;
    setSaving(true);
    setDocument({ ...document, error: "" });
    try {
      const response = await api.put<{ version: number }>(`/api/admin/rules/${encodeURIComponent(document.name)}`, { content: document.content });
      discardDocument();
      notify(`规则文件已保存为版本 ${response.version || "-"}`);
      await load();
    } catch (reason) {
      setDocument((current) => current ? { ...current, error: errorMessage(reason, "规则文件保存失败") } : null);
    } finally {
      setSaving(false);
    }
  };

  const openHistory = async (file: RuleFile) => {
    setHistoryFile(file);
    setHistory([]);
    setSelectedVersion(null);
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const response = await api.get<{ history?: RuleVersionWire[] }>(`/api/admin/rules/${encodeURIComponent(file.name)}/history`);
      const versions = (response.history ?? []).map(normalizeRuleVersion);
      setHistory(versions);
      setSelectedVersion(versions[0] ?? null);
    } catch (reason) {
      setHistoryError(errorMessage(reason, "版本历史加载失败"));
    } finally {
      setHistoryLoading(false);
    }
  };

  return (
    <div className="rw-page">
      <PageHeader
        title="规则配置"
        description="直接维护已生成的 YAML 订阅文件，并查看不可修改的版本记录"
        actions={<IconButton label="重新加载规则文件" onClick={() => void load()} disabled={loading}><RefreshCw size={18} /></IconButton>}
      />
      <Surface className="table-surface rw-table-surface">
        <div className="surface-heading rw-list-heading">
          <div><h2>YAML 文件</h2><small>{files.length} 个可维护文件</small></div>
          <div className="search-box rw-search"><Search size={17} /><input aria-label="搜索规则文件" placeholder="搜索文件名" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
        </div>
        {loading ? (
          <div className="rw-loading"><Spinner label="正在读取规则目录" /></div>
        ) : error ? (
          <div className="rw-surface-error"><ErrorState message={error} onRetry={() => void load()} /></div>
        ) : visibleFiles.length === 0 ? (
          <EmptyState icon={search ? <Search size={23} /> : <FileText size={23} />} title={search ? "没有匹配的规则文件" : "规则目录中暂无 YAML 文件"} />
        ) : (
          <div className="table-wrap">
            <table className="rw-files-table">
              <thead><tr><th>文件</th><th>大小</th><th>当前版本</th><th>修改时间</th><th aria-label="操作" /></tr></thead>
              <tbody>
                {visibleFiles.map((file) => (
                  <tr key={file.name}>
                    <td><div className="rw-name"><span className="rw-file-icon"><FileText size={17} /></span><span><strong>{file.name}</strong><small>YAML 配置文件</small></span></div></td>
                    <td>{formatBytes(file.size)}</td>
                    <td>{file.latest_version > 0 ? <Badge tone="info">v{file.latest_version}</Badge> : <Badge>未归档</Badge>}</td>
                    <td><span className="rw-date"><Clock3 size={14} />{formatDate(file.mod_time)}</span></td>
                    <td><div className="rw-actions"><Button variant="ghost" onClick={() => void openHistory(file)}><History size={15} />历史</Button><Button variant="secondary" onClick={() => void openDocument(file)}><Pencil size={15} />编辑</Button></div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Surface>

      {document ? (
        <Dialog title={`编辑 ${document.name}`} description={`当前归档版本：${document.latest_version > 0 ? `v${document.latest_version}` : "暂无"}`} onClose={requestDocumentClose} wide dismissible={!saving}>
          {document.loading ? <div className="rw-loading rw-dialog-loading"><Spinner label="正在读取文件" /></div> : (
            <form className="rw-editor-form" onSubmit={saveDocument}>
              {document.error ? <ErrorState message={document.error} /> : null}
              <Field label="YAML 内容" hint={documentDirty ? "存在未保存修改；保存时服务端会校验 YAML 语法并创建历史版本" : "保存时服务端会校验 YAML 语法并自动创建历史版本"}>
                <textarea aria-label="YAML 内容" className="rw-code-editor rw-rule-file-editor" required spellCheck={false} value={document.content} onChange={(event) => setDocument({ ...document, content: event.target.value })} />
              </Field>
              <div className="dialog-actions"><Button type="button" variant="secondary" onClick={requestDocumentClose} disabled={saving}>取消</Button><Button type="submit" disabled={saving || !documentDirty || !document.content.trim()}>{saving ? <Spinner label="正在保存" /> : <><Save size={16} />保存新版本</>}</Button></div>
            </form>
          )}
        </Dialog>
      ) : null}

      {discardDocumentConfirm ? (
        <ConfirmDialog
          title="丢弃未保存的规则文件修改"
          description="当前 YAML 修改尚未保存。继续关闭将丢弃这些修改。"
          confirmLabel="丢弃修改"
          working={false}
          onCancel={() => setDiscardDocumentConfirm(false)}
          onConfirm={discardDocument}
        />
      ) : null}

      {historyFile ? (
        <Dialog title={`${historyFile.name} 版本历史`} description="历史版本只读，不会覆盖当前文件" onClose={() => setHistoryFile(null)} wide>
          {historyError ? <ErrorState message={historyError} /> : null}
          {historyLoading ? <div className="rw-loading rw-dialog-loading"><Spinner label="正在读取版本历史" /></div> : history.length === 0 ? (
            <EmptyState icon={<History size={23} />} title="暂无历史版本" description="首次保存文件后会创建版本记录" />
          ) : (
            <div className="rw-history-layout">
              <div className="rw-history-list" role="list" aria-label="历史版本">
                {history.map((version) => (
                  <button key={version.version} type="button" role="listitem" className={selectedVersion?.version === version.version ? "is-active" : ""} onClick={() => setSelectedVersion(version)}>
                    <span><strong>版本 {version.version}</strong><small>{version.createdBy}</small></span>
                    <time>{formatDate(version.createdAt)}</time>
                  </button>
                ))}
              </div>
              <div className="rw-history-preview">
                <div><ShieldCheck size={15} /><strong>只读内容</strong><Badge tone="info">v{selectedVersion?.version}</Badge></div>
                <pre>{selectedVersion?.content}</pre>
              </div>
            </div>
          )}
        </Dialog>
      ) : null}
    </div>
  );
}
