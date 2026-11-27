import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const requestMock = vi.hoisted(() => vi.fn());
const qrMock = vi.hoisted(() => vi.fn());

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, request: requestMock };
});
vi.mock("qrcode", () => ({ default: { toDataURL: qrMock } }));

import { api } from "./api";
import { CertificatesWorkbenchPage, SubscribeFilesPage, TemplatesWorkbenchPage } from "./content-workbench";

vi.hoisted(() => {
  (globalThis as unknown as { process: { env: { NODE_ENV?: string } } }).process.env.NODE_ENV = "test";
});

afterEach(() => {
  cleanup();
  requestMock.mockReset();
  qrMock.mockReset();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

function subscribeLoad(path: string, files: unknown[] = [], external: unknown[] = [], providers: unknown[] = []): unknown {
  if (path === "/api/admin/subscribe-files") return { files };
  if (path === "/api/subscriptions") return { subscriptions: [] };
  if (path === "/api/user/external-subscriptions") return external;
  if (path === "/api/user/token") return { token: "secret", user_short_code: "usr" };
  if (path === "/api/admin/custom-rules") return [{ id: 11, name: "DNS 覆写", type: "dns", enabled: true }];
  if (path === "/api/admin/override-scripts") return [{ id: 13, name: "节点整理", hook: "post_fetch", enabled: true }];
  if (path === "/api/admin/nodes") return { nodes: [{ id: 7, node_name: "香港 01", protocol: "vless", clash_config: "{}", enabled: true }] };
  if (path === "/api/admin/rule-templates") return { templates: ["edge_v3.yaml"], owners: {}, username: "admin", is_admin: true };
  if (path === "/api/admin/remote-servers") return { servers: [{ id: 2, name: "Edge HK" }] };
  if (path === "/api/user/proxy-provider-configs") return providers;
  throw new Error(`unexpected GET ${path}`);
}

describe("content workbench templates", () => {
  it("updates template content and filename in one atomic request", async () => {
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/rule-templates") return { templates: ["old.yaml"], owners: { "old.yaml": "alice" }, username: "alice", is_admin: false } as T;
      if (path === "/api/admin/rule-templates/old.yaml") return { content: "rules:\n  - MATCH,DIRECT\n" } as T;
      throw new Error(`unexpected GET ${path}`);
    });
    const put = vi.spyOn(api, "put").mockResolvedValue({ filename: "new.yaml" });
    const post = vi.spyOn(api, "post");
    render(<TemplatesWorkbenchPage />);

    fireEvent.click(await screen.findByRole("button", { name: "编辑 old.yaml" }));
    fireEvent.change(screen.getByRole("textbox", { name: /文件名/ }), { target: { value: "new" } });
    const editor = await screen.findByRole("textbox", { name: "YAML 内容" });
    fireEvent.change(editor, { target: { value: "rules:\n  - MATCH,PROXY\n" } });
    fireEvent.click(screen.getByRole("button", { name: "保存模板" }));

    await waitFor(() => expect(put).toHaveBeenCalledWith("/api/admin/rule-templates/old.yaml", {
      content: "rules:\n  - MATCH,PROXY\n",
      new_name: "new.yaml",
    }));
    expect(post).not.toHaveBeenCalledWith("/api/admin/rule-templates/rename", expect.anything());
  });

  it("marks the current default template and can change it in place", async () => {
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/rule-templates") return { templates: ["edge_v3.yaml", "private.yaml"], owners: {}, username: "admin", is_admin: true } as T;
      if (path === "/api/admin/system-settings/default-template") return { default_template_filename: "edge_v3.yaml" } as T;
      throw new Error(`unexpected GET ${path}`);
    });
    const put = vi.spyOn(api, "put").mockResolvedValue({});

    render(<TemplatesWorkbenchPage notify={vi.fn()} />);
    expect(await screen.findByRole("button", { name: "默认模板" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "删除 edge_v3.yaml" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "将 private.yaml 设为默认模板" }));

    await waitFor(() => expect(put).toHaveBeenCalledWith("/api/admin/system-settings/default-template", { default_template_filename: "private.yaml" }));
    expect(screen.getByRole("button", { name: "默认模板" })).toBeDisabled();
  });

  it("loads an existing template into the visual editor and saves structured updates", async () => {
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/rule-templates") return { templates: ["edge_v3.yaml"], owners: {}, username: "admin", is_admin: true } as T;
      if (path === "/api/admin/rule-templates/edge_v3.yaml") {
        return {
          content: "mode: rule\ngeodata-mode: true\ndns:\n  enable: true\n  enhanced-mode: fake-ip\n  nameserver:\n    - tls://8.8.8.8\nproxy-groups:\n  - name: PROXY\n    type: select\n    proxies:\n      - __PROXY_NODES__\n      - DIRECT\nrules:\n  - MATCH,PROXY\n",
        } as T;
      }
      if (path === "/api/admin/nodes") return { nodes: [] } as T;
      if (path === "/api/admin/template-v3/region-filters") return { region_filters: {} } as T;
      if (path === "/api/user/proxy-provider-configs") return [] as T;
      throw new Error(`unexpected GET ${path}`);
    });
    const post = vi.spyOn(api, "post").mockResolvedValue({ content: "ok" });
    const put = vi.spyOn(api, "put").mockResolvedValue({ success: true });

    render(<TemplatesWorkbenchPage notify={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "可视化修改 edge_v3.yaml" }));

    expect(await screen.findByRole("dialog", { name: "可视化修改 · edge_v3.yaml" })).toBeInTheDocument();
    expect(await screen.findByRole("textbox", { name: "模板文件名" })).toHaveValue("edge_v3.yaml");
    fireEvent.change(screen.getByRole("combobox", { name: "类型" }), { target: { value: "url-test" } });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/template-v3/preview", expect.objectContaining({
      proxies: [],
      template_content: expect.stringContaining("geodata-mode: true"),
    })));
    await waitFor(() => expect(put).toHaveBeenCalledWith(
      "/api/admin/rule-templates/edge_v3.yaml",
      expect.objectContaining({
        new_name: "edge_v3.yaml",
        content: expect.stringContaining('type: "url-test"'),
      }),
    ));
  });

  it("fetches a URL through the backend and uploads the resulting YAML", async () => {
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/rule-templates") return { templates: [], owners: {}, username: "admin", is_admin: true } as T;
      if (path === "/api/admin/subscribe-files") return { files: [] } as T;
      throw new Error(`unexpected GET ${path}`);
    });
    const post = vi.spyOn(api, "post").mockResolvedValue({ content: "proxies: []\nrules: []" });
    requestMock.mockResolvedValue({ filename: "remote.yaml" });

    render(<TemplatesWorkbenchPage notify={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "新建模板" }));
    fireEvent.click(screen.getByRole("button", { name: "从 URL" }));
    fireEvent.change(screen.getByRole("textbox", { name: "模板文件名" }), { target: { value: "remote" } });
    fireEvent.change(screen.getByRole("textbox", { name: "模板 URL" }), { target: { value: "https://rules.example/template.yaml" } });
    fireEvent.click(screen.getByRole("button", { name: "创建模板" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/templates/fetch-source", { url: "https://rules.example/template.yaml", use_proxy: false }));
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith("/api/admin/rule-templates/upload", expect.objectContaining({ method: "POST", body: expect.any(FormData) })));
    const form = requestMock.mock.calls[0][1].body as FormData;
    expect((form.get("template") as File).name).toBe("remote.yaml");
  });

  it("surfaces subscription loading failures and retries before template creation", async () => {
    let subscriptionAttempts = 0;
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/rule-templates") return { templates: [], owners: {}, username: "admin", is_admin: true } as T;
      if (path === "/api/admin/system-settings/default-template") return { default_template_filename: "" } as T;
      if (path === "/api/admin/subscribe-files") {
        subscriptionAttempts += 1;
        if (subscriptionAttempts === 1) throw new Error("subscription list unavailable");
        return { files: [{ id: 4, name: "主订阅", filename: "main.yaml" }] } as T;
      }
      throw new Error(`unexpected GET ${path}`);
    });

    render(<TemplatesWorkbenchPage notify={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "新建模板" }));
    fireEvent.click(screen.getByRole("button", { name: "从订阅" }));

    expect(await screen.findByText("subscription list unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建模板" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    expect(await screen.findByRole("option", { name: "主订阅 · main.yaml" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "创建模板" })).toBeEnabled();
    expect(subscriptionAttempts).toBe(2);
  });

  it("deletes a rule template only after confirmation", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ templates: ["private.yaml"], owners: { "private.yaml": "admin" }, username: "admin", is_admin: true });
    const remove = vi.spyOn(api, "delete").mockResolvedValue({ message: "ok" });
    render(<TemplatesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "删除 private.yaml" }));
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith("/api/admin/rule-templates/private.yaml"));
  });

  it("builds an ordered structured template and uploads valid generated YAML", async () => {
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/rule-templates") return { templates: [], owners: {}, username: "admin", is_admin: true } as T;
      if (path === "/api/admin/nodes") return { nodes: [{ id: 7, node_name: "香港 01", protocol: "vless", clash_config: "{}", enabled: true }] } as T;
      if (path === "/api/admin/template-v3/region-filters") return { region_filters: { 香港: "香港|HK" } } as T;
      throw new Error(`unexpected GET ${path}`);
    });
    const validate = vi.spyOn(api, "post").mockResolvedValue({ content: "ok" });
    requestMock.mockResolvedValue({ filename: "structured.yaml" });
    render(<TemplatesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "可视化设计" }));
    fireEvent.change(screen.getByRole("textbox", { name: "模板文件名" }), { target: { value: "structured" } });
    fireEvent.change(screen.getByRole("combobox", { name: "类型" }), { target: { value: "url-test" } });
    const source = await screen.findByRole("option", { name: "节点 · 香港 01" });
    fireEvent.change(screen.getByRole("combobox", { name: "添加 PROXY 来源" }), { target: { value: source.getAttribute("value") } });
    fireEvent.click(screen.getByRole("tab", { name: "YAML 预览" }));

    expect(screen.getByText(/type: "url-test"/)).toBeInTheDocument();
    expect(screen.getByText(/proxies:[\s\S]*香港 01/)).toBeInTheDocument();
    expect(screen.queryByText(/use:/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存新模板" }));

    await waitFor(() => expect(validate).toHaveBeenCalledWith("/api/admin/template-v3/preview", expect.objectContaining({ proxies: [], template_content: expect.stringContaining('type: "url-test"') })));
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith("/api/admin/rule-templates/upload", expect.objectContaining({ method: "POST", body: expect.any(FormData) })));
    const form = requestMock.mock.calls[0][1].body as FormData;
    const file = form.get("template") as File;
    expect(file.name).toBe("structured.yaml");
    expect(await file.text()).toContain('type: "url-test"');
    expect(await file.text()).toContain('proxies:\n      - "__PROXY_NODES__"\n      - "DIRECT"\n      - "香港 01"');
  });

  it("restores a valid visual template draft from local storage", async () => {
    window.localStorage.setItem("arcway:visual-template-draft:v1", JSON.stringify({
      version: 1,
      filename: "recovered.yaml",
      dnsMode: "off",
      ipv6: false,
      nameservers: [],
      fakeIPRange: "198.18.0.1/16",
      fakeIPFilters: [],
      groups: [{ id: "g1", name: "RECOVERED", type: "select", sources: [{ id: "s1", kind: "builtin", value: "DIRECT" }], url: "", interval: 300, tolerance: 0, lazy: true, filter: "", excludeFilter: "", excludeType: "", strategy: "consistent-hashing", dialerProxyGroup: "" }],
      rules: ["MATCH,RECOVERED"],
    }));
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/rule-templates") return { templates: [], owners: {}, username: "admin", is_admin: true } as T;
      if (path === "/api/admin/nodes") return { nodes: [] } as T;
      if (path === "/api/admin/template-v3/region-filters") return { region_filters: {} } as T;
      throw new Error(`unexpected GET ${path}`);
    });
    render(<TemplatesWorkbenchPage />);
    fireEvent.click(await screen.findByRole("button", { name: "可视化设计" }));

    expect(screen.getByText("已恢复上次未保存草稿")).toBeInTheDocument();
    expect(screen.getByDisplayValue("recovered.yaml")).toBeInTheDocument();
    expect(screen.getByDisplayValue("RECOVERED")).toBeInTheDocument();
  });

  it("loads Provider sources and preserves them as use references", async () => {
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/rule-templates") return { templates: [], owners: {}, username: "admin", is_admin: true } as T;
      if (path === "/api/admin/nodes") return { nodes: [] } as T;
      if (path === "/api/admin/template-v3/region-filters") return { region_filters: {} } as T;
      if (path === "/api/user/proxy-provider-configs") return [{ id: 9, name: "Airport HK", process_mode: "" }] as T;
      throw new Error(`unexpected GET ${path}`);
    });
    const post = vi.spyOn(api, "post").mockResolvedValue({ content: "ok" });
    requestMock.mockResolvedValue({ filename: "visual_v3.yaml" });
    render(<TemplatesWorkbenchPage />);

    fireEvent.click(await screen.findByRole("button", { name: "可视化设计" }));
    const provider = await screen.findByRole("option", { name: "Provider · Airport HK · Mihomo 拉取" });
    fireEvent.change(screen.getByRole("combobox", { name: "添加 PROXY 来源" }), { target: { value: provider.getAttribute("value") } });
    fireEvent.click(screen.getByRole("tab", { name: "YAML 预览" }));

    expect(screen.getByText(/use:[\s\S]*Airport HK/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存新模板" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/template-v3/preview", expect.objectContaining({ template_content: expect.stringContaining('use:\n      - "Airport HK"') })));
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith("/api/admin/rule-templates/upload", expect.objectContaining({ method: "POST", body: expect.any(FormData) })));
  });

  it("clearly rejects a restored draft whose Provider no longer exists", async () => {
    window.localStorage.setItem("arcway:visual-template-draft:v1", JSON.stringify({
      version: 1,
      filename: "provider.yaml",
      dnsMode: "off",
      ipv6: false,
      nameservers: [],
      fakeIPRange: "198.18.0.1/16",
      fakeIPFilters: [],
      groups: [{ id: "g1", name: "PROXY", type: "select", sources: [{ id: "s1", kind: "provider", value: "Removed Airport" }], url: "", interval: 300, tolerance: 0, lazy: true, filter: "", excludeFilter: "", excludeType: "", strategy: "consistent-hashing", dialerProxyGroup: "" }],
      rules: ["MATCH,PROXY"],
    }));
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/rule-templates") return { templates: [], owners: {}, username: "admin", is_admin: true } as T;
      if (path === "/api/admin/nodes") return { nodes: [] } as T;
      if (path === "/api/admin/template-v3/region-filters") return { region_filters: {} } as T;
      if (path === "/api/user/proxy-provider-configs") return [] as T;
      throw new Error(`unexpected GET ${path}`);
    });
    const post = vi.spyOn(api, "post");
    render(<TemplatesWorkbenchPage />);

    fireEvent.click(await screen.findByRole("button", { name: "可视化设计" }));
    expect(await screen.findByText(/Removed Airport。请重新选择来源后再保存/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存新模板" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Proxy Provider 已不存在或不可用：Removed Airport");
    expect(post).not.toHaveBeenCalled();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("cannot dismiss the visual editor while its template is saving", async () => {
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/rule-templates") return { templates: [], owners: {}, username: "admin", is_admin: true } as T;
      if (path === "/api/admin/nodes") return { nodes: [] } as T;
      if (path === "/api/admin/template-v3/region-filters") return { region_filters: {} } as T;
      if (path === "/api/user/proxy-provider-configs") return [] as T;
      throw new Error(`unexpected GET ${path}`);
    });
    let resolvePreview!: (value: { content: string }) => void;
    vi.spyOn(api, "post").mockImplementation(<T,>(): Promise<T> => new Promise((resolve) => {
      resolvePreview = resolve as (value: { content: string }) => void;
    }));
    requestMock.mockResolvedValue({ filename: "visual_v3.yaml" });
    render(<TemplatesWorkbenchPage />);

    fireEvent.click(await screen.findByRole("button", { name: "可视化设计" }));
    fireEvent.click(screen.getByRole("button", { name: "保存新模板" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "取消" })).toBeDisabled());
    expect(screen.getByRole("textbox", { name: "模板文件名" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "关闭" })).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.mouseDown(screen.getByRole("presentation"));
    expect(screen.getByRole("dialog", { name: "可视化模板设计" })).toBeInTheDocument();

    resolvePreview({ content: "ok" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "可视化模板设计" })).not.toBeInTheDocument());
  });
});

