import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import type { RemoteServer } from "./types";
import { WarpManagement } from "./warp-management";

vi.hoisted(() => {
  (globalThis as unknown as { process: { env: { NODE_ENV?: string } } }).process.env.NODE_ENV = "test";
});

function server(id: number, name: string): RemoteServer {
  return {
    id,
    name,
    status: "connected",
    ipv6_enabled: true,
    connection_mode: "outbound",
    current_upload_speed: 0,
    current_download_speed: 0,
    xray_running: true,
    xray_mode: "external",
    traffic_limit: 0,
    traffic_used: 0,
    traffic_stats_mode: "total",
    traffic_source: "system",
    ws_connected: true,
    encrypted: true,
    inbounds: [],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("per-server WARP management", () => {
  it("ignores a stale response after the selected server changes", async () => {
    const first = deferred<Record<string, unknown>>();
    const second = deferred<Record<string, unknown>>();
    const get = vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path.endsWith("server_id=1")) return first.promise as Promise<T>;
      if (path.endsWith("server_id=2")) return second.promise as Promise<T>;
      throw new Error(`unexpected GET ${path}`);
    });
    const props = { notify: vi.fn(), configDirty: false, onChanged: vi.fn(async () => undefined) };
    const view = render(<WarpManagement server={server(1, "东京")} {...props} />);
    await waitFor(() => expect(get).toHaveBeenCalledWith("/api/admin/remote/warp/status?server_id=1"));

    view.rerender(<WarpManagement server={server(2, "香港")} {...props} />);
    await waitFor(() => expect(get).toHaveBeenCalledWith("/api/admin/remote/warp/status?server_id=2"));
    await act(async () => { second.resolve({ installed: true, addr_v4: "2.2.2.2" }); });
    expect(await screen.findByText("2.2.2.2")).toBeInTheDocument();

    await act(async () => { first.resolve({ installed: true, addr_v4: "1.1.1.1" }); });
    expect(screen.queryByText("1.1.1.1")).not.toBeInTheDocument();
    expect(screen.getByText("2.2.2.2")).toBeInTheDocument();
  });

  it("installs only after confirmation and refreshes Xray state", async () => {
    let installed = false;
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/remote/warp/status?server_id=1") return { installed } as T;
      throw new Error(`unexpected GET ${path}`);
    });
    const post = vi.spyOn(api, "post").mockImplementation(async <T,>(): Promise<T> => {
      installed = true;
      return { success: true } as T;
    });
    const notify = vi.fn();
    const onChanged = vi.fn(async () => undefined);
    render(<WarpManagement server={server(1, "东京")} notify={notify} configDirty={false} onChanged={onChanged} />);

    fireEvent.click(await screen.findByRole("button", { name: "安装 WARP" }));
    expect(post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认安装" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/remote/warp/install?server_id=1", undefined));
    expect(await screen.findByText("已注册")).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith("WARP 已安装");
  });

  it("updates the license with the current server-scoped payload", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ installed: true, license_active: false });
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true });
    const notify = vi.fn();
    const onChanged = vi.fn(async () => undefined);
    render(<WarpManagement server={server(1, "东京")} notify={notify} configDirty={false} onChanged={onChanged} />);

    fireEvent.click(await screen.findByRole("button", { name: "更新 License" }));
    const dialog = screen.getByRole("dialog", { name: "更新 WARP License" });
    const licenseInput = dialog.querySelector<HTMLInputElement>('input[type="password"]');
    expect(licenseInput).not.toBeNull();
    fireEvent.change(licenseInput as HTMLInputElement, { target: { value: "license-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "确认更新" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith(
      "/api/admin/remote/warp/license?server_id=1",
      { license: "license-secret" },
    ));
    expect(onChanged).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith("WARP License 已更新");
    expect(screen.queryByRole("dialog", { name: "更新 WARP License" })).not.toBeInTheDocument();
  });

  it("removes WARP only after destructive confirmation", async () => {
    let installed = true;
    vi.spyOn(api, "get").mockImplementation(async <T,>(): Promise<T> => ({ installed } as T));
    const post = vi.spyOn(api, "post").mockImplementation(async <T,>(): Promise<T> => {
      installed = false;
      return { success: true } as T;
    });
    const notify = vi.fn();
    const onChanged = vi.fn(async () => undefined);
    render(<WarpManagement server={server(1, "东京")} notify={notify} configDirty={false} onChanged={onChanged} />);

    fireEvent.click(await screen.findByRole("button", { name: "移除 WARP" }));
    expect(post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认移除" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/remote/warp/remove?server_id=1", undefined));
    expect(await screen.findByText("未注册")).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith("WARP 已移除");
  });

  it("blocks WARP writes while the Xray editor has unsaved changes", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ installed: true });
    const post = vi.spyOn(api, "post");
    render(<WarpManagement server={server(1, "东京")} notify={vi.fn()} configDirty onChanged={vi.fn(async () => undefined)} />);

    expect(await screen.findByText("存在未保存的 Xray 更改")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "更新 License" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "移除 WARP" })).toBeDisabled();
    expect(post).not.toHaveBeenCalled();
  });
});
