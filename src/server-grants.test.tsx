import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { ServerGrantsDialog } from "./server-grants";

vi.hoisted(() => {
  (globalThis as unknown as { process: { env: { NODE_ENV?: string } } }).process.env.NODE_ENV = "test";
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("server grants", () => {
  it("creates a grant limited to the exact Shadowsocks 2022 combination", async () => {
    vi.spyOn(api, "get").mockImplementation(async (path) => {
      if (path === "/api/admin/users/alice/server-grants") return { grants: [] };
      if (path === "/api/admin/users/alice/managed-nodes") return { items: [] };
      if (path === "/api/admin/remote-servers") return { success: true, servers: [{ id: 3, name: "香港入口", status: "online" }] };
      throw new Error(`unexpected GET ${path}`);
    });
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true });
    render(<ServerGrantsDialog username="alice" notify={vi.fn()} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "新增授权" }));
    fireEvent.change(screen.getByRole("combobox", { name: "授权服务器" }), { target: { value: "3" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: /^最大已开通节点/ }), { target: { value: "4" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: /^限速/ }), { target: { value: "80" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: /^并发连接数/ }), { target: { value: "5" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: /^流量额度/ }), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Shadowsocks Shadowsocks 2022" }));
    fireEvent.click(screen.getByRole("button", { name: "上下行" }));
    fireEvent.click(screen.getByRole("button", { name: "保存授权" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/users/alice/server-grants", expect.objectContaining({
      server_id: 3,
      enabled: true,
      max_active_nodes: 4,
      speed_limit_mbps: 80,
      connection_limit: 5,
      traffic_limit_bytes: 10 * 1024 ** 3,
      billing_mode: "both",
      reset_policy: "none",
      reset_day: 1,
      allowed_protocols: ["shadowsocks"],
      allowed_protocol_profiles: ["shadowsocks-2022"],
      version: 1,
      starts_at: expect.stringMatching(/Z$/),
      expires_at: null,
    })));
  });

  it("restores and preserves the protocol whitelist while editing a grant", async () => {
    const grant = {
      id: 7, username: "alice", server_id: 3, server_name: "香港入口", server_status: "online",
      enabled: true, starts_at: "2026-07-01T00:00:00Z", expires_at: null, max_active_nodes: 0,
      speed_limit_mbps: 0, connection_limit: 0, traffic_limit_bytes: 0, billing_mode: "download",
      reset_policy: "none", reset_day: 1, allowed_protocols: ["hysteria", "socks"], version: 4,
      state: "active", offer_count: 2, active_node_count: 0, used_uplink_bytes: 0,
      used_downlink_bytes: 0, billed_bytes: 0,
    };
    vi.spyOn(api, "get").mockImplementation(async (path) => {
      if (path === "/api/admin/users/alice/server-grants") return { grants: [grant] };
      if (path === "/api/admin/users/alice/managed-nodes") return { items: [] };
      if (path === "/api/admin/remote-servers") return { success: true, servers: [{ id: 3, name: "香港入口", status: "online" }] };
      throw new Error(`unexpected GET ${path}`);
    });
    const put = vi.spyOn(api, "put").mockResolvedValue({ success: true });
    render(<ServerGrantsDialog username="alice" notify={vi.fn()} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "编辑 香港入口 授权" }));
    expect(screen.getByRole("checkbox", { name: "Hysteria2 全部组合" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "SOCKS5 全部组合" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "全部协议组合" })).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "保存授权" }));

    expect(screen.queryByText("确认收窄协议组合")).not.toBeInTheDocument();
    await waitFor(() => expect(put).toHaveBeenCalledWith("/api/admin/users/alice/server-grants/7", expect.objectContaining({
      allowed_protocols: ["hysteria", "socks"],
      allowed_protocol_profiles: [],
      version: 4,
    })));
  });

  it("restores and preserves an exact protocol combination", async () => {
    const grant = {
      id: 7, username: "alice", server_id: 3, server_name: "香港入口", server_status: "online",
      enabled: true, starts_at: "2026-07-01T00:00:00Z", expires_at: null, max_active_nodes: 0,
      speed_limit_mbps: 0, connection_limit: 0, traffic_limit_bytes: 0, billing_mode: "download",
      reset_policy: "none", reset_day: 1, allowed_protocols: ["shadowsocks"],
      allowed_protocol_profiles: ["shadowsocks-2022"], version: 4,
      state: "active", offer_count: 1, active_node_count: 0, used_uplink_bytes: 0,
      used_downlink_bytes: 0, billed_bytes: 0,
    };
    vi.spyOn(api, "get").mockImplementation(async (path) => {
      if (path === "/api/admin/users/alice/server-grants") return { grants: [grant] };
      if (path === "/api/admin/users/alice/managed-nodes") return { items: [] };
      if (path === "/api/admin/remote-servers") return { success: true, servers: [{ id: 3, name: "香港入口", status: "online" }] };
      throw new Error(`unexpected GET ${path}`);
    });
    const put = vi.spyOn(api, "put").mockResolvedValue({ success: true });
    render(<ServerGrantsDialog username="alice" notify={vi.fn()} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "编辑 香港入口 授权" }));
    expect(screen.getByRole("checkbox", { name: "全部协议组合" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Shadowsocks Shadowsocks 2022" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "VLESS Reality" })).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "保存授权" }));

    expect(screen.queryByText("确认收窄协议组合")).not.toBeInTheDocument();
    await waitFor(() => expect(put).toHaveBeenCalledWith("/api/admin/users/alice/server-grants/7", expect.objectContaining({
      allowed_protocols: ["shadowsocks"],
      allowed_protocol_profiles: ["shadowsocks-2022"],
      version: 4,
    })));
  });

  it("requires confirmation before narrowing an existing protocol whitelist", async () => {
    const grant = {
      id: 7, username: "alice", server_id: 3, server_name: "香港入口", server_status: "online",
      enabled: true, starts_at: "2026-07-01T00:00:00Z", expires_at: null, max_active_nodes: 0,
      speed_limit_mbps: 0, connection_limit: 0, traffic_limit_bytes: 0, billing_mode: "download",
      reset_policy: "none", reset_day: 1, version: 4,
      state: "active", offer_count: 2, active_node_count: 1, used_uplink_bytes: 0,
      used_downlink_bytes: 0, billed_bytes: 0,
    };
    vi.spyOn(api, "get").mockImplementation(async (path) => {
      if (path === "/api/admin/users/alice/server-grants") return { grants: [grant] };
      if (path === "/api/admin/users/alice/managed-nodes") return { items: [] };
      if (path === "/api/admin/remote-servers") return { success: true, servers: [{ id: 3, name: "香港入口", status: "online" }] };
      throw new Error(`unexpected GET ${path}`);
    });
    const put = vi.spyOn(api, "put").mockResolvedValue({ success: true });
    render(<ServerGrantsDialog username="alice" notify={vi.fn()} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "编辑 香港入口 授权" }));
    expect(screen.getByRole("checkbox", { name: "全部协议组合" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Shadowsocks Shadowsocks 2022" })).not.toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "Shadowsocks Shadowsocks 2022" }));
    fireEvent.click(screen.getByRole("button", { name: "保存授权" }));

    expect(await screen.findByText("确认收窄协议组合")).toBeInTheDocument();
    expect(screen.getByText(/已有的未选协议组合节点会立即停用/)).toBeInTheDocument();
    expect(screen.getByText(/用户也需要重新开通对应节点/)).toBeInTheDocument();
    expect(put).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "确认收窄并保存" }));
    await waitFor(() => expect(put).toHaveBeenCalledWith("/api/admin/users/alice/server-grants/7", expect.objectContaining({
      allowed_protocols: ["shadowsocks"],
      allowed_protocol_profiles: ["shadowsocks-2022"],
      version: 4,
    })));
  });

  it("allows clearing the last exact selection without turning it into unrestricted access", async () => {
    vi.spyOn(api, "get").mockImplementation(async (path) => {
      if (path === "/api/admin/users/alice/server-grants") return { grants: [] };
      if (path === "/api/admin/users/alice/managed-nodes") return { items: [] };
      if (path === "/api/admin/remote-servers") return { success: true, servers: [{ id: 3, name: "香港入口", status: "online" }] };
      throw new Error(`unexpected GET ${path}`);
    });
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true });
    render(<ServerGrantsDialog username="alice" notify={vi.fn()} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "新增授权" }));
    fireEvent.change(screen.getByRole("combobox", { name: "授权服务器" }), { target: { value: "3" } });
    const ss2022 = screen.getByRole("checkbox", { name: "Shadowsocks Shadowsocks 2022" });
    fireEvent.click(ss2022);
    fireEvent.click(ss2022);

    expect(screen.getByText(/请选择至少一个协议组合/)).toBeInTheDocument();
    expect(ss2022).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "全部协议组合" })).not.toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "保存授权" }));
    expect(post).not.toHaveBeenCalled();

    fireEvent.click(ss2022);
    fireEvent.click(screen.getByRole("button", { name: "保存授权" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/users/alice/server-grants", expect.objectContaining({
      allowed_protocols: ["shadowsocks"],
      allowed_protocol_profiles: ["shadowsocks-2022"],
    })));
  });
});
