import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { extractList, ForwardingManagement, groupTunnelTemplates, isReverseHops } from "./forwarding-management";
import type { RemoteServer } from "./types";

vi.hoisted(() => {
  (globalThis as unknown as { process: { env: { NODE_ENV?: string } } }).process.env.NODE_ENV = "test";
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const tunnel = {
  id: 7,
  public_id: "tunnel_tokyo_us",
  name: "东京到洛杉矶",
  state: "active",
  network: "tcp_udp",
  billing_mode: "both",
  traffic_multiplier_milli: 1000,
  hops: [
    { position: 0, server_id: 11, server_name: "东京入口" },
    { position: 1, server_id: 12, server_name: "洛杉矶出口" },
  ],
};

const compactGrant = {
  id: 9,
  public_id: "grant_alice_tokyo",
  username: "alice",
  name: "东京到洛杉矶",
  description: "低延迟固定路线",
  route: ["东京入口", "洛杉矶出口"],
  state: "active",
  effective_state: "active",
  max_active_forwards: 2,
  active_forward_count: 0,
  per_forward_speed_mbps: 0,
  per_forward_connection_limit: 0,
  traffic_limit_bytes: 100 * 1024 ** 3,
  used_bytes: 10 * 1024 ** 3,
  expires_at: "2030-01-01T00:00:00Z",
};

describe("forwarding response compatibility", () => {
  it("accepts direct arrays and nested API envelopes", () => {
    expect(extractList([{ id: 1 }], "templates")).toEqual([{ id: 1 }]);
    expect(extractList({ templates: [{ id: 2 }] }, "templates")).toEqual([{ id: 2 }]);
    expect(extractList({ data: { templates: [{ id: 3 }] } }, "templates")).toEqual([{ id: 3 }]);
    expect(extractList({ data: [{ id: 4 }] }, "templates")).toEqual([{ id: 4 }]);
  });
});

describe("user forwarding workflow", () => {
  it("preflights and creates a TCP+UDP forward on one requested hop port", async () => {
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/user/tunnel-grants") return { data: { grants: [compactGrant] } } as T;
      if (path === "/api/user/forwards") return { forwards: [] } as T;
      if (path === "/api/user/nodes") return { nodes: [{ id: 42, node_name: "美国 Reality", protocol: "vless", enabled: true }] } as T;
      throw new Error(`unexpected GET ${path}`);
    });
    const post = vi.spyOn(api, "post").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/user/forwards/preflight") return { data: { result: { success: true, ready: true, entry_address: "edge.example.com", entry_port: 2033 } } } as T;
      if (path === "/api/user/forwards") return { data: { forward: { id: "forward_1", observed_state: "pending" } } } as T;
      throw new Error(`unexpected POST ${path}`);
    });
    render(<ForwardingManagement isAdmin={false} notify={vi.fn()} />);

    await screen.findByRole("tab", { name: /可用隧道/ });
    const createButton = screen.getByRole("button", { name: "创建转发" });
    await waitFor(() => expect(createButton).toBeEnabled());
    fireEvent.click(createButton);
    const dialog = screen.getByRole("dialog", { name: "创建用户转发" });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText("东京到洛杉矶")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    expect(await screen.findByRole("combobox", { name: "最终目标节点" })).toHaveValue("42");
    expect(screen.getByRole("button", { name: /自定义公网目标/ })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    fireEvent.change(screen.getByRole("textbox", { name: "转发名称" }), { target: { value: "东京入口" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: /入口端口/ }), { target: { value: "2033" } });
    expect(screen.getByRole("combobox", { name: "网络类型" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));

    expect(await screen.findByText("转发预检通过")).toBeInTheDocument();
    expect(screen.getByText("edge.example.com:2033")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认创建" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/user/forwards", {
      grant_id: "grant_alice_tokyo",
      name: "东京入口",
      target: { type: "managed_node", node_id: 42 },
      network: "tcp_udp",
      requested_entry_port: 2033,
      source_cidrs: [],
    }, { idempotencyKey: expect.any(String) }));
  }, 15_000);

  it("renders the compact forward DTO returned by the user API", async () => {
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/user/tunnel-grants") return { grants: [compactGrant] } as T;
      if (path === "/api/user/forwards") return { forwards: [{
        id: "forward_tokyo",
        name: "游戏入口",
        grant_id: "grant_alice_tokyo",
        target_node_id: 42,
        target_name: "美国 Reality",
        network: "tcp_udp",
        entry_host: "edge.example.com",
        entry_port: 39888,
        desired_state: "active",
        observed_state: "active",
        route: ["东京入口", "洛杉矶出口"],
      }] } as T;
      if (path === "/api/user/nodes") return { nodes: [] } as T;
      throw new Error(`unexpected GET ${path}`);
    });
    render(<ForwardingManagement isAdmin={false} notify={vi.fn()} />);

    expect(await screen.findByText("游戏入口")).toBeInTheDocument();
    expect(screen.getByText("edge.example.com:39888")).toBeInTheDocument();
    expect(screen.getByText("美国 Reality")).toBeInTheDocument();
    expect(screen.getByTitle("东京入口")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "复制 游戏入口 入口" })).not.toBeDisabled();
  });
});

