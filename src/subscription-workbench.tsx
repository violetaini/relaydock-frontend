import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { ArrowLeft, ArrowRight, Check, ChevronDown, Copy, Eye, FileInput, Layers, Link2, MoreHorizontal, Pencil, Plus, RefreshCw, Search, Settings2, ShieldCheck, SlidersHorizontal, Trash2, X } from "lucide-react";
import { createPortal } from "react-dom";
import { api } from "./api";
import { Badge, Button, ConfirmDialog, Dialog, EmptyState, ErrorState, Field, IconButton, PageHeader, Spinner, Surface, Toggle } from "./ui";
import type { ContentPageProps, CustomRuleOption, NodeItem, OverrideScriptOption, SubscribeFile } from "./content-workbench";
import ruleCategories from "./subscription-rule-categories.json";
import "./subscription-workbench.css";

type Kind = "external" | "custom" | "strategy";
export interface SubscriptionOutput { client: string; mode: "full" | "source" | "nodes"; template_filename?: string; rule_mode?: "template" | "custom"; rule_categories?: string[] }
export interface SubscriptionGeneration {
  kind: Kind;
  source_ids: number[];
  processing: { deduplicate: boolean; remove_dead: boolean; include?: string; exclude?: string; exclude_types?: string[]; sort?: string };
  outputs: SubscriptionOutput[];
}
interface Preview { input: number; duplicate: number; filtered: number; dead: number; unknown: number; output: number; warnings: string[]; content: string; client: string; outputs?: Preview[] }
type ImportProps = { templates: string[]; rules: CustomRuleOption[]; scripts: OverrideScriptOption[]; onClose: (created: boolean) => void; onComplete: () => void };
type ManagerProps = ContentPageProps & {
  ImportDialog: ComponentType<ImportProps>;
  ContentDialog: ComponentType<{ item: SubscribeFile; onClose: () => void; onComplete: () => void }>;
};
const kindLabel: Record<Kind, string> = { external: "外部订阅", custom: "自选订阅", strategy: "策略订阅" };
export function subscriptionKind(file: SubscribeFile): Kind {
  if (file.generation) return file.generation.kind;
  if (file.kind) return file.kind;
  if (/^\[策略[订訂][阅閱]\]/.test(file.description || "")) return "strategy";
  return file.url || ["import", "upload"].includes(file.type) ? "external" : "custom";
}
const clients = [
  { id: "clashmeta", name: "Clash Meta / Mihomo", full: true },
  { id: "clash-to-shadowrocket", name: "Shadowrocket 小火箭", full: true },
  { id: "v2ray", name: "v2rayN / v2rayNG", full: false },
  { id: "sing-box", name: "sing-box", full: true },
  { id: "clash-to-surge", name: "Surge", full: true },
  { id: "clash-to-loon", name: "Loon", full: true },
];
const clientName = (id: string) => clients.find(c => c.id === id)?.name || (id === "shadowrocket" ? "小火箭 · 仅节点" : id === "uri" ? "URI 节点" : id);
const message = (reason: unknown) => reason instanceof Error ? reason.message : "操作失败，请重试";
const noNotify = () => {};
const builtinTemplate = "__relaydock_balanced__";
const templateName = (name?: string) => name === builtinTemplate ? "通用分流 · 跨客户端" : name || "";
function safeFilename(value: string) { const name = value.trim(); return /\.ya?ml$/i.test(name) ? name : `${name}.yaml`; }
function intervalLabel(value?: number) { return value ? `每 ${value >= 86400 ? `${value / 86400} 天` : `${value / 3600} 小时`}更新` : "手动更新"; }

const defaultRuleKeys = ruleCategories.filter(category => category.default).map(category => category.key);

function RuleCategoryPicker({ selected, onChange }: { selected: string[]; onChange: (keys: string[]) => void }) {
  return <div className="sm-category-picker"><div className="sm-category-heading"><div><strong>规则分类</strong><small>已选 {selected.length} 个分类</small></div><div><Button variant="ghost" onClick={() => onChange([...defaultRuleKeys])}>恢复均衡规则</Button><Button variant="ghost" onClick={() => onChange([])}>清空分类</Button></div></div><div className="sm-rule-grid">{ruleCategories.map(category => <button type="button" key={category.key} className={`sm-rule-category ${selected.includes(category.key) ? "is-selected" : ""}`} aria-pressed={selected.includes(category.key)} onClick={() => onChange(selected.includes(category.key) ? selected.filter(key => key !== category.key) : [...selected, category.key])}><span aria-hidden="true">{category.emoji}</span><span>{category.label}</span>{selected.includes(category.key) && <Check size={13} aria-hidden="true" />}</button>)}</div><p className="sm-hint">按分类顺序匹配，未命中的流量走代理；分类随订阅保存，来源节点更新后自动重新生成。</p></div>;
}

