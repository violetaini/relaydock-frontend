import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const requestMock = vi.hoisted(() => vi.fn());

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, request: requestMock };
});

import { api } from "./api";
import {
  BackupPanel,
  DebugLogsPanel,
  SecretDialog,
  TGBotInvitesPanel,
  TunnelsPanel,
  WarpPanel,
  normalizeInviteList,
  validateBackupFile,
} from "./advanced";

vi.hoisted(() => {
  (globalThis as unknown as { process: { env: { NODE_ENV?: string } } }).process.env.NODE_ENV = "test";
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function server(id: number, name: string) {
  return {
    id,
    name,
    status: "connected",
    ipv6_enabled: true,
    connection_mode: "outbound",
    current_upload_speed: 0,
    current_download_speed: 0,
    xray_running: true,
    xray_mode: "system",
    traffic_limit: 0,
    traffic_used: 0,
    traffic_stats_mode: "total",
    traffic_source: "system",
    ws_connected: true,
    encrypted: true,
    inbounds: [],
  };
}

afterEach(() => {
  cleanup();
  requestMock.mockReset();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("WARP status", () => {
  it("ignores an older server response after the selection changes", async () => {
    const first = deferred<Record<string, unknown>>();
    const second = deferred<Record<string, unknown>>();
    const get = vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/remote-servers") return { servers: [server(1, "东京"), server(2, "香港")] } as T;
      if (path.endsWith("server_id=1")) return first.promise as Promise<T>;
      if (path.endsWith("server_id=2")) return second.promise as Promise<T>;
      throw new Error(`unexpected GET ${path}`);
    });

    render(<WarpPanel />);
    const select = await screen.findByRole("combobox", { name: "服务器" });
    await waitFor(() => expect(get).toHaveBeenCalledWith("/api/admin/remote/warp/status?server_id=1"));
    fireEvent.change(select, { target: { value: "2" } });
    await waitFor(() => expect(get).toHaveBeenCalledWith("/api/admin/remote/warp/status?server_id=2"));

    await act(async () => { second.resolve({ installed: true, addr_v4: "2.2.2.2" }); });
    expect(await screen.findByText("2.2.2.2")).toBeInTheDocument();

    await act(async () => { first.resolve({ installed: true, addr_v4: "1.1.1.1" }); });
    expect(screen.queryByText("1.1.1.1")).not.toBeInTheDocument();
    expect(screen.getByText("2.2.2.2")).toBeInTheDocument();
  });

  it("installs WARP only after confirmation and refreshes the status", async () => {
    let installed = false;
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/remote-servers") return { servers: [server(1, "东京")] } as T;
      if (path === "/api/admin/remote/warp/status?server_id=1") return { installed } as T;
      throw new Error(`unexpected GET ${path}`);
    });
    const post = vi.spyOn(api, "post").mockImplementation(async <T,>(): Promise<T> => {
      installed = true;
      return { success: true } as T;
    });
    const notify = vi.fn();

    render(<WarpPanel notify={notify} />);
    fireEvent.click(await screen.findByRole("button", { name: "安装 WARP" }));
    expect(post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认安装" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/remote/warp/install?server_id=1", undefined));
    expect(await screen.findByText("已注册")).toBeInTheDocument();
    expect(notify).toHaveBeenCalledWith("WARP 已安装");
  });

  it("updates the license and confirms removal for an installed account", async () => {
    let installed = true;
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/remote-servers") return { servers: [server(2, "香港")] } as T;
      if (path === "/api/admin/remote/warp/status?server_id=2") return { installed } as T;
      throw new Error(`unexpected GET ${path}`);
    });
    const post = vi.spyOn(api, "post").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path.includes("/remove")) installed = false;
      return { success: true } as T;
    });

    render(<WarpPanel />);
    fireEvent.click(await screen.findByRole("button", { name: "更新 License" }));
    fireEvent.change(screen.getByLabelText(/License Key/), { target: { value: "license-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "确认更新" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/remote/warp/license?server_id=2", { license: "license-secret" }));

    fireEvent.click(await screen.findByRole("button", { name: "移除 WARP" }));
    expect(post).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "确认移除" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/remote/warp/remove?server_id=2", undefined));
    expect(await screen.findByRole("button", { name: "安装 WARP" })).toBeInTheDocument();
  });
});

function renderRoutedTunnel(postHandler: (path: string) => unknown) {
  vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
    if (path === "/api/admin/tunnels") {
      return {
        success: true,
        chains: [],
        tunnels: [{
          kind: "routed",
          server_id: 7,
          server_name: "出口节点",
          is_federated: false,
          tag: "route-test",
          listen_port: 0,
          target_address: "example.com",
          target_port: 443,
          network: "tcp",
        }],
      } as T;
    }
    if (path === "/api/admin/remote-servers") return { servers: [] } as T;
    if (path.startsWith("/api/admin/remote/routing")) return { success: true, routing: { rules: [{ outboundTag: "route-test" }] } } as T;
    throw new Error(`unexpected GET ${path}`);
  });
  const post = vi.spyOn(api, "post").mockImplementation(async <T,>(path: string): Promise<T> => postHandler(path) as T);
  const notify = vi.fn();
  render(<TunnelsPanel notify={notify} />);
  return { notify, post };
}

