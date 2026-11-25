import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { PackagesPage } from "./packages";
import type { NodeItem, PackageItem } from "./types";

vi.hoisted(() => {
  (globalThis as unknown as { process: { env: { NODE_ENV?: string } } }).process.env.NODE_ENV = "test";
});

const packageItem: PackageItem = {
  id: 9,
  name: "标准套餐",
  description: "完整字段套餐",
  traffic_limit_gb: 200,
  cycle_days: 30,
  is_reset: true,
  reset_day: 8,
  node_traffic_reset_period: "quarterly",
  nodes: [1, 2],
  speed_limit_mbps: 100,
  device_limit: 3,
  short_code: "standard",
  traffic_mode: "twoway",
  node_multipliers: { "1": 2, "2": 1.5 },
  node_traffic_limits: { "1": 40, "2": 30 },
  node_speed_limits: { "1": 80, "2": 60 },
  node_device_limits: { "1": 2, "2": 1 },
  auto_speed_rules: [{
    type: "sustained",
    threshold_mbps: 90,
    sustained_seconds: 20,
    window_seconds: 0,
    burst_count: 0,
    limit_mbps: 30,
    limit_duration: 300,
  }],
  template_filename: "default.yaml",
  server_grants: [{
    server_id: 3, max_active_nodes: 2, speed_limit_mbps: 50, connection_limit: 0,
    traffic_limit_bytes: 10 * 1024 ** 3, billing_mode: "download", reset_policy: "none",
    reset_day: 1, allowed_protocols: [], allowed_protocol_profiles: [],
  }],
  forwarding_grants: [{
    tunnel_id: 7, max_active_forwards: 1, per_forward_speed_mbps: 20,
    per_forward_connection_limit: 0, traffic_limit_bytes: 0, billing_mode_override: null,
  }],
};

const nodes: NodeItem[] = [
  { id: 1, node_name: "香港 A", protocol: "vless", raw_url: "", clash_config: "", parsed_config: "", enabled: true, tag: "hk", original_server: "edge-hk", inbound_tag: "in-a", node_type: "physical", updated_at: "" },
  { id: 2, node_name: "东京 B", protocol: "trojan", raw_url: "", clash_config: "", parsed_config: "", enabled: true, tag: "jp", original_server: "edge-jp", inbound_tag: "in-b", node_type: "physical", updated_at: "" },
];

