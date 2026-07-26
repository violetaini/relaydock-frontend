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
  it("shows quota progress and keeps common row actions directly available", async () => {
    const quotaUser = { ...alice, traffic_used: 60 * 1024 ** 3, traffic_limit: 100 * 1024 ** 3 };
    vi.spyOn(api, "get").mockResolvedValue({ users: [quotaUser] });
    const post = vi.spyOn(api, "post").mockResolvedValue({ status: "updated" });
    render(<UsersWorkbenchPage notify={vi.fn()} />);

    const progress = await screen.findByRole("progressbar", { name: "alice 流量使用率" });
    expect(progress).toHaveAttribute("aria-valuenow", "60");
    expect(progress.closest(".traffic-progress")).toHaveAttribute("data-tone", "warn");
    expect(screen.getByRole("button", { name: "复制订阅短码 alice" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "用户设置 alice" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "删除用户 alice" })).toHaveClass("is-danger");

    fireEvent.click(screen.getByRole("switch", { name: "停用用户 alice" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/users/status", { username: "alice", is_active: false }));
  });

  it("does not expose destructive account actions for an administrator", async () => {
    const admin = { ...alice, username: "admin", nickname: "管理员", role: "admin" };
    vi.spyOn(api, "get").mockResolvedValue({ users: [admin] });
    const post = vi.spyOn(api, "post");
    render(<UsersWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "用户设置 admin" }));

    expect(screen.queryByRole("button", { name: "停用用户" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "删除用户" })).not.toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

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

    expect(await screen.findByRole("dialog", { name: "用户设置 · alice" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "服务器授权" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tablist", { name: "服务器授权视图" })).toBeInTheDocument();
    await waitFor(() => expect(get).toHaveBeenCalledWith("/api/admin/users/alice/server-grants"));
    expect(get).toHaveBeenCalledWith("/api/admin/users/alice/managed-nodes");
  });

  it("keeps one user settings dialog and restores its overview after a child setting", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ users: [alice] });
    render(<UsersWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "用户设置 alice" }));
    const dialog = screen.getByRole("dialog", { name: "用户设置 · alice" });
    fireEvent.click(screen.getByRole("button", { name: /资料、备注与订阅短码/ }));

    expect(screen.getByRole("dialog", { name: "用户设置 · alice" })).toBe(dialog);
    expect(screen.getByRole("tab", { name: "资料与短码" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("资料、备注与订阅短码", { exact: true })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "返回设置总览" })[0]);

    expect(screen.getByRole("tab", { name: "设置总览" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: /资料、备注与订阅短码/ })).toBeInTheDocument();

    fireEvent.keyDown(screen.getByRole("tab", { name: "设置总览" }), { key: "End" });
    expect(screen.getByRole("tab", { name: "节点子账号" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "节点子账号" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("tab", { name: "节点子账号" }), { key: "Home" });
    expect(screen.getByRole("tab", { name: "设置总览" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "设置总览" })).toHaveFocus();
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
    await waitFor(() => expect(screen.getByRole("tab", { name: "设置总览" })).toHaveAttribute("aria-selected", "true"));
    expect(screen.getByRole("dialog", { name: "用户设置 · alice" })).toBeInTheDocument();
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
    expect(screen.getByRole("dialog", { name: "用户设置 · alice" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "流量与限额" })).toHaveAttribute("aria-selected", "true");
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

  it("lets an administrator override the selected package reset policy", async () => {
    const unassigned = { ...alice, package_id: undefined, package_name: undefined, package_end_date: undefined };
    vi.spyOn(api, "get").mockImplementation(async (path) => {
      if (path === "/api/admin/users") return { users: [unassigned] };
      if (path === "/api/admin/packages") return { packages: [{ id: 9, name: "月付套餐", traffic_limit_gb: 200, cycle_days: 30, is_reset: true, reset_day: 8 }] };
      throw new Error(`unexpected GET ${path}`);
    });
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true });
    render(<UsersWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "用户设置 alice" }));
    fireEvent.change(await screen.findByRole("combobox", { name: "用户套餐" }), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("switch", { name: "按自然月重置该用户流量" }));
    fireEvent.click(screen.getByRole("button", { name: "分配套餐" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/packages/assign", {
      username: "alice",
      package_id: 9,
      is_reset: false,
    }));
  });

  it("shows every package user in the renewal workbench and supports quick renewal", async () => {
    const expired = { ...alice, package_end_date: "2020-01-01" };
    const later = { ...alice, username: "later", nickname: "Later", package_end_date: "2035-12-31" };
    vi.spyOn(api, "get").mockResolvedValue({ users: [later, expired] });
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true, end_date: "2026-09-29" });
    const notify = vi.fn();
    render(<UsersWorkbenchPage notify={notify} />);

    fireEvent.click(await screen.findByRole("button", { name: "续期工作台" }));
    expect(await screen.findByText(/已过期/)).toBeInTheDocument();
    expect(screen.getByText("Later", { exact: true })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "为 alice 续期 30 天" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/users/extend", { username: "alice", days: 30 }));
    expect(notify).toHaveBeenCalledWith("alice 已续期至 2026-09-29");
  });

  it("reports provisioning warnings after a successful quick renewal", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ users: [alice] });
    vi.spyOn(api, "post").mockResolvedValue({
      success: true,
      end_date: "2026-09-29",
      warnings: ["HK Reality: agent unavailable"],
    });
    const notify = vi.fn();
    render(<UsersWorkbenchPage notify={notify} initialScope="renewal" />);

    fireEvent.click(await screen.findByRole("button", { name: "为 alice 续期 30 天" }));

    await waitFor(() => expect(notify).toHaveBeenCalledWith(
      "alice 已续期至 2026-09-29；1 项节点截止日下发失败，请到服务管理检查",
      "error",
    ));
  });

  it("reports provisioning warnings from the settings renewal panel", async () => {
    vi.spyOn(api, "get").mockImplementation(async (path) => {
      if (path === "/api/admin/users") return { users: [alice] };
      if (path === "/api/admin/packages") return { packages: [] };
      throw new Error(`unexpected GET ${path}`);
    });
    vi.spyOn(api, "post").mockResolvedValue({
      success: true,
      end_date: "2026-09-29",
      warnings: ["HK Reality: agent unavailable"],
    });
    const notify = vi.fn();
    render(<UsersWorkbenchPage notify={notify} />);

    fireEvent.click(await screen.findByRole("button", { name: "用户设置 alice" }));
    fireEvent.click(await screen.findByRole("button", { name: "续期" }));
    fireEvent.click(screen.getByRole("button", { name: "确认续期" }));

    await waitFor(() => expect(notify).toHaveBeenCalledWith(
      "alice 已续期至 2026-09-29；1 项节点截止日下发失败，请到服务管理检查",
      "error",
    ));
  });

  it("requires confirmation before unassigning a package", async () => {
    vi.spyOn(api, "get").mockImplementation(async (path) => {
      if (path === "/api/admin/users") return { users: [alice] };
      if (path === "/api/admin/packages") return { packages: [{ id: 2, name: "标准", traffic_limit_gb: 100, cycle_days: 30 }] };
      throw new Error(`unexpected GET ${path}`);
    });
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true });
    render(<UsersWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "用户设置 alice" }));
    fireEvent.click(await screen.findByRole("button", { name: "解绑套餐" }));

    expect(screen.getByRole("dialog", { name: "解绑用户套餐" })).toBeInTheDocument();
    expect(post).not.toHaveBeenCalledWith("/api/admin/packages/unassign", expect.anything());
    fireEvent.click(screen.getByRole("button", { name: "确认解绑" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/packages/unassign", { username: "alice" }));
  });
});