describe("content workbench subscriptions", () => {
  it("keeps the core list usable for a normal user without calling the admin-only server endpoint", async () => {
    const get = vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/remote-servers") throw new Error("admin endpoint must not be called");
      if (path === "/api/admin/nodes") throw new Error("节点服务暂不可用");
      return subscribeLoad(path, [{ id: 4, name: "可用订阅", filename: "ready.yaml", type: "create", auto_sync_custom_rules: false }]) as T;
    });

    render(<SubscribeFilesPage isAdmin={false} />);

    expect(await screen.findByText("可用订阅")).toBeInTheDocument();
    expect(screen.getByText(/节点加载失败/)).toBeInTheDocument();
    expect(get).not.toHaveBeenCalledWith("/api/admin/remote-servers");
    expect(screen.queryByText("admin endpoint must not be called")).not.toBeInTheDocument();
  });

  it("keeps rule management entry points with subscription management", async () => {
    const onOpenCustomRules = vi.fn();
    const onOpenRulesConfig = vi.fn();
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => subscribeLoad(path) as T);

    render(<SubscribeFilesPage onOpenCustomRules={onOpenCustomRules} onOpenRulesConfig={onOpenRulesConfig} />);

    fireEvent.click(await screen.findByRole("button", { name: "覆写规则" }));
    fireEvent.click(screen.getByRole("button", { name: /模板管理|管理规则模板/ }));

    expect(onOpenCustomRules).toHaveBeenCalledOnce();
    expect(onOpenRulesConfig).toHaveBeenCalledOnce();
  });

  it("preserves server scopes and traffic limits when toggling an unrelated setting", async () => {
    const file = {
      id: 4,
      name: "受限订阅",
      description: "production",
      type: "import",
      filename: "limited.yaml",
      auto_sync_custom_rules: true,
      selected_tags: ["hk"],
      selected_node_ids: [7],
      selected_custom_rule_ids: [11],
      selected_override_script_ids: [13],
      stats_server_ids: "2,5",
      traffic_limit: 107374182400,
    };
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => subscribeLoad(path, [file]) as T);
    const put = vi.spyOn(api, "put").mockResolvedValue({});
    render(<SubscribeFilesPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByLabelText("更多操作 受限订阅"));
    fireEvent.click(screen.getByRole("button", { name: "关闭 受限订阅 自动同步" }));

    await waitFor(() => expect(put).toHaveBeenCalledWith("/api/admin/subscribe-files/4", expect.objectContaining({
      auto_sync_custom_rules: false,
      selected_custom_rule_ids: [11],
      selected_override_script_ids: [13],
      stats_server_ids: "2,5",
      traffic_limit: 107374182400,
    })));
  });

  it("applies template output immediately after a URL import returns its file ID", async () => {
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => subscribeLoad(path) as T);
    const created = { id: 15, name: "新订阅", description: "", type: "import", filename: "new.yaml", auto_sync_custom_rules: false };
    const post = vi.spyOn(api, "post").mockImplementation(async (path) => {
      if (path.endsWith("/parse-preview")) return { count: 1, nodes: [{ key: "n1", name: "Node 1", type: "ss", country_code: "HK" }] };
      return { file: created };
    });
    const put = vi.spyOn(api, "put").mockResolvedValue({});
    render(<SubscribeFilesPage />);

    fireEvent.click((await screen.findAllByRole("button", { name: "添加外部订阅" }))[0]);
    fireEvent.change(screen.getByRole("textbox", { name: "订阅名称" }), { target: { value: "新订阅" } });
    fireEvent.change(screen.getByRole("textbox", { name: "订阅 URL" }), { target: { value: "https://sub.example/new" } });
    fireEvent.click(screen.getByRole("button", { name: "高级配置 · 分流规则" }));
    expect(screen.getByRole("combobox", { name: "规则配置" })).toHaveValue("source");
    fireEvent.change(screen.getByRole("combobox", { name: "规则配置" }), { target: { value: "full" } });
    fireEvent.change(screen.getByRole("combobox", { name: /^规则模板/ }), { target: { value: "edge_v3.yaml" } });
    fireEvent.click(screen.getByRole("button", { name: "下一步：预览节点" }));

    expect(await screen.findByText("Node 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "完成导入" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/subscribe-files/import", {
      name: "新订阅",
      description: "",
      url: "https://sub.example/new",
      filename: "",
      auto_update_interval: 0,
      node_regions: { n1: "HK" },
    }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/subscribe-files/generation", expect.objectContaining({
      id: 15, generation: expect.objectContaining({ kind: "external", outputs: [expect.objectContaining({ mode: "full", template_filename: "edge_v3.yaml" })] }),
    })));
    expect(put).not.toHaveBeenCalled();
    expect(screen.queryByText("指定覆写规则")).not.toBeInTheDocument();
    expect(screen.queryByText("指定覆写脚本")).not.toBeInTheDocument();
  });

  it("retries only advanced settings when import succeeded before the update failed", async () => {
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => subscribeLoad(path) as T);
    const created = { id: 15, name: "新订阅", description: "", type: "import", filename: "new.yaml", auto_sync_custom_rules: false };
    let attempts = 0;
    const post = vi.spyOn(api, "post").mockImplementation(async (path) => {
      if (path.endsWith("/parse-preview")) return { count: 1, nodes: [{ key: "n1", name: "Node 1", type: "ss", country_code: "HK" }] };
      if (path.endsWith("/generation") && ++attempts === 1) throw new Error("高级设置暂不可用");
      return { file: created };
    });
    render(<SubscribeFilesPage />);

    fireEvent.click((await screen.findAllByRole("button", { name: "添加外部订阅" }))[0]);
    fireEvent.change(screen.getByRole("textbox", { name: "订阅名称" }), { target: { value: "新订阅" } });
    fireEvent.change(screen.getByRole("textbox", { name: "订阅 URL" }), { target: { value: "https://sub.example/new" } });
    fireEvent.click(screen.getByRole("button", { name: "高级配置 · 分流规则" }));
    expect(screen.getByRole("combobox", { name: "规则配置" })).toHaveValue("source");
    fireEvent.change(screen.getByRole("combobox", { name: "规则配置" }), { target: { value: "full" } });
    fireEvent.change(screen.getByRole("combobox", { name: /^规则模板/ }), { target: { value: "edge_v3.yaml" } });
    fireEvent.click(screen.getByRole("button", { name: "下一步：预览节点" }));

    expect(await screen.findByText("Node 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "完成导入" }));

    expect(await screen.findByText("高级设置暂不可用")).toBeInTheDocument();
    expect(screen.getByText(/已导入；再次提交只会重试/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "重试高级设置" }));

    await waitFor(() => expect(post.mock.calls.filter(([path]) => path.endsWith("/generation"))).toHaveLength(2));
    expect(post.mock.calls.filter(([path]) => path === "/api/admin/subscribe-files/import")).toHaveLength(1);
  });

  it("reloads an imported file when advanced settings fail and the dialog closes", async () => {
    const created = { id: 15, name: "新订阅", description: "", type: "import", filename: "new.yaml", auto_sync_custom_rules: false };
    let fileLoads = 0;
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/subscribe-files") {
        fileLoads += 1;
        return { files: fileLoads > 1 ? [created] : [] } as T;
      }
      return subscribeLoad(path) as T;
    });
    vi.spyOn(api, "post").mockImplementation(async (path) => {
      if (path.endsWith("/parse-preview")) return { count: 1, nodes: [{ key: "n1", name: "Node 1", type: "ss", country_code: "HK" }] };
      if (path.endsWith("/generation")) throw new Error("高级设置暂不可用");
      return { file: created };
    });
    const notify = vi.fn();
    render(<SubscribeFilesPage notify={notify} />);

    fireEvent.click((await screen.findAllByRole("button", { name: "添加外部订阅" }))[0]);
    fireEvent.change(screen.getByRole("textbox", { name: "订阅名称" }), { target: { value: "新订阅" } });
    fireEvent.change(screen.getByRole("textbox", { name: "订阅 URL" }), { target: { value: "https://sub.example/new" } });
    fireEvent.click(screen.getByRole("button", { name: "高级配置 · 分流规则" }));
    fireEvent.click(screen.getByRole("button", { name: "下一步：预览节点" }));

    expect(await screen.findByText("Node 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "完成导入" }));

    expect(await screen.findByText("高级设置暂不可用")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: /确认节点与地区/ })).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByText("新订阅")).toBeInTheDocument());
    expect(fileLoads).toBeGreaterThanOrEqual(2);
    expect(notify).toHaveBeenCalledWith("订阅已导入，但高级设置尚未保存", "error");
  });

  it("cannot dismiss an import while its create request is still running", async () => {
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => subscribeLoad(path) as T);
    const created = { id: 15, name: "新订阅", description: "", type: "import", filename: "new.yaml", auto_sync_custom_rules: false };
    let resolveImport!: (value: { file: typeof created }) => void;
    vi.spyOn(api, "post").mockImplementation(async (path) => {
      if (path.endsWith("/parse-preview")) return { count: 1, nodes: [{ key: "n1", name: "Node 1", type: "ss", country_code: "HK" }] };
      if (path.endsWith("/generation")) return {};
      return new Promise((resolve) => { resolveImport = resolve; });
    });
    render(<SubscribeFilesPage />);

    fireEvent.click((await screen.findAllByRole("button", { name: "添加外部订阅" }))[0]);
    fireEvent.change(screen.getByRole("textbox", { name: "订阅名称" }), { target: { value: "新订阅" } });
    fireEvent.change(screen.getByRole("textbox", { name: "订阅 URL" }), { target: { value: "https://sub.example/new" } });
    fireEvent.click(screen.getByRole("button", { name: "下一步：预览节点" }));

    expect(await screen.findByText("Node 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "完成导入" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "上一步" })).toBeDisabled());
    expect(screen.queryByRole("button", { name: "关闭" })).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.mouseDown(screen.getByRole("presentation"));
    expect(screen.getByRole("dialog", { name: /确认节点与地区/ })).toBeInTheDocument();

    resolveImport({ file: created });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /确认节点与地区/ })).not.toBeInTheDocument());
  });

  it("allows overriding node region during external subscription preview before import", async () => {
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => subscribeLoad(path) as T);
    const created = { id: 16, name: "节点改区订阅", description: "", type: "import", filename: "preview.yaml", auto_sync_custom_rules: false };
    const post = vi.spyOn(api, "post").mockImplementation(async (path) => {
      if (path.endsWith("/parse-preview")) {
        return { count: 2, nodes: [
          { key: "k1", name: "HK-01", type: "ss", country_code: "HK" },
          { key: "k2", name: "Unknown-Node", type: "vless", country_code: "" }
        ] };
      }
      return { file: created };
    });
    render(<SubscribeFilesPage />);

    fireEvent.click((await screen.findAllByRole("button", { name: "添加外部订阅" }))[0]);
    fireEvent.change(screen.getByRole("textbox", { name: "订阅名称" }), { target: { value: "节点改区订阅" } });
    fireEvent.change(screen.getByRole("textbox", { name: "订阅 URL" }), { target: { value: "https://sub.example/preview" } });
    fireEvent.click(screen.getByRole("button", { name: "下一步：预览节点" }));

    expect(await screen.findByText("HK-01")).toBeInTheDocument();
    expect(screen.getByText("Unknown-Node")).toBeInTheDocument();

    const node2Select = screen.getByLabelText("修改 Unknown-Node 的地区");
    fireEvent.change(node2Select, { target: { value: "JP" } });

    fireEvent.click(screen.getByRole("button", { name: "完成导入" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/subscribe-files/import", expect.objectContaining({
      name: "节点改区订阅",
      node_regions: { k1: "HK", k2: "JP" },
    })));
  });

  it("syncs an external subscribe file directly from the subscription list action button", async () => {
    const externalFile = {
      id: 15,
      name: "外部订阅文件",
      description: "",
      type: "import",
      url: "https://sub.example/test",
      filename: "ext.yaml",
      auto_sync_custom_rules: false,
      auto_update_interval: 3600,
      last_sync_at: "2026-11-24T08:00:00Z",
    };
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/subscribe-files") return { files: [externalFile] } as T;
      return subscribeLoad(path) as T;
    });
    const post = vi.spyOn(api, "post").mockResolvedValue({ file: { ...externalFile, last_sync_at: "2026-11-24T08:30:00Z" } });
    const notify = vi.fn();
    render(<SubscribeFilesPage notify={notify} />);

    expect(await screen.findByText("外部订阅文件")).toBeInTheDocument();
    expect(screen.getByText("每 1 小时更新")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("更多操作 外部订阅文件"));

    const syncButton = screen.getByRole("button", { name: "立即同步 外部订阅文件" });
    fireEvent.click(syncButton);

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/subscribe-files/15/sync"));
    await waitFor(() => expect(notify).toHaveBeenCalledWith("“外部订阅文件”外部订阅同步成功"));
  });

  it("navigates across 4 subscription tabs: all, external, custom combination, and strategy provider", async () => {
    const files = [{ id: 1, name: "机场订阅", type: "import", filename: "airport.yaml" }, { id: 2, name: "自选专线", type: "create", filename: "custom.yaml" }, { id: 3, name: "多线策略", type: "create", filename: "strategy.yaml", kind: "strategy", generation: { kind: "strategy", source_ids: [1,2], outputs: [], processing: {} } }];
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => subscribeLoad(path, files) as T);
    render(<SubscribeFilesPage />);
    expect(await screen.findByText("机场订阅")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /外部订阅/ }));
    expect(screen.getByText("机场订阅")).toBeInTheDocument(); expect(screen.queryByText("自选专线")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /自选订阅/ }));
    expect(screen.getByText("自选专线")).toBeInTheDocument(); expect(screen.queryByText("机场订阅")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /策略订阅/ })); expect(screen.getByText("多线策略")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Proxy Provider" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /全部订阅/ })); expect(screen.getByText("自选专线")).toBeInTheDocument();
  });

  it("creates a custom subscription without a duplicate file quota", async () => {
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => subscribeLoad(path) as T);
    const post = vi.spyOn(api, "post").mockImplementation(async <T,>(path: string): Promise<T> => (path.endsWith("preview") ? { input: 1, output: 1, duplicate: 0, filtered: 0, dead: 0, unknown: 1, warnings: [], client: "clashmeta", content: "proxies: []" } : { file: { id: 88 } }) as T);
    const put = vi.spyOn(api, "put");
    render(<SubscribeFilesPage />);
    fireEvent.click((await screen.findAllByRole("button", { name: "创建自选订阅" }))[0]);
    fireEvent.click(screen.getByRole("checkbox", { name: "选择节点 香港 01" }));
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    fireEvent.click(screen.getByRole("button", { name: "生成预览" }));
    await screen.findByText("预览已生成");
    fireEvent.change(screen.getByRole("textbox", { name: "订阅名称" }), { target: { value: "自选套餐" } });
    fireEvent.change(screen.getByRole("textbox", { name: /文件名/ }), { target: { value: "my-package.yaml" } });
    fireEvent.click(screen.getByRole("button", { name: "保存订阅" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/subscribe-files/generation", expect.objectContaining({ name: "自选套餐", filename: "my-package.yaml", selected_node_ids: [7], generation: expect.objectContaining({ kind: "custom" }) })));
    expect(put).not.toHaveBeenCalled();
  });

  it("composes a strategy subscription from existing external and custom subscriptions", async () => {
    const files = [{ id: 1, name: "外部机场", filename: "airport.yaml", type: "import", selected_node_ids: [] }, { id: 2, name: "自选专线", filename: "custom.yaml", type: "create", selected_node_ids: [20] }];
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => subscribeLoad(path, files) as T);
    const post = vi.spyOn(api, "post").mockImplementation(async <T,>(path: string): Promise<T> => (path.endsWith("preview") ? { input: 4, output: 3, duplicate: 1, filtered: 0, dead: 0, unknown: 4, warnings: [], client: "clashmeta", content: "proxies: []" } : { file: { id: 99 } }) as T);
    render(<SubscribeFilesPage />);
    fireEvent.click(await screen.findByRole("checkbox", { name: "选择来源 外部机场" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "选择来源 自选专线" }));
    fireEvent.click(screen.getByRole("button", { name: "用所选来源创建策略" }));
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    fireEvent.click(screen.getByRole("switch", { name: "自动剔除失效节点" }));
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    expect(screen.getByRole("combobox", { name: /^规则模板/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "保留上游规则" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "生成预览" }));
    await screen.findByText("预览已生成");
    fireEvent.change(screen.getByRole("textbox", { name: "订阅名称" }), { target: { value: "多源策略调度" } });
    fireEvent.click(screen.getByRole("button", { name: "保存订阅" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/subscribe-files/generation", expect.objectContaining({ name: "多源策略调度", selected_node_ids: [], generation: expect.objectContaining({ kind: "strategy", source_ids: [1,2], processing: expect.objectContaining({ remove_dead: true }) }) })));
    expect(post).not.toHaveBeenCalledWith("/api/admin/subscribe-files/create-from-config", expect.anything());
  });

});

describe("content workbench certificates", () => {
  function mockCertificateLoads(
    certificate: Record<string, unknown> = {},
    credentialsResponse: unknown = { success: true, credentials: { CF_DNS_API_TOKEN: "SAVED_TOKEN" } },
    servers: Array<{ id: number; name: string }> = [],
  ) {
    return vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/certificates") return { success: true, certificates: [{ id: 3, domain: "*.example.com", email: "ops@example.com", provider: "letsencrypt", status: "valid", expiry_date: "2030-01-01T00:00:00Z", issue_date: "2029-10-01T00:00:00Z", auto_renew: false, auto_deploy: false, challenge_mode: "dns", dns_provider_id: 8, deploy_target: "none", ...certificate }] } as T;
      if (path === "/api/admin/dns-providers") return { success: true, providers: [{ ID: 8, Name: "Cloudflare", ProviderType: "cloudflare", Credentials: "TOP_SECRET_TOKEN", UpdatedAt: "2026-01-01T00:00:00Z" }] } as T;
      if (path === "/api/admin/dns-providers/8/credentials") return credentialsResponse as T;
      if (path === "/api/admin/remote-servers") return { servers } as T;
      throw new Error(`unexpected GET ${path}`);
    });
  }

  it("updates auto-renew with the certificate PATCH endpoint", async () => {
    mockCertificateLoads();
    requestMock.mockResolvedValue({ success: true });
    render(<CertificatesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("switch", { name: "自动续期" }));

    await waitFor(() => expect(requestMock).toHaveBeenCalledWith("/api/admin/certificates/auto-renew", expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ id: 3, auto_renew: true }),
    })));
  });

  it("disables automatic renewal for manual certificates", async () => {
    mockCertificateLoads({ provider: "manual", challenge_mode: "manual" });
    render(<CertificatesWorkbenchPage notify={vi.fn()} />);

    expect(await screen.findByRole("switch", { name: "自动续期" })).toBeDisabled();
  });

  it("does not fetch stored DNS credentials automatically and preserves them on an untouched edit", async () => {
    const get = mockCertificateLoads();
    const put = vi.spyOn(api, "put").mockResolvedValue({ success: true });
    render(<CertificatesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("tab", { name: /DNS 提供商/ }));
    expect(screen.queryByDisplayValue("TOP_SECRET_TOKEN")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "编辑 Cloudflare" }));
    expect(get).not.toHaveBeenCalledWith("/api/admin/dns-providers/8/credentials");
    expect(screen.getByLabelText("API 密钥")).toHaveValue("");
    expect(screen.getByLabelText("账户邮箱（可选）")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(put).toHaveBeenCalledWith("/api/admin/dns-providers/8", {
      name: "Cloudflare",
      provider_type: "cloudflare",
      credentials: JSON.stringify({}),
    }));
  });

  it("reveals and populates stored Cloudflare credentials only after an explicit request, then saves them", async () => {
    const get = mockCertificateLoads({}, {
      success: true,
      credentials: { CF_API_EMAIL: "owner@example.com", CF_API_KEY: "GLOBAL_KEY" },
    });
    const put = vi.spyOn(api, "put").mockResolvedValue({ success: true });
    render(<CertificatesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("tab", { name: /DNS 提供商/ }));
    fireEvent.click(screen.getByRole("button", { name: "编辑 Cloudflare" }));
    const dialog = screen.getByRole("dialog", { name: "编辑 DNS 提供商" });
    const keyInput = within(dialog).getByLabelText("API 密钥");
    expect(keyInput).toHaveAttribute("type", "password");
    expect(get).not.toHaveBeenCalledWith("/api/admin/dns-providers/8/credentials");

    fireEvent.click(within(dialog).getByRole("button", { name: "显示已保存凭据" }));

    await waitFor(() => expect(keyInput).toHaveValue("GLOBAL_KEY"));
    expect(within(dialog).getByLabelText("账户邮箱（可选）")).toHaveValue("owner@example.com");
    expect(keyInput).toHaveAttribute("type", "text");
    expect(get).toHaveBeenCalledWith("/api/admin/dns-providers/8/credentials");
    fireEvent.click(within(dialog).getByRole("button", { name: "隐藏 API 密钥" }));
    expect(keyInput).toHaveAttribute("type", "password");
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));

    await waitFor(() => expect(put).toHaveBeenCalledWith("/api/admin/dns-providers/8", {
      name: "Cloudflare",
      provider_type: "cloudflare",
      credentials: JSON.stringify({ CF_API_EMAIL: "owner@example.com", CF_API_KEY: "GLOBAL_KEY" }),
    }));
  });

  it("reports an error when stored DNS credentials cannot be loaded", async () => {
    mockCertificateLoads({}, { success: false, error: "没有权限读取凭据" });
    render(<CertificatesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("tab", { name: /DNS 提供商/ }));
    fireEvent.click(screen.getByRole("button", { name: "编辑 Cloudflare" }));
    const dialog = screen.getByRole("dialog", { name: "编辑 DNS 提供商" });
    fireEvent.click(within(dialog).getByRole("button", { name: "显示已保存凭据" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent("没有权限读取凭据");
    expect(within(dialog).getByLabelText("API 密钥")).toHaveValue("");
    expect(within(dialog).getByRole("button", { name: "显示已保存凭据" })).toBeEnabled();
  });

  it("maps the single Cloudflare key to an API token when email is empty", async () => {
    mockCertificateLoads();
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true });
    render(<CertificatesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "DNS 提供商" }));
    const dialog = screen.getByRole("dialog", { name: "添加 DNS 提供商" });
    fireEvent.change(within(dialog).getByLabelText("名称"), { target: { value: "Cloudflare Token" } });
    fireEvent.change(within(dialog).getByLabelText("API 密钥"), { target: { value: "TOKEN_VALUE" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/dns-providers/create", {
      name: "Cloudflare Token",
      provider_type: "cloudflare",
      credentials: JSON.stringify({ CF_DNS_API_TOKEN: "TOKEN_VALUE" }),
    }));
  });

  it("maps the single Cloudflare key to a Global API Key when email is present", async () => {
    mockCertificateLoads();
    const put = vi.spyOn(api, "put").mockResolvedValue({ success: true });
    render(<CertificatesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("tab", { name: /DNS 提供商/ }));
    fireEvent.click(screen.getByRole("button", { name: "编辑 Cloudflare" }));
    fireEvent.change(screen.getByLabelText("账户邮箱（可选）"), { target: { value: "owner@example.com" } });
    fireEvent.change(screen.getByLabelText("API 密钥"), { target: { value: "GLOBAL_KEY" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(put).toHaveBeenCalledWith("/api/admin/dns-providers/8", {
      name: "Cloudflare",
      provider_type: "cloudflare",
      credentials: JSON.stringify({ CF_API_EMAIL: "owner@example.com", CF_API_KEY: "GLOBAL_KEY" }),
    }));
  });

  it("requires fresh credentials after switching DNS provider type", async () => {
    mockCertificateLoads();
    const put = vi.spyOn(api, "put").mockResolvedValue({ success: true });
    render(<CertificatesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("tab", { name: /DNS 提供商/ }));
    fireEvent.click(screen.getByRole("button", { name: "编辑 Cloudflare" }));
    fireEvent.change(screen.getByLabelText("提供商类型"), { target: { value: "alidns" } });

    expect(screen.getByLabelText("AccessKey ID")).toBeRequired();
    expect(screen.getByLabelText("AccessKey Secret")).toBeRequired();
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    expect(put).not.toHaveBeenCalled();
  });

  it("edits certificate renewal settings without changing issued identity", async () => {
    mockCertificateLoads();
    const put = vi.spyOn(api, "put").mockResolvedValue({ success: true });
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true });
    render(<CertificatesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "编辑 *.example.com" }));
    const dialog = screen.getByRole("dialog", { name: "编辑证书设置" });
    expect(within(dialog).getByLabelText("域名")).toHaveAttribute("readonly");
    expect(within(dialog).getByLabelText("证书颁发机构")).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("switch", { name: "到期前自动续期" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "保存设置" }));

    await waitFor(() => expect(put).toHaveBeenCalledWith("/api/admin/certificates/3", {
      domain: "*.example.com",
      email: "ops@example.com",
      provider: "letsencrypt",
      challenge_mode: "dns",
      webroot_path: "",
      dns_provider_id: 8,
      remote_server_id: 0,
      auto_renew: true,
    }));
    expect(post).not.toHaveBeenCalledWith("/api/admin/certificates/create", expect.anything());
  });

  it("forces ACME issuance onto the working local handler path", async () => {
    mockCertificateLoads();
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true, message: "submitted" });
    render(<CertificatesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "申请证书" }));
    expect(screen.getByRole("combobox", { name: "DNS 提供商" })).toHaveValue("8");
    fireEvent.change(screen.getByRole("textbox", { name: "域名" }), { target: { value: "*.new.example.com" } });
    fireEvent.change(screen.getByRole("textbox", { name: "联系邮箱" }), { target: { value: "ops@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "提交申请" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/certificates/create", expect.objectContaining({
      domain: "*.new.example.com",
      challenge_mode: "dns",
      dns_provider_id: 8,
      remote_server_id: 0,
      auto_renew: true,
    })));
    expect(screen.queryByRole("combobox", { name: "签发目标" })).not.toBeInTheDocument();
  });

  it("cannot dismiss an ACME request while submission is still running", async () => {
    mockCertificateLoads();
    let resolveApply!: (value: { success: boolean }) => void;
    vi.spyOn(api, "post").mockImplementation(() => new Promise((resolve) => { resolveApply = resolve; }));
    render(<CertificatesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "申请证书" }));
    const dialog = screen.getByRole("dialog", { name: "申请 ACME 证书" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "域名" }), { target: { value: "*.new.example.com" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "联系邮箱" }), { target: { value: "ops@example.com" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "提交申请" }));

    await waitFor(() => expect(within(dialog).getByRole("button", { name: "取消" })).toBeDisabled());
    expect(within(dialog).queryByRole("button", { name: "关闭" })).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.mouseDown(screen.getByRole("presentation"));
    expect(screen.getByRole("dialog", { name: "申请 ACME 证书" })).toBeInTheDocument();

    resolveApply({ success: true });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "申请 ACME 证书" })).not.toBeInTheDocument());
  });

  it("cannot dismiss a certificate upload while submission is still running", async () => {
    mockCertificateLoads();
    let resolveUpload!: (value: { success: boolean }) => void;
    vi.spyOn(api, "post").mockImplementation(() => new Promise((resolve) => { resolveUpload = resolve; }));
    render(<CertificatesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "上传证书" }));
    const dialog = screen.getByRole("dialog", { name: "上传证书" });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "证书域名" }), { target: { value: "manual.example.com" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "证书链 PEM" }), { target: { value: "-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----" } });
    fireEvent.change(within(dialog).getByRole("textbox", { name: "私钥 PEM" }), { target: { value: "-----BEGIN PRIVATE KEY-----\nTEST\n-----END PRIVATE KEY-----" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "上传证书" }));

    await waitFor(() => expect(within(dialog).getByRole("button", { name: "取消" })).toBeDisabled());
    expect(within(dialog).queryByRole("button", { name: "关闭" })).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.mouseDown(screen.getByRole("presentation"));
    expect(screen.getByRole("dialog", { name: "上传证书" })).toBeInTheDocument();

    resolveUpload({ success: true });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "上传证书" })).not.toBeInTheDocument());
  });

  it("offers DNS provider creation directly when the certificate selector is empty", async () => {
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/certificates") return { success: true, certificates: [] } as T;
      if (path === "/api/admin/dns-providers") return { success: true, providers: [] } as T;
      if (path === "/api/admin/remote-servers") return { servers: [] } as T;
      throw new Error(`unexpected GET ${path}`);
    });
    render(<CertificatesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "申请证书" }));
    const applyDialog = screen.getByRole("dialog", { name: "申请 ACME 证书" });
    expect(within(applyDialog).getByRole("combobox", { name: "DNS 提供商" })).toHaveValue("");
    fireEvent.click(within(applyDialog).getByRole("button", { name: "添加" }));

    expect(await screen.findByRole("dialog", { name: "添加 DNS 提供商" })).toBeInTheDocument();
  });

  it("offers an explicit retry action for a failed ACME request", async () => {
    mockCertificateLoads({ status: "failed", issue_date: null, expiry_date: null, message: "DNS 验证失败" });
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true });
    render(<CertificatesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "重试申请" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/certificates/renew", { id: 3 }));
  });
});
