import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, AlertTriangle, Check, ChevronDown, ChevronsUp, Code2, Copy, Eye, FileCode, FileInput, GripVertical, Layers, Link2, MoreHorizontal, Pencil, Plus, RefreshCw, Search, Settings2, ShieldCheck, SlidersHorizontal, Trash2, X } from "lucide-react";
import { createPortal } from "react-dom";
import { api } from "./api";
import { CountryFlag, getCountryRegionLabel, normalizeCountryCode } from "./country-flag";
import { isAnyDoorNode } from "./managed-node-presets";
import { Badge, Button, ConfirmDialog, Dialog, EmptyState, ErrorState, Field, IconButton, PageHeader, Spinner, Surface, Toggle } from "./ui";
import type { ContentPageProps, CustomRuleOption, NodeItem, OverrideScriptOption, SubscribeFile } from "./content-workbench";
import ruleCategories from "./subscription-rule-categories.json";
import "./subscription-workbench.css";

type Kind = "external" | "custom" | "strategy";
export type SortMode = "source" | "name" | "type" | "region" | "custom";
export type SortDirection = "asc" | "desc";
export interface PreviewNodeSummary { key: string; name: string; type: string; country_code?: string; source_index?: number }
export interface SubscriptionOutput { client: string; mode: "full" | "source" | "nodes"; template_filename?: string; rule_mode?: "template" | "custom"; rule_categories?: string[] }
export interface SubscriptionGeneration {
  kind: Kind;
  source_ids: number[];
  processing: {
    deduplicate: boolean;
    remove_dead: boolean;
    include?: string;
    exclude?: string;
    exclude_types?: string[];
    sort?: SortMode | string;
    sort_direction?: SortDirection;
    type_order?: string[];
    region_order?: string[];
    custom_order?: string[];
    node_regions?: Record<string, string>;
  };
  outputs: SubscriptionOutput[];
  last_sync_error?: string;
}
function formatSyncTime(value?: string): string {
  if (!value) return "";
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toLocaleString("zh-CN", { hour12: false }) : value;
}
interface Preview { input: number; duplicate: number; filtered: number; dead: number; unknown: number; output: number; warnings: string[]; content: string; client: string; nodes?: PreviewNodeSummary[]; outputs?: Preview[] }
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

const knownProtocols: Array<{ value: string; label: string }> = [
  { value: "ss", label: "Shadowsocks (ss)" },
  { value: "ssr", label: "ShadowsocksR (ssr)" },
  { value: "vmess", label: "VMess (vmess)" },
  { value: "vless", label: "VLESS (vless)" },
  { value: "trojan", label: "Trojan (trojan)" },
  { value: "hysteria2", label: "Hysteria2 (hysteria2)" },
  { value: "hysteria", label: "Hysteria (hysteria)" },
  { value: "tuic", label: "TUIC (tuic)" },
  { value: "wireguard", label: "WireGuard (wireguard)" },
  { value: "anytls", label: "AnyTLS (anytls)" },
  { value: "socks5", label: "SOCKS5 (socks5)" },
  { value: "http", label: "HTTP (http)" },
  { value: "snell", label: "Snell (snell)" },
  { value: "mieru", label: "Mieru (mieru)" },
];

type FilterField = "name" | "protocol";
type FilterOperator = "exclude_match" | "include_match" | "exclude_protocol";
interface FilterRuleRow {
  id: string;
  connector: "and" | "or";
  field: FilterField;
  operator: FilterOperator;
  tokens: string[];
  draft: string;
}

function uniqueItems(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const item = raw.trim();
    if (!item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

/** Split filter keywords on top-level | , ， or newlines without breaking (...) or [...] regex groups. */
function splitFilterTokens(raw: string): string[] {
  if (!raw) return [];
  const parts: string[] = [];
  let buf = "";
  let parenDepth = 0;
  let bracketDepth = 0;
  let escaped = false;
  for (const ch of raw) {
    if (escaped) {
      buf += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      buf += ch;
      escaped = true;
      continue;
    }
    if (ch === "[" && bracketDepth === 0) {
      bracketDepth = 1;
      buf += ch;
      continue;
    }
    if (ch === "]" && bracketDepth > 0) {
      bracketDepth = 0;
      buf += ch;
      continue;
    }
    if (bracketDepth === 0) {
      if (ch === "(") parenDepth += 1;
      else if (ch === ")" && parenDepth > 0) parenDepth -= 1;
    }
    if (parenDepth === 0 && bracketDepth === 0 && (ch === "|" || ch === "," || ch === "，" || ch === "\n")) {
      const trimmed = buf.trim();
      if (trimmed) parts.push(trimmed);
      buf = "";
      continue;
    }
    buf += ch;
  }
  const tail = buf.trim();
  if (tail) parts.push(tail);
  return uniqueItems(parts);
}

function hasTopLevelSeparator(raw: string): boolean {
  let parenDepth = 0;
  let bracketDepth = 0;
  let escaped = false;
  for (const ch of raw) {
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (ch === "[" && bracketDepth === 0) { bracketDepth = 1; continue; }
    if (ch === "]" && bracketDepth > 0) { bracketDepth = 0; continue; }
    if (bracketDepth === 0) {
      if (ch === "(") parenDepth += 1;
      else if (ch === ")" && parenDepth > 0) parenDepth -= 1;
    }
    if (parenDepth === 0 && bracketDepth === 0 && (ch === "|" || ch === "," || ch === "，" || ch === "\n")) {
      return true;
    }
  }
  return false;
}

function parseNameInput(prevDraft: string, rawValue: string, existingTokens: string[]): { tokens: string[]; draft: string } {
  if (!hasTopLevelSeparator(rawValue)) return { tokens: existingTokens, draft: rawValue };
  const endsWithSep = /[|,，\n]\s*$/.test(rawValue);
  const isPaste = rawValue.length - prevDraft.length > 1;
  const segments = splitFilterTokens(rawValue);
  if (endsWithSep || isPaste) {
    return { tokens: uniqueItems([...existingTokens, ...segments]), draft: "" };
  }
  const trailing = segments.pop() || "";
  return { tokens: uniqueItems([...existingTokens, ...segments]), draft: trailing };
}

function buildRuleRows(processing: Pick<SubscriptionGeneration["processing"], "include" | "exclude" | "exclude_types">, makeID: () => string): FilterRuleRow[] {
  const rows: FilterRuleRow[] = [];
  if (processing.exclude?.trim()) {
    rows.push({ id: makeID(), connector: "and", field: "name", operator: "exclude_match", tokens: splitFilterTokens(processing.exclude), draft: "" });
  }
  if (processing.include?.trim()) {
    rows.push({ id: makeID(), connector: "and", field: "name", operator: "include_match", tokens: splitFilterTokens(processing.include), draft: "" });
  }
  if (processing.exclude_types?.length) {
    rows.push({ id: makeID(), connector: "and", field: "protocol", operator: "exclude_protocol", tokens: uniqueItems(processing.exclude_types.map(t => t.toLowerCase())), draft: "" });
  }
  return rows.length ? rows : [{ id: makeID(), connector: "and", field: "name", operator: "exclude_match", tokens: [], draft: "" }];
}

function compileRuleRows(rows: FilterRuleRow[]): Pick<SubscriptionGeneration["processing"], "include" | "exclude" | "exclude_types"> {
  const collect = (op: FilterOperator) => uniqueItems(rows.filter(r => r.operator === op).flatMap(r => [...r.tokens, ...(r.field === "name" ? splitFilterTokens(r.draft) : [])]));
  const exclude = collect("exclude_match");
  const include = collect("include_match");
  const excludeTypes = collect("exclude_protocol").map(t => t.toLowerCase());
  return {
    exclude: exclude.length ? exclude.join("|") : undefined,
    include: include.length ? include.join("|") : undefined,
    exclude_types: excludeTypes.length ? excludeTypes : undefined,
  };
}

function validateRegexPattern(pattern?: string): string {
  if (!pattern) return "";
  if (pattern.length > 512) return "过滤表达式超过 512 字符限制";
  try {
    new RegExp(pattern);
    return "";
  } catch {
    return "正则表达式语法无效，请检查括号或转义符";
  }
}

function escapeExprString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function formatFilterExpression(processing: Pick<SubscriptionGeneration["processing"], "include" | "exclude" | "exclude_types">): string {
  const parts: string[] = [];
  if (processing.include?.trim()) parts.push(`(node.name =~ "${escapeExprString(processing.include.trim())}")`);
  if (processing.exclude?.trim()) parts.push(`(node.name !~ "${escapeExprString(processing.exclude.trim())}")`);
  if (processing.exclude_types?.length) {
    parts.push(`(node.protocol not in {"${processing.exclude_types.map(escapeExprString).join('" "')}"})`);
  }
  return parts.join(" and ");
}

type ExprToken =
  | { type: "word"; value: string }
  | { type: "str"; value: string }
  | { type: "op"; value: string }
  | { type: "punct"; value: string };

type ExprAst =
  | { kind: "and" | "or"; left: ExprAst; right: ExprAst }
  | { kind: "not"; inner: ExprAst }
  | { kind: "include" | "exclude"; pattern: string }
  | { kind: "include_types" | "exclude_types"; values: string[] };

interface CompiledFilterClause {
  include?: string;
  excludePatterns: string[];
  excludeTypes: string[];
}

function tokenizeFilterExpr(input: string): { tokens: ExprToken[]; error?: string } {
  const tokens: ExprToken[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch)) { i += 1; continue; }
    const two = input.slice(i, i + 2);
    if (["=~", "!~", "!=", "==", "&&", "||"].includes(two)) {
      tokens.push({ type: "op", value: two });
      i += 2;
      continue;
    }
    if (ch === "!") {
      tokens.push({ type: "op", value: "!" });
      i += 1;
      continue;
    }
    if ("(){}[] ,".includes(ch)) {
      tokens.push({ type: "punct", value: ch });
      i += 1;
      continue;
    }
    // Cloudflare-style r"..." raw string or standard "..." / '...' string
    const isRaw = (ch === "r" || ch === "R") && (input[i + 1] === '"' || input[i + 1] === "'");
    if (isRaw || ch === '"' || ch === "'") {
      const quote = isRaw ? input[i + 1] : ch;
      i += isRaw ? 2 : 1;
      let val = "";
      let closed = false;
      while (i < input.length) {
        const cur = input[i];
        if (!isRaw && cur === "\\" && i + 1 < input.length) {
          const nextCh = input[i + 1];
          val += nextCh === quote || nextCh === "\\" ? nextCh : `\\${nextCh}`;
          i += 2;
          continue;
        }
        if (cur === quote) {
          closed = true;
          i += 1;
          break;
        }
        val += cur;
        i += 1;
      }
      if (!closed) return { tokens: [], error: "语法错误：引号未闭合" };
      tokens.push({ type: "str", value: val });
      continue;
    }
    if (/[a-zA-Z0-9_.-]/.test(ch)) {
      let word = "";
      while (i < input.length && /[a-zA-Z0-9_.-]/.test(input[i])) {
        word += input[i];
        i += 1;
      }
      tokens.push({ type: "word", value: word });
      continue;
    }
    return { tokens: [], error: `无法识别的字符：${ch}` };
  }
  return { tokens };
}