async function confirmRoutedDelete() {
  fireEvent.click(await screen.findByRole("button", { name: "删除隧道 route-test" }));
  fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
}

describe("routed tunnel deletion", () => {
  it("reports an HTTP 200 routing response whose body says success:false", async () => {
    const { notify, post } = renderRoutedTunnel((path) => path.includes("/routing")
      ? { success: false, error: "路由规则拒绝删除" }
      : { success: true });

    await confirmRoutedDelete();

    await waitFor(() => expect(notify).toHaveBeenCalledWith("路由规则拒绝删除", "error"));
    expect(post.mock.calls.some(([path]) => String(path).includes("/outbounds"))).toBe(false);
  });

  it("reports an HTTP 200 outbound response whose body says success:false", async () => {
    const { notify } = renderRoutedTunnel((path) => path.includes("/outbounds")
      ? { success: false, message: "出站仍在使用" }
      : { success: true });

    await confirmRoutedDelete();

    await waitFor(() => expect(notify).toHaveBeenCalledWith("出站仍在使用", "error"));
    expect(notify).not.toHaveBeenCalledWith("隧道已删除");
  });
});

describe("one-time secret dialog", () => {
  it("offers an explicit manual-save exit when clipboard access fails", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("clipboard denied"));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const onClose = vi.fn();
    const notify = vi.fn();

    const { container } = render(<SecretDialog title="分享令牌" description="仅显示一次" secret="secret-token" onClose={onClose} notify={notify} />);
    expect(screen.queryByRole("button", { name: "关闭" })).not.toBeInTheDocument();
    fireEvent.mouseDown(container.querySelector(".dialog-backdrop")!);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "复制令牌" }));

    expect(await screen.findByText("无法访问剪贴板，请手动选择并保存上方令牌。")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith("复制失败，请手动保存令牌", "error");

    fireEvent.click(screen.getByRole("button", { name: "已手动保存" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

function encryptedBackup(name = "arcway.zip.enc") {
  const bytes = new Uint8Array(64);
  bytes.set(new TextEncoder().encode("MMWXBKP1"));
  return new File([bytes], name, { type: "application/octet-stream" });
}

function installDownloadMocks(body = "download") {
  const createObjectURL = vi.fn(() => "blob:arcway-test");
  const revokeObjectURL = vi.fn();
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectURL });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectURL });
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": "attachment; filename=server-backup.zip.enc",
    },
  }));
  return { click, createObjectURL, fetchMock };
}