function mockLoads(packageItems: PackageItem[] = [packageItem]) {
  return vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
    if (path === "/api/admin/packages") return { packages: packageItems } as T;
    if (path === "/api/admin/nodes") return { nodes } as T;
    if (path === "/api/admin/remote-servers") return { servers: [{ id: 3, name: "香港入口", status: "online" }] } as T;
    if (path === "/api/admin/tunnel-templates") return { tunnels: [{ id: 7, name: "香港转发", state: "active", billing_mode: "upload" }] } as T;
    if (path === "/api/admin/rule-templates") return { templates: ["default.yaml"] } as T;
    throw new Error(`unexpected GET ${path}`);
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("package management", () => {
  it("sends detail-only limits and prunes removed node values", async () => {
    mockLoads();
    const post = vi.spyOn(api, "post").mockResolvedValue({ message: "Package updated successfully" });
    const notify = vi.fn();
    render(<PackagesPage notify={notify} />);

    fireEvent.click(await screen.findByRole("button", { name: "编辑 标准套餐" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /香港 A/ }));
    fireEvent.click(screen.getByRole("button", { name: "保存更改" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/packages/update", expect.objectContaining({
      id: 9,
      name: "标准套餐",
      traffic_limit_gb: 0,
      speed_limit_mbps: 0,
      is_reset: true,
      node_traffic_reset_period: "quarterly",
      reset_day: 8,
      nodes: [2],
      node_multipliers: { "2": 1.5 },
      node_traffic_limits: { "2": 30 },
      node_speed_limits: { "2": 60 },
      node_device_limits: { "2": 1 },
      auto_speed_rules: [],
      template_filename: "default.yaml",
      server_grants: packageItem.server_grants,
      forwarding_grants: [expect.objectContaining({
        tunnel_id: 7,
        billing_mode_override: "upload",
      })],
    })));
    expect(notify).toHaveBeenCalledWith("套餐已更新，节点关联正在同步");
  });

  it("replaces inherited forwarding billing with three explicit directions", async () => {
    mockLoads();
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true });
    render(<PackagesPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "编辑 标准套餐" }));
    const billing = screen.getByRole("combobox", { name: "香港转发 流量计算" });
    expect(billing).toHaveValue("upload");
    expect(Array.from(billing.querySelectorAll("option"), (option) => option.textContent)).toEqual([
      "双向",
      "仅算上行",
      "仅算下行",
    ]);
    expect(screen.queryByText("继承线路")).not.toBeInTheDocument();

    fireEvent.change(billing, { target: { value: "download" } });
    fireEvent.click(screen.getByRole("button", { name: "保存更改" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/packages/update", expect.objectContaining({
      forwarding_grants: [expect.objectContaining({
        tunnel_id: 7,
        billing_mode_override: "download",
      })],
    })));
  });

  it("persists a protocol/profile restriction on a package server grant", async () => {
    mockLoads();
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true });
    render(<PackagesPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "编辑 标准套餐" }));
    const disclosure = screen.getByRole("button", { name: "香港入口 代理协议，全部协议组合" });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("checkbox", { name: "香港入口 VLESS WS" })).not.toBeInTheDocument();
    fireEvent.click(disclosure);
    expect(disclosure).toHaveAttribute("aria-expanded", "true");
    const profile = screen.getByRole("checkbox", { name: "香港入口 VLESS WS" });
    fireEvent.click(profile);
    fireEvent.click(screen.getByRole("button", { name: "保存更改" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/packages/update", expect.objectContaining({
      server_grants: [expect.objectContaining({
        server_id: 3,
        allowed_protocols: ["vless"],
        allowed_protocol_profiles: ["vless-ws"],
      })],
    })));
  });

  it("keeps user assignment out of the package workbench", async () => {
    mockLoads();
    render(<PackagesPage notify={vi.fn()} />);

    expect(await screen.findByRole("heading", { name: "套餐模板管理" })).toBeInTheDocument();
    expect(screen.queryByText("用户套餐分配")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /分配套餐|分配用户/ })).not.toBeInTheDocument();
  });

  it("edits node overrides and the package template through visible controls", async () => {
    mockLoads();
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true });
    render(<PackagesPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "编辑 标准套餐" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "香港 A 流量倍率" }), { target: { value: "3" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "香港 A 流量额度" }), { target: { value: "25" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "香港 A 限速" }), { target: { value: "55" } });
    fireEvent.change(screen.getByRole("combobox", { name: /订阅规则模板/ }), { target: { value: "default.yaml" } });
    fireEvent.click(screen.getByRole("button", { name: "保存更改" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/packages/update", expect.objectContaining({
      node_multipliers: { "1": 3, "2": 1.5 },
      node_traffic_limits: { "1": 25, "2": 30 },
      node_speed_limits: { "1": 55, "2": 60 },
      template_filename: "default.yaml",
    })));
  });

  it("keeps package actions available in the compact list view", async () => {
    mockLoads();
    render(<PackagesPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "列表视图" }));
    expect(screen.getByRole("columnheader", { name: "授权周期 / 设备" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "编辑 标准套餐" })).toBeInTheDocument();
  });

  it("treats a legacy package without a reset period as monthly", async () => {
    const legacyPackage = { ...packageItem, node_traffic_reset_period: undefined, is_reset: false };
    mockLoads([legacyPackage]);
    render(<PackagesPage notify={vi.fn()} />);

    expect(await screen.findByText("固定节点按套餐授权周期重置")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "编辑 标准套餐" }));
    expect(screen.getByRole("combobox", { name: "固定节点流量重置周期" })).toHaveValue("monthly");
  });

  it("hides package-wide totals and edits the per-forward speed", async () => {
    mockLoads();
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true });
    render(<PackagesPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "编辑 标准套餐" }));
    expect(screen.queryByRole("spinbutton", { name: "流量限额（GB）" })).not.toBeInTheDocument();
    expect(screen.queryByRole("spinbutton", { name: "全局限速（Mbps）" })).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "按自然月重置流量" })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "固定节点流量重置周期" })).toHaveValue("quarterly");
    expect(screen.getByRole("spinbutton", { name: "固定节点流量重置日" })).toHaveValue(8);

    fireEvent.change(screen.getByRole("combobox", { name: "固定节点流量重置周期" }), { target: { value: "yearly" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "香港转发 单条转发限速" }), { target: { value: "35" } });
    fireEvent.click(screen.getByRole("button", { name: "保存更改" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/packages/update", expect.objectContaining({
      traffic_limit_gb: 0,
      speed_limit_mbps: 0,
      is_reset: true,
      node_traffic_reset_period: "yearly",
      forwarding_grants: [expect.objectContaining({
        tunnel_id: 7,
        per_forward_speed_mbps: 35,
      })],
    })));
  });

  it("does not delete a package before the confirmation action", async () => {
    mockLoads();
    const remove = vi.spyOn(api, "delete").mockResolvedValue({ message: "Package deleted successfully", unbound_users: 0 });
    render(<PackagesPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "删除 标准套餐" }));
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));

    await waitFor(() => expect(remove).toHaveBeenCalledWith("/api/admin/packages/9"));
  });
  it("directly hides nodes that cannot multiplex ports from associated nodes list", async () => {
    const mixedNodes: NodeItem[] = [
      { id: 1, node_name: "香港 VLESS 01", protocol: "vless", raw_url: "", clash_config: "", parsed_config: "", enabled: true, tag: "hk", original_server: "edge-hk", inbound_tag: "in-a", node_type: "physical", updated_at: "" },
      { id: 2, node_name: "东京 SS-2022", protocol: "ss", raw_url: "", clash_config: "", parsed_config: JSON.stringify({ cipher: "2022-blake3-aes-128-gcm" }), enabled: true, tag: "jp", original_server: "edge-jp", inbound_tag: "in-b", node_type: "physical", updated_at: "" },
      { id: 3, node_name: "香港 转发 01", protocol: "dokodemo-door", raw_url: "", clash_config: "", parsed_config: "", enabled: true, tag: "tunnel", original_server: "edge-hk", inbound_tag: "anydoor-2001", node_type: "physical", updated_at: "" },
      { id: 4, node_name: "韩国 SS-ChaCha20", protocol: "ss", raw_url: "", clash_config: "", parsed_config: JSON.stringify({ cipher: "chacha20-ietf-poly1305" }), enabled: true, tag: "kr", original_server: "edge-kr", inbound_tag: "in-c", node_type: "physical", updated_at: "" },
      { id: 5, node_name: "台湾 路由转发 01", protocol: "shadowsocks", raw_url: "", clash_config: "", parsed_config: JSON.stringify({ cipher: "aes-128-gcm" }), enabled: true, tag: "tw", original_server: "edge-tw", inbound_tag: "in-d", node_type: "routed", updated_at: "" },
      { id: 6, node_name: "friend | Tunnel", protocol: "shadowsocks", raw_url: "", clash_config: "", parsed_config: JSON.stringify({ cipher: "2022-blake3-aes-128-gcm" }), enabled: true, tag: "anydoor", original_server: "edge-hk", inbound_tag: "anydoor-node-41", node_type: "forwarded", updated_at: "" },
    ];
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/packages") return { packages: [packageItem] } as T;
      if (path === "/api/admin/nodes") return { nodes: mixedNodes } as T;
      if (path === "/api/admin/remote-servers") return { servers: [{ id: 3, name: "香港入口", status: "online" }] } as T;
      if (path === "/api/admin/tunnel-templates") return { tunnels: [{ id: 7, name: "香港转发", state: "active", billing_mode: "upload" }] } as T;
      if (path === "/api/admin/rule-templates") return { templates: ["default.yaml"] } as T;
      throw new Error(`unexpected GET ${path}`);
    });

    render(<PackagesPage notify={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "编辑 标准套餐" }));

    // Eligible multi-user nodes (including routed forwarding nodes) must be displayed
    expect(screen.getByRole("checkbox", { name: /香港 VLESS 01/ })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /东京 SS-2022/ })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /台湾 路由转发 01/ })).toBeInTheDocument();

    // Ineligible / AnyDoor nodes must NOT be displayed
    expect(screen.queryByText(/香港 转发 01/)).not.toBeInTheDocument();
    expect(screen.queryByText(/韩国 SS-ChaCha20/)).not.toBeInTheDocument();
    expect(screen.queryByText(/friend \| Tunnel/)).not.toBeInTheDocument();
  });

  it("groups bidirectional tunnels into a single item and toggles both directions in package grants", async () => {
    const bidirectionalTunnels = [
      { id: 10, name: "港台专线", state: "active", billing_mode: "both", hops: [{ server_id: 1, position: 1 }, { server_id: 2, position: 2 }] },
      { id: 11, name: "港台专线", state: "active", billing_mode: "both", hops: [{ server_id: 2, position: 1 }, { server_id: 1, position: 2 }] },
    ];
    const remoteServers = [
      { id: 1, name: "Bestvm HK", status: "online" },
      { id: 2, name: "Bestvm TW", status: "online" },
    ];
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/packages") return { packages: [{ ...packageItem, forwarding_grants: [] }] } as T;
      if (path === "/api/admin/nodes") return { nodes } as T;
      if (path === "/api/admin/remote-servers") return { servers: remoteServers } as T;
      if (path === "/api/admin/tunnel-templates") return { tunnels: bidirectionalTunnels } as T;
      if (path === "/api/admin/rule-templates") return { templates: ["default.yaml"] } as T;
      throw new Error(`unexpected GET ${path}`);
    });
    const postSpy = vi.spyOn(api, "post").mockResolvedValue({ message: "Package updated" });

    render(<PackagesPage notify={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "编辑 标准套餐" }));

    // Bidirectional tunnel "港台专线" should only be rendered ONCE
    const checkboxes = screen.getAllByRole("checkbox", { name: /港台专线/ });
    expect(checkboxes).toHaveLength(1);
    expect(screen.getByText("双向对称")).toBeInTheDocument();

    // Toggle on the bidirectional tunnel
    fireEvent.click(checkboxes[0]);

    // Save package
    fireEvent.click(screen.getByRole("button", { name: "保存更改" }));

    await waitFor(() => expect(postSpy).toHaveBeenCalledWith("/api/admin/packages/update", expect.any(Object)));
    const updateCall = postSpy.mock.calls.find(([url]) => url === "/api/admin/packages/update");
    expect(updateCall).toBeDefined();
    const payload = updateCall![1] as { forwarding_grants: Array<{ tunnel_id: number }> };
    // Both tunnel IDs 10 and 11 must be included in forwarding_grants!
    const grantedIDs = payload.forwarding_grants.map((g) => g.tunnel_id).sort();
    expect(grantedIDs).toEqual([10, 11]);
  });

  it("filters servers and routes within the package editor dialog", async () => {
    const serversList = [
      { id: 1, name: "香港入口 01", status: "online", ip_address: "1.1.1.1" },
      { id: 2, name: "日本入口 02", status: "online", ip_address: "2.2.2.2" },
    ];
    const tunnelsList = [
      { id: 10, name: "港台专线", state: "active", billing_mode: "both", hops: [{ server_id: 1, position: 1 }] },
      { id: 20, name: "美日专线", state: "active", billing_mode: "both", hops: [{ server_id: 2, position: 1 }] },
    ];
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/packages") return { packages: [packageItem] } as T;
      if (path === "/api/admin/nodes") return { nodes } as T;
      if (path === "/api/admin/remote-servers") return { servers: serversList } as T;
      if (path === "/api/admin/tunnel-templates") return { tunnels: tunnelsList } as T;
      if (path === "/api/admin/rule-templates") return { templates: ["default.yaml"] } as T;
      throw new Error(`unexpected GET ${path}`);
    });

    render(<PackagesPage notify={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "编辑 标准套餐" }));

    // Filter server
    const serverFilter = screen.getByRole("textbox", { name: "筛选服务器" });
    fireEvent.change(serverFilter, { target: { value: "日本" } });
    expect(screen.getByText("日本入口 02")).toBeInTheDocument();
    expect(screen.queryByText("香港入口 01")).not.toBeInTheDocument();

    // Clear filter
    fireEvent.change(serverFilter, { target: { value: "" } });
    expect(screen.getByText("香港入口 01")).toBeInTheDocument();

    // Filter tunnel route
    const tunnelFilter = screen.getByRole("textbox", { name: "筛选转发线路" });
    fireEvent.change(tunnelFilter, { target: { value: "美日" } });
    expect(screen.getByText(/美日专线/)).toBeInTheDocument();
    expect(screen.queryByText(/港台专线/)).not.toBeInTheDocument();
  });
});
