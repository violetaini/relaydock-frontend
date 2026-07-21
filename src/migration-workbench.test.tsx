import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { MmwMigrationDialog, validateMigrationSource } from "./migration-workbench";

vi.hoisted(() => {
  (globalThis as unknown as { process: { env: { NODE_ENV?: string } } }).process.env.NODE_ENV = "test";
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("MMW migration wizard", () => {
  it("prepares, confirms, imports and repairs a remote backup", async () => {
    const post = vi.spyOn(api, "post").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path.endsWith("fetch-mmw-backup")) return {
        success: true,
        migration_id: "0123456789abcdef0123456789abcdef",
        subscribe_count: 3,
        size_bytes: 4096,
        db_size_bytes: 2048,
      } as T;
      if (path.endsWith("import-mmw")) return {
        success: true,
        report: {
          users: 2, user_tokens: 2, nodes: 4, subscribe_files: 3, user_subscriptions: 1,
          user_settings: 2, templates: 1, custom_rules: 1, override_scripts: 0, external_subscriptions: 1,
        },
        owned_by_admin: "admin",
        subscribes_copied: 3,
      } as T;
      if (path.endsWith("patch-client-emails")) return { success: true, servers_scanned: 1, clients_patched: [{ inbound_tag: "vless-in" }], server_errors: [] } as T;
      throw new Error(`unexpected POST ${path}`);
    });
    const remove = vi.spyOn(api, "delete").mockResolvedValue({ success: true });
    vi.spyOn(api, "get").mockResolvedValue({
      success: true,
      servers: [{ address: "edge.example.com", node_count: 4, ports: [443], protocols: ["vless"], existing_server: true, existing_server_id: 7, sample_node_name: "Edge" }],
    });
    const notify = vi.fn();

    render(<MmwMigrationDialog notify={notify} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: "妙妙屋地址" }), { target: { value: "https://old.example.com" } });
    fireEvent.change(screen.getByRole("textbox", { name: "管理员用户名" }), { target: { value: "root" } });
    fireEvent.change(screen.getByLabelText("管理员密码"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "拉取并校验" }));

    expect(await screen.findByText("备份已准备")).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith("/api/admin/migrate/fetch-mmw-backup", expect.objectContaining({ url: "https://old.example.com", username: "root", password: "secret" }));
    fireEvent.click(screen.getByRole("button", { name: "开始导入" }));
    expect(post).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "确认导入" }));

    expect(await screen.findByText("数据导入结果")).toBeInTheDocument();
    expect(screen.getByText("edge.example.com")).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith("/api/admin/migrate/import-mmw", { migration_id: "0123456789abcdef0123456789abcdef" });
    expect(remove).toHaveBeenCalledWith("/api/admin/migrate/cleanup", { migration_id: "0123456789abcdef0123456789abcdef" });

    fireEvent.click(screen.getByRole("button", { name: "修复客户端归属" }));
    fireEvent.click(screen.getByRole("button", { name: "确认修复" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/migrate/patch-client-emails", { server_ids: [7] }));
    expect(notify).toHaveBeenCalledWith("客户端归属修复完成");
  });

  it("prevents closing and duplicate submits while import is running", async () => {
    let resolveImport!: (value: unknown) => void;
    const importPromise = new Promise((resolve) => { resolveImport = resolve; });
    const post = vi.spyOn(api, "post").mockImplementation(async <T,>(path: string, body?: unknown): Promise<T> => {
      if (path.endsWith("fetch-mmw-backup")) return { success: true, migration_id: "0123456789abcdef0123456789abcdef", subscribe_count: 0, size_bytes: 1, db_size_bytes: 1 } as T;
      if (path.endsWith("import-mmw")) return importPromise as Promise<T>;
      throw new Error(`unexpected POST ${path} ${JSON.stringify(body)}`);
    });
    vi.spyOn(api, "get").mockResolvedValue({ success: true, servers: [] });
    vi.spyOn(api, "delete").mockResolvedValue({ success: true });
    const onClose = vi.fn();
    render(<MmwMigrationDialog notify={vi.fn()} onClose={onClose} />);
    fireEvent.change(screen.getByRole("textbox", { name: "妙妙屋地址" }), { target: { value: "https://old.example.com" } });
    fireEvent.change(screen.getByRole("textbox", { name: "管理员用户名" }), { target: { value: "root" } });
    fireEvent.change(screen.getByLabelText("管理员密码"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "拉取并校验" }));
    await screen.findByText("备份已准备");
    fireEvent.click(screen.getByRole("button", { name: "开始导入" }));
    const confirm = screen.getByRole("button", { name: "确认导入" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(post).toHaveBeenCalledTimes(2);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
    resolveImport({ success: true, report: { users: 0, user_tokens: 0, nodes: 0, subscribe_files: 0, user_subscriptions: 0, user_settings: 0, templates: 0, custom_rules: 0, override_scripts: 0, external_subscriptions: 0 }, owned_by_admin: "admin", subscribes_copied: 0 });
    await screen.findByText("数据导入结果");
  });

  it("surfaces partial takeover and patch failures", async () => {
    const post = vi.spyOn(api, "post").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path.endsWith("fetch-mmw-backup")) return { success: true, migration_id: "0123456789abcdef0123456789abcdef", subscribe_count: 0, size_bytes: 1, db_size_bytes: 1 } as T;
      if (path.endsWith("import-mmw")) return { success: true, report: { users: 0, user_tokens: 0, nodes: 0, subscribe_files: 0, user_subscriptions: 0, user_settings: 0, templates: 0, custom_rules: 0, override_scripts: 0, external_subscriptions: 0 }, owned_by_admin: "admin", subscribes_copied: 0 } as T;
      if (path.endsWith("takeover-external-xray")) return { success: true, servers_scanned: 2, results: [{ server_id: 1, server_name: "ok", success: true }, { server_id: 2, server_name: "bad", success: false, error: "offline" }] } as T;
      if (path.endsWith("patch-client-emails")) return { success: true, servers_scanned: 1, clients_patched: [{ inbound_tag: "vless" }], admin_subaccounts_linked: [], server_errors: ["edge: write back failed"] } as T;
      throw new Error(`unexpected POST ${path}`);
    });
    vi.spyOn(api, "get").mockResolvedValue({ success: true, servers: [{ address: "edge", node_count: 1, ports: [443], protocols: ["vless"], existing_server: true, existing_server_id: 1, sample_node_name: "Edge" }] });
    vi.spyOn(api, "delete").mockResolvedValue({ success: true });
    const notify = vi.fn();
    render(<MmwMigrationDialog notify={notify} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: "妙妙屋地址" }), { target: { value: "https://old.example.com" } });
    fireEvent.change(screen.getByRole("textbox", { name: "管理员用户名" }), { target: { value: "root" } });
    fireEvent.change(screen.getByLabelText("管理员密码"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "拉取并校验" }));
    await screen.findByText("备份已准备");
    fireEvent.click(screen.getByRole("button", { name: "开始导入" }));
    fireEvent.click(screen.getByRole("button", { name: "确认导入" }));
    await screen.findByText("待接管节点服务器");
    fireEvent.click(screen.getByRole("button", { name: "接管外置 Xray" }));
    fireEvent.click(screen.getByRole("button", { name: "确认接管" }));
    expect(await screen.findByText("部分失败")).toBeInTheDocument();
    expect(screen.getAllByText(/offline/).length).toBeGreaterThan(0);
    expect(notify).toHaveBeenCalledWith("外置 Xray 接管部分完成：1 项失败", "error");
    expect(post).toHaveBeenCalledWith("/api/admin/migrate/takeover-external-xray", { server_ids: [1] });
    fireEvent.click(screen.getByRole("button", { name: "修复客户端归属" }));
    fireEvent.click(screen.getByRole("button", { name: "确认修复" }));
    expect((await screen.findAllByText(/write back failed/)).length).toBeGreaterThan(0);
    expect(notify).toHaveBeenCalledWith("客户端归属修复部分完成：1 项失败", "error");
  });

  it("cleans a prepared session when the dialog closes", async () => {
    vi.spyOn(api, "post").mockResolvedValue({ success: true, migration_id: "0123456789abcdef0123456789abcdef", subscribe_count: 0, size_bytes: 1, db_size_bytes: 1 });
    const remove = vi.spyOn(api, "delete").mockResolvedValue({ success: true });
    const onClose = vi.fn();
    render(<MmwMigrationDialog notify={vi.fn()} onClose={onClose} />);
    fireEvent.change(screen.getByRole("textbox", { name: "妙妙屋地址" }), { target: { value: "https://old.example.com" } });
    fireEvent.change(screen.getByRole("textbox", { name: "管理员用户名" }), { target: { value: "root" } });
    fireEvent.change(screen.getByLabelText("管理员密码"), { target: { value: "secret" } });
    expect(screen.getByLabelText("管理员密码")).toHaveAttribute("autocomplete", "new-password");
    fireEvent.click(screen.getByRole("button", { name: "拉取并校验" }));
    await screen.findByText("备份已准备");
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith("/api/admin/migrate/cleanup", { migration_id: "0123456789abcdef0123456789abcdef" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows a refresh failure without replacing imported data", async () => {
    vi.spyOn(api, "post").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path.endsWith("fetch-mmw-backup")) return { success: true, migration_id: "0123456789abcdef0123456789abcdef", subscribe_count: 0, size_bytes: 1, db_size_bytes: 1 } as T;
      return { success: true, report: { users: 0, user_tokens: 0, nodes: 0, subscribe_files: 0, user_subscriptions: 0, user_settings: 0, templates: 0, custom_rules: 0, override_scripts: 0, external_subscriptions: 0 }, owned_by_admin: "admin", subscribes_copied: 0 } as T;
    });
    vi.spyOn(api, "get").mockResolvedValueOnce({ success: true, servers: [] }).mockRejectedValueOnce(new Error("节点列表断开"));
    vi.spyOn(api, "delete").mockResolvedValue({ success: true });
    const notify = vi.fn();
    render(<MmwMigrationDialog notify={notify} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole("textbox", { name: "妙妙屋地址" }), { target: { value: "https://old.example.com" } });
    fireEvent.change(screen.getByRole("textbox", { name: "管理员用户名" }), { target: { value: "root" } });
    fireEvent.change(screen.getByLabelText("管理员密码"), { target: { value: "secret" } });
    fireEvent.click(screen.getByRole("button", { name: "拉取并校验" }));
    await screen.findByText("备份已准备");
    fireEvent.click(screen.getByRole("button", { name: "开始导入" }));
    fireEvent.click(screen.getByRole("button", { name: "确认导入" }));
    await screen.findByText("数据导入结果");
    fireEvent.click(screen.getByRole("button", { name: "刷新" }));
    expect(await screen.findByText("节点列表断开")).toBeInTheDocument();
    expect(screen.getByText("数据导入结果")).toBeInTheDocument();
    expect(notify).toHaveBeenCalledWith("节点列表断开", "error");
  });

  it("rejects insecure or credential-bearing source URLs", () => {
    expect(() => validateMigrationSource("http://example.com")).toThrow(/HTTPS/);
    expect(() => validateMigrationSource("https://user:pass@example.com")).toThrow(/账号或密码/);
    expect(validateMigrationSource("http://127.0.0.1:8080").allowInsecureLoopback).toBe(true);
  });
});
