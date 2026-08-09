import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { CustomRulesWorkbenchPage, RulesConfigWorkbenchPage } from "./rules-workbench";

vi.hoisted(() => {
  (globalThis as unknown as { process: { env: { NODE_ENV?: string } } }).process.env.NODE_ENV = "test";
});

const dnsRule = {
  id: 7,
  name: "安全 DNS",
  type: "dns" as const,
  mode: "replace" as const,
  content: "dns:\n  enable: true\n",
  enabled: true,
  updated_at: "2026-07-19 10:00:00",
};

const routeRule = {
  id: 8,
  name: "内网直连",
  type: "rules" as const,
  mode: "prepend" as const,
  content: "- DOMAIN-SUFFIX,internal.example,DIRECT\n",
  enabled: false,
  updated_at: "2026-07-19 11:00:00",
};

const script = {
  id: 12,
  name: "节点清洗",
  hook: "post_fetch" as const,
  content: "function main(value) { return value; }",
  enabled: true,
  sort_order: 10,
  updated_at: "2026-07-19 12:00:00",
};

function mockCustomRuleLoads() {
  return vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
    if (path === "/api/admin/custom-rules") return [dnsRule, routeRule] as T;
    if (path === "/api/admin/override-scripts") return [script] as T;
    throw new Error(`unexpected GET ${path}`);
  });
}

function mockRuleFileLoads() {
  return vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
    if (path === "/api/admin/rules/") return { files: [{ name: "Hong Kong rules.yaml", size: 2048, mod_time: 1784426400, latest_version: 3 }] } as T;
    if (path === "/api/admin/rules/Hong%20Kong%20rules.yaml") return { name: "Hong Kong rules.yaml", content: "rules:\n  - MATCH,DIRECT\n", latest_version: 3 } as T;
    if (path === "/api/admin/rules/Hong%20Kong%20rules.yaml/history") return {
      history: [{
        Filename: "Hong Kong rules.yaml",
        Version: 3,
        Content: "rules:\n  - MATCH,DIRECT\n",
        CreatedBy: "admin",
        CreatedAt: "2026-07-19T10:00:00Z",
      }],
    } as T;
    throw new Error(`unexpected GET ${path}`);
  });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("custom rules workbench", () => {
  it("merges YAML rules and scripts, then filters them by the original categories", async () => {
    const get = mockCustomRuleLoads();
    render(<CustomRulesWorkbenchPage notify={vi.fn()} />);

    expect(await screen.findByText("安全 DNS")).toBeInTheDocument();
    expect(screen.getByText("内网直连")).toBeInTheDocument();
    expect(screen.getByText("节点清洗")).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith("/api/admin/custom-rules");
    expect(get).toHaveBeenCalledWith("/api/admin/override-scripts");

    fireEvent.click(screen.getByRole("tab", { name: /脚本/ }));
    expect(screen.getByText("节点清洗")).toBeInTheDocument();
    expect(screen.queryByText("安全 DNS")).not.toBeInTheDocument();
    expect(screen.queryByText("内网直连")).not.toBeInTheDocument();
  });

  it("creates a DNS rule with the handler's exact POST payload", async () => {
    mockCustomRuleLoads();
    const post = vi.spyOn(api, "post").mockResolvedValue({
      id: 21,
      name: "自定义 DNS",
      type: "dns",
      mode: "replace",
      content: "dns:\n  enable: false\n",
      enabled: true,
    });
    render(<CustomRulesWorkbenchPage notify={vi.fn()} />);

    await screen.findByText("安全 DNS");
    fireEvent.click(screen.getByRole("button", { name: "新建覆写" }));
    const dialog = screen.getByRole("dialog", { name: "新建覆写" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "名称" }), { target: { value: "自定义 DNS" } });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "规则类型" }), { target: { value: "dns" } });
    expect(within(dialog).getByRole("combobox", { name: "合并方式" })).toHaveValue("replace");
    fireEvent.change(within(dialog).getByRole("textbox", { name: "YAML 内容" }), { target: { value: "dns:\n  enable: false\n" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/custom-rules", {
      name: "自定义 DNS",
      type: "dns",
      mode: "replace",
      content: "dns:\n  enable: false\n",
      enabled: true,
    }));
  });

  it("edits a script without dropping hook, order, enabled state, or content", async () => {
    mockCustomRuleLoads();
    const put = vi.spyOn(api, "put").mockImplementation(async <T,>(_path: string, body?: unknown): Promise<T> => ({ id: 12, ...(body as object) }) as T);
    render(<CustomRulesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "编辑 节点清洗" }));
    const dialog = screen.getByRole("dialog", { name: "编辑 节点清洗" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "名称" }), { target: { value: "保存前清洗" } });
    fireEvent.change(within(dialog).getByRole("combobox", { name: "执行阶段" }), { target: { value: "pre_save_nodes" } });
    fireEvent.change(within(dialog).getByRole("spinbutton", { name: /^执行顺序/ }), { target: { value: "25" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: /^JavaScript 内容/ }), { target: { value: "function main(nodes) { return nodes.filter(Boolean); }" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));

    await waitFor(() => expect(put).toHaveBeenCalledWith("/api/admin/override-scripts/12", {
      name: "保存前清洗",
      hook: "pre_save_nodes",
      content: "function main(nodes) { return nodes.filter(Boolean); }",
      enabled: true,
      sort_order: 25,
    }));
  });

  it("preserves every rule field when toggling and confirms before deleting a script", async () => {
    mockCustomRuleLoads();
    const put = vi.spyOn(api, "put").mockImplementation(async <T,>(_path: string, body?: unknown): Promise<T> => ({ ...dnsRule, ...(body as object) }) as T);
    const remove = vi.spyOn(api, "delete").mockResolvedValue({ status: "deleted" });
    render(<CustomRulesWorkbenchPage notify={vi.fn()} />);

    const row = (await screen.findByText("安全 DNS")).closest("tr")!;
    fireEvent.click(within(row).getByRole("switch", { name: "已启用" }));
    await waitFor(() => expect(put).toHaveBeenCalledWith("/api/admin/custom-rules/7", {
      name: "安全 DNS",
      type: "dns",
      mode: "replace",
      content: "dns:\n  enable: true\n",
      enabled: false,
    }));

    fireEvent.click(screen.getByRole("button", { name: "删除 节点清洗" }));
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith("/api/admin/override-scripts/12"));
  });
});

