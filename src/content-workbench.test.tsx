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
import { CertificatesWorkbenchPage, SubscribeFilesPage, SubscriptionGeneratorPage, SubscriptionLinksPage, TemplatesWorkbenchPage } from "./content-workbench";

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

function subscribeLoad(path: string, files: unknown[] = [], external: unknown[] = []): unknown {
  if (path === "/api/admin/subscribe-files") return { files };
  if (path === "/api/user/external-subscriptions") return external;
  if (path === "/api/user/token") return { token: "secret", user_short_code: "usr" };
  if (path === "/api/admin/custom-rules") return [{ id: 11, name: "DNS 覆写", type: "dns", enabled: true }];
  if (path === "/api/admin/override-scripts") return [{ id: 13, name: "节点整理", hook: "post_fetch", enabled: true }];
  if (path === "/api/admin/nodes") return { nodes: [{ id: 7, node_name: "香港 01", protocol: "vless", clash_config: "{}", enabled: true }] };
  if (path === "/api/admin/rule-templates") return { templates: ["edge_v3.yaml"], owners: {}, username: "admin", is_admin: true };
  if (path === "/api/admin/remote-servers") return { servers: [{ id: 2, name: "Edge HK" }] };
  if (path === "/api/user/proxy-provider-configs") return [];
  throw new Error(`unexpected GET ${path}`);
}

describe("content workbench templates", () => {
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

  it("loads a template and previews it through the V3 preview endpoint", async () => {
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/rule-templates") return { templates: ["edge_v3.yaml"], owners: {}, username: "admin", is_admin: true } as T;
      if (path === "/api/admin/rule-templates/edge_v3.yaml") return { content: "proxies: []\nrules: []" } as T;
      throw new Error(`unexpected GET ${path}`);
    });
    const post = vi.spyOn(api, "post").mockResolvedValue({ content: "proxies: []\nrules:\n  - MATCH,PROXY" });

    render(<TemplatesWorkbenchPage notify={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "预览" }));

    expect(await screen.findByText(/MATCH,PROXY/)).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith("/api/admin/template-v3/preview", {
      template_content: "proxies: []\nrules: []",
      proxies: [],
    });
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
      if (path === "/api/user/proxy-provider-configs") return [{ id: 8, external_subscription_id: 3, name: "Airport HK", type: "http" }] as T;
      if (path === "/api/admin/template-v3/region-filters") return { region_filters: { 香港: "香港|HK" } } as T;
      throw new Error(`unexpected GET ${path}`);
    });
    const validate = vi.spyOn(api, "post").mockResolvedValue({ content: "ok" });
    requestMock.mockResolvedValue({ filename: "structured.yaml" });
    render(<TemplatesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "可视化设计" }));
    fireEvent.change(screen.getByRole("textbox", { name: "模板文件名" }), { target: { value: "structured" } });
    fireEvent.change(screen.getByRole("combobox", { name: "类型" }), { target: { value: "url-test" } });
    const source = await screen.findByRole("option", { name: "Provider · Airport HK" });
    fireEvent.change(screen.getByRole("combobox", { name: "添加 PROXY 来源" }), { target: { value: source.getAttribute("value") } });
    fireEvent.click(screen.getByRole("tab", { name: "YAML 预览" }));

    expect(screen.getByText(/type: "url-test"/)).toBeInTheDocument();
    expect(screen.getByText(/use:[\s\S]*Airport HK/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "保存新模板" }));

    await waitFor(() => expect(validate).toHaveBeenCalledWith("/api/admin/template-v3/preview", expect.objectContaining({ proxies: [], template_content: expect.stringContaining('type: "url-test"') })));
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith("/api/admin/rule-templates/upload", expect.objectContaining({ method: "POST", body: expect.any(FormData) })));
    const form = requestMock.mock.calls[0][1].body as FormData;
    const file = form.get("template") as File;
    expect(file.name).toBe("structured.yaml");
    expect(await file.text()).toContain('type: "url-test"');
    expect(await file.text()).toContain('use:\n      - "Airport HK"');
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
      if (path === "/api/user/proxy-provider-configs") return [] as T;
      if (path === "/api/admin/template-v3/region-filters") return { region_filters: {} } as T;
      throw new Error(`unexpected GET ${path}`);
    });
    render(<TemplatesWorkbenchPage />);
    fireEvent.click(await screen.findByRole("button", { name: "可视化设计" }));

    expect(screen.getByText("已恢复上次未保存草稿")).toBeInTheDocument();
    expect(screen.getByDisplayValue("recovered.yaml")).toBeInTheDocument();
    expect(screen.getByDisplayValue("RECOVERED")).toBeInTheDocument();
  });
});

