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
  nodes: [1, 2],
  speed_limit_mbps: 100,
  device_limit: 3,
  short_code: "standard",
  traffic_mode: "twoway",
  node_multipliers: { "1": 2, "2": 1.5 },
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
    tunnel_id: 7, max_active_forwards: 1, per_forward_speed_mbps: 0,
    per_forward_connection_limit: 0, traffic_limit_bytes: 0, billing_mode_override: null,
  }],
};

const nodes: NodeItem[] = [
  { id: 1, node_name: "香港 A", protocol: "vless", raw_url: "", clash_config: "", parsed_config: "", enabled: true, tag: "hk", original_server: "edge-hk", inbound_tag: "in-a", node_type: "physical", updated_at: "" },
  { id: 2, node_name: "东京 B", protocol: "trojan", raw_url: "", clash_config: "", parsed_config: "", enabled: true, tag: "jp", original_server: "edge-jp", inbound_tag: "in-b", node_type: "physical", updated_at: "" },
];

function mockLoads() {
  return vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
    if (path === "/api/admin/packages") return { packages: [packageItem] } as T;
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
  it("preserves advanced settings in a complete update payload and prunes removed node overrides", async () => {
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
      is_reset: true,
      reset_day: 8,
      nodes: [2],
      node_multipliers: { "2": 1.5 },
      node_speed_limits: { "2": 60 },
      node_device_limits: { "2": 1 },
      auto_speed_rules: packageItem.auto_speed_rules,
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
    fireEvent.change(screen.getByRole("spinbutton", { name: "香港 A 限速" }), { target: { value: "55" } });
    fireEvent.change(screen.getByRole("combobox", { name: /订阅规则模板/ }), { target: { value: "default.yaml" } });
    fireEvent.click(screen.getByRole("button", { name: "保存更改" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/packages/update", expect.objectContaining({
      node_multipliers: { "1": 3, "2": 1.5 },
      node_speed_limits: { "1": 55, "2": 60 },
      template_filename: "default.yaml",
    })));
  });

  it("keeps package actions available in the compact list view", async () => {
    mockLoads();
    render(<PackagesPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "列表视图" }));
    expect(screen.getByRole("columnheader", { name: "流量 / 周期" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "编辑 标准套餐" })).toBeInTheDocument();
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
});