describe("administrator tunnel composition", () => {
  it("only offers custom-mode users when creating a tunnel grant", async () => {
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/tunnel-templates") return { templates: [tunnel] } as T;
      if (path === "/api/admin/remote-servers") return { servers: [] } as T;
      if (path === "/api/admin/users") return { users: [
        { username: "package-user", nickname: "套餐用户", role: "user", authorization_mode: "package", package_id: 2 },
        { username: "custom-user", nickname: "自定义用户", role: "user", authorization_mode: "custom" },
        { username: "admin", nickname: "管理员", role: "admin", authorization_mode: "custom" },
      ] } as T;
      if (path === "/api/admin/forwards") return { forwards: [] } as T;
      if (path.endsWith("/tunnel-grants")) return { grants: [] } as T;
      throw new Error(`unexpected GET ${path}`);
    });
    render(<ForwardingManagement isAdmin notify={vi.fn()} />);

    expect(await screen.findByText("不限制")).toBeInTheDocument();
    expect(screen.queryByText("0/不限 条转发")).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("tab", { name: /用户授权/ }));
    fireEvent.click(screen.getByRole("button", { name: "新增授权" }));
    const userSelect = screen.getByRole("combobox", { name: "授权用户" });

    expect(userSelect).toHaveValue("custom-user");
    expect(screen.getByRole("option", { name: /自定义用户/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /套餐用户/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /管理员/ })).not.toBeInTheDocument();
  });

  it("keeps successful admin data usable when one user's grants fail", async () => {
    const bobGrant = { ...compactGrant, id: 10, public_id: "grant_bob_tokyo", username: "bob" };
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/tunnel-templates") return { templates: [tunnel] } as T;
      if (path === "/api/admin/remote-servers") return { servers: [
        { id: 11, name: "东京入口", status: "online", ws_connected: true, is_federated: false },
      ] } as T;
      if (path === "/api/admin/users") return { users: [
        { username: "alice", nickname: "Alice", role: "user" },
        { username: "bob", nickname: "Bob", role: "user" },
      ] } as T;
      if (path === "/api/admin/forwards") return { forwards: [{
        id: "forward_bob",
        username: "bob",
        name: "Bob 游戏转发",
        grant_id: "grant_bob_tokyo",
        observed_state: "active",
      }] } as T;
      if (path === "/api/admin/users/alice/tunnel-grants") throw new Error("Alice 授权接口暂不可用");
      if (path === "/api/admin/users/bob/tunnel-grants") return { grants: [bobGrant] } as T;
      throw new Error(`unexpected GET ${path}`);
    });
    render(<ForwardingManagement isAdmin notify={vi.fn()} />);

    expect(await screen.findByText("东京到洛杉矶")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /用户授权/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("用户授权：alice 加载失败");
    expect(screen.getByText("bob")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "新增授权" }));
    expect(screen.getByRole("dialog", { name: "新增隧道授权" })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("dialog", { name: "新增隧道授权" })).getByRole("button", { name: "取消" }));

    fireEvent.click(screen.getByRole("tab", { name: /全部转发/ }));
    expect(screen.getByText("Bob 游戏转发")).toBeInTheDocument();
  });

  it("preflights and submits the explicitly ordered managed servers", async () => {
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/tunnel-templates") return { data: { templates: [] } } as T;
      if (path === "/api/admin/remote-servers") return { servers: [
        { id: 11, name: "东京入口", status: "online", ws_connected: true, is_federated: false },
        { id: 12, name: "洛杉矶出口", status: "online", ws_connected: true, is_federated: false },
      ] } as T;
      if (path === "/api/admin/users") return { users: [] } as T;
      if (path === "/api/admin/forwards") return { data: { forwards: [] } } as T;
      throw new Error(`unexpected GET ${path}`);
    });
    const post = vi.spyOn(api, "post").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/tunnel-templates/preflight") return { preflight: { success: true, ready: true } } as T;
      if (path === "/api/admin/tunnel-templates") return { template: { id: 1 } } as T;
      throw new Error(`unexpected POST ${path}`);
    });
    render(<ForwardingManagement isAdmin notify={vi.fn()} />);

    await screen.findByText("暂无隧道模板");
    fireEvent.click(screen.getByRole("button", { name: "创建第一条隧道" }));
    fireEvent.change(screen.getByRole("textbox", { name: "隧道名称" }), { target: { value: "东京反向链路" } });
    fireEvent.click(screen.getByRole("button", { name: "加入路线" }));
    fireEvent.click(screen.getByRole("button", { name: "加入路线" }));
    fireEvent.click(screen.getByRole("button", { name: "上移 洛杉矶出口" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: /端口范围起点/ }), { target: { value: "2033" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: /端口范围终点/ }), { target: { value: "2033" } });
    const templateBilling = within(screen.getByRole("dialog", { name: "创建隧道模板" })).getByRole("combobox", { name: "计费方向" });
    expect(Array.from(templateBilling.querySelectorAll("option"), (option) => option.textContent)).toEqual([
      "双向",
      "仅算上行",
      "仅算下行",
    ]);
    fireEvent.change(templateBilling, { target: { value: "upload" } });
    fireEvent.click(screen.getByRole("button", { name: "预检路线" }));

    expect(await screen.findByText("路线预检通过")).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("dialog", { name: "创建隧道模板" })).getByRole("button", { name: "创建隧道" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/tunnel-templates", expect.objectContaining({
      name: "东京反向链路",
      billing_mode: "upload",
      port_range_start: 2033,
      port_range_end: 2033,
      server_ids: [12, 11],
    }), { idempotencyKey: expect.any(String) }));
    const createBody = post.mock.calls.find(([path]) => path === "/api/admin/tunnel-templates")?.[1] as Record<string, unknown>;
    expect(createBody).not.toHaveProperty("network");
    expect(createBody).not.toHaveProperty("allow_custom_public_target");
  });

  it("submits a per-forward speed limit while keeping connection limits disabled", async () => {
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/tunnel-templates") return { templates: [tunnel] } as T;
      if (path === "/api/admin/remote-servers") return { servers: [] } as T;
      if (path === "/api/admin/users") return { users: [{ username: "alice", nickname: "Alice", role: "user" }] } as T;
      if (path === "/api/admin/forwards") return { forwards: [] } as T;
      if (path === "/api/admin/users/alice/tunnel-grants") return { grants: [] } as T;
      throw new Error(`unexpected GET ${path}`);
    });
    const post = vi.spyOn(api, "post").mockResolvedValue({ grant: { id: 1 } });
    render(<ForwardingManagement isAdmin notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("tab", { name: /用户授权/ }));
    fireEvent.click(screen.getByRole("button", { name: "新增授权" }));
    const dialog = screen.getByRole("dialog", { name: "新增隧道授权" });
    const speedLimit = within(dialog).getByRole("spinbutton", { name: /^每转发限速 Mbps/ });
    expect(speedLimit).toBeEnabled();
    expect(within(dialog).getByRole("spinbutton", { name: /^每转发连接数/ })).toBeDisabled();
    expect(within(dialog).getAllByText("当前节点组件暂不支持")).toHaveLength(1);
    expect(within(dialog).getByText(/可配置每条转发的独立限速/)).toBeInTheDocument();
    const billing = within(dialog).getByRole("combobox", { name: "计费方向" });
    expect(billing).toHaveValue("both");
    expect(Array.from(billing.querySelectorAll("option"), (option) => option.textContent)).toEqual([
      "双向",
      "仅算上行",
      "仅算下行",
    ]);
    expect(within(dialog).queryByText("继承隧道")).not.toBeInTheDocument();
    fireEvent.change(speedLimit, { target: { value: "35" } });
    fireEvent.change(billing, { target: { value: "upload" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存授权" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/users/alice/tunnel-grants", expect.objectContaining({
      per_forward_speed_mbps: 35,
      per_forward_connection_limit: 0,
      billing_mode_override: "upload",
    }), { idempotencyKey: expect.any(String) }));
    const grantBody = post.mock.calls.find(([path]) => path === "/api/admin/users/alice/tunnel-grants")?.[1] as Record<string, unknown>;
    expect(grantBody).not.toHaveProperty("reset_policy");
    expect(grantBody).not.toHaveProperty("allow_manual_entry_port");
  });

  it("materializes a legacy null billing mode from its linked tunnel", async () => {
    const legacyGrant = {
      ...compactGrant,
      tunnel_id: 7,
      billing_mode_override: null,
      version: 3,
    };
    const uploadTunnel = { ...tunnel, billing_mode: "upload" };
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/tunnel-templates") return { templates: [uploadTunnel] } as T;
      if (path === "/api/admin/remote-servers") return { servers: [] } as T;
      if (path === "/api/admin/users") return { users: [{ username: "alice", nickname: "Alice", role: "user" }] } as T;
      if (path === "/api/admin/forwards") return { forwards: [] } as T;
      if (path === "/api/admin/users/alice/tunnel-grants") return { grants: [legacyGrant] } as T;
      throw new Error(`unexpected GET ${path}`);
    });
    const put = vi.spyOn(api, "put").mockResolvedValue({ grant: legacyGrant });
    render(<ForwardingManagement isAdmin notify={vi.fn()} />);

    expect(await screen.findByText("仅算上行")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("tab", { name: /用户授权/ }));
    fireEvent.click(await screen.findByRole("button", { name: "编辑 alice 的隧道授权" }));
    const dialog = screen.getByRole("dialog", { name: "编辑隧道授权" });
    expect(within(dialog).getByRole("combobox", { name: "计费方向" })).toHaveValue("upload");
    fireEvent.click(within(dialog).getByRole("button", { name: "保存授权" }));

    await waitFor(() => expect(put).toHaveBeenCalledWith(
      "/api/admin/users/alice/tunnel-grants/grant_alice_tokyo",
      expect.objectContaining({ billing_mode_override: "upload", version: 3 }),
      { idempotencyKey: expect.any(String) },
    ));
  });

  it("creates bidirectional tunnel templates with the same name when bidirectional mode is selected", async () => {
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/tunnel-templates") return { templates: [] } as T;
      if (path === "/api/admin/remote-servers") return { servers: [
        { id: 11, name: "东京入口", status: "online", ws_connected: true, is_federated: false },
        { id: 12, name: "洛杉矶出口", status: "online", ws_connected: true, is_federated: false },
      ] } as T;
      if (path === "/api/admin/users") return { users: [] } as T;
      if (path === "/api/admin/forwards") return { forwards: [] } as T;
      throw new Error(`unexpected GET ${path}`);
    });
    const post = vi.spyOn(api, "post").mockImplementation(async <T,>(path: string, body: unknown): Promise<T> => {
      if (path === "/api/admin/tunnel-templates/preflight") return { preflight: { success: true, ready: true } } as T;
      if (path === "/api/admin/tunnel-templates") return { tunnel: { ...tunnel, name: (body as { name: string }).name } } as T;
      throw new Error(`unexpected POST ${path}`);
    });
    render(<ForwardingManagement isAdmin notify={vi.fn()} />);

    await screen.findByText("暂无隧道模板");
    fireEvent.click(screen.getByRole("button", { name: "创建第一条隧道" }));
    fireEvent.change(screen.getByRole("textbox", { name: "隧道名称" }), { target: { value: "hk-tw" } });
    fireEvent.click(screen.getByRole("button", { name: "加入路线" }));
    fireEvent.click(screen.getByRole("button", { name: "加入路线" }));

    const dialog = screen.getByRole("dialog", { name: "创建隧道模板" });
    const directionSelect = within(dialog).getByRole("combobox", { name: /路线方向/ });
    expect(directionSelect).toBeInTheDocument();
    fireEvent.change(directionSelect, { target: { value: "bidirectional" } });

    expect(within(dialog).queryByRole("textbox", { name: /反向模板名称预览/ })).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "预检路线" }));
    expect(await screen.findByText("路线预检通过（正反双向均已验证可用）")).toBeInTheDocument();

    expect(post).toHaveBeenCalledWith("/api/admin/tunnel-templates/preflight", expect.objectContaining({
      name: "hk-tw",
      server_ids: [11, 12],
    }), { idempotencyKey: expect.any(String) });
    expect(post).toHaveBeenCalledWith("/api/admin/tunnel-templates/preflight", expect.objectContaining({
      name: "hk-tw",
      server_ids: [12, 11],
    }), { idempotencyKey: expect.any(String) });

    fireEvent.click(within(dialog).getByRole("button", { name: "创建隧道" }));
    await waitFor(() => {
      expect(post).toHaveBeenCalledWith("/api/admin/tunnel-templates", expect.objectContaining({
        name: "hk-tw",
        server_ids: [11, 12],
      }), { idempotencyKey: expect.any(String) });
      expect(post).toHaveBeenCalledWith("/api/admin/tunnel-templates", expect.objectContaining({
        name: "hk-tw",
        server_ids: [12, 11],
      }), { idempotencyKey: expect.any(String) });
    });
  });

  it("allows selecting bidirectional mode with zero or one server and prompts to add servers", async () => {
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/tunnel-templates") return { templates: [] } as T;
      if (path === "/api/admin/remote-servers") return { servers: [
        { id: 11, name: "东京入口", status: "online", ws_connected: true, is_federated: false },
        { id: 12, name: "洛杉矶出口", status: "online", ws_connected: true, is_federated: false },
      ] } as T;
      if (path === "/api/admin/users") return { users: [] } as T;
      if (path === "/api/admin/forwards") return { forwards: [] } as T;
      throw new Error(`unexpected GET ${path}`);
    });

    render(<ForwardingManagement isAdmin notify={vi.fn()} />);
    await screen.findByText("暂无隧道模板");
    fireEvent.click(screen.getByRole("button", { name: "创建第一条隧道" }));

    const dialog = screen.getByRole("dialog", { name: "创建隧道模板" });
    const directionSelect = within(dialog).getByRole("combobox", { name: /路线方向/ });

    // Select bidirectional before adding servers
    fireEvent.change(directionSelect, { target: { value: "bidirectional" } });
    expect(directionSelect).toHaveValue("bidirectional");
    expect(within(dialog).getByText(/双向对称模式至少需要添加 2 台服务器/)).toBeInTheDocument();
    expect(within(dialog).queryByRole("textbox", { name: /反向模板名称预览/ })).not.toBeInTheDocument();

    // Add only 1 server
    fireEvent.click(screen.getByRole("button", { name: "加入路线" }));
    expect(within(dialog).getByText(/双向对称模式至少需要添加 2 台服务器/)).toBeInTheDocument();

    // Add 2nd server -> hint updates to both templates sharing name
    fireEvent.change(screen.getByRole("textbox", { name: "隧道名称" }), { target: { value: "东京-洛杉矶" } });
    fireEvent.click(screen.getByRole("button", { name: "加入路线" }));
    expect(within(dialog).getByText(/将同时创建正向与反向两条独立隧道模板（共用相同名称）/)).toBeInTheDocument();
  });

  it("merges bidirectional mirror templates into a single row with bidirectional indicator and synchronized actions", async () => {
    const notify = vi.fn();
    const forwardTemplate = {
      id: 201,
      public_id: "tun_tw_hk",
      name: "港台",
      state: "active",
      billing_mode: "both" as const,
      traffic_multiplier_milli: 1000,
      port_range_start: 1024,
      port_range_end: 65535,
      version: 1,
      hops: [
        { position: 0, server_id: 11, server_name: "Bestvm TW" },
        { position: 1, server_id: 12, server_name: "Bestvm HK" },
      ],
    };
    const reverseTemplate = {
      id: 202,
      public_id: "tun_hk_tw",
      name: "港台",
      state: "active",
      billing_mode: "both" as const,
      traffic_multiplier_milli: 1000,
      port_range_start: 1024,
      port_range_end: 65535,
      version: 1,
      hops: [
        { position: 0, server_id: 12, server_name: "Bestvm HK" },
        { position: 1, server_id: 11, server_name: "Bestvm TW" },
      ],
    };

    // Test pure grouping logic first
    const groups = groupTunnelTemplates([forwardTemplate, reverseTemplate]);
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe("港台");
    expect(groups[0].isBidirectional).toBe(true);
    expect(groups[0].templates).toHaveLength(2);

    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/tunnel-templates") return { templates: [forwardTemplate, reverseTemplate] } as T;
      if (path === "/api/admin/remote-servers") return { servers: [
        { id: 11, name: "Bestvm TW", status: "online", ws_connected: true, is_federated: false },
        { id: 12, name: "Bestvm HK", status: "online", ws_connected: true, is_federated: false },
      ] } as T;
      if (path === "/api/admin/users") return { users: [] } as T;
      if (path === "/api/admin/forwards") return { forwards: [] } as T;
      throw new Error(`unexpected GET ${path}`);
    });

    const put = vi.spyOn(api, "put").mockResolvedValue({});
    const del = vi.spyOn(api, "delete").mockResolvedValue({});

    render(<ForwardingManagement isAdmin notify={notify} />);

    // Tab count should be 1, not 2
    const templateTab = await screen.findByRole("tab", { name: /隧道模板/ });
    expect(templateTab).toHaveTextContent("1");

    // Table should have only 1 row for 港台
    const tableRows = screen.getAllByRole("row");
    // Row 0 is header, Row 1 is data row
    expect(tableRows).toHaveLength(2);

    expect(screen.getByText("港台")).toBeInTheDocument();
    expect(screen.getAllByText("双向")).toHaveLength(2); // One for badge, one for billing mode
    expect(screen.getByText(/2 跳 · 双向 · TCP \+ UDP/)).toBeInTheDocument();

    // Verify duplicate emergency button (Zap) is removed, leaving only pause/resume, edit, and delete
    expect(screen.queryByRole("button", { name: /紧急停用/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "编辑 港台" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "停止 港台 新建" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除 港台" })).toBeInTheDocument();

    // Test Edit opens prefilled dialog and updates BOTH mirror templates
    fireEvent.click(screen.getByRole("button", { name: "编辑 港台" }));
    const editDialog = await screen.findByRole("dialog", { name: "编辑双向隧道" });
    expect(editDialog).toBeInTheDocument();
    const nameInput = within(editDialog).getByRole("textbox", { name: "隧道名称" });
    expect(nameInput).toHaveValue("港台");

    fireEvent.change(nameInput, { target: { value: "港台专线" } });
    fireEvent.change(within(editDialog).getByRole("spinbutton", { name: "流量倍率" }), { target: { value: "1.5" } });
    fireEvent.click(within(editDialog).getByRole("button", { name: "保存修改" }));

    await waitFor(() => {
      expect(put).toHaveBeenCalledWith(
        "/api/admin/tunnel-templates/tun_tw_hk",
        expect.objectContaining({
          name: "港台专线",
          traffic_multiplier_milli: 1500,
          server_ids: [11, 12],
          version: 1,
        }),
        { idempotencyKey: expect.any(String) },
      );
      expect(put).toHaveBeenCalledWith(
        "/api/admin/tunnel-templates/tun_hk_tw",
        expect.objectContaining({
          name: "港台专线",
          traffic_multiplier_milli: 1500,
          server_ids: [12, 11],
          version: 1,
        }),
        { idempotencyKey: expect.any(String) },
      );
      expect(notify).toHaveBeenCalledWith("双向隧道已更新");
    });

    // Test Pause (停止新建) triggers state update on BOTH templates
    const pauseButton = screen.getByRole("button", { name: "停止 港台 新建" });
    fireEvent.click(pauseButton);

    await waitFor(() => {
      expect(put).toHaveBeenCalledWith(
        "/api/admin/tunnel-templates/tun_tw_hk/state",
        { state: "draining", version: 1 },
        { idempotencyKey: expect.any(String) },
      );
      expect(put).toHaveBeenCalledWith(
        "/api/admin/tunnel-templates/tun_hk_tw/state",
        { state: "draining", version: 1 },
        { idempotencyKey: expect.any(String) },
      );
      expect(notify).toHaveBeenCalledWith("双向隧道已停止新建");
    });

    // Test Delete triggers bidirectional confirmation and deletes BOTH templates
    const deleteButton = screen.getByRole("button", { name: "删除 港台" });
    fireEvent.click(deleteButton);

    const confirmDialog = await screen.findByRole("dialog", { name: "删除双向隧道模板" });
    expect(confirmDialog).toBeInTheDocument();
    expect(within(confirmDialog).getByText(/将同时删除“港台”的正反两条隧道模板/)).toBeInTheDocument();

    fireEvent.click(within(confirmDialog).getByRole("button", { name: "确认删除" }));

    await waitFor(() => {
      expect(del).toHaveBeenCalledWith(
        "/api/admin/tunnel-templates/tun_tw_hk",
        undefined,
        { idempotencyKey: expect.any(String) },
      );
      expect(del).toHaveBeenCalledWith(
        "/api/admin/tunnel-templates/tun_hk_tw",
        undefined,
        { idempotencyKey: expect.any(String) },
      );
      expect(notify).toHaveBeenCalledWith("双向隧道模板已删除");
    });
  });
});
