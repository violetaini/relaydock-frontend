import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { extractList, ForwardingManagement } from "./forwarding-management";

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
    fireEvent.change(screen.getByRole("spinbutton", { name: /全链路端口/ }), { target: { value: "2033" } });
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

  it("keeps limiter-dependent grant controls disabled and submits zero values", async () => {
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
    expect(within(dialog).getByRole("spinbutton", { name: /^每转发限速 Mbps/ })).toBeDisabled();
    expect(within(dialog).getByRole("spinbutton", { name: /^每转发连接数/ })).toBeDisabled();
    expect(within(dialog).getAllByText("当前节点组件暂不支持")).toHaveLength(2);
    const billing = within(dialog).getByRole("combobox", { name: "计费方向" });
    expect(billing).toHaveValue("both");
    expect(Array.from(billing.querySelectorAll("option"), (option) => option.textContent)).toEqual([
      "双向",
      "仅算上行",
      "仅算下行",
    ]);
    expect(within(dialog).queryByText("继承隧道")).not.toBeInTheDocument();
    fireEvent.change(billing, { target: { value: "upload" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "保存授权" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/users/alice/tunnel-grants", expect.objectContaining({
      per_forward_speed_mbps: 0,
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
});