function compileExprAst(node: ExprAst, negated = false): { ok: true; clause: CompiledFilterClause } | { ok: false; error: string } {
  if (node.kind === "not") return compileExprAst(node.inner, !negated);

  if (node.kind === "include") {
    return {
      ok: true,
      clause: negated ? { excludePatterns: [node.pattern], excludeTypes: [] } : { include: node.pattern, excludePatterns: [], excludeTypes: [] },
    };
  }
  if (node.kind === "exclude") {
    return {
      ok: true,
      clause: negated ? { include: node.pattern, excludePatterns: [], excludeTypes: [] } : { excludePatterns: [node.pattern], excludeTypes: [] },
    };
  }
  if (node.kind === "exclude_types") {
    if (negated) return { ok: false, error: "协议筛选目前仅支持剔除模式，请使用 node.protocol not in {...} 或 !=" };
    return { ok: true, clause: { excludePatterns: [], excludeTypes: node.values } };
  }
  if (node.kind === "include_types") {
    if (!negated) return { ok: false, error: "协议筛选目前仅支持剔除模式，请使用 node.protocol not in {...} 或 !=" };
    return { ok: true, clause: { excludePatterns: [], excludeTypes: node.values } };
  }

  if (node.kind !== "and" && node.kind !== "or") return { ok: false, error: "不支持的表达式节点" };
  // De Morgan: !(A && B) === (!A || !B), !(A || B) === (!A && !B)
  const effectiveOp = negated ? (node.kind === "and" ? "or" : "and") : node.kind;
  const left = compileExprAst(node.left, negated);
  if (!left.ok) return left;
  const right = compileExprAst(node.right, negated);
  if (!right.ok) return right;

  if (effectiveOp === "and") {
    if (left.clause.include && right.clause.include) {
      return { ok: false, error: "暂不支持用 and 组合多个保留名称条件，请用 or 合并（例如 node.name =~ \"A|B\"）" };
    }
    return {
      ok: true,
      clause: {
        include: left.clause.include || right.clause.include,
        excludePatterns: uniqueItems([...left.clause.excludePatterns, ...right.clause.excludePatterns]),
        excludeTypes: uniqueItems([...left.clause.excludeTypes, ...right.clause.excludeTypes]),
      },
    };
  }

  // OR is supported across pure include-name clauses (a or b -> a|b)
  const leftIncludeOnly = Boolean(left.clause.include) && !left.clause.excludePatterns.length && !left.clause.excludeTypes.length;
  const rightIncludeOnly = Boolean(right.clause.include) && !right.clause.excludePatterns.length && !right.clause.excludeTypes.length;
  if (leftIncludeOnly && rightIncludeOnly) {
    return {
      ok: true,
      clause: {
        include: uniqueItems([left.clause.include!, right.clause.include!]).join("|"),
        excludePatterns: [],
        excludeTypes: [],
      },
    };
  }
  return { ok: false, error: "暂不支持跨条件使用 or 组合，请改用 and 连接不同条件（同名关键词可用 | 或 or 合并）" };
}