describe("backup operations", () => {
  it("downloads an encrypted backup with the real passphrase and session headers", async () => {
    window.localStorage.setItem("arcway-session-token", "admin-token");
    const { click, fetchMock } = installDownloadMocks();
    const notify = vi.fn();
    render(<BackupPanel notify={notify} />);

    fireEvent.change(screen.getByLabelText(/^备份加密口令/), { target: { value: "strong-passphrase" } });
    fireEvent.change(screen.getByLabelText(/^确认备份口令/), { target: { value: "strong-passphrase" } });
    fireEvent.click(screen.getByRole("button", { name: "下载加密备份" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const [path, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(path).toBe("/api/admin/backup/download");
    expect(init?.method).toBe("GET");
    expect(headers.get("X-Backup-Passphrase")).toBe("strong-passphrase");
    expect(headers.get("MM-Authorization")).toBe("admin-token");
    expect(click).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith("加密备份已下载：server-backup.zip.enc");
  });

  it("validates an encrypted backup and posts multipart data only after confirmation", async () => {
    const file = encryptedBackup();
    requestMock.mockResolvedValue({ message: "恢复成功" });
    const notify = vi.fn();
    render(<BackupPanel notify={notify} />);

    fireEvent.change(screen.getByLabelText(/^备份文件/), { target: { files: [file] } });
    expect(await screen.findByText("Arcway 加密备份", { exact: false })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^原备份口令/), { target: { value: "strong-passphrase" } });
    fireEvent.click(screen.getByRole("button", { name: "校验并恢复" }));

    expect(await screen.findByRole("dialog", { name: "恢复数据备份" })).toBeInTheDocument();
    expect(requestMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认恢复" }));

    await waitFor(() => expect(requestMock).toHaveBeenCalledOnce());
    const [path, init] = requestMock.mock.calls[0];
    expect(path).toBe("/api/admin/backup/restore");
    expect(init).toEqual(expect.objectContaining({ method: "POST", body: expect.any(FormData) }));
    const form = init.body as FormData;
    expect((form.get("backup") as File).name).toBe("arcway.zip.enc");
    expect(form.get("passphrase")).toBe("strong-passphrase");
    expect(notify).toHaveBeenCalledWith("恢复成功");
  });

  it("rejects a misleading backup extension whose file header is invalid", async () => {
    await expect(validateBackupFile(new File(["not a backup"], "fake.zip.enc"))).rejects.toThrow("文件头与 Arcway 备份格式不匹配");
  });
});

describe("debug log operations", () => {
  it("loads the real status and tail endpoints and filters visible lines", async () => {
    const get = vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/user/debug/status") return { enabled: true, file_size: "2 KB", duration: "12 秒" } as T;
      if (path === "/api/user/debug/tail?lines=200") return { lines: "[INFO] agent connected\n[ERROR] dial failed", total_size: 2048 } as T;
      throw new Error(`unexpected GET ${path}`);
    });
    render(<DebugLogsPanel notify={vi.fn()} />);

    expect(await screen.findByText("[INFO] agent connected", { exact: false })).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith("/api/user/debug/status");
    expect(get).toHaveBeenCalledWith("/api/user/debug/tail?lines=200");
    fireEvent.change(screen.getByRole("textbox", { name: "筛选日志" }), { target: { value: "error" } });
    expect(screen.getByLabelText("Debug 日志内容")).toHaveTextContent("[ERROR] dial failed");
    expect(screen.getByLabelText("Debug 日志内容")).not.toHaveTextContent("agent connected");
  });

  it("stops capture before downloading the one-time server file", async () => {
    window.localStorage.setItem("arcway-session-token", "user-token");
    installDownloadMocks("debug log");
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/user/debug/status") return { enabled: true, log_path: "data/logs/log_admin.txt" } as T;
      if (path === "/api/user/debug/tail?lines=200") return { lines: "agent line", total_size: 10 } as T;
      throw new Error(`unexpected GET ${path}`);
    });
    const post = vi.spyOn(api, "post").mockResolvedValue({ status: "disabled", download_url: "/api/user/debug/download?file=log_admin.txt" });
    const notify = vi.fn();
    render(<DebugLogsPanel notify={notify} />);

    fireEvent.click(await screen.findByRole("button", { name: "停止并下载" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/user/debug/disable"));
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/user/debug/download?file=log_admin.txt",
      expect.objectContaining({ method: "GET", headers: expect.any(Headers) }),
    ));
    const headers = new Headers(vi.mocked(globalThis.fetch).mock.calls[0][1]?.headers);
    expect(headers.get("MM-Authorization")).toBe("user-token");
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("服务端副本将自动清理"));
  });
});

function invite(overrides: Partial<ReturnType<typeof normalizeInviteList>[number]> = {}) {
  return {
    code: "ABC123DEF456",
    kind: "new",
    max_uses: 2,
    used_count: 0,
    revoked: false,
    usable: true,
    remark: "测试注册",
    created_at: "2026-07-19T10:00:00Z",
    ...overrides,
  };
}

describe("TG Bot invite operations", () => {
  it("accepts the real items envelope plus legacy array and nested shapes", () => {
    const item = invite();
    expect(normalizeInviteList({ success: true, items: [item] })).toEqual([item]);
    expect(normalizeInviteList([item])).toEqual([item]);
    expect(normalizeInviteList({ data: { invites: [item] } })).toEqual([item]);
  });

  it("creates an invite with the handler's exact payload", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ success: true, items: [invite()] });
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true, code: "NEWCODE12345" });
    const notify = vi.fn();
    render(<TGBotInvitesPanel notify={notify} />);

    fireEvent.click(await screen.findByRole("button", { name: "创建邀请码" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: /^套餐 ID/ }), { target: { value: "7" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: /^账号有效月数/ }), { target: { value: "3" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: "最大使用次数" }), { target: { value: "5" } });
    fireEvent.change(screen.getByRole("textbox", { name: "备注" }), { target: { value: " 首发用户 " } });
    fireEvent.click(within(screen.getByRole("dialog", { name: "创建 TG Bot 邀请码" })).getByRole("button", { name: "创建邀请码" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/tgbot/invites", {
      kind: "new",
      bind_username: "",
      package_id: 7,
      max_uses: 5,
      expires_at: "",
      remark: "首发用户",
      duration_months: 3,
    }));
    expect(notify).toHaveBeenCalledWith("邀请码已创建：NEWCODE12345");
  });

  it("revokes a usable invite and hard-deletes an unavailable invite through real POST routes", async () => {
    const active = invite();
    const revoked = invite({ code: "REVOKED12345", revoked: true, usable: false });
    vi.spyOn(api, "get").mockResolvedValue({ success: true, items: [active, revoked] });
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true });
    render(<TGBotInvitesPanel notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: `撤销邀请码 ${active.code}` }));
    fireEvent.click(screen.getByRole("button", { name: "确认撤销" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/tgbot/invites/revoke", { code: active.code }));

    fireEvent.click(await screen.findByRole("button", { name: `删除邀请码 ${revoked.code}` }));
    fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/tgbot/invites/delete", { code: revoked.code }));
  });
});