describe("content workbench subscriptions", () => {
  it("includes a normal WireGuard node in generated subscriptions", async () => {
    const wireGuard = {
      id: 12,
      node_name: "办公室 WireGuard",
      protocol: "wireguard",
      enabled: true,
      tags: ["office"],
      clash_config: JSON.stringify({
        name: "办公室 WireGuard",
        type: "wireguard",
        server: "edge.example.com",
        port: 51820,
        ip: "10.66.66.2",
        "private-key": "encrypted-client-private-key",
        "public-key": "server-public-key",
        "allowed-ips": ["0.0.0.0/0"],
        udp: true,
        mtu: 1420,
      }),
    };
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/nodes") return { nodes: [wireGuard] } as T;
      if (path === "/api/admin/template-v3") return { templates: [] } as T;
      throw new Error(`unexpected GET ${path}`);
    });
    const notify = vi.fn();
    render(<SubscriptionGeneratorPage notify={notify} />);

    fireEvent.click(await screen.findByRole("checkbox", { name: /办公室 WireGuard/ }));
    fireEvent.click(screen.getByRole("button", { name: "生成订阅文件" }));

    const output = await screen.findByRole("textbox", { name: "生成的订阅配置" });
    const generated = (output as HTMLTextAreaElement).value;
    expect(generated).toContain('"type":"wireguard"');
    expect(generated).toContain('"private-key":"encrypted-client-private-key"');
    expect(generated).toContain('"allowed-ips":["0.0.0.0/0"]');
    expect(notify).toHaveBeenCalledWith("订阅配置已生成");
  });

  it("keeps rule management entry points with subscription management", async () => {
    const onOpenCustomRules = vi.fn();
    const onOpenRulesConfig = vi.fn();
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => subscribeLoad(path) as T);

    render(<SubscribeFilesPage onOpenCustomRules={onOpenCustomRules} onOpenRulesConfig={onOpenRulesConfig} />);

    fireEvent.click(await screen.findByRole("button", { name: "覆写规则" }));
    fireEvent.click(screen.getByRole("button", { name: "规则配置" }));

    expect(onOpenCustomRules).toHaveBeenCalledOnce();
    expect(onOpenRulesConfig).toHaveBeenCalledOnce();
  });

  it("exposes a real Clash deep link for the resolved subscription URL", async () => {
    qrMock.mockResolvedValue("data:image/png;base64,LOCAL_QR");
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/subscriptions") return { subscriptions: [{ id: 4, name: "日常套餐", filename: "daily.yaml", type: "package", file_short_code: "abc" }] } as T;
      if (path === "/api/user/token") return { token: "secret", user_short_code: "usr" } as T;
      throw new Error(`unexpected GET ${path}`);
    });
    render(<SubscriptionLinksPage />);

    const clash = await screen.findByRole("link", { name: "导入 Clash" });
    expect(clash.getAttribute("href")).toContain("clash://install-config?");
    expect(clash.getAttribute("href")).toContain("url=http%3A%2F%2Flocalhost%3A3000%2Fx%2Fabcusr");
    expect(screen.queryByRole("link", { name: "导入 Clash Meta" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "二维码" }));

    const image = await screen.findByRole("img", { name: "日常套餐 订阅二维码" });
    expect(qrMock).toHaveBeenCalledWith("http://localhost:3000/x/abcusr", {
      errorCorrectionLevel: "M",
      margin: 2,
      width: 320,
      color: { dark: "#111815", light: "#ffffff" },
    });
    expect(image).toHaveAttribute("src", "data:image/png;base64,LOCAL_QR");
    expect(screen.getByRole("link", { name: "下载 PNG" })).toHaveAttribute("download", "日常套餐.png");
  });

  it("deletes only subscriptions the current user is allowed to remove", async () => {
    const notify = vi.fn();
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/subscriptions") return { subscriptions: [
        { id: 4, name: "自建订阅", filename: "mine.yaml", type: "create", file_short_code: "abc", can_delete: true },
        { id: -1, name: "套餐订阅", filename: "__package__", type: "package", file_short_code: "pkg", can_delete: false },
      ] } as T;
      if (path === "/api/user/token") return { token: "secret", user_short_code: "usr" } as T;
      throw new Error(`unexpected GET ${path}`);
    });
    const remove = vi.spyOn(api, "delete").mockResolvedValue({});
    render(<SubscriptionLinksPage notify={notify} />);

    fireEvent.click(await screen.findByRole("button", { name: "删除订阅 自建订阅" }));
    expect(screen.queryByRole("button", { name: "删除订阅 套餐订阅" })).not.toBeInTheDocument();
    expect(screen.getByText("所有已分配链接会立即失效。", { exact: false })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith("/api/admin/subscribe-files/4"));
    await waitFor(() => expect(screen.queryByText("自建订阅")).not.toBeInTheDocument());
    expect(screen.getByText("套餐订阅")).toBeInTheDocument();
    expect(notify).toHaveBeenCalledWith("订阅“自建订阅”已删除");
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

    fireEvent.click(await screen.findByRole("button", { name: "关闭 受限订阅 自动同步" }));

    await waitFor(() => expect(put).toHaveBeenCalledWith("/api/admin/subscribe-files/4", expect.objectContaining({
      auto_sync_custom_rules: false,
      selected_custom_rule_ids: [11],
      selected_override_script_ids: [13],
      stats_server_ids: "2,5",
      traffic_limit: 107374182400,
    })));
  });

  it("saves node, template, rule, script and traffic scopes with the exact subscribe-file contract", async () => {
    const file = { id: 4, name: "高级订阅", description: "", type: "import", filename: "advanced.yaml", auto_sync_custom_rules: false, selected_tags: [], selected_node_ids: [], selected_custom_rule_ids: [], selected_override_script_ids: [], stats_server_ids: "", traffic_limit: null };
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => subscribeLoad(path, [file]) as T);
    const put = vi.spyOn(api, "put").mockResolvedValue({});
    render(<SubscribeFilesPage />);

    fireEvent.click(await screen.findByRole("button", { name: "编辑 高级订阅" }));
    fireEvent.change(screen.getByRole("combobox", { name: "V3 模板" }), { target: { value: "edge_v3.yaml" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /香港 01/ }));
    const scopes = screen.getAllByRole("combobox", { name: "应用范围" });
    fireEvent.change(scopes[0], { target: { value: "selected" } });
    fireEvent.change(scopes[1], { target: { value: "selected" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /DNS 覆写/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /节点整理/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Edge HK/ }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "手动流量上限（GB）" }), { target: { value: "120.5" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(put).toHaveBeenCalledWith("/api/admin/subscribe-files/4", expect.objectContaining({
      template_filename: "edge_v3.yaml",
      selected_node_ids: [7],
      selected_custom_rule_ids: [11],
      selected_override_script_ids: [13],
      stats_server_ids: "2",
      traffic_limit: 120.5,
    })));
  });

  it("applies advanced fields immediately after a URL import returns its file ID", async () => {
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => subscribeLoad(path) as T);
    const created = { id: 15, name: "新订阅", description: "", type: "import", filename: "new.yaml", auto_sync_custom_rules: false };
    const post = vi.spyOn(api, "post").mockResolvedValue({ file: created });
    const put = vi.spyOn(api, "put").mockResolvedValue({});
    render(<SubscribeFilesPage />);

    fireEvent.click((await screen.findAllByRole("button", { name: "添加订阅" }))[0]);
    fireEvent.change(screen.getByRole("textbox", { name: "订阅名称" }), { target: { value: "新订阅" } });
    fireEvent.change(screen.getByRole("textbox", { name: "订阅 URL" }), { target: { value: "https://sub.example/new" } });
    fireEvent.click(screen.getByRole("button", { name: "配置模板、节点与覆写范围" }));
    fireEvent.change(screen.getByRole("combobox", { name: "V3 模板" }), { target: { value: "edge_v3.yaml" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /香港 01/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /DNS 覆写/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /节点整理/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Edge HK/ }));
    fireEvent.click(screen.getByRole("button", { name: "添加" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/subscribe-files/import", { name: "新订阅", description: "", url: "https://sub.example/new", filename: "" }));
    await waitFor(() => expect(put).toHaveBeenCalledWith("/api/admin/subscribe-files/15", expect.objectContaining({
      template_filename: "edge_v3.yaml",
      selected_node_ids: [7],
      selected_custom_rule_ids: [11],
      selected_override_script_ids: [13],
      stats_server_ids: "2",
    })));
  });

  it("creates and validates a Proxy Provider with every backend DTO field", async () => {
    const external = [{ id: 3, name: "Airport", url: "https://sub.example/value", node_count: 10, traffic_mode: "both" }];
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => subscribeLoad(path, [], external) as T);
    const post = vi.spyOn(api, "post").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/user/external-subscriptions/check-filter") return { has_matches: true, match_count: 4 } as T;
      if (path === "/api/user/proxy-provider-configs") return { id: 9 } as T;
      throw new Error(`unexpected POST ${path}`);
    });
    render(<SubscribeFilesPage />);

    fireEvent.click(await screen.findByRole("tab", { name: /Provider/ }));
    fireEvent.click(screen.getByRole("button", { name: "Proxy Provider" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Provider 名称" }), { target: { value: "airport-hk" } });
    fireEvent.change(screen.getByRole("textbox", { name: "包含名称（正则）" }), { target: { value: "香港|HK" } });
    fireEvent.change(screen.getByRole("textbox", { name: "GeoIP 国家代码" }), { target: { value: "HK" } });
    fireEvent.click(screen.getByRole("button", { name: "检查匹配" }));

    await screen.findByText("匹配 4 个节点");
    expect(post).toHaveBeenCalledWith("/api/user/external-subscriptions/check-filter", { subscription_id: 3, filter: "香港|HK", exclude_filter: "", geo_ip_filter: "HK" });
    fireEvent.click(screen.getByRole("button", { name: "保存 Provider" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/user/proxy-provider-configs", {
      external_subscription_id: 3,
      name: "airport-hk",
      type: "http",
      interval: 3600,
      proxy: "",
      size_limit: 0,
      header: "",
      health_check_enabled: true,
      health_check_url: "https://cp.cloudflare.com/generate_204",
      health_check_interval: 300,
      health_check_timeout: 5000,
      health_check_lazy: true,
      health_check_expected_status: 204,
      filter: "香港|HK",
      exclude_filter: "",
      exclude_type: "",
      geo_ip_filter: "HK",
      override: "",
      process_mode: "client",
    }));
  });
});

