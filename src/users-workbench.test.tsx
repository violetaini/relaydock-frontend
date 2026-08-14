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

const customAlice = {
  ...alice,
  package_id: undefined,
  package_name: undefined,
  package_end_date: undefined,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.location.hash = "";
});

describe("users workbench", () => {
  it("never saves an empty subscription assignment after either source failed to load", async () => {
    let fileAttempts = 0;
    vi.spyOn(api, "get").mockImplementation(async (path) => {
      if (path === "/api/admin/users") return { users: [alice] };
      if (path === "/api/admin/packages") return { packages: [] };
      if (path === "/api/admin/subscribe-files") {
        fileAttempts += 1;
        if (fileAttempts === 1) throw new Error("订阅列表暂不可用");
        return { files: [{ id: 7, name: "主订阅", filename: "main.yaml", type: "create" }] };
      }
      if (path === "/api/admin/users/alice/subscriptions") return { subscription_ids: [7] };
      throw new Error(`unexpected GET ${path}`);
    });
    const put = vi.spyOn(api, "put").mockResolvedValue({});
    render(<UsersWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "用户设置 alice" }));
    fireEvent.click(screen.getByRole("tab", { name: "订阅分配" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("订阅列表暂不可用");
    expect(screen.queryByRole("button", { name: /保存分配/ })).not.toBeInTheDocument();
    expect(put).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    expect(await screen.findByRole("checkbox", { name: /主订阅/ })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "保存分配（1）" }));
    await waitFor(() => expect(put).toHaveBeenCalledWith("/api/admin/users/alice/subscriptions", { subscription_ids: [7] }));
  });

  it("keeps the selected user view in the URL", async () => {
    vi.spyOn(api, "get").mockImplementation(async (path) => {
      if (path === "/api/admin/users") return { users: [alice] };
      if (path === "/api/admin/packages") return { packages: [] };
      if (path === "/api/admin/tgbot/invites") return { success: true, items: [] };
      throw new Error(`unexpected GET ${path}`);
    });

    render(<UsersWorkbenchPage notify={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "TG 邀请码" }));

    expect(window.location.hash).toBe("#/users?view=invites");
  });

  it("shows TG invites as a dedicated view without rendering the user table", async () => {
    const get = vi.spyOn(api, "get").mockImplementation(async (path) => {
      if (path === "/api/admin/tgbot/invites") return {
        success: true,
        items: [{ code: "INVITE123456", kind: "new", max_uses: 1, used_count: 0, revoked: false, usable: true }],
      };
      if (path === "/api/admin/users") return { users: [alice] };
      if (path === "/api/admin/packages") return { packages: [] };
      throw new Error(`unexpected GET ${path}`);
    });

    render(<UsersWorkbenchPage notify={vi.fn()} initialScope="invites" />);

    expect(await screen.findByText("INVITE123456", { exact: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "TG 邀请码" })).toHaveClass("is-active");
    expect(screen.queryByRole("button", { name: "新建用户" })).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "搜索用户" })).not.toBeInTheDocument();
    expect(screen.queryByRole("table", { name: /用户/ })).not.toBeInTheDocument();
    expect(get).toHaveBeenCalledWith("/api/admin/users");
  });

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
    expect(screen.getByRole("columnheader", { name: "服务授权" })).toBeInTheDocument();
    expect(screen.getByText("套餐 · 标准", { selector: ".user-package-chip" })).toBeInTheDocument();

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

  it("opens every custom service grant from the unified authorization panel", async () => {
    const get = vi.spyOn(api, "get").mockImplementation(async (path) => {
      if (path === "/api/admin/users") return { users: [customAlice] };
      if (path === "/api/admin/packages") return { packages: [] };
      if (path === "/api/admin/nodes") return { nodes: [] };
      if (path === "/api/admin/users/alice/node-grants") return { items: [] };
      if (path === "/api/admin/users/alice/server-grants") return { grants: [] };
      if (path === "/api/admin/users/alice/managed-nodes") return { items: [] };
      if (path === "/api/admin/remote-servers") return { success: true, servers: [] };
      if (path === "/api/admin/tunnel-templates") return { templates: [] };
      if (path === "/api/admin/users/alice/tunnel-grants") return { grants: [] };
      throw new Error(`unexpected GET ${path}`);
    });
    render(<UsersWorkbenchPage notify={vi.fn()} />);

    expect(await screen.findByText("自定义", { selector: ".user-package-chip" })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "用户设置 alice" }));
    fireEvent.click(screen.getByRole("tab", { name: "服务授权" }));

    expect(await screen.findByRole("dialog", { name: "用户设置 · alice" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "服务授权" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("radio", { name: /自定义授权/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("tablist", { name: "用户设置菜单" })).not.toHaveTextContent("固定节点授权");
    expect(screen.getByRole("tablist", { name: "用户设置菜单" })).not.toHaveTextContent("转发授权");
    expect(screen.getByRole("tablist", { name: "自助节点授权视图" })).toBeInTheDocument();
    await waitFor(() => expect(get).toHaveBeenCalledWith("/api/admin/users/alice/server-grants"));
    expect(get).toHaveBeenCalledWith("/api/admin/users/alice/managed-nodes");
    expect(get).toHaveBeenCalledWith("/api/admin/users/alice/node-grants");
    expect(get).toHaveBeenCalledWith("/api/admin/users/alice/tunnel-grants");
  });

  it("manages personalized fixed nodes independently from package templates", async () => {
    const get = vi.spyOn(api, "get").mockImplementation(async (path) => {
      if (path === "/api/admin/users") return { users: [customAlice] };
      if (path === "/api/admin/packages") return { packages: [] };
      if (path === "/api/admin/nodes") return { nodes: [
        { id: 7, node_name: "香港固定入口", protocol: "vless", enabled: true, direct_grant_eligible: true, node_type: "physical", original_server: "HK-01", inbound_tag: "vless-main" },
      ] };
      if (path === "/api/admin/users/alice/node-grants") return { items: [] };
      if (path === "/api/admin/users/alice/server-grants") return { grants: [] };
      if (path === "/api/admin/users/alice/managed-nodes") return { items: [] };
      if (path === "/api/admin/remote-servers") return { success: true, servers: [] };
      if (path === "/api/admin/tunnel-templates") return { templates: [] };
      if (path === "/api/admin/users/alice/tunnel-grants") return { grants: [] };
      throw new Error(`unexpected GET ${path}`);
    });
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true });
    render(<UsersWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "用户设置 alice" }));
    fireEvent.click(screen.getByRole("tab", { name: "服务授权" }));

    expect(await screen.findByRole("radio", { name: /自定义授权/ })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(/套餐内的制式节点由“套餐授权”统一维护/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "候选固定节点" }), { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "授权节点" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/users/alice/node-grants", {
      node_id: 7,
      expires_at: null,
    }));
    expect(get).toHaveBeenCalledWith("/api/admin/users/alice/node-grants");
  });

  it("does not offer nodes that the backend has not marked as independently manageable", async () => {
    vi.spyOn(api, "get").mockImplementation(async (path) => {
      if (path === "/api/admin/users") return { users: [customAlice] };
      if (path === "/api/admin/packages") return { packages: [] };
      if (path === "/api/admin/nodes") return { nodes: [
        { id: 7, node_name: "共享导入节点", protocol: "vless", enabled: true, node_type: "physical", original_server: "HK-01", inbound_tag: "vless-main" },
      ] };
      if (path === "/api/admin/users/alice/node-grants") return { items: [] };
      if (path === "/api/admin/users/alice/server-grants") return { grants: [] };
      if (path === "/api/admin/users/alice/managed-nodes") return { items: [] };
      if (path === "/api/admin/remote-servers") return { success: true, servers: [] };
      if (path === "/api/admin/tunnel-templates") return { templates: [] };
      if (path === "/api/admin/users/alice/tunnel-grants") return { grants: [] };
      throw new Error(`unexpected GET ${path}`);
    });
    render(<UsersWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "用户设置 alice" }));
    fireEvent.click(screen.getByRole("tab", { name: "服务授权" }));

    expect(await screen.findByRole("combobox", { name: "候选固定节点" })).toHaveValue("");
    expect(screen.getByRole("option", { name: "暂无可新增的固定节点" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "授权节点" })).toBeDisabled();
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
    const put = vi.spyOn(api, "put").mockResolvedValue({ success: true });
    render(<UsersWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "用户设置 alice" }));
    fireEvent.click(screen.getByRole("tab", { name: "服务授权" }));
    fireEvent.click(screen.getByRole("radio", { name: /套餐授权/ }));
    fireEvent.change(await screen.findByRole("combobox", { name: "用户套餐" }), { target: { value: "9" } });
    fireEvent.change(screen.getByLabelText("套餐到期日期"), { target: { value: "2026-12-31" } });
    fireEvent.click(screen.getByRole("button", { name: "分配套餐" }));

    await waitFor(() => expect(put).toHaveBeenCalledWith("/api/admin/users/alice/service-authorization", {
      mode: "package",
      package: { package_id: 9, expire_date: "2026-12-31", is_reset: false },
    }));
  });

  it("lets an administrator override the selected package reset policy", async () => {
    const unassigned = { ...alice, package_id: undefined, package_name: undefined, package_end_date: undefined };
    vi.spyOn(api, "get").mockImplementation(async (path) => {
      if (path === "/api/admin/users") return { users: [unassigned] };
      if (path === "/api/admin/packages") return { packages: [{ id: 9, name: "月付套餐", traffic_limit_gb: 200, cycle_days: 30, is_reset: true, reset_day: 8 }] };
      throw new Error(`unexpected GET ${path}`);
    });
    const put = vi.spyOn(api, "put").mockResolvedValue({ success: true });
    render(<UsersWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "用户设置 alice" }));
    fireEvent.click(screen.getByRole("tab", { name: "服务授权" }));
    fireEvent.click(screen.getByRole("radio", { name: /套餐授权/ }));
    fireEvent.change(await screen.findByRole("combobox", { name: "用户套餐" }), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("switch", { name: "按自然月重置该用户流量" }));
    fireEvent.click(screen.getByRole("button", { name: "分配套餐" }));

    await waitFor(() => expect(put).toHaveBeenCalledWith("/api/admin/users/alice/service-authorization", {
      mode: "package",
      package: { package_id: 9, is_reset: false },
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
    fireEvent.click(screen.getByRole("tab", { name: "服务授权" }));
    fireEvent.click(await screen.findByRole("button", { name: "续期" }));
    fireEvent.click(screen.getByRole("button", { name: "确认续期" }));

    await waitFor(() => expect(notify).toHaveBeenCalledWith(
      "alice 已续期至 2026-09-29；1 项节点截止日下发失败，请到服务管理检查",
      "error",
    ));
  });

  it("requires confirmation before switching a package user to custom authorization", async () => {
    vi.spyOn(api, "get").mockImplementation(async (path) => {
      if (path === "/api/admin/users") return { users: [alice] };
      if (path === "/api/admin/packages") return { packages: [{ id: 2, name: "标准", traffic_limit_gb: 100, cycle_days: 30 }] };
      throw new Error(`unexpected GET ${path}`);
    });
    const put = vi.spyOn(api, "put").mockResolvedValue({ success: true });
    render(<UsersWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "用户设置 alice" }));
    fireEvent.click(screen.getByRole("tab", { name: "服务授权" }));
    fireEvent.click(await screen.findByRole("button", { name: "改为自定义授权" }));

    expect(screen.getByRole("dialog", { name: "切换为自定义授权" })).toBeInTheDocument();
    expect(put).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认切换" }));
    await waitFor(() => expect(put).toHaveBeenCalledWith("/api/admin/users/alice/service-authorization", {
      mode: "custom",
      custom: { fixed_node_grants: [], server_grants: [], forwarding_grants: [] },
    }));
  });

  it("batch assigns one package to selected non-admin users", async () => {
    const bob = { ...alice, username: "bob", nickname: "Bob" };
    const admin = { ...alice, username: "admin", nickname: "管理员", role: "admin" };
    vi.spyOn(api, "get").mockImplementation(async (path) => {
      if (path === "/api/admin/users") return { users: [alice, bob, admin] };
      if (path === "/api/admin/packages") return { packages: [{ id: 9, name: "团队套餐", is_reset: true, reset_day: 8 }] };
      if (path === "/api/admin/nodes") return { nodes: [] };
      if (path === "/api/admin/remote-servers") return { servers: [] };
      if (path === "/api/admin/tunnel-templates") return { templates: [] };
      throw new Error(`unexpected GET ${path}`);
    });
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true });
    render(<UsersWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("checkbox", { name: "选择用户 alice" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "选择用户 bob" }));
    expect(screen.queryByRole("checkbox", { name: "选择用户 admin" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "批量服务授权 (2)" }));
    fireEvent.click(screen.getByRole("radio", { name: /套餐授权/ }));
    fireEvent.change(await screen.findByRole("combobox", { name: "批量套餐" }), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: "应用到 2 位用户" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/users/service-authorization/batch", {
      usernames: ["alice", "bob"],
      mode: "package",
      package: { package_id: 9, is_reset: true, reset_day: 8 },
    }));
  });

  it("batch replaces custom service grants with explicit service policies", async () => {
    const bob = { ...customAlice, username: "bob", nickname: "Bob" };
    vi.spyOn(api, "get").mockImplementation(async (path) => {
      if (path === "/api/admin/users") return { users: [customAlice, bob] };
      if (path === "/api/admin/packages") return { packages: [] };
      if (path === "/api/admin/nodes") return { nodes: [{
        id: 7, node_name: "香港固定入口", protocol: "vless", enabled: true,
        direct_grant_eligible: true, node_type: "physical", original_server: "HK-01",
      }] };
      if (path === "/api/admin/remote-servers") return { servers: [{ id: 11, name: "东京服务器", status: "online" }] };
      if (path === "/api/admin/tunnel-templates") return { templates: [{
        id: 22, name: "东京中继", state: "active", hops: [{ server_id: 11 }],
      }] };
      throw new Error(`unexpected GET ${path}`);
    });
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true });
    render(<UsersWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("checkbox", { name: "选择当前用户" }));
    fireEvent.click(screen.getByRole("button", { name: "批量服务授权 (2)" }));
    fireEvent.click(screen.getByRole("radio", { name: /自定义授权/ }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /香港固定入口/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /东京服务器/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /东京中继/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "批量转发流量计算" }), { target: { value: "upload" } });
    fireEvent.click(screen.getByRole("button", { name: "应用到 2 位用户" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/users/service-authorization/batch", {
      usernames: ["alice", "bob"],
      mode: "custom",
      custom: {
        fixed_node_grants: [{ node_id: 7, expires_at: null }],
        server_grants: [{
          server_id: 11, enabled: true, starts_at: expect.any(String), expires_at: null,
          max_active_nodes: 0, speed_limit_mbps: 0, connection_limit: 0,
          traffic_limit_bytes: 0, billing_mode: "download", reset_policy: "none", reset_day: 1,
          allowed_protocols: [], allowed_protocol_profiles: [],
        }],
        forwarding_grants: [{
          tunnel_id: 22, enabled: true, starts_at: expect.any(String), expires_at: null,
          max_active_forwards: 1, per_forward_speed_mbps: 0, per_forward_connection_limit: 0,
          traffic_limit_bytes: 0, billing_mode_override: "upload", allow_custom_public_target: false,
        }],
      },
    }));
  });

  it("reports batch authorization partial results and keeps only failed users selected", async () => {
    const bob = { ...alice, username: "bob", nickname: "Bob" };
    vi.spyOn(api, "get").mockImplementation(async (path) => {
      if (path === "/api/admin/users") return { users: [alice, bob] };
      if (path === "/api/admin/packages") return { packages: [{ id: 9, name: "团队套餐", is_reset: false, reset_day: 1 }] };
      if (path === "/api/admin/nodes") return { nodes: [] };
      if (path === "/api/admin/remote-servers") return { servers: [] };
      if (path === "/api/admin/tunnel-templates") return { templates: [] };
      throw new Error(`unexpected GET ${path}`);
    });
    vi.spyOn(api, "post").mockResolvedValue({
      success: false,
      applied_users: ["alice"],
      results: [
        { username: "alice", mode: "package", status: "applied" },
        { username: "bob", mode: "package", status: "rolled_back", error: "Agent 离线" },
      ],
    });
    const notify = vi.fn();
    render(<UsersWorkbenchPage notify={notify} />);

    fireEvent.click(await screen.findByRole("checkbox", { name: "选择当前用户" }));
    fireEvent.click(screen.getByRole("button", { name: "批量服务授权 (2)" }));
    fireEvent.click(screen.getByRole("radio", { name: /套餐授权/ }));
    fireEvent.change(await screen.findByRole("combobox", { name: "批量套餐" }), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: "应用到 2 位用户" }));

    await waitFor(() => expect(notify).toHaveBeenCalledWith(
      "已为 1/2 位用户应用套餐授权；1 位未应用（bob：Agent 离线）",
      "error",
    ));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "批量服务授权 · 2 位用户" })).not.toBeInTheDocument());
    expect(screen.getByRole("checkbox", { name: "选择用户 alice" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "选择用户 bob" })).toBeChecked();
    expect(screen.getByRole("button", { name: "批量服务授权 (1)" })).toBeInTheDocument();
  });

  it("locks the batch dialog and authorization mode while a replacement is running", async () => {
    const bob = { ...alice, username: "bob", nickname: "Bob" };
    vi.spyOn(api, "get").mockImplementation(async (path) => {
      if (path === "/api/admin/users") return { users: [alice, bob] };
      if (path === "/api/admin/packages") return { packages: [{ id: 9, name: "团队套餐" }] };
      if (path === "/api/admin/nodes") return { nodes: [] };
      if (path === "/api/admin/remote-servers") return { servers: [] };
      if (path === "/api/admin/tunnel-templates") return { templates: [] };
      throw new Error(`unexpected GET ${path}`);
    });
    let resolveBatch!: (value: { success: boolean }) => void;
    const post = vi.spyOn(api, "post").mockImplementation(() => new Promise((resolve) => { resolveBatch = resolve; }));
    render(<UsersWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("checkbox", { name: "选择当前用户" }));
    fireEvent.click(screen.getByRole("button", { name: "批量服务授权 (2)" }));
    const packageMode = screen.getByRole("radio", { name: /套餐授权/ });
    const customMode = screen.getByRole("radio", { name: /自定义授权/ });
    fireEvent.click(packageMode);
    fireEvent.change(await screen.findByRole("combobox", { name: "批量套餐" }), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: "应用到 2 位用户" }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("button", { name: "关闭" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
    expect(packageMode).toBeDisabled();
    expect(customMode).toBeDisabled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog", { name: "批量服务授权 · 2 位用户" })).toBeInTheDocument();
    expect(packageMode).toHaveAttribute("aria-checked", "true");

    resolveBatch({ success: true });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "批量服务授权 · 2 位用户" })).not.toBeInTheDocument());
  });

  it("retries a failed package list in one user's service authorization panel", async () => {
    let packageAttempts = 0;
    vi.spyOn(api, "get").mockImplementation(async (path) => {
      if (path === "/api/admin/users") return { users: [alice] };
      if (path === "/api/admin/packages") {
        packageAttempts += 1;
        if (packageAttempts === 1) throw new Error("套餐列表暂不可用");
        return { packages: [{ id: 2, name: "标准" }] };
      }
      throw new Error(`unexpected GET ${path}`);
    });
    render(<UsersWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "用户设置 alice" }));
    fireEvent.click(screen.getByRole("tab", { name: "服务授权" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("套餐列表暂不可用");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));

    expect(await screen.findByRole("option", { name: /标准/ })).toBeInTheDocument();
    expect(packageAttempts).toBe(2);
  });

  it("blocks batch replacement when authorization options fail to load", async () => {
    const bob = { ...customAlice, username: "bob", nickname: "Bob" };
    vi.spyOn(api, "get").mockImplementation(async (path) => {
      if (path === "/api/admin/users") return { users: [customAlice, bob] };
      if (path === "/api/admin/packages") return { packages: [] };
      if (path === "/api/admin/nodes") return { nodes: [] };
      if (path === "/api/admin/remote-servers") throw new Error("服务器选项加载失败");
      if (path === "/api/admin/tunnel-templates") return { templates: [] };
      throw new Error(`unexpected GET ${path}`);
    });
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true });
    render(<UsersWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("checkbox", { name: "选择当前用户" }));
    fireEvent.click(screen.getByRole("button", { name: "批量服务授权 (2)" }));
    fireEvent.click(screen.getByRole("radio", { name: /自定义授权/ }));
    expect(await screen.findByText("服务器选项加载失败")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "应用到 2 位用户" })).toBeDisabled();
    expect(post).not.toHaveBeenCalled();
  });
});
