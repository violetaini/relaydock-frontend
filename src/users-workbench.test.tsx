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

    fireEvent.click(await screen.findByRole("button", { name: "停用 alice" }));

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
      if (path === "/api/admin/users/alice/server-grants") return { grants: [] };
      if (path === "/api/admin/users/alice/managed-nodes") return { items: [] };
      if (path === "/api/admin/remote-servers") return { success: true, servers: [] };
      throw new Error(`unexpected GET ${path}`);
    });
    render(<UsersWorkbenchPage notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "服务器授权 alice" }));

    expect(await screen.findByRole("dialog", { name: "服务器授权 · alice" })).toBeInTheDocument();
    await waitFor(() => expect(get).toHaveBeenCalledWith("/api/admin/users/alice/server-grants"));
    expect(get).toHaveBeenCalledWith("/api/admin/users/alice/managed-nodes");
  });
});
