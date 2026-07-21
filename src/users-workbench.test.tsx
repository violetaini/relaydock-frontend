import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { UsersWorkbenchPage } from "./users-workbench";

vi.hoisted(() => {
  (globalThis as unknown as { process: { env: { NODE_ENV?: string } } }).process.env.NODE_ENV = "test";
});

const alice = {
  username: "alice", email: "alice@example.com", nickname: "Alice", role: "user", is_active: true,
  remark: "测试用户", package_id: 2, package_name: "标准", traffic_used: 1024, traffic_limit: 10240,
  is_over_limit: false, speed_limit_mbps: 100, device_limit: 3, package_end_date: "2026-08-30",
  user_short_code: "a1b2c3", custom_user_short_code: "",
};

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("users workbench", () => {
  it("toggles a user's active state through the provisioning endpoint", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ users: [alice] });
    const post = vi.spyOn(api, "post").mockResolvedValue({ status: "updated" });
    const notify = vi.fn();
    render(<UsersWorkbenchPage notify={notify} />);

    fireEvent.click(await screen.findByRole("button", { name: "用户设置 alice" }));
    fireEvent.click(await screen.findByRole("button", { name: "停用用户" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/users/status", { username: "alice", is_active: false }));
    expect(notify).toHaveBeenCalledWith("用户已停用，节点凭据已暂停");
  });

  it("creates a user and exposes the server-generated initial password once", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ users: [] });
    vi.spyOn(api, "post").mockResolvedValue({ username: "bob", password: "generated-pass" });
    const notify = vi.fn();
    render(<UsersWorkbenchPage notify={notify} />);

    fireEvent.click(await screen.findByRole("button", { name: "新建用户" }));
    fireEvent.change(screen.getByRole("textbox", { name: "用户名" }), { target: { value: "bob" } });
    fireEvent.click(screen.getByRole("button", { name: "创建用户" }));

    expect(await screen.findByText("generated-pass")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "完成" }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith("用户 bob 已创建"));
  });

  it("opens the server authorization workbench from a regular user row", async () => {
    const get = vi.spyOn(api, "get").mockImplementation(async (path) => {
      if (path === "/api/admin/users") return { users: [alice] };
      if (path === "/api/admin/packages") return { packages: [] };
      if (path === "/api/admin/users/alice/server-grants") return { grants: [] };
      if (path === "/api/admin/users/alice/managed-nodes") return { items: [] };
      if (path === "/api/admin/remote-servers") return { success: true, servers: [] };
      throw new Error(`unexpected GET ${path}`);
    });
    render(<UsersWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "用户设置 alice" }));
    fireEvent.click(await screen.findByRole("button", { name: /服务器授权与自建节点/ }));

    expect(await screen.findByRole("dialog", { name: "服务器授权 · alice" })).toBeInTheDocument();
    await waitFor(() => expect(get).toHaveBeenCalledWith("/api/admin/users/alice/server-grants"));
    expect(get).toHaveBeenCalledWith("/api/admin/users/alice/managed-nodes");
  });

  it("saves an explicit unlimited package traffic override without changing server grants", async () => {
    vi.spyOn(api, "get").mockImplementation(async (path) => {
      if (path === "/api/admin/users") return { users: [{ ...alice, traffic_limit_override_gb: 12.5 }] };
      if (path === "/api/admin/packages") return { packages: [] };
      if (path === "/api/admin/nodes") return { nodes: [] };
      throw new Error(`unexpected GET ${path}`);
    });
    const put = vi.spyOn(api, "put").mockResolvedValue({ success: true });
    const notify = vi.fn();
    render(<UsersWorkbenchPage notify={notify} />);

    fireEvent.click(await screen.findByRole("button", { name: "用户设置 alice" }));
    fireEvent.click(await screen.findByRole("button", { name: /流量、限速与设备数/ }));
    const traffic = screen.getByRole("spinbutton", { name: /^总流量覆盖（GB）/ });
    expect(traffic).toHaveValue(12.5);
    fireEvent.change(traffic, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "保存并下发" }));

    await waitFor(() => expect(put).toHaveBeenCalledWith("/api/admin/users/traffic-limit", {
      username: "alice",
      traffic_limit_override_gb: 0,
    }));
    expect(put.mock.calls.some(([path]) => String(path).includes("server-grants"))).toBe(false);
  });

  it("reports which limit steps were saved when a later push fails", async () => {
    vi.spyOn(api, "get").mockImplementation(async (path) => {
      if (path === "/api/admin/users") return { users: [alice] };
      if (path === "/api/admin/packages") return { packages: [] };
      if (path === "/api/admin/nodes") return { nodes: [] };
      throw new Error(`unexpected GET ${path}`);
    });
    const put = vi.spyOn(api, "put").mockImplementation(async (path) => {
      if (path === "/api/admin/users/limits") throw new Error("Agent 暂时不可用");
      return { success: true };
    });
    render(<UsersWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "用户设置 alice" }));
    fireEvent.click(await screen.findByRole("button", { name: /流量、限速与设备数/ }));
    fireEvent.click(screen.getByRole("button", { name: "保存并下发" }));

    expect(await screen.findByText(/Agent 暂时不可用.*已保存：总流量/)).toBeInTheDocument();
    expect(put).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("dialog", { name: "alice 的用户限额" })).toBeInTheDocument();
  });

  it("assigns a package and expiry from the unified user settings", async () => {
    const unassigned = { ...alice, package_id: undefined, package_name: undefined, package_end_date: undefined };
    vi.spyOn(api, "get").mockImplementation(async (path) => {
      if (path === "/api/admin/users") return { users: [unassigned] };
      if (path === "/api/admin/packages") return { packages: [{ id: 9, name: "合租套餐", traffic_limit_gb: 200, cycle_days: 30 }] };
      throw new Error(`unexpected GET ${path}`);
    });
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true });
    render(<UsersWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "用户设置 alice" }));
    fireEvent.change(await screen.findByRole("combobox", { name: "用户套餐" }), { target: { value: "9" } });
    fireEvent.change(screen.getByLabelText("套餐到期日期"), { target: { value: "2026-12-31" } });
    fireEvent.click(screen.getByRole("button", { name: "分配套餐" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/packages/assign", {
      username: "alice",
      package_id: 9,
      expire_date: "2026-12-31",
    }));
  });
});