describe("content workbench certificates", () => {
  function mockCertificateLoads(
    certificate: Record<string, unknown> = {},
    credentialsResponse: unknown = { success: true, credentials: { CF_DNS_API_TOKEN: "SAVED_TOKEN" } },
  ) {
    return vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/certificates") return { success: true, certificates: [{ id: 3, domain: "*.example.com", email: "ops@example.com", provider: "letsencrypt", status: "valid", expiry_date: "2030-01-01T00:00:00Z", issue_date: "2029-10-01T00:00:00Z", auto_renew: false, auto_deploy: false, challenge_mode: "dns", dns_provider_id: 8, deploy_target: "none", ...certificate }] } as T;
      if (path === "/api/admin/dns-providers") return { success: true, providers: [{ ID: 8, Name: "Cloudflare", ProviderType: "cloudflare", Credentials: "TOP_SECRET_TOKEN", UpdatedAt: "2026-01-01T00:00:00Z" }] } as T;
      if (path === "/api/admin/dns-providers/8/credentials") return credentialsResponse as T;
      if (path === "/api/admin/remote-servers") return { servers: [] } as T;
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

  it("edits certificate renewal and deployment settings without changing issued identity", async () => {
    mockCertificateLoads();
    const put = vi.spyOn(api, "put").mockResolvedValue({ success: true });
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true });
    render(<CertificatesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "编辑 *.example.com" }));
    const dialog = screen.getByRole("dialog", { name: "编辑证书设置" });
    expect(within(dialog).getByLabelText("域名")).toHaveAttribute("readonly");
    expect(within(dialog).getByLabelText("证书颁发机构")).toBeDisabled();
    fireEvent.click(within(dialog).getByRole("switch", { name: "自动续期" }));
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
      auto_deploy: false,
      deploy_target: "none",
      deploy_cert_path: "",
      deploy_key_path: "",
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

  it("deploys a valid certificate with the handler's required paths", async () => {
    mockCertificateLoads();
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true });
    render(<CertificatesWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "部署 *.example.com" }));
    fireEvent.click(screen.getByRole("button", { name: "立即部署" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/certificates/deploy", {
      id: 3,
      deploy_target: "both",
      deploy_cert_path: "/usr/local/nginx/cert/_.example.com.pem",
      deploy_key_path: "/usr/local/nginx/cert/_.example.com.key",
    }));
  });
});