export function SubscriptionOutputRules({ out, index, templates, onChange, onManageTemplates }: { out: SubscriptionOutput; index: number; templates: string[]; onChange: (value: Partial<SubscriptionOutput>) => void; onManageTemplates?: () => void }) {
  const custom = out.rule_mode === "custom";
  const templateField = <Field label={out.client === "v2ray" ? "独立路由模板" : `规则模板${index ? ` ${index + 1}` : ""}`} hint="按目标客户端转换，并在预览中验证。"><select value={out.template_filename || ""} onChange={event => onChange({ template_filename: event.target.value })}><option value="">请选择模板</option>{templates.map(template => <option value={template} key={template}>{templateName(template)}</option>)}</select></Field>;
  const categories = <RuleCategoryPicker selected={out.rule_categories || []} onChange={keys => onChange({ rule_categories: keys })} />;
  if (out.client === "v2ray") return <><p className="sm-client-hint">普通 URI / Base64 订阅仅携带节点；路由可单独导出，不嵌入节点订阅。</p><Field label="独立路由（可选）"><select value={custom ? "custom" : out.template_filename ? "template" : "none"} onChange={event => event.target.value === "none" ? onChange({ rule_mode: "template", template_filename: "" }) : onChange({ rule_mode: event.target.value as "template" | "custom", rule_categories: out.rule_categories ?? [...defaultRuleKeys], template_filename: out.template_filename || templates[0] || "" })}><option value="none">不导出路由</option><option value="custom">自定义规则</option><option value="template">使用模板</option></select></Field>{custom ? categories : out.template_filename ? templateField : null}</>;
  if (out.mode !== "full") return null;
  return <div className="sm-output-rules"><div className="sm-rule-mode" role="tablist" aria-label={`规则模式 ${index + 1}`}><button type="button" role="tab" aria-selected={custom} onClick={() => onChange({ rule_mode: "custom", rule_categories: out.rule_categories ?? [...defaultRuleKeys] })}><SlidersHorizontal size={15} />自定义规则</button><button type="button" role="tab" aria-selected={!custom} onClick={() => onChange({ rule_mode: "template", template_filename: out.template_filename || templates[0] || "" })}><FileInput size={15} />使用模板</button></div>{custom ? categories : <div className="sm-template-field">{templateField}{!templates.length && <Button variant="ghost" onClick={onManageTemplates}>管理规则模板</Button>}</div>}</div>;
}

function SubscriptionCopyButton({ file, disabled, onCopy }: { file: SubscribeFile; disabled: boolean; onCopy: (client?: string) => void }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 260 });
  const anchor = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const outputs = file.generation?.outputs || [];
  const multiple = outputs.length > 1;
  const updatePosition = useCallback(() => {
    if (!anchor.current || !menu.current) return;
    const bounds = anchor.current.getBoundingClientRect();
    if (bounds.bottom < 0 || bounds.top > window.innerHeight || bounds.right < 0 || bounds.left > window.innerWidth) { setOpen(false); return; }
    const width = Math.min(260, window.innerWidth - 16);
    const height = menu.current.getBoundingClientRect().height;
    const below = bounds.bottom + 6;
    setPosition({ width, left: Math.max(8, Math.min(bounds.right - width, window.innerWidth - width - 8)), top: Math.max(8, below + height <= window.innerHeight - 8 ? below : bounds.top - height - 6) });
  }, []);
  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    menu.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [open, updatePosition]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!anchor.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false); };
    const keyboard = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); setOpen(false); anchor.current?.querySelector("button")?.focus(); } };
    const scroll = (event: Event) => { if (!menu.current?.contains(event.target as Node)) updatePosition(); };
    const resize = () => updatePosition();
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", keyboard);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", resize);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", keyboard); window.removeEventListener("scroll", scroll, true); window.removeEventListener("resize", resize); };
  }, [open, updatePosition]);
  return <div className="sm-copy-action" ref={anchor}>
    <IconButton label={`复制订阅链接 ${file.name}`} disabled={disabled} aria-haspopup={multiple ? "menu" : undefined} aria-expanded={multiple ? open : undefined} className={multiple ? "sm-copy-multiple" : ""} onClick={() => multiple ? setOpen(value => !value) : onCopy(outputs[0]?.client)}><Copy size={16} />{multiple && <ChevronDown size={11} />}</IconButton>
    {open && createPortal(<div ref={menu} className="sm-menu sm-copy-menu" role="menu" aria-label={`选择要复制的客户端 ${file.name}`} style={position} onKeyDown={event => {
      if (event.key === "Tab") { setOpen(false); return; }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>("button") || []);
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length;
      items[next]?.focus();
    }}>{outputs.map(out => <button key={out.client} type="button" role="menuitem" onClick={() => { setOpen(false); onCopy(out.client); anchor.current?.querySelector("button")?.focus(); }}><Copy size={14} /><span>{clientName(out.client)}</span></button>)}</div>, document.body)}
  </div>;
}