function parseFilterExpression(
  input: string,
): { ok: true; value: Pick<SubscriptionGeneration["processing"], "include" | "exclude" | "exclude_types"> } | { ok: false; error: string } {
  const trimmed = input.trim();
  if (!trimmed) {
    return { ok: true, value: { include: undefined, exclude: undefined, exclude_types: undefined } };
  }
  const { tokens, error: tokErr } = tokenizeFilterExpr(trimmed);
  if (tokErr) return { ok: false, error: tokErr };
  if (!tokens.length) return { ok: true, value: { include: undefined, exclude: undefined, exclude_types: undefined } };

  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const isWord = (tok: ExprToken | undefined, ...words: string[]) =>
    tok?.type === "word" && words.includes(tok.value.toLowerCase());

  const parseOr = (): ExprAst => {
    let left = parseAnd();
    while (isWord(peek(), "or") || (peek()?.type === "op" && peek()?.value === "||")) {
      next();
      left = { kind: "or", left, right: parseAnd() };
    }
    return left;
  };

  const parseAnd = (): ExprAst => {
    let left = parseUnary();
    while (isWord(peek(), "and") || (peek()?.type === "op" && peek()?.value === "&&")) {
      next();
      left = { kind: "and", left, right: parseUnary() };
    }
    return left;
  };

  const parseUnary = (): ExprAst => {
    if (isWord(peek(), "not") || (peek()?.type === "op" && peek()?.value === "!")) {
      next();
      return { kind: "not", inner: parseUnary() };
    }
    return parsePrimary();
  };

  const readStringValue = (label: string): string => {
    const tok = next();
    if (!tok || (tok.type !== "str" && tok.type !== "word")) {
      throw new Error(`语法错误：${label} 需要引号包裹的字符串值`);
    }
    if (!tok.value.trim()) throw new Error(`${label} 值不能为空`);
    return tok.value.trim();
  };

  const readProtocolList = (): string[] => {
    const open = next();
    if (!open || open.type !== "punct" || (open.value !== "{" && open.value !== "[")) {
      throw new Error("语法错误：not in / in 后面需要用 {...} 或 [...] 包裹协议列表");
    }
    const closeChar = open.value === "{" ? "}" : "]";
    const items: string[] = [];
    while (peek() && !(peek()?.type === "punct" && peek()?.value === closeChar)) {
      if (peek()?.type === "punct" && peek()?.value === ",") { next(); continue; }
      const tok = next();
      if (!tok || (tok.type !== "str" && tok.type !== "word")) {
        throw new Error("语法错误：协议列表中包含无效项");
      }
      const val = tok.value.trim().toLowerCase();
      if (val) items.push(val);
    }
    const close = next();
    if (!close || close.type !== "punct" || close.value !== closeChar) {
      throw new Error(`语法错误：缺少闭合符号 ${closeChar}`);
    }
    if (!items.length) throw new Error("协议列表不能为空");
    return uniqueItems(items);
  };

  const parsePrimary = (): ExprAst => {
    const tok = peek();
    if (!tok) throw new Error("表达式不完整，请补全过滤条件");
    if (tok.type === "punct" && tok.value === "(") {
      next();
      const inner = parseOr();
      const close = next();
      if (!close || close.type !== "punct" || close.value !== ")") {
        throw new Error("语法错误：缺少右括号 )");
      }
      return inner;
    }
    if (tok.type !== "word") throw new Error(`意外的符号：${tok.value}`);
    const field = next()!.value.toLowerCase();
    if (field === "node.name") {
      let negatedOp = false;
      if (isWord(peek(), "not")) { next(); negatedOp = true; }
      const op = next();
      if (!op) throw new Error("语法错误：node.name 后缺少运算符（支持 =~、!~、contains）");
      if (!negatedOp && (op.type === "op" && op.value === "=~" || isWord(op, "contains"))) {
        const pattern = readStringValue("node.name");
        const err = validateRegexPattern(pattern);
        if (err) throw new Error(err);
        return { kind: "include", pattern };
      }
      if ((op.type === "op" && op.value === "!~" && !negatedOp) || (negatedOp && isWord(op, "contains"))) {
        const pattern = readStringValue("node.name");
        const err = validateRegexPattern(pattern);
        if (err) throw new Error(err);
        return { kind: "exclude", pattern };
      }
      throw new Error("字段 node.name 仅支持 =~、!~、contains 或 not contains");
    }
    if (field === "node.protocol") {
      let negatedOp = false;
      if (isWord(peek(), "not")) { next(); negatedOp = true; }
      const op = next();
      if (!op) throw new Error("语法错误：node.protocol 后缺少运算符（支持 not in、!=、ne）");
      if (isWord(op, "in")) {
        return { kind: negatedOp ? "exclude_types" : "include_types", values: readProtocolList() };
      }
      if (!negatedOp && ((op.type === "op" && op.value === "!=") || isWord(op, "ne"))) {
        return { kind: "exclude_types", values: [readStringValue("node.protocol").toLowerCase()] };
      }
      if (!negatedOp && ((op.type === "op" && op.value === "==") || isWord(op, "eq"))) {
        return { kind: "include_types", values: [readStringValue("node.protocol").toLowerCase()] };
      }
      throw new Error("字段 node.protocol 仅支持 not in {...}、!= 或 ne");
    }
    throw new Error(`不支持的字段「${field}」，仅支持 node.name 与 node.protocol`);
  };

  try {
    const ast = parseOr();
    if (pos < tokens.length) {
      throw new Error(`意外的多余内容「${tokens[pos].value}」，请检查是否缺少 and / or`);
    }
    const compiled = compileExprAst(ast);
    if (!compiled.ok) return compiled;
    const include = compiled.clause.include || undefined;
    const exclude = compiled.clause.excludePatterns.length ? compiled.clause.excludePatterns.join("|") : undefined;
    const err = validateRegexPattern(include) || validateRegexPattern(exclude);
    if (err) return { ok: false, error: err };
    return {
      ok: true,
      value: {
        include,
        exclude,
        exclude_types: compiled.clause.excludeTypes.length ? compiled.clause.excludeTypes : undefined,
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "表达式语法无效" };
  }
}

function TokenChips({ tokens, labelMap, isProtocol, onRemove }: { tokens: string[]; labelMap?: Map<string, string>; isProtocol?: boolean; onRemove: (token: string) => void }) {
  if (!tokens.length) return null;
  return (
    <div className="sm-cf-chips">
      {tokens.map(token => (
        <button
          key={token}
          type="button"
          className={`sm-cf-chip ${isProtocol ? "is-protocol" : ""}`}
          title="点击删除该过滤块"
          aria-label={`删除${isProtocol ? "协议" : "关键词"} ${token}`}
          onClick={() => onRemove(token)}
        >
          <span>{labelMap?.get(token) || token}</span>
          <X size={12} aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

function ProtocolSelect({ selected, options, label, onAdd }: { selected: string[]; options: Array<{ value: string; label: string }>; label: string; onAdd: (proto: string) => void }) {
  return (
    <select
      aria-label={label}
      value=""
      onChange={e => {
        const next = e.target.value.trim().toLowerCase();
        if (next) onAdd(next);
      }}
    >
      <option value="">从下拉菜单选择要排除的协议...</option>
      {options.map(opt => {
        const chosen = selected.includes(opt.value);
        return <option key={opt.value} value={opt.value} disabled={chosen}>{opt.label}{chosen ? " · 已选" : ""}</option>;
      })}
    </select>
  );
}

function NodeFilterRuleBuilder({
  processing,
  nodes,
  onChange,
  onExprError,
}: {
  processing: SubscriptionGeneration["processing"];
  nodes: NodeItem[];
  onChange: (patch: Partial<SubscriptionGeneration["processing"]>) => void;
  onExprError?: (error: string) => void;
}) {
  const nextID = useRef(1);
  const makeID = () => `filter-row-${nextID.current++}`;
  const [rows, setRows] = useState<FilterRuleRow[]>(() => buildRuleRows(processing, makeID));
  const [editExprMode, setEditExprMode] = useState(false);
  const [exprDraft, setExprDraft] = useState(() => formatFilterExpression(processing));
  const [exprError, setExprError] = useState("");

  const protocolOptions = useMemo(() => {
    const map = new Map<string, string>(knownProtocols.map(p => [p.value, p.label]));
    for (const node of nodes) {
      if (isAnyDoorNode(node)) continue;
      const proto = node.protocol?.trim().toLowerCase();
      if (proto && !map.has(proto)) map.set(proto, proto);
    }
    return Array.from(map.entries()).map(([value, label]) => ({ value, label }));
  }, [nodes]);

  const protocolLabelMap = useMemo(() => new Map(protocolOptions.map(p => [p.value, p.label])), [protocolOptions]);

  const commitRows = (updater: (current: FilterRuleRow[]) => FilterRuleRow[]) => {
    const next = updater(rows);
    const compiled = compileRuleRows(next);
    setRows(next);
    setExprDraft(formatFilterExpression(compiled));
    setExprError("");
    onExprError?.("");
    onChange(compiled);
  };

  const handleFieldChange = (id: string, field: FilterField) => {
    commitRows(current => current.map(row => {
      if (row.id !== id) return row;
      return {
        ...row,
        field,
        operator: field === "protocol" ? "exclude_protocol" : "exclude_match",
        tokens: [],
        draft: "",
      };
    }));
  };

  const handleOperatorChange = (id: string, operator: FilterOperator) => {
    commitRows(current => current.map(row => row.id === id ? { ...row, operator } : row));
  };

  const handleNameChange = (id: string, value: string) => {
    commitRows(current => current.map(row => {
      if (row.id !== id) return row;
      const parsed = parseNameInput(row.draft, value, row.tokens);
      return { ...row, tokens: parsed.tokens, draft: parsed.draft };
    }));
  };

  const commitNameDraft = (id: string) => {
    commitRows(current => current.map(row => {
      if (row.id !== id || !row.draft.trim()) return row;
      return { ...row, tokens: uniqueItems([...row.tokens, ...splitFilterTokens(row.draft)]), draft: "" };
    }));
  };

  const addToken = (id: string, token: string) => {
    commitRows(current => current.map(row => row.id === id ? { ...row, tokens: uniqueItems([...row.tokens, token]) } : row));
  };

  const removeToken = (id: string, token: string) => {
    commitRows(current => current.map(row => row.id === id ? { ...row, tokens: row.tokens.filter(t => t !== token) } : row));
  };

  const addRowAfter = (id: string, connector: "and" | "or") => {
    commitRows(current => {
      const index = current.findIndex(r => r.id === id);
      const source = current[index] || current[0];
      let field: FilterField = source.field;
      let operator: FilterOperator = source.operator;
      if (connector === "and") {
        const present = new Set(current.map(r => r.operator));
        const candidateOrder: FilterOperator[] = ["include_match", "exclude_protocol", "exclude_match"];
        const nextOp = candidateOrder.find(op => !present.has(op)) || (source.field === "name" ? "exclude_protocol" : "exclude_match");
        operator = nextOp;
        field = nextOp === "exclude_protocol" ? "protocol" : "name";
      }
      const inserted: FilterRuleRow = { id: makeID(), connector, field, operator, tokens: [], draft: "" };
      const copy = [...current];
      copy.splice(index + 1, 0, inserted);
      return copy;
    });
  };

  const removeRow = (id: string) => {
    commitRows(current => {
      if (current.length <= 1) return [{ ...current[0], tokens: [], draft: "" }];
      const next = current.filter(r => r.id !== id);
      next[0] = { ...next[0], connector: "and" };
      return next;
    });
  };

  const clearAll = () => {
    setRows([{ id: makeID(), connector: "and", field: "name", operator: "exclude_match", tokens: [], draft: "" }]);
    setExprDraft("");
    setExprError("");
    onExprError?.("");
    onChange({ include: undefined, exclude: undefined, exclude_types: undefined });
  };

  const handleExprChange = (value: string) => {
    setExprDraft(value);
    const result = parseFilterExpression(value);
    if (result.ok) {
      setExprError("");
      onExprError?.("");
      onChange(result.value);
      setRows(buildRuleRows(result.value, makeID));
    } else {
      setExprError(result.error);
      onExprError?.(result.error);
    }
  };

  const toggleExprEditor = () => {
    if (editExprMode) {
      if (exprError) {
        setExprDraft(formatFilterExpression(processing));
        setExprError("");
        onExprError?.("");
      }
      setEditExprMode(false);
    } else {
      setExprDraft(formatFilterExpression(processing));
      setExprError("");
      onExprError?.("");
      setEditExprMode(true);
    }
  };

  const hasAnyFilter = Boolean(processing.include?.trim() || processing.exclude?.trim() || processing.exclude_types?.length);
  const expressionPreview = formatFilterExpression(processing);
  const maxRegexLen = Math.max(processing.include?.length || 0, processing.exclude?.length || 0);
  const activeWarning = exprError || validateRegexPattern(processing.include) || validateRegexPattern(processing.exclude);

  return (
    <section className="sm-cf-card" aria-label="节点过滤规则">
      <div className="sm-cf-card-head">
        <div>
          <strong>当传入节点匹配时...</strong>
          <small>关键词用 | 或逗号 , 分隔（回车确认）自动识别为标签块，点击块可删除；协议直接下拉选择。</small>
        </div>
        {(hasAnyFilter || exprDraft.trim() !== "") && <Button variant="ghost" onClick={clearAll}>清空过滤</Button>}
      </div>

      <div className="sm-cf-head" aria-hidden="true">
        <span>字段</span>
        <span>运算符</span>
        <span>值</span>
        <span>逻辑</span>
      </div>
      <div className="sm-cf-rows">
        {rows.map((row, index) => (
          <div key={row.id}>
            {index > 0 && (
              <div className="sm-cf-connector">
                <span>{row.connector === "or" ? "Or" : "And"}</span>
              </div>
            )}
            <div className="sm-cf-row">
              <select
                aria-label={`规则字段 ${index + 1}`}
                value={row.field}
                onChange={e => handleFieldChange(row.id, e.target.value as FilterField)}
              >
                <option value="name">节点名称</option>
                <option value="protocol">节点协议</option>
              </select>

              <select
                aria-label={`规则运算符 ${index + 1}`}
                value={row.operator}
                disabled={row.field === "protocol"}
                onChange={e => handleOperatorChange(row.id, e.target.value as FilterOperator)}
              >
                {row.field === "name" ? (
                  <>
                    <option value="exclude_match">剔除</option>
                    <option value="include_match">保留</option>
                  </>
                ) : (
                  <option value="exclude_protocol">剔除</option>
                )}
              </select>

              <div className="sm-cf-value">
                {row.field === "name" ? (
                  <>
                    <input
                      value={row.draft}
                      aria-label={row.operator === "include_match" ? `仅保留名称 ${index + 1}` : `排除名称 ${index + 1}`}
                      placeholder={row.operator === "include_match" ? "用 | 或 , 分隔，如：香港|HK" : "用 | 或 , 分隔，如：到期|剩余流量|官网"}
                      onChange={e => handleNameChange(row.id, e.target.value)}
                      onBlur={() => commitNameDraft(row.id)}
                      onKeyDown={e => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          commitNameDraft(row.id);
                        } else if (e.key === "Backspace" && !row.draft && row.tokens.length > 0) {
                          removeToken(row.id, row.tokens[row.tokens.length - 1]);
                        }
                      }}
                    />
                    <TokenChips tokens={row.tokens} onRemove={token => removeToken(row.id, token)} />
                  </>
                ) : (
                  <>
                    <ProtocolSelect
                      selected={row.tokens}
                      options={protocolOptions}
                      label={`排除协议 ${index + 1}`}
                      onAdd={proto => addToken(row.id, proto)}
                    />
                    <TokenChips tokens={row.tokens} labelMap={protocolLabelMap} isProtocol onRemove={proto => removeToken(row.id, proto)} />
                  </>
                )}
              </div>

              <div className="sm-cf-actions">
                <Button variant="secondary" className="sm-cf-logic-btn" onClick={() => addRowAfter(row.id, "and")}>And</Button>
                <Button variant="secondary" className="sm-cf-logic-btn" onClick={() => addRowAfter(row.id, "or")}>Or</Button>
                {(rows.length > 1 || row.tokens.length > 0 || row.draft.trim() !== "") && (
                  <IconButton label={`删除规则行 ${index + 1}`} onClick={() => removeRow(row.id)}><Trash2 size={14} /></IconButton>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="sm-cf-preview">
        <div className="sm-cf-preview-head">
          <span>{editExprMode ? "表达式编辑器" : "表达式预览"}</span>
          <Button variant="ghost" onClick={toggleExprEditor}>
            <Code2 size={14} />
            {editExprMode ? "完成表达式编辑" : "编辑表达式"}
          </Button>
        </div>

        {editExprMode ? (
          <>
            <textarea
              className={`sm-cf-expr-input ${exprError ? "is-invalid" : ""}`}
              aria-label="过滤表达式编辑器"
              spellCheck={false}
              value={exprDraft}
              placeholder={'例如：(node.name =~ "香港|HK") and (node.name !~ "到期|官网") and (node.protocol not in {"ss" "vmess"})'}
              onChange={e => handleExprChange(e.target.value)}
            />
            <span className="sm-cf-expr-help">
              支持语法：<code>node.name =~ &quot;保留正则&quot;</code>、<code>node.name !~ &quot;剔除正则&quot;</code>、<code>node.protocol not in &#123;&quot;ss&quot; &quot;vmess&quot;&#125;</code>，用 <code>and</code> / <code>or</code> 连接；修改后将实时校验并同步至上方规则。
            </span>
          </>
        ) : (
          <div className={`sm-cf-expr-box ${!expressionPreview ? "is-empty" : ""}`} role="region" aria-label="过滤表达式预览">
            {expressionPreview ? <code>{expressionPreview}</code> : <span>未设置过滤条件（保留全部来源节点）</span>}
          </div>
        )}

        <div className="sm-cf-expr-meta">
          {activeWarning ? (
            <span className="sm-cf-expr-warn" role="alert">{activeWarning}</span>
          ) : editExprMode && exprDraft.trim() ? (
            <span className="sm-cf-expr-ok">✓ 表达式有效，已同步至上方规则</span>
          ) : (
            <span />
          )}
          <span>{maxRegexLen} / 512 characters</span>
        </div>
      </div>
    </section>
  );
}

function reorderArray<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= items.length || to >= items.length) return items;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

function SortableOrderList<T>({
  items,
  keyOf,
  labelOf,
  renderMeta,
  onReorder,
  allowPinTop = false,
  groupOf,
  readOnly = false,
}: {
  items: T[];
  keyOf: (item: T) => string | number;
  labelOf: (item: T) => string;
  renderMeta: (item: T) => ReactNode;
  onReorder: (next: T[]) => void;
  allowPinTop?: boolean;
  groupOf?: (item: T) => string | number;
  readOnly?: boolean;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const sameGroup = (a: number, b: number) => !groupOf || groupOf(items[a]) === groupOf(items[b]);

  return (
    <ul className="sm-sort-list">
      {items.map((item, index) => {
        const isDragging = dragIndex === index;
        const canDropHere = !readOnly && dragIndex !== null && dragIndex !== index && sameGroup(dragIndex, index);
        const isOver = overIndex === index && canDropHere;
        const itemLabel = labelOf(item);
        const groupKey = groupOf ? groupOf(item) : undefined;
        let firstInGroup = 0;
        let prevInGroup = index - 1;
        let nextInGroup = index + 1;
        if (groupOf) {
          firstInGroup = items.findIndex(candidate => groupOf(candidate) === groupKey);
          prevInGroup = -1;
          for (let k = index - 1; k >= 0; k -= 1) {
            if (groupOf(items[k]) === groupKey) { prevInGroup = k; break; }
          }
          nextInGroup = -1;
          for (let k = index + 1; k < items.length; k += 1) {
            if (groupOf(items[k]) === groupKey) { nextInGroup = k; break; }
          }
        } else {
          if (prevInGroup < 0) prevInGroup = -1;
          if (nextInGroup >= items.length) nextInGroup = -1;
        }
        return (
          <li
            key={keyOf(item)}
            draggable={!readOnly}
            className={`sm-sort-item ${readOnly ? "is-readonly" : ""} ${isDragging ? "is-dragging" : ""} ${isOver ? "is-drag-over" : ""}`}
            onDragStart={e => {
              if (readOnly) return;
              setDragIndex(index);
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", String(index));
            }}
            onDragOver={e => {
              if (readOnly) return;
              if (dragIndex !== null && !sameGroup(dragIndex, index)) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (overIndex !== index) setOverIndex(index);
            }}
            onDrop={e => {
              if (readOnly) return;
              e.preventDefault();
              if (dragIndex !== null && dragIndex !== index && sameGroup(dragIndex, index)) {
                onReorder(reorderArray(items, dragIndex, index));
              }
              setDragIndex(null);
              setOverIndex(null);
            }}
            onDragEnd={() => {
              setDragIndex(null);
              setOverIndex(null);
            }}
          >
            {!readOnly && (
              <span className="sm-sort-grip" title={groupOf ? "同组内上下拖动调整顺序" : "上下拖动调整顺序"} aria-hidden="true">
                <GripVertical size={15} />
              </span>
            )}
            <span className="sm-sort-index">{index + 1}</span>
            <div className="sm-sort-info">{renderMeta(item)}</div>
            {!readOnly && (
              <div className="sm-sort-item-actions">
                {allowPinTop && (
                  <IconButton
                    label={`置顶 ${itemLabel}`}
                    disabled={index === firstInGroup}
                    onClick={() => onReorder(reorderArray(items, index, firstInGroup))}
                  >
                    <ChevronsUp size={14} />
                  </IconButton>
                )}
                <IconButton
                  label={`上移 ${itemLabel}`}
                  disabled={prevInGroup < 0}
                  onClick={() => prevInGroup >= 0 && onReorder(reorderArray(items, index, prevInGroup))}
                >
                  <ArrowUp size={14} />
                </IconButton>
                <IconButton
                  label={`下移 ${itemLabel}`}
                  disabled={nextInGroup < 0}
                  onClick={() => nextInGroup >= 0 && onReorder(reorderArray(items, index, nextInGroup))}
                >
                  <ArrowDown size={14} />
                </IconButton>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const sortModeOptions: Array<{ id: SortMode; label: string }> = [
  { id: "source", label: "按来源顺序" },
  { id: "name", label: "按节点名称" },
  { id: "type", label: "按节点类型" },
  { id: "region", label: "按地区排序" },
];

function inferClientRegionCode(name: string, explicit?: string): string {
  const norm = normalizeCountryCode(explicit);
  if (norm && norm !== "UN") return norm;
  const upper = name.toUpperCase();
  if (name.includes("🇭🇰") || name.includes("香港") || upper.includes("HK")) return "HK";
  if (name.includes("🇯🇵") || name.includes("日本") || name.includes("东京") || name.includes("大阪") || upper.includes("JP")) return "JP";
  if (name.includes("🇹🇼") || name.includes("台湾") || name.includes("台北") || upper.includes("TW")) return "TW";
  if (name.includes("🇺🇸") || name.includes("美国") || name.includes("洛杉矶") || name.includes("圣何塞") || upper.includes("US")) return "US";
  if (name.includes("🇸🇬") || name.includes("新加坡") || name.includes("狮城") || upper.includes("SG")) return "SG";
  if (name.includes("🇰🇷") || name.includes("韩国") || name.includes("首尔") || upper.includes("KR")) return "KR";
  if (name.includes("🇬🇧") || name.includes("英国") || name.includes("伦敦") || upper.includes("UK") || upper.includes("GB")) return "GB";
  if (name.includes("🇩🇪") || name.includes("德国") || name.includes("法兰克福") || upper.includes("DE")) return "DE";
  if (name.includes("🇫🇷") || name.includes("法国")) return "FR";
  if (name.includes("🇳🇱") || name.includes("荷兰")) return "NL";
  if (name.includes("🇨🇦") || name.includes("加拿大")) return "CA";
  if (name.includes("🇦🇺") || name.includes("澳大利亚") || name.includes("澳洲")) return "AU";
  if (name.includes("🇷🇺") || name.includes("俄罗斯") || upper.includes("RU")) return "RU";
  if (name.includes("🇹🇷") || name.includes("土耳其")) return "TR";
  if (name.includes("🇮🇳") || name.includes("印度")) return "IN";
  if (name.includes("🇲🇴") || name.includes("澳门")) return "MO";
  return "UN";
}

function HorizontalRegionOrderList({
  items,
  onReorder,
}: {
  items: Array<{ code: string; count: number }>;
  onReorder: (nextItems: Array<{ code: string; count: number }>) => void;
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= items.length || from === to) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onReorder(next);
  };

  return (
    <ul className="sm-region-grid" aria-label="地区横向排序列表">
      {items.map((item, idx) => {
        const displayCode = item.code === "UN" ? "未知" : item.code;
        return (
          <li
            key={item.code}
            title={`${getCountryRegionLabel(item.code)} · ${item.count} 个节点`}
            aria-label={`地区 ${displayCode}`}
            className={`sm-region-chip ${dragIndex === idx ? "is-dragging" : ""} ${overIndex === idx && dragIndex !== idx ? "is-drag-over" : ""}`}
            draggable={items.length > 1}
            onDragStart={() => { setDragIndex(idx); setOverIndex(idx); }}
            onDragOver={e => { e.preventDefault(); if (overIndex !== idx) setOverIndex(idx); }}
            onDrop={e => {
              e.preventDefault();
              if (dragIndex !== null && dragIndex !== idx) move(dragIndex, idx);
              setDragIndex(null);
              setOverIndex(null);
            }}
            onDragEnd={() => { setDragIndex(null); setOverIndex(null); }}
          >
            <CountryFlag countryCode={item.code} className="sm-region-flag" fallbackSize={16} />
            <span className="sm-region-code">{displayCode}</span>
          </li>
        );
      })}
    </ul>
  );
}

function NodeSortPanel({
  processing,
  selectedSources,
  sourceFiles,
  onChangeProcessing,
  onReorderSources,
  fetchSortedNodes,
}: {
  processing: SubscriptionGeneration["processing"];
  selectedSources: number[];
  sourceFiles: SubscribeFile[];
  onChangeProcessing: (patch: Partial<SubscriptionGeneration["processing"]>) => void;
  onReorderSources: (nextIDs: number[]) => void;
  fetchSortedNodes: (overrideProcessing?: Partial<SubscriptionGeneration["processing"]>) => Promise<PreviewNodeSummary[]>;
}) {
  const sortMode = (processing.sort || "source") as SortMode;
  const direction: SortDirection = processing.sort_direction === "desc" ? "desc" : "asc";
  const [sortedNodes, setSortedNodes] = useState<PreviewNodeSummary[]>([]);
  const [loadingNodes, setLoadingNodes] = useState(false);
  const [nodesError, setNodesError] = useState("");
  const fetchRef = useRef(fetchSortedNodes);
  fetchRef.current = fetchSortedNodes;
  const reqSeqRef = useRef(0);
  const loadedKeyRef = useRef("");

  const fetchKey = useMemo(
    () =>
      JSON.stringify([
        selectedSources,
        processing.deduplicate,
        processing.remove_dead,
        processing.include || "",
        processing.exclude || "",
        processing.exclude_types || [],
        sortMode,
        direction,
      ]),
    [
      selectedSources,
      processing.deduplicate,
      processing.remove_dead,
      processing.include,
      processing.exclude,
      processing.exclude_types,
      sortMode,
      direction,
    ],
  );

  const loadNodes = useCallback(async (keyForAttempt = fetchKey) => {
    if (!selectedSources.length) return;
    loadedKeyRef.current = keyForAttempt;
    const seq = ++reqSeqRef.current;
    setLoadingNodes(true);
    setNodesError("");
    try {
      const list = await fetchRef.current();
      if (seq !== reqSeqRef.current) return;
      setSortedNodes(list);
    } catch (reason) {
      if (seq !== reqSeqRef.current) return;
      setNodesError(message(reason));
    } finally {
      if (seq === reqSeqRef.current) setLoadingNodes(false);
    }
  }, [fetchKey, selectedSources.length]);

  useEffect(() => {
    if (!selectedSources.length || loadedKeyRef.current === fetchKey) return;
    const timer = window.setTimeout(() => {
      void loadNodes(fetchKey);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [fetchKey, selectedSources.length, loadNodes]);

  const handleModeChange = (nextMode: SortMode) => {
    onChangeProcessing({ sort: nextMode });
  };

  const handleReorderNodes = (nextList: PreviewNodeSummary[]) => {
    setSortedNodes(nextList);
    const nextOrder = direction === "desc" ? [...nextList].reverse().map(item => item.key) : nextList.map(item => item.key);
    onChangeProcessing({ sort: sortMode === "name" ? "custom" : sortMode, custom_order: nextOrder });
  };

  const nodeGroupKey = useCallback((node: PreviewNodeSummary): string | number => {
    if (sortMode === "type") return (node.type || "unknown").toLowerCase();
    if (sortMode === "region") return inferClientRegionCode(node.name, node.country_code);
    if (sortMode === "source") return node.source_index ?? 0;
    return node.key;
  }, [sortMode]);

  const typeGroups = useMemo(() => {
    const counts = new Map<string, number>();
    const order: string[] = [];
    for (const n of sortedNodes) {
      const typ = (n.type || "unknown").toLowerCase();
      if (!counts.has(typ)) order.push(typ);
      counts.set(typ, (counts.get(typ) || 0) + 1);
    }
    return order.map(type => ({ type, count: counts.get(type) || 0 }));
  }, [sortedNodes]);

  const protocolNameMap = useMemo(() => {
    const map = new Map<string, string>(knownProtocols.map(p => [p.value, p.label]));
    map.set("chitanda", "Chitanda (chitanda)");
    return map;
  }, []);

  const handleReorderTypes = (nextGroups: Array<{ type: string; count: number }>) => {
    const nextTypes = nextGroups.map(g => g.type);
    const rank = new Map(nextTypes.map((t, idx) => [t, idx]));
    const reorderedNodes = [...sortedNodes].sort((a, b) => {
      const ra = rank.get((a.type || "unknown").toLowerCase()) ?? nextTypes.length;
      const rb = rank.get((b.type || "unknown").toLowerCase()) ?? nextTypes.length;
      return ra - rb;
    });
    setSortedNodes(reorderedNodes);
    const persisted = direction === "desc" ? [...nextTypes].reverse() : nextTypes;
    onChangeProcessing({ sort: "type", type_order: persisted });
  };

  const regionGroups = useMemo(() => {
    const counts = new Map<string, number>();
    const order: string[] = [];
    for (const n of sortedNodes) {
      const code = inferClientRegionCode(n.name, n.country_code);
      if (!counts.has(code)) order.push(code);
      counts.set(code, (counts.get(code) || 0) + 1);
    }
    if (processing.region_order?.length) {
      const rank = new Map(processing.region_order.map((c, idx) => [c.toUpperCase(), idx]));
      const ordered = [...order].sort((a, b) => {
        const ra = rank.get(a) ?? processing.region_order!.length;
        const rb = rank.get(b) ?? processing.region_order!.length;
        if (ra !== rb) return ra - rb;
        return order.indexOf(a) - order.indexOf(b);
      });
      const finalOrder = direction === "desc" ? [...ordered].reverse() : ordered;
      return finalOrder.map(code => ({ code, count: counts.get(code) || 0 }));
    }
    return order.map(code => ({ code, count: counts.get(code) || 0 }));
  }, [direction, processing.region_order, sortedNodes]);

  const handleReorderRegions = (nextGroups: Array<{ code: string; count: number }>) => {
    const nextCodes = nextGroups.map(g => g.code);
    const rank = new Map(nextCodes.map((c, idx) => [c, idx]));
    const reorderedNodes = [...sortedNodes].sort((a, b) => {
      const ra = rank.get(inferClientRegionCode(a.name, a.country_code)) ?? nextCodes.length;
      const rb = rank.get(inferClientRegionCode(b.name, b.country_code)) ?? nextCodes.length;
      return ra - rb;
    });
    setSortedNodes(reorderedNodes);
    const persisted = direction === "desc" ? [...nextCodes].reverse() : nextCodes;
    onChangeProcessing({ sort: "region", region_order: persisted });
  };

  return (
    <section className="sm-sort-card" aria-label="节点与来源排序">
      <div className="sm-sort-head">
        <div>
          <strong>节点与来源排序</strong>
          <small>自动实时加载排序结果，支持拖拽与点击上下调整来源或节点顺序，并一键切换顺逆向。</small>
        </div>
        <div className="sm-sort-dir" role="group" aria-label="排序方向">
          <button
            type="button"
            className={direction === "asc" ? "is-active" : ""}
            aria-pressed={direction === "asc"}
            onClick={() => onChangeProcessing({ sort_direction: "asc" })}
          >
            <ArrowUp size={13} aria-hidden="true" />
            顺向
          </button>
          <button
            type="button"
            className={direction === "desc" ? "is-active" : ""}
            aria-pressed={direction === "desc"}
            onClick={() => onChangeProcessing({ sort_direction: "desc" })}
          >
            <ArrowDown size={13} aria-hidden="true" />
            逆向
          </button>
        </div>
      </div>

      <div className="sm-sort-modes" role="tablist" aria-label="节点排序方式">
        {sortModeOptions.map(opt => (
          <button
            key={opt.id}
            type="button"
            role="tab"
            aria-selected={sortMode === opt.id}
            className={sortMode === opt.id ? "is-active" : ""}
            onClick={() => handleModeChange(opt.id)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {sortMode === "source" && sourceFiles.length > 0 && (
        <div className="sm-sort-body">
          <div className="sm-sort-toolbar">
            <span>来源优先级（共 <strong>{sourceFiles.length}</strong> 个来源）</span>
          </div>
          <SortableOrderList
            items={sourceFiles}
            keyOf={src => src.id}
            labelOf={src => src.name}
            renderMeta={src => (
              <>
                <strong>{src.name}</strong>
                <Badge tone={subscriptionKind(src) === "external" ? "info" : "good"}>{kindLabel[subscriptionKind(src)]}</Badge>
              </>
            )}
            onReorder={nextFiles => {
              const nextIDs = nextFiles.map(f => f.id);
              if (nextIDs.length === selectedSources.length) onReorderSources(nextIDs);
            }}
          />
        </div>
      )}

      {sortMode === "type" && typeGroups.length > 0 && (
        <div className="sm-sort-body">
          <div className="sm-sort-toolbar">
            <span>协议大类顺序（共 <strong>{typeGroups.length}</strong> 类 · 拖动或点击箭头按大类排序）</span>
          </div>
          <SortableOrderList
            items={typeGroups}
            keyOf={grp => grp.type}
            labelOf={grp => `协议大类 ${grp.type}`}
            allowPinTop
            renderMeta={grp => (
              <>
                <strong>{protocolNameMap.get(grp.type) || grp.type.toUpperCase()}</strong>
                <Badge tone="info">{grp.count} 个节点</Badge>
              </>
            )}
            onReorder={handleReorderTypes}
          />
        </div>
      )}

      {sortMode === "region" && regionGroups.length > 0 && (
        <div className="sm-sort-body">
          <div className="sm-sort-toolbar">
            <span>地区国旗排序（共 <strong>{regionGroups.length}</strong> 个地区 · 直接拖拽国旗卡片即可上下左右调整顺序）</span>
          </div>
          <HorizontalRegionOrderList items={regionGroups} onReorder={handleReorderRegions} />
        </div>
      )}

      <div className="sm-sort-body">
        <div className="sm-sort-toolbar">
          <span>
            {loadingNodes ? "正在同步节点列表..." : (
              <>
                当前输出顺序：共 <strong>{sortedNodes.length}</strong> 个节点
                {sortMode === "name" ? " · 按节点名称自动排序" : " · 可在同组内拖拽或点击箭头微调顺序（规则优先级高于组内微调）"}
              </>
            )}
          </span>
          <Button variant="ghost" disabled={loadingNodes} onClick={() => { loadedKeyRef.current = ""; void loadNodes(fetchKey); }}>
            <RefreshCw size={13} />
            {loadingNodes ? "加载中..." : "刷新"}
          </Button>
        </div>
        {nodesError && (
          <ErrorState message={nodesError} onRetry={() => { loadedKeyRef.current = ""; void loadNodes(fetchKey); }} />
        )}
        {loadingNodes && !sortedNodes.length ? (
          <div className="sm-sort-loading"><Spinner label="正在读取处理后的节点列表" /></div>
        ) : sortedNodes.length > 0 ? (
          <SortableOrderList
            items={sortedNodes}
            keyOf={node => node.key}
            labelOf={node => node.name}
            allowPinTop={sortMode !== "name"}
            readOnly={sortMode === "name"}
            groupOf={sortMode === "source" || sortMode === "type" || sortMode === "region" ? nodeGroupKey : undefined}
            renderMeta={node => (
              <>
                <CountryFlag countryCode={inferClientRegionCode(node.name, node.country_code)} className="sm-region-node-flag" fallbackSize={13} />
                <strong>{node.name}</strong>
                <Badge tone="info">{node.type || "unknown"}</Badge>
              </>
            )}
            onReorder={handleReorderNodes}
          />
        ) : !nodesError ? (
          <small className="sm-sort-note">暂无匹配节点，请调整上方来源或过滤条件。</small>
        ) : null}
      </div>
    </section>
  );
}

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
  const [filterExprError, setFilterExprError] = useState("");
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
          return <tr key={file.id}><td className="sm-select">{kind !== "strategy" && <input type="checkbox" aria-label={`选择来源 ${file.name}`} checked={selected.includes(file.id)} onChange={() => toggle(file.id)} />}</td><td><div className="sm-file-name"><span>{file.name}</span><Badge tone={kind === "strategy" ? "warn" : kind === "custom" ? "good" : "info"}>{kindLabel[kind]}</Badge></div><small>{file.filename}</small></td><td><span>{kind === "strategy" ? sourceNames.length ? sourceNames.join(" + ") : "旧版组合 · 请重新绑定来源" : kind === "external" ? file.url ? "URL 导入" : "本地导入" : `${file.selected_node_ids?.length || 0} 个面板节点`}</span><div className="sm-sync-meta"><small>{kind === "external" ? intervalLabel(file.auto_update_interval) : "配置变更自动跟随"}</small>{file.last_sync_error ? <div className="sm-sync-error" title={file.last_sync_error}><AlertTriangle size={13} className="sm-sync-error-icon" /><span className="sm-sync-error-text">同步失败: {file.last_sync_error}</span></div> : file.last_sync_at ? <small className="sm-sync-time">上次更新: {formatSyncTime(file.last_sync_at)}</small> : null}</div></td><td><span>{outputs[0] ? outputs[0].mode === "source" ? "保留上游规则" : outputs[0].mode === "nodes" ? "仅节点" : outputs[0].rule_mode === "custom" ? `自定义规则 · ${outputs[0].rule_categories?.length || 0} 个分类` : templateName(outputs[0].template_filename) : file.template_filename || (kind === "external" ? "原始配置" : "未绑定模板")}</span><small>{outputs.length ? outputs.map(out => clientName(out.client)).join(" · ") : "可配置客户端输出"}</small></td><td className="sm-action-cell"><div className="sm-row-actions"><SubscriptionCopyButton file={file} disabled={!token} onCopy={client => { setError(""); void (async () => { try { await navigator.clipboard.writeText(link(file, client)); notify(client ? `${clientName(client)} 订阅链接已复制` : "订阅链接已复制"); } catch (reason) { setError(message(reason)); } })(); }} /><IconButton label={`编辑 ${file.name}`} onClick={() => setWizard({ kind, file })}><Pencil size={16} /></IconButton>{kind === "external" && !file.url && <IconButton label={`修改配置内容 ${file.name}`} onClick={() => setContent(file)}><FileCode size={16} /></IconButton>}<details className="sm-more" onToggle={event => { const menu = event.currentTarget; if (menu.open) { const bounds = menu.getBoundingClientRect(); menu.style.setProperty("--sm-menu-top", `${Math.max(8, Math.min(bounds.bottom + 6, window.innerHeight - 240))}px`); menu.style.setProperty("--sm-menu-left", `${Math.max(8, bounds.right - 200)}px`); } }}><summary aria-label={`更多操作 ${file.name}`}><MoreHorizontal size={18} /></summary><div className="sm-menu"><button type="button" disabled={!token} onClick={() => { setLinksVisible(false); setLinkFile(file); }}><Link2 size={15} />客户端订阅链接</button>{file.url && <button type="button" aria-label={`立即同步 ${file.name}`} disabled={busy} onClick={() => void run(() => api.post(`/api/admin/subscribe-files/${file.id}/sync`), `“${file.name}”外部订阅同步成功`)}><RefreshCw size={15} />立即同步</button>}<button type="button" onClick={() => setContent(file)}><FileCode size={15} />修改配置内容</button><button type="button" aria-label={`${file.auto_sync_custom_rules ? "关闭" : "开启"} ${file.name} 自动同步`} disabled={busy} onClick={() => void run(() => api.put(`/api/admin/subscribe-files/${file.id}`, { ...file, auto_sync_custom_rules: !file.auto_sync_custom_rules }), "覆写规则同步设置已更新")}><RefreshCw size={15} />{file.auto_sync_custom_rules ? "关闭" : "开启"}规则同步</button><button type="button" className="sm-danger" onClick={() => setPending(file)}><Trash2 size={15} />删除订阅</button></div></details></div></td></tr>;
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
  const [filterExprError, setFilterExprError] = useState("");
  const requestVersion = useRef(0);
  const titles = kind === "strategy" ? ["选择来源", "节点处理", "客户端与规则", "预览保存"] : kind === "custom" ? ["选择节点", "客户端与规则", "预览保存"] : ["客户端与规则", "预览保存"];
  const outputStep = titles.length - 2; const lastStep = titles.length - 1;
  const candidates = files.filter(source => source.id !== file?.id && subscriptionKind(source) !== "strategy");
  const selectedSourceFiles = selectedSources
    .map(id => candidates.find(source => source.id === id))
    .filter((source): source is SubscribeFile => Boolean(source));
  const fetchSortedNodes = async (overrideProcessing?: Partial<SubscriptionGeneration["processing"]>): Promise<PreviewNodeSummary[]> => {
    const nextProcessing = overrideProcessing ? { ...processing, ...overrideProcessing } : processing;
    const reqPayload = {
      ...(file ? { id: file.id } : {}),
      name: name.trim(),
      description: file?.description || "",
      filename: safeFilename(filename || name || "subscription"),
      selected_node_ids: kind === "custom" ? selectedNodes : [],
      generation: {
        kind,
        source_ids: kind === "strategy" ? selectedSources : [],
        processing: nextProcessing,
        outputs: [{ client: "clashmeta", mode: "nodes" as const }],
      },
    };
    const result = await api.post<Preview>("/api/admin/subscribe-files/generation/preview", reqPayload);
    return result.nodes || [];
  };
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
    if (kind === "strategy" && step === 1) {
      const filterErr = filterExprError || validateRegexPattern(processing.include) || validateRegexPattern(processing.exclude);
      if (filterErr) { setError(filterErr); return; }
    }
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
  const filteredNodes = nodes.filter(node => (!isAnyDoorNode(node) || retainedNodeIDs.has(node.id)) && `${node.node_name} ${node.protocol}`.toLowerCase().includes(query.toLowerCase()));
  return <Dialog title={`${file ? "编辑" : "创建"}${kindLabel[kind]}`} description={kind === "strategy" ? "选择来源与处理方式，自动跟随来源更新。" : kind === "custom" ? "使用面板节点创建订阅，配置变更自动同步。" : "保留导入原文，为不同客户端配置输出方式。"} onClose={onClose} wide dismissible={!busy}>
    <fieldset className="sm-wizard" disabled={busy}><ol className="sm-steps" aria-label="订阅创建步骤">{titles.map((title, index) => <li key={title} className={step === index ? "is-active" : index < step ? "is-done" : ""}><button type="button" disabled={busy || index > step} onClick={() => { setStep(index); setError(""); }} aria-current={step === index ? "step" : undefined}><span>{index < step ? <Check size={13} /> : index + 1}</span>{title}</button></li>)}</ol>
    {error && <ErrorState message={error} />}
    {kind === "strategy" && step === 0 && <><div className="sm-picker-header"><span>已选 <strong>{selectedSources.length}</strong> 个来源</span><div className="sm-search"><Search size={15} /><input type="search" aria-label="搜索订阅来源" placeholder="搜索外部、自选订阅" value={query} onChange={e => setQuery(e.target.value)} /></div></div><div className="sm-source-grid">{candidates.filter(source => source.name.toLowerCase().includes(query.toLowerCase())).map(source => <label key={source.id} className={`sm-source ${selectedSources.includes(source.id) ? "is-selected" : ""}`}><input type="checkbox" aria-label={`绑定来源 ${source.name}`} checked={selectedSources.includes(source.id)} onChange={() => { invalidate(); toggleID(source.id, selectedSources, setSelectedSources); }} /><span><strong>{source.name}</strong><small>{kindLabel[subscriptionKind(source)]} · {source.url ? intervalLabel(source.auto_update_interval) : source.filename}</small></span></label>)}</div>{!candidates.length && <EmptyState icon={<FileInput size={24} />} title="暂无可用来源" description="请先添加外部订阅或创建自选订阅。" />}<p className="sm-hint">单个来源也可以创建策略。来源更新后，处理结果自动跟随。</p></>}
    {kind === "custom" && step === 0 && <><div className="sm-picker-header"><span>已选 <strong>{selectedNodes.length}</strong> 个节点</span><div className="sm-search"><Search size={15} /><input type="search" aria-label="搜索面板节点" placeholder="搜索名称或协议" value={query} onChange={e => setQuery(e.target.value)} /></div></div><div className="sm-picker-shortcuts"><Button variant="ghost" onClick={() => { invalidate(); setSelectedNodes([...new Set([...selectedNodes, ...filteredNodes.filter(node => node.enabled && node.subscription_eligible !== false && !isAnyDoorNode(node)).map(node => node.id)])]); }}>选择可用节点</Button><Button variant="ghost" onClick={() => { invalidate(); setSelectedNodes([]); }}>清空选择</Button>{selectedNodes.some(id => nodes.some(node => node.id === id && node.subscription_eligible === false)) && <Button variant="ghost" onClick={() => { invalidate(); setSelectedNodes(selectedNodes.filter(id => nodes.some(node => node.id === id && node.enabled && node.subscription_eligible !== false && !isAnyDoorNode(node)))); }}>移除不可统计节点</Button>}</div><div className="sm-source-grid">{filteredNodes.map(node => <label className={`sm-source ${selectedNodes.includes(node.id) ? "is-selected" : ""}`} key={node.id}><input type="checkbox" aria-label={`选择节点 ${node.node_name}`} disabled={(!node.enabled || node.subscription_eligible === false) && !selectedNodes.includes(node.id) && !retainedNodeIDs.has(node.id)} checked={selectedNodes.includes(node.id)} onChange={() => { invalidate(); toggleID(node.id, selectedNodes, setSelectedNodes); }} /><span><strong>{node.node_name}</strong><small>{node.node_type === "routed" ? "路由转发 · " : ""}{node.protocol} · {!node.enabled ? "已停用" : node.subscription_eligible === false ? node.subscription_ineligible_reason || "无法按用户统计" : "支持按用户统计"}</small></span></label>)}</div></>}
    {kind === "strategy" && step === 1 && <div className="sm-processing"><div className="sm-process-toggle"><div><strong>自动去重</strong><p>按完整连接配置去重，名称不同也能识别。</p></div><Toggle checked={processing.deduplicate} onChange={value => { invalidate(); setProcessing(current => ({ ...current, deduplicate: value })); }} label="自动去重" /></div><div className="sm-process-toggle"><div><strong>自动剔除失效节点</strong><p>面板经真实代理协议检测，连续失败 3 次后暂时移出；恢复后重新加入。</p></div><Toggle checked={processing.remove_dead} onChange={value => { invalidate(); setProcessing(current => ({ ...current, remove_dead: value })); }} label="自动剔除失效节点" /></div><div className="sm-notice"><ShieldCheck size={17} /><span>未检测、过期结果及无法检测的节点保留。全部失败时不清空订阅。检测位置：面板服务器；需要已有 Mihomo 核心。</span></div><NodeSortPanel processing={processing} selectedSources={selectedSources} sourceFiles={selectedSourceFiles} onChangeProcessing={patch => { invalidate(); setProcessing(current => ({ ...current, ...patch })); }} onReorderSources={nextIDs => { invalidate(); setSelectedSources(nextIDs); }} fetchSortedNodes={fetchSortedNodes} /><NodeFilterRuleBuilder processing={processing} nodes={nodes} onChange={patch => { invalidate(); setProcessing(current => ({ ...current, ...patch })); }} onExprError={setFilterExprError} /></div>}
    {step === outputStep && <div className="sm-output-list">{outputs.map((out, index) => <section className="sm-output" key={index} aria-label={`客户端输出 ${index + 1}`}><div className="sm-output-heading"><strong>{index === 0 ? "默认客户端" : "附加客户端"}</strong>{index > 0 && <IconButton label={`移除客户端 ${index + 1}`} onClick={() => { invalidate(); setOutputs(current => current.filter((_, i) => i !== index)); }}><X size={15} /></IconButton>}</div><div className="sm-form-grid"><Field label={`输出客户端${index ? ` ${index + 1}` : ""}`}><select value={out.client} onChange={e => { const id = e.target.value; setOutput(index, { client: id, mode: id === "v2ray" ? "nodes" : canInherit && id === "clashmeta" ? "source" : templates.length ? "full" : "nodes", template_filename: out.template_filename || templates[0] || "" }); }}>
      {clients.map(client => <option key={client.id} value={client.id} disabled={outputs.some((other, i) => i !== index && other.client === client.id)}>{client.name}</option>)}{["shadowrocket", "uri"].includes(out.client) && <option value={out.client}>{clientName(out.client)}</option>}
    </select></Field><Field label={`规则配置${index ? ` ${index + 1}` : ""}`}><select value={out.mode} onChange={e => setOutput(index, { mode: e.target.value as SubscriptionOutput["mode"] })}>{out.client !== "v2ray" && out.client !== "shadowrocket" && out.client !== "uri" && <option value="full">完整配置（分流规则）</option>}{canInherit && out.client === "clashmeta" && <option value="source">保留上游规则</option>}<option value="nodes">仅输出节点</option></select></Field></div><SubscriptionOutputRules out={out} index={index} templates={templates} onChange={next => setOutput(index, next)} onManageTemplates={onManageTemplates} />{out.client === "clash-to-shadowrocket" && <p className="sm-client-hint">完整配置生成小火箭 .conf；仅节点模式提供独立节点订阅。</p>}{out.mode === "source" && <p className="sm-client-hint">保留该外部来源的分组、分流和 DNS，导入原文保持不变。</p>}</section>)}{outputs.length < clients.length && <Button variant="ghost" onClick={() => { const client = clients.find(c => !outputs.some(out => out.client === c.id)); if (client) { invalidate(); setOutputs(current => [...current, { client: client.id, mode: client.full && templates.length ? "full" : "nodes", template_filename: templates[0] || "" }]); } }}><Plus size={15} />添加其他客户端输出</Button>}</div>}
    {step === lastStep && preview && <div className="sm-review"><div className="sm-form-grid"><Field label="订阅名称"><input autoFocus required value={name} onChange={e => setName(e.target.value)} placeholder={kind === "strategy" ? "例如：日常多线订阅" : "例如：自建专线"} /></Field><div className="sm-review-summary"><Badge tone="good"><Check size={13} />预览已生成</Badge><span>{clientName(preview.client)} · {outputs.length} 个客户端输出</span></div></div><div className="sm-preview-counts"><div><small>输入节点</small><strong>{preview.input}</strong></div><div><small>去重 / 过滤 / 失效</small><strong>{preview.duplicate} / {preview.filtered} / {preview.dead}</strong></div><div><small>输出节点</small><strong>{preview.output}</strong></div></div>{preview.unknown > 0 && processing.remove_dead && <p className="sm-hint">{preview.unknown} 个节点暂无近期检测结果，已保留。</p>}{[...new Set([...(preview.warnings || []), ...(preview.outputs || []).flatMap(out => out.warnings || [])])].map(warn => <div className="sm-notice" key={warn}>{warn}</div>)}{kind === "strategy" && <div className="sm-bound-sources"><small>持续绑定来源</small><div>{selectedSourceFiles.map(source => <Badge key={source.id}>{source.name}</Badge>)}</div></div>}<Field label="链接文件名（可选）" hint={file ? "保持原文件名，现有订阅链接继续使用。" : "留空按订阅名称生成。"}><input value={filename} disabled={Boolean(file)} onChange={e => setFilename(e.target.value)} placeholder="subscription.yaml" /></Field><p className="sm-hint">用户额度在用户管理中设置，下发时使用当前用户的独立凭据与流量额度。</p><Button variant="ghost" onClick={() => setShowCode(value => !value)}><Eye size={15} />{showCode ? "收起配置预览" : "查看生成配置"}</Button>{showCode && <div className="sm-code-view">{(preview.outputs?.length || 0) > 1 && <Field label="预览客户端"><select value={previewIndex} onChange={e => setPreviewIndex(Number(e.target.value))}>{preview.outputs!.map((out, i) => <option key={out.client} value={i}>{clientName(out.client)} · {out.output} 个节点</option>)}</select></Field>}<pre className="sm-code">{preview.outputs?.[previewIndex]?.content || preview.content}</pre></div>}</div>}
    <div className="sm-wizard-footer"><Button variant="secondary" onClick={step === 0 ? onClose : () => { setStep(value => value - 1); setError(""); }} disabled={busy}><ArrowLeft size={15} />{step === 0 ? "取消" : "上一步"}</Button><span className="sm-step-hint">{step + 1} / {titles.length}</span><Button onClick={() => void (step === lastStep ? save() : next())} disabled={busy || step < outputStep && !validSelection}>{busy ? <Spinner label={step === lastStep ? "正在保存" : "正在生成预览"} /> : <>{step === lastStep ? "保存订阅" : step === outputStep ? "生成预览" : "下一步"}<ArrowRight size={15} /></>}</Button></div>
    </fieldset>
  </Dialog>;
}