describe("rules config workbench", () => {
  it("reads and updates an encoded filename through the trailing-slash API", async () => {
    const get = mockRuleFileLoads();
    const put = vi.spyOn(api, "put").mockResolvedValue({ version: 4 });
    render(<RulesConfigWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "编辑" }));
    const editor = await screen.findByRole("dialog", { name: "编辑 Hong Kong rules.yaml" });
    const textarea = await within(editor).findByRole("textbox", { name: "YAML 内容" });
    fireEvent.change(textarea, { target: { value: "rules:\n  - MATCH,PROXY\n" } });
    fireEvent.click(within(editor).getByRole("button", { name: "保存新版本" }));

    expect(get).toHaveBeenCalledWith("/api/admin/rules/");
    expect(get).toHaveBeenCalledWith("/api/admin/rules/Hong%20Kong%20rules.yaml");
    await waitFor(() => expect(put).toHaveBeenCalledWith("/api/admin/rules/Hong%20Kong%20rules.yaml", {
      content: "rules:\n  - MATCH,PROXY\n",
    }));
  });

  it("normalizes the Go history response and keeps historical content read-only", async () => {
    const get = mockRuleFileLoads();
    render(<RulesConfigWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "历史" }));
    const dialog = await screen.findByRole("dialog", { name: "Hong Kong rules.yaml 版本历史" });
    expect(await within(dialog).findByText("版本 3")).toBeInTheDocument();
    expect(within(dialog).getByText("admin")).toBeInTheDocument();
    expect(within(dialog).getByText(/MATCH,DIRECT/)).toBeInTheDocument();
    expect(within(dialog).queryByRole("textbox")).not.toBeInTheDocument();
    expect(get).toHaveBeenCalledWith("/api/admin/rules/Hong%20Kong%20rules.yaml/history");
  });

  it("keeps the newest file when document requests resolve out of order", async () => {
    const slowA = deferred<{
      name: string;
      content: string;
      latest_version: number;
    }>();
    const fastB = deferred<{
      name: string;
      content: string;
      latest_version: number;
    }>();
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/rules/") return {
        files: [
          { name: "A.yaml", size: 120, mod_time: 1784426400, latest_version: 1 },
          { name: "B.yaml", size: 140, mod_time: 1784426401, latest_version: 2 },
        ],
      } as T;
      if (path === "/api/admin/rules/A.yaml") return slowA.promise as Promise<T>;
      if (path === "/api/admin/rules/B.yaml") return fastB.promise as Promise<T>;
      throw new Error(`unexpected GET ${path}`);
    });
    render(<RulesConfigWorkbenchPage notify={vi.fn()} />);

    const rowA = (await screen.findByText("A.yaml")).closest("tr")!;
    const rowB = screen.getByText("B.yaml").closest("tr")!;
    fireEvent.click(within(rowA).getByRole("button", { name: "编辑" }));
    expect(screen.getByRole("dialog", { name: "编辑 A.yaml" })).toBeInTheDocument();
    fireEvent.click(within(rowB).getByRole("button", { name: "编辑" }));

    await act(async () => {
      fastB.resolve({ name: "B.yaml", content: "rules:\n  - MATCH,B\n", latest_version: 2 });
    });
    const editorB = await screen.findByRole("dialog", { name: "编辑 B.yaml" });
    expect(within(editorB).getByRole("textbox", { name: "YAML 内容" })).toHaveValue("rules:\n  - MATCH,B\n");

    await act(async () => {
      slowA.resolve({ name: "A.yaml", content: "rules:\n  - MATCH,A\n", latest_version: 1 });
    });
    expect(screen.getByRole("dialog", { name: "编辑 B.yaml" })).toBeInTheDocument();
    expect(within(editorB).getByRole("textbox", { name: "YAML 内容" })).toHaveValue("rules:\n  - MATCH,B\n");
    expect(screen.queryByRole("dialog", { name: "编辑 A.yaml" })).not.toBeInTheDocument();
  });

  it("does not reopen an editor when a closed document request resolves later", async () => {
    const pending = deferred<{
      name: string;
      content: string;
      latest_version: number;
    }>();
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/rules/") return {
        files: [{ name: "A.yaml", size: 120, mod_time: 1784426400, latest_version: 1 }],
      } as T;
      if (path === "/api/admin/rules/A.yaml") return pending.promise as Promise<T>;
      throw new Error(`unexpected GET ${path}`);
    });
    render(<RulesConfigWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "编辑" }));
    const editor = screen.getByRole("dialog", { name: "编辑 A.yaml" });
    fireEvent.click(within(editor).getByRole("button", { name: "关闭" }));
    expect(screen.queryByRole("dialog", { name: "编辑 A.yaml" })).not.toBeInTheDocument();

    await act(async () => {
      pending.resolve({ name: "A.yaml", content: "rules:\n  - MATCH,A\n", latest_version: 1 });
    });
    expect(screen.queryByRole("dialog", { name: "编辑 A.yaml" })).not.toBeInTheDocument();
  });

  it("confirms every dirty close path while unchanged content closes directly", async () => {
    mockRuleFileLoads();
    render(<RulesConfigWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "编辑" }));
    let editor = await screen.findByRole("dialog", { name: "编辑 Hong Kong rules.yaml" });
    await within(editor).findByRole("textbox", { name: "YAML 内容" });
    expect(within(editor).getByRole("button", { name: "保存新版本" })).toBeDisabled();
    fireEvent.click(within(editor).getByRole("button", { name: "关闭" }));
    expect(screen.queryByRole("dialog", { name: "丢弃未保存的规则文件修改" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "编辑 Hong Kong rules.yaml" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    editor = await screen.findByRole("dialog", { name: "编辑 Hong Kong rules.yaml" });
    const textarea = await within(editor).findByRole("textbox", { name: "YAML 内容" });
    fireEvent.change(textarea, { target: { value: "rules:\n  - MATCH,PROXY\n" } });
    expect(within(editor).getByRole("button", { name: "保存新版本" })).toBeEnabled();

    const cancelDiscard = async () => {
      const confirm = await screen.findByRole("dialog", { name: "丢弃未保存的规则文件修改" });
      fireEvent.click(within(confirm).getByRole("button", { name: "取消" }));
      expect(screen.getByRole("dialog", { name: "编辑 Hong Kong rules.yaml" })).toBeInTheDocument();
    };

    fireEvent.click(within(editor).getByRole("button", { name: "取消" }));
    await cancelDiscard();

    fireEvent.click(within(editor).getByRole("button", { name: "关闭" }));
    await cancelDiscard();

    fireEvent.keyDown(document, { key: "Escape" });
    await cancelDiscard();

    fireEvent.mouseDown(editor.closest(".dialog-backdrop")!);
    const confirm = await screen.findByRole("dialog", { name: "丢弃未保存的规则文件修改" });
    fireEvent.click(within(confirm).getByRole("button", { name: "丢弃修改" }));
    expect(screen.queryByRole("dialog", { name: "编辑 Hong Kong rules.yaml" })).not.toBeInTheDocument();
  });
});
