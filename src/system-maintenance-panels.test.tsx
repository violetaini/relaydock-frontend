import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const requestMock = vi.hoisted(() => vi.fn());

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, request: requestMock };
});

import { api } from "./api";
import { BackupPanel, DebugLogsPanel, validateBackupFile } from "./system-maintenance-panels";

vi.hoisted(() => {
  (globalThis as unknown as { process: { env: { NODE_ENV?: string } } }).process.env.NODE_ENV = "test";
});

afterEach(() => {
  cleanup();
  requestMock.mockReset();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

function encryptedBackup(name = "arcway.zip.enc", magic = "RLDKBKP1") {
  const bytes = new Uint8Array(64);
  bytes.set(new TextEncoder().encode(magic));
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
  return { click, fetchMock };
}

describe("backup operations", () => {
  it("downloads an encrypted backup with the passphrase and session headers", async () => {
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
    expect(init?.method).toBe("POST");
    expect(headers.get("X-Backup-Passphrase")).toBe("strong-passphrase");
    expect(headers.get("Authorization")).toBe("Bearer admin-token");
    expect(click).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith("加密备份已下载：server-backup.zip.enc");
  });

  it("posts multipart restore data only after confirmation", async () => {
    const file = encryptedBackup();
    requestMock.mockResolvedValue({ message: "恢复成功" });
    const notify = vi.fn();
    render(<BackupPanel notify={notify} />);

    fireEvent.change(screen.getByLabelText(/^备份文件/), { target: { files: [file] } });
    expect(await screen.findByText("Arcway 加密备份", { exact: false })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^原备份口令/), { target: { value: "strong-passphrase" } });
    fireEvent.click(screen.getByRole("button", { name: "校验并暂存" }));

    const dialog = await screen.findByRole("dialog", { name: "暂存数据备份" });
    expect(requestMock).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "校验并暂存" }));

    await waitFor(() => expect(requestMock).toHaveBeenCalledOnce());
    const [path, init] = requestMock.mock.calls[0];
    expect(path).toBe("/api/admin/backup/restore");
    expect(init).toEqual(expect.objectContaining({ method: "POST", body: expect.any(FormData) }));
    const form = init.body as FormData;
    expect((form.get("backup") as File).name).toBe("arcway.zip.enc");
    expect(form.get("passphrase")).toBe("strong-passphrase");
    expect(notify).toHaveBeenCalledWith("恢复成功");
  });

  it("rejects a misleading backup extension with an invalid header", async () => {
    await expect(validateBackupFile(new File(["not a backup"], "fake.zip.enc"))).rejects.toThrow("文件头与 Arcway 备份格式不匹配");
  });

  it("accepts the current chunked encrypted backup format", async () => {
    await expect(validateBackupFile(encryptedBackup("current.zip.enc", "RLDKBKP2"))).resolves.toEqual({
      encrypted: true,
      description: "Arcway 分块加密备份",
    });
  });

  it("rejects legacy encrypted backups above the backend's 64 MB compatibility limit", async () => {
    const file = {
      name: "legacy.zip.enc",
      size: 64 * 1024 * 1024 + 1,
      slice: () => new Blob(["RLDKBKP1"]),
    } as File;

    await expect(validateBackupFile(file)).rejects.toThrow("旧版加密备份不能超过 64 MB");
  });
});

describe("main controller debug logs", () => {
  it("loads status and tail endpoints and filters visible lines", async () => {
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
    expect(screen.getByLabelText("主控 Debug 日志内容")).toHaveTextContent("[ERROR] dial failed");
    expect(screen.getByLabelText("主控 Debug 日志内容")).not.toHaveTextContent("agent connected");
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
    expect(headers.get("Authorization")).toBe("Bearer user-token");
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("服务端副本将自动清理"));
  });
});