export function SubscriptionManager({ notify = noNotify, isAdmin = true, onOpenRulesConfig, onOpenCustomRules, ImportDialog, ContentDialog }: ManagerProps) {
  const [tab, setTab] = useState<"all" | Kind>("all");
  const [search, setSearch] = useState("");
  const [files, setFiles] = useState<SubscribeFile[]>([]);
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [templates, setTemplates] = useState<string[]>([]);
  const [rules, setRules] = useState<CustomRuleOption[]>([]);
  const [scripts, setScripts] = useState<OverrideScriptOption[]>([]);
  const [token, setToken] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [wizard, setWizard] = useState<{ kind: Kind; file?: SubscribeFile; sourceIDs?: number[] } | null>(null);
  const [content, setContent] = useState<SubscribeFile | null>(null);
  const [pending, setPending] = useState<SubscribeFile | null>(null);
  const [linkFile, setLinkFile] = useState<SubscribeFile | null>(null);
  const [linksVisible, setLinksVisible] = useState(false);
  const load = useCallback(async () => {
    setError(""); setWarning("");
    const results = await Promise.allSettled([
      api.get<{ files?: SubscribeFile[] }>("/api/admin/subscribe-files"),
      api.get<{ nodes?: NodeItem[] }>("/api/admin/nodes"),
      api.get<{ templates?: string[] }>("/api/admin/rule-templates"),
      api.get<{ token?: string }>("/api/user/token"),
      api.get<CustomRuleOption[]>("/api/admin/custom-rules"),
      api.get<OverrideScriptOption[]>("/api/admin/override-scripts"),
    ]);
    if (results[0].status === "fulfilled") {
      const next = results[0].value.files || []; setFiles(next);
      setSelected(current => current.filter(id => next.some(file => file.id === id && subscriptionKind(file) !== "strategy")));
    } else setError(message(results[0].reason));
    if (results[1].status === "fulfilled") setNodes(results[1].value.nodes || []);
    if (results[2].status === "fulfilled") setTemplates([builtinTemplate, ...(results[2].value.templates || []).filter(name => name !== builtinTemplate)]);
    if (results[3].status === "fulfilled") setToken(results[3].value.token || "");
    if (results[4].status === "fulfilled") setRules(results[4].value || []);
    if (results[5].status === "fulfilled") setScripts(results[5].value || []);
    const labels = ["节点", "模板", "订阅令牌", "覆写规则", "脚本"];
    const missing = results.slice(1).flatMap((result, i) => result.status === "rejected" ? [`${labels[i]}加载失败`] : []);
    if (missing.length) setWarning(`${missing.join("、")}；已有订阅仍可查看，请刷新后再创建。`);
    setLoading(false);
  }, [isAdmin]);
  useEffect(() => { void load(); }, [load]);
  const visible = useMemo(() => files.filter(file => (tab === "all" || subscriptionKind(file) === tab) && `${file.name} ${file.filename} ${file.template_filename || ""}`.toLowerCase().includes(search.toLowerCase())), [files, tab, search]);
  const selectable = visible.filter(file => subscriptionKind(file) !== "strategy");
  const allSelected = selectable.length > 0 && selectable.every(file => selected.includes(file.id));
  const toggle = (id: number) => setSelected(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  const create = (kind: Kind) => kind === "external" ? setShowImport(true) : setWizard({ kind, sourceIDs: kind === "strategy" ? selected : [] });
  const run = async (work: () => Promise<unknown>, success: string) => { setBusy(true); setError(""); try { await work(); notify(success); await load(); } catch (reason) { setError(message(reason)); } finally { setBusy(false); } };
  const downloadRoutes = async (file: SubscribeFile) => {
    setBusy(true); setError("");
    try {
      const routing = await api.get<unknown>(`/api/admin/subscribe-files/${file.id}/routes`);
      const url = URL.createObjectURL(new Blob([JSON.stringify(routing, null, 2)], { type: "application/json" }));
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = "routing.json"; anchor.click(); URL.revokeObjectURL(url);
    } catch (reason) { setError(message(reason)); } finally { setBusy(false); }
  };
  const link = (file: SubscribeFile, client?: string) => {
    if (!token) return "";
    const query = new URLSearchParams({ filename: file.filename, token }); if (client) query.set("t", client);
    return `${window.location.origin}/api/clash/subscribe?${query}`;
  };
  if (loading) return <section className="subscription-manager"><PageHeader title="订阅管理" /><div className="cw-loading"><Spinner label="正在加载订阅" /></div></section>;
  return <section className="subscription-manager">
    <PageHeader title="订阅管理" description="导入外部来源，选择自建节点，按策略组合交付。" actions={<div className="sm-header-actions">
      {(["external", "custom", "strategy"] as Kind[]).map(kind => <Button key={kind} variant={(tab === "all" ? kind === "external" : tab === kind) ? "primary" : "secondary"} onClick={() => create(kind)}><Plus size={16} />{kind === "external" ? "添加外部订阅" : kind === "custom" ? "创建自选订阅" : "创建策略订阅"}</Button>)}
    </div>} />
    {error && !pending && !linkFile && <ErrorState message={error} onRetry={() => void load()} />}
    {warning && <div className="sm-notice" role="status">{warning}</div>}
    <Surface className="sm-list-surface">
      <div className="sm-list-toolbar"><div className="sm-tabs" role="tablist" aria-label="订阅分类">
        {(["all", "external", "custom", "strategy"] as const).map(kind => <button key={kind} type="button" role="tab" aria-selected={tab === kind} className={tab === kind ? "is-active" : ""} onClick={() => setTab(kind)}>{kind === "all" ? "全部订阅" : kindLabel[kind]}<span>{files.filter(file => kind === "all" || subscriptionKind(file) === kind).length}</span></button>)}
      </div><div className="sm-search"><Search size={16} /><input type="search" aria-label="搜索订阅" placeholder="搜索名称或模板" value={search} onChange={event => setSearch(event.target.value)} /><IconButton label="刷新订阅列表" disabled={busy} onClick={() => void load()}><RefreshCw size={15} /></IconButton></div></div>
      {selected.length > 0 && <div className="sm-selection-bar"><span>已选 <strong>{selected.length}</strong> 个来源</span><div><Button variant="ghost" onClick={() => setSelected([])}>取消选择</Button><Button onClick={() => create("strategy")}><Layers size={15} />用所选来源创建策略</Button></div></div>}
      {loading ? <div className="cw-loading"><Spinner /></div> : visible.length === 0 ? <EmptyState icon={<Layers size={24} />} title={search ? "未找到匹配的订阅" : "还没有订阅"} description={search ? "试试其他名称或模板。" : "从导入一个来源或选择面板节点开始。"} action={!search ? <Button onClick={() => create(tab === "all" ? "external" : tab)}><Plus size={16} />{tab === "all" || tab === "external" ? "添加外部订阅" : `创建${kindLabel[tab]}`}</Button> : undefined} /> : <div className="sm-table-wrap"><table className="sm-table"><thead><tr><th className="sm-select"><input type="checkbox" aria-label="选择全部可用来源" checked={allSelected} disabled={!selectable.length} onChange={() => setSelected(current => allSelected ? current.filter(id => !selectable.some(file => file.id === id)) : [...new Set([...current, ...selectable.map(file => file.id)])])} /></th><th>订阅</th><th>来源 / 更新</th><th>规则与输出</th><th className="sm-action-cell">操作</th></tr></thead><tbody>
        {visible.map(file => { const kind = subscriptionKind(file); const outputs = file.generation?.outputs || []; const sourceNames = (file.generation?.source_ids || []).map(id => files.find(source => source.id === id)?.name || "来源已移除");
          return <tr key={file.id}><td className="sm-select">{kind !== "strategy" && <input type="checkbox" aria-label={`选择来源 ${file.name}`} checked={selected.includes(file.id)} onChange={() => toggle(file.id)} />}</td><td><div className="sm-file-name"><span>{file.name}</span><Badge tone={kind === "strategy" ? "warn" : kind === "custom" ? "good" : "info"}>{kindLabel[kind]}</Badge></div><small>{file.filename}</small></td><td><span>{kind === "strategy" ? sourceNames.length ? sourceNames.join(" + ") : "旧版组合 · 请重新绑定来源" : kind === "external" ? file.url ? "URL 导入" : "本地导入" : `${file.selected_node_ids?.length || 0} 个面板节点`}</span><small>{kind === "external" ? intervalLabel(file.auto_update_interval) : "配置变更自动跟随"}</small></td><td><span>{outputs[0] ? outputs[0].mode === "source" ? "保留上游规则" : outputs[0].mode === "nodes" ? "仅节点" : outputs[0].rule_mode === "custom" ? `自定义规则 · ${outputs[0].rule_categories?.length || 0} 个分类` : templateName(outputs[0].template_filename) : file.template_filename || (kind === "external" ? "原始配置" : "未绑定模板")}</span><small>{outputs.length ? outputs.map(out => clientName(out.client)).join(" · ") : "可配置客户端输出"}</small></td><td className="sm-action-cell"><div className="sm-row-actions"><SubscriptionCopyButton file={file} disabled={!token} onCopy={client => { setError(""); void (async () => { try { await navigator.clipboard.writeText(link(file, client)); notify(client ? `${clientName(client)} 订阅链接已复制` : "订阅链接已复制"); } catch (reason) { setError(message(reason)); } })(); }} /><IconButton label={`编辑 ${file.name}`} onClick={() => setWizard({ kind, file })}><Pencil size={16} /></IconButton><details className="sm-more" onToggle={event => { const menu = event.currentTarget; if (menu.open) { const bounds = menu.getBoundingClientRect(); menu.style.setProperty("--sm-menu-top", `${Math.max(8, Math.min(bounds.bottom + 6, window.innerHeight - 240))}px`); menu.style.setProperty("--sm-menu-left", `${Math.max(8, bounds.right - 200)}px`); } }}><summary aria-label={`更多操作 ${file.name}`}><MoreHorizontal size={18} /></summary><div className="sm-menu"><button type="button" disabled={!token} onClick={() => { setLinksVisible(false); setLinkFile(file); }}><Link2 size={15} />客户端订阅链接</button>{file.url && <button type="button" aria-label={`立即同步 ${file.name}`} disabled={busy} onClick={() => void run(() => api.post(`/api/admin/subscribe-files/${file.id}/sync`), `“${file.name}”外部订阅同步成功`)}><RefreshCw size={15} />立即同步</button>}<button type="button" onClick={() => setContent(file)}><Eye size={15} />查看原始配置</button><button type="button" aria-label={`${file.auto_sync_custom_rules ? "关闭" : "开启"} ${file.name} 自动同步`} disabled={busy} onClick={() => void run(() => api.put(`/api/admin/subscribe-files/${file.id}`, { ...file, auto_sync_custom_rules: !file.auto_sync_custom_rules }), "覆写规则同步设置已更新")}><RefreshCw size={15} />{file.auto_sync_custom_rules ? "关闭" : "开启"}规则同步</button><button type="button" className="sm-danger" onClick={() => setPending(file)}><Trash2 size={15} />删除订阅</button></div></details></div></td></tr>;
        })}
      </tbody></table></div>}
      <div className="sm-list-footer"><small>{visible.length} 个订阅{tab === "strategy" ? " · 单个来源也可以创建策略" : " · 可勾选外部、自选订阅组合"}</small><div>{onOpenRulesConfig && <Button variant="ghost" onClick={onOpenRulesConfig}>管理规则模板</Button>}{onOpenCustomRules && <Button variant="ghost" onClick={onOpenCustomRules}>覆写规则</Button>}</div></div>
    </Surface>
    {showImport && <ImportDialog templates={templates} rules={rules} scripts={scripts} onClose={created => { setShowImport(false); if (created) { notify("订阅已导入，但高级设置尚未保存", "error"); void load(); } }} onComplete={() => { setShowImport(false); notify("外部订阅已添加"); void load(); }} />}
    {wizard && <SubscriptionWizard {...wizard} isAdmin={isAdmin} files={files} nodes={nodes} templates={templates} onClose={() => setWizard(null)} onSaved={() => { const kind = wizard.kind; setWizard(null); setTab(kind); setSelected([]); notify("订阅配置已保存"); void load(); }} onManageTemplates={onOpenRulesConfig} />}
    {content && <ContentDialog item={content} onClose={() => setContent(null)} onComplete={() => { setContent(null); void load(); }} />}
    {pending && <ConfirmDialog title="删除订阅" description={`删除“${pending.name}”后，引用它的策略订阅需要重新选择来源；原有链接将失效。`} confirmLabel="删除" tone="danger" working={busy} error={error} onCancel={() => setPending(null)} onConfirm={() => void run(async () => { await api.delete(`/api/admin/subscribe-files/${pending.id}`); setPending(null); }, "订阅已删除")} />}
    {linkFile && <Dialog title={`${linkFile.name} · 订阅链接`} description="同一订阅按客户端生成配置，来源更新后链接保持不变。" onClose={() => setLinkFile(null)} wide><div className="sm-link-list">{error && <ErrorState message={error} />}{(linkFile.generation?.outputs.length ? linkFile.generation.outputs : [{ client: "clashmeta", mode: "full" }, { client: "v2ray", mode: "nodes" }]).map(out => <div key={out.client}><strong>{clientName(out.client)}</strong><div className="sm-link-line"><input aria-label={`${clientName(out.client)}订阅地址`} type={linksVisible ? "text" : "password"} readOnly value={link(linkFile, out.client)} /><IconButton label={`复制 ${clientName(out.client)} 链接`} onClick={() => { void navigator.clipboard.writeText(link(linkFile, out.client)).then(() => notify("链接已复制")); }}><Copy size={16} /></IconButton></div></div>)}{linkFile.generation?.outputs.some(out => out.client === "v2ray") && <div className="sm-route-download"><Button variant="secondary" disabled={busy} onClick={() => void downloadRoutes(linkFile)}>导出 Xray 路由 JSON</Button><p className="sm-hint">路由需在客户端单独导入。策略组映射为 proxy，直连为 direct，拦截为 block。</p></div>}<Button variant="ghost" onClick={() => setLinksVisible(value => !value)}>{linksVisible ? "隐藏链接" : "显示链接"}</Button></div></Dialog>}
  </section>;
}

interface WizardProps { kind: Kind; file?: SubscribeFile; sourceIDs?: number[]; files: SubscribeFile[]; nodes: NodeItem[]; templates: string[]; isAdmin?: boolean; onClose: () => void; onSaved: () => void; onManageTemplates?: () => void }
export function SubscriptionWizard({ kind, file, sourceIDs = [], files, nodes, templates, isAdmin = true, onClose, onSaved, onManageTemplates }: WizardProps) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState(file?.name || "");
  const [filename, setFilename] = useState(file?.filename || "");
  const [selectedSources, setSelectedSources] = useState<number[]>(file?.generation?.source_ids || sourceIDs);
  const [selectedNodes, setSelectedNodes] = useState<number[]>(file?.selected_node_ids || []);
  const [query, setQuery] = useState("");
  const [processing, setProcessing] = useState<SubscriptionGeneration["processing"]>(file?.generation?.processing || { deduplicate: true, remove_dead: false, sort: "source" });
  const [outputs, setOutputs] = useState<SubscriptionOutput[]>(file?.generation?.outputs || [{ client: "clashmeta", mode: kind === "external" ? "source" : templates.length ? "full" : "nodes", template_filename: file?.template_filename || templates[0] || "" }]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [showCode, setShowCode] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const requestVersion = useRef(0);
  const titles = kind === "strategy" ? ["选择来源", "节点处理", "客户端与规则", "预览保存"] : kind === "custom" ? ["选择节点", "客户端与规则", "预览保存"] : ["客户端与规则", "预览保存"];
  const outputStep = titles.length - 2; const lastStep = titles.length - 1;
  const candidates = files.filter(source => source.id !== file?.id && subscriptionKind(source) !== "strategy");
  const selectedSourceFiles = candidates.filter(source => selectedSources.includes(source.id));
  const canInherit = kind === "external" || kind === "strategy" && selectedSources.length === 1 && selectedSourceFiles.length === 1 && subscriptionKind(selectedSourceFiles[0]) === "external";
  const generation = (): SubscriptionGeneration => ({ kind, source_ids: kind === "strategy" ? selectedSources : [], processing, outputs: outputs.map(out => ({ ...out, mode: out.mode === "source" && !canInherit ? "nodes" : out.mode })) });
  const payload = () => ({ ...(file ? { id: file.id } : {}), name: name.trim(), description: file?.description || "", filename: safeFilename(filename || name || "subscription"), selected_node_ids: kind === "custom" ? selectedNodes : [], generation: generation() });
  const toggleID = (id: number, selected: number[], change: (next: number[]) => void) => change(selected.includes(id) ? selected.filter(value => value !== id) : [...selected, id]);
  const invalidate = () => { requestVersion.current += 1; setPreview(null); setError(""); };
  const setOutput = (index: number, next: Partial<SubscriptionOutput>) => { invalidate(); setOutputs(current => current.map((out, i) => i === index ? { ...out, ...next } : out)); };
  const retainedNodeIDs = new Set(file?.selected_node_ids || []);
  const validSelection = kind === "strategy" ? selectedSources.length > 0 && selectedSourceFiles.length === selectedSources.length : kind === "custom" ? selectedNodes.length > 0 && selectedNodes.every(id => retainedNodeIDs.has(id) || nodes.some(node => node.id === id && node.enabled && node.subscription_eligible !== false)) : true;
  const outputsValid = outputs.length > 0 && outputs.every(out => out.mode !== "full" || out.rule_mode === "custom" || Boolean(out.template_filename));
  useEffect(() => { if (!canInherit) setOutputs(current => current.map(out => out.mode === "source" ? { ...out, mode: templates.length ? "full" : "nodes", template_filename: out.template_filename || templates[0] || "" } : out)); }, [canInherit, templates]);
  const next = async () => {
    setError("");
    if (!validSelection) { setError(kind === "strategy" ? "请至少选择一个可用的来源订阅" : "请选择可按用户统计的节点，并取消不支持的节点"); return; }
    if (step < outputStep) { setStep(value => value + 1); return; }
    if (!outputsValid) { setError("请选择自定义规则、规则模板，或改为仅输出节点"); return; }
    setBusy(true); const version = ++requestVersion.current;
    try { const result = await api.post<Preview>("/api/admin/subscribe-files/generation/preview", payload()); if (version === requestVersion.current) { setPreview(result); setPreviewIndex(0); setStep(lastStep); } }
    catch (reason) { if (version === requestVersion.current) setError(message(reason)); }
    finally { setBusy(false); }
  };
  const save = async () => {
    if (!name.trim()) { setError("请输入订阅名称"); return; }
    if (!preview) { setError("请先预览当前配置"); return; }
    setBusy(true); setError("");
    try { await api.post("/api/admin/subscribe-files/generation", payload()); onSaved(); }
    catch (reason) { setError(message(reason)); }
    finally { setBusy(false); }
  };
  const filteredNodes = nodes.filter(node => `${node.node_name} ${node.protocol}`.toLowerCase().includes(query.toLowerCase()));
  return <Dialog title={`${file ? "编辑" : "创建"}${kindLabel[kind]}`} description={kind === "strategy" ? "选择来源与处理方式，自动跟随来源更新。" : kind === "custom" ? "使用面板节点创建订阅，配置变更自动同步。" : "保留导入原文，为不同客户端配置输出方式。"} onClose={onClose} wide dismissible={!busy}>
    <fieldset className="sm-wizard" disabled={busy}><ol className="sm-steps" aria-label="订阅创建步骤">{titles.map((title, index) => <li key={title} className={step === index ? "is-active" : index < step ? "is-done" : ""}><button type="button" disabled={busy || index > step} onClick={() => { setStep(index); setError(""); }} aria-current={step === index ? "step" : undefined}><span>{index < step ? <Check size={13} /> : index + 1}</span>{title}</button></li>)}</ol>
    {error && <ErrorState message={error} />}
    {kind === "strategy" && step === 0 && <><div className="sm-picker-header"><span>已选 <strong>{selectedSources.length}</strong> 个来源</span><div className="sm-search"><Search size={15} /><input type="search" aria-label="搜索订阅来源" placeholder="搜索外部、自选订阅" value={query} onChange={e => setQuery(e.target.value)} /></div></div><div className="sm-source-grid">{candidates.filter(source => source.name.toLowerCase().includes(query.toLowerCase())).map(source => <label key={source.id} className={`sm-source ${selectedSources.includes(source.id) ? "is-selected" : ""}`}><input type="checkbox" aria-label={`绑定来源 ${source.name}`} checked={selectedSources.includes(source.id)} onChange={() => { invalidate(); toggleID(source.id, selectedSources, setSelectedSources); }} /><span><strong>{source.name}</strong><small>{kindLabel[subscriptionKind(source)]} · {source.url ? intervalLabel(source.auto_update_interval) : source.filename}</small></span></label>)}</div>{!candidates.length && <EmptyState icon={<FileInput size={24} />} title="暂无可用来源" description="请先添加外部订阅或创建自选订阅。" />}<p className="sm-hint">单个来源也可以创建策略。来源更新后，处理结果自动跟随。</p></>}
    {kind === "custom" && step === 0 && <><div className="sm-picker-header"><span>已选 <strong>{selectedNodes.length}</strong> 个节点</span><div className="sm-search"><Search size={15} /><input type="search" aria-label="搜索面板节点" placeholder="搜索名称或协议" value={query} onChange={e => setQuery(e.target.value)} /></div></div><div className="sm-picker-shortcuts"><Button variant="ghost" onClick={() => { invalidate(); setSelectedNodes([...new Set([...selectedNodes, ...filteredNodes.filter(node => node.enabled && node.subscription_eligible !== false).map(node => node.id)])]); }}>选择可用节点</Button><Button variant="ghost" onClick={() => { invalidate(); setSelectedNodes([]); }}>清空选择</Button>{selectedNodes.some(id => nodes.some(node => node.id === id && node.subscription_eligible === false)) && <Button variant="ghost" onClick={() => { invalidate(); setSelectedNodes(selectedNodes.filter(id => nodes.some(node => node.id === id && node.enabled && node.subscription_eligible !== false))); }}>移除不可统计节点</Button>}</div><div className="sm-source-grid">{filteredNodes.map(node => <label className={`sm-source ${selectedNodes.includes(node.id) ? "is-selected" : ""}`} key={node.id}><input type="checkbox" aria-label={`选择节点 ${node.node_name}`} disabled={(!node.enabled || node.subscription_eligible === false) && !selectedNodes.includes(node.id) && !retainedNodeIDs.has(node.id)} checked={selectedNodes.includes(node.id)} onChange={() => { invalidate(); toggleID(node.id, selectedNodes, setSelectedNodes); }} /><span><strong>{node.node_name}</strong><small>{node.protocol} · {!node.enabled ? "已停用" : node.subscription_eligible === false ? node.subscription_ineligible_reason || "无法按用户统计" : "支持按用户统计"}</small></span></label>)}</div></>}
    {kind === "strategy" && step === 1 && <div className="sm-processing"><div className="sm-process-toggle"><div><strong>自动去重</strong><p>按完整连接配置去重，名称不同也能识别。</p></div><Toggle checked={processing.deduplicate} onChange={value => { invalidate(); setProcessing(current => ({ ...current, deduplicate: value })); }} label="自动去重" /></div><div className="sm-process-toggle"><div><strong>自动剔除失效节点</strong><p>面板经真实代理协议检测，连续失败 3 次后暂时移出；恢复后重新加入。</p></div><Toggle checked={processing.remove_dead} onChange={value => { invalidate(); setProcessing(current => ({ ...current, remove_dead: value })); }} label="自动剔除失效节点" /></div><div className="sm-notice"><ShieldCheck size={17} /><span>未检测、过期结果及无法检测的节点保留。全部失败时不清空订阅。检测位置：面板服务器；需要已有 Mihomo 核心。</span></div><div className="sm-form-grid"><Field label="节点排序"><select value={processing.sort || "source"} onChange={e => { invalidate(); setProcessing(current => ({ ...current, sort: e.target.value })); }}><option value="source">按来源顺序</option><option value="name">按节点名称</option></select></Field><Field label="排除名称" hint="可选，支持正则表达式"><input value={processing.exclude || ""} placeholder="到期|剩余流量|官网" onChange={e => { invalidate(); setProcessing(current => ({ ...current, exclude: e.target.value })); }} /></Field></div><details className="sm-advanced"><summary>更多节点过滤<ChevronDown size={14} /></summary><div className="sm-form-grid"><Field label="仅保留名称"><input value={processing.include || ""} placeholder="香港|HK" onChange={e => { invalidate(); setProcessing(current => ({ ...current, include: e.target.value })); }} /></Field><Field label="排除协议" hint="逗号分隔，例如 ss, vmess"><input value={(processing.exclude_types || []).join(", ")} onChange={e => { invalidate(); setProcessing(current => ({ ...current, exclude_types: e.target.value.split(",").map(t => t.trim()).filter(Boolean) })); }} /></Field></div></details></div>}
    {step === outputStep && <div className="sm-output-list">{outputs.map((out, index) => <section className="sm-output" key={index} aria-label={`客户端输出 ${index + 1}`}><div className="sm-output-heading"><strong>{index === 0 ? "默认客户端" : "附加客户端"}</strong>{index > 0 && <IconButton label={`移除客户端 ${index + 1}`} onClick={() => { invalidate(); setOutputs(current => current.filter((_, i) => i !== index)); }}><X size={15} /></IconButton>}</div><div className="sm-form-grid"><Field label={`输出客户端${index ? ` ${index + 1}` : ""}`}><select value={out.client} onChange={e => { const id = e.target.value; setOutput(index, { client: id, mode: id === "v2ray" ? "nodes" : canInherit && id === "clashmeta" ? "source" : templates.length ? "full" : "nodes", template_filename: out.template_filename || templates[0] || "" }); }}>
      {clients.map(client => <option key={client.id} value={client.id} disabled={outputs.some((other, i) => i !== index && other.client === client.id)}>{client.name}</option>)}{["shadowrocket", "uri"].includes(out.client) && <option value={out.client}>{clientName(out.client)}</option>}
    </select></Field><Field label={`规则配置${index ? ` ${index + 1}` : ""}`}><select value={out.mode} onChange={e => setOutput(index, { mode: e.target.value as SubscriptionOutput["mode"] })}>{out.client !== "v2ray" && out.client !== "shadowrocket" && out.client !== "uri" && <option value="full">完整配置（分流规则）</option>}{canInherit && out.client === "clashmeta" && <option value="source">保留上游规则</option>}<option value="nodes">仅输出节点</option></select></Field></div><SubscriptionOutputRules out={out} index={index} templates={templates} onChange={next => setOutput(index, next)} onManageTemplates={onManageTemplates} />{out.client === "clash-to-shadowrocket" && <p className="sm-client-hint">完整配置生成小火箭 .conf；仅节点模式提供独立节点订阅。</p>}{out.mode === "source" && <p className="sm-client-hint">保留该外部来源的分组、分流和 DNS，导入原文保持不变。</p>}</section>)}{outputs.length < clients.length && <Button variant="ghost" onClick={() => { const client = clients.find(c => !outputs.some(out => out.client === c.id)); if (client) { invalidate(); setOutputs(current => [...current, { client: client.id, mode: client.full && templates.length ? "full" : "nodes", template_filename: templates[0] || "" }]); } }}><Plus size={15} />添加其他客户端输出</Button>}</div>}
    {step === lastStep && preview && <div className="sm-review"><div className="sm-form-grid"><Field label="订阅名称"><input autoFocus required value={name} onChange={e => setName(e.target.value)} placeholder={kind === "strategy" ? "例如：日常多线订阅" : "例如：自建专线"} /></Field><div className="sm-review-summary"><Badge tone="good"><Check size={13} />预览已生成</Badge><span>{clientName(preview.client)} · {outputs.length} 个客户端输出</span></div></div><div className="sm-preview-counts"><div><small>输入节点</small><strong>{preview.input}</strong></div><div><small>去重 / 过滤 / 失效</small><strong>{preview.duplicate} / {preview.filtered} / {preview.dead}</strong></div><div><small>输出节点</small><strong>{preview.output}</strong></div></div>{preview.unknown > 0 && processing.remove_dead && <p className="sm-hint">{preview.unknown} 个节点暂无近期检测结果，已保留。</p>}{[...new Set([...(preview.warnings || []), ...(preview.outputs || []).flatMap(out => out.warnings || [])])].map(warn => <div className="sm-notice" key={warn}>{warn}</div>)}{kind === "strategy" && <div className="sm-bound-sources"><small>持续绑定来源</small><div>{selectedSourceFiles.map(source => <Badge key={source.id}>{source.name}</Badge>)}</div></div>}<Field label="链接文件名（可选）" hint={file ? "保持原文件名，现有订阅链接继续使用。" : "留空按订阅名称生成。"}><input value={filename} disabled={Boolean(file)} onChange={e => setFilename(e.target.value)} placeholder="subscription.yaml" /></Field><p className="sm-hint">用户额度在用户管理中设置，下发时使用当前用户的独立凭据与流量额度。</p><Button variant="ghost" onClick={() => setShowCode(value => !value)}><Eye size={15} />{showCode ? "收起配置预览" : "查看生成配置"}</Button>{showCode && <div className="sm-code-view">{(preview.outputs?.length || 0) > 1 && <Field label="预览客户端"><select value={previewIndex} onChange={e => setPreviewIndex(Number(e.target.value))}>{preview.outputs!.map((out, i) => <option key={out.client} value={i}>{clientName(out.client)} · {out.output} 个节点</option>)}</select></Field>}<pre className="sm-code">{preview.outputs?.[previewIndex]?.content || preview.content}</pre></div>}</div>}
    <div className="sm-wizard-footer"><Button variant="secondary" onClick={step === 0 ? onClose : () => { setStep(value => value - 1); setError(""); }} disabled={busy}><ArrowLeft size={15} />{step === 0 ? "取消" : "上一步"}</Button><span className="sm-step-hint">{step + 1} / {titles.length}</span><Button onClick={() => void (step === lastStep ? save() : next())} disabled={busy || step < outputStep && !validSelection}>{busy ? <Spinner label={step === lastStep ? "正在保存" : "正在生成预览"} /> : <>{step === lastStep ? "保存订阅" : step === outputStep ? "生成预览" : "下一步"}<ArrowRight size={15} /></>}</Button></div>
    </fieldset>
  </Dialog>;
}
