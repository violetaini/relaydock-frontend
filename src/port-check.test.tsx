import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { PortCheckHint, isPortCheckBlocking, useDebouncedPortCheck } from "./port-check";
import { AnyDoorForwardDialog, type WorkbenchNode } from "./nodes-workbench";

vi.hoisted(() => {
  (globalThis as unknown as { process: { env: { NODE_ENV?: string } } }).process.env.NODE_ENV = "test";
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function HookHarness({
  enabled = true,
  port,
  url,
  debounceMs = 500,
}: {
  enabled?: boolean;
  port: string;
  url: string | null;
  debounceMs?: number;
}) {
  const state = useDebouncedPortCheck({ enabled, port, url, debounceMs });
  return (
    <div>
      <span data-testid="status">{state.status}</span>
      <span data-testid="blocking">{String(isPortCheckBlocking(state))}</span>
      <PortCheckHint state={state} />
    </div>
  );
}

describe("useDebouncedPortCheck", () => {
  it("debounces rapid digit entry and issues a single request after 500ms", async () => {
    vi.useFakeTimers();
    const getSpy = vi.spyOn(api, "get").mockResolvedValue({
      success: true,
      port: 2033,
      available: true,
      reason: "端口 2033 (tcp+udp) 可用",
    });

    const { rerender } = render(
      <HookHarness
        port="2"
        url="/api/admin/remote/port-check?server_id=1&port=2"
      />,
    );

    expect(screen.getByTestId("status")).toHaveTextContent("checking");
    expect(getSpy).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(getSpy).not.toHaveBeenCalled();

    rerender(
      <HookHarness
        port="20"
        url="/api/admin/remote/port-check?server_id=1&port=20"
      />,
    );
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(getSpy).not.toHaveBeenCalled();

    rerender(
      <HookHarness
        port="203"
        url="/api/admin/remote/port-check?server_id=1&port=203"
      />,
    );
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(getSpy).not.toHaveBeenCalled();

    rerender(
      <HookHarness
        port="2033"
        url="/api/admin/remote/port-check?server_id=1&port=2033"
      />,
    );
    await act(async () => {
      vi.advanceTimersByTime(499);
    });
    expect(getSpy).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(getSpy).toHaveBeenCalledWith(
      "/api/admin/remote/port-check?server_id=1&port=2033",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(screen.getByTestId("status")).toHaveTextContent("available");
    expect(screen.getByTestId("blocking")).toHaveTextContent("false");
    expect(screen.getByText("端口 2033 (tcp+udp) 可用")).toBeInTheDocument();
  });

  it("aborts in-flight checks on new input and treats occupied ports as blocking", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const getSpy = vi.spyOn(api, "get").mockImplementation(async (path: string, opts) => {
      if (opts?.signal) signals.push(opts.signal);
      if (path.includes("port=30222")) {
        return {
          success: true,
          port: 30222,
          available: false,
          occupied_by: "system_listener",
          reason: "端口 30222 已被本机 TCP 进程占用",
        };
      }
      return { success: true, port: 443, available: true, occupied_by: "shared_nginx", reason: "443 TLS 复用" };
    });

    const { rerender } = render(
      <HookHarness port="30222" url="/api/admin/remote/port-check?server_id=1&port=30222" />,
    );
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByTestId("status")).toHaveTextContent("occupied");
    expect(screen.getByTestId("blocking")).toHaveTextContent("true");
    expect(screen.getByText("端口 30222 已被本机 TCP 进程占用")).toBeInTheDocument();

    rerender(
      <HookHarness port="443" url="/api/admin/remote/port-check?server_id=1&port=443&protocol=vless-wss" />,
    );
    expect(signals[0]?.aborted).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(getSpy).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("status")).toHaveTextContent("shared");
    expect(screen.getByTestId("blocking")).toHaveTextContent("false");
  });
});

describe("AnyDoorForwardDialog port check integration", () => {
  it("disables submit when backend reports port occupied after debounce", async () => {
    vi.useFakeTimers();
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/remote-servers") {
        return {
          servers: [{
            id: 7,
            name: "Edge JP",
            status: "connected",
            ws_connected: true,
            xray_mode: "embedded",
            xray_running: true,
            domain: "jp.example.com",
            ip_address: "203.0.113.7",
          }],
        } as T;
      }
      if (path.startsWith("/api/admin/remote/port-check")) {
        if (path.includes("port=23889")) {
          return {
            success: true,
            port: 23889,
            available: false,
            occupied_by: "agent_port",
            reason: "端口 23889 为 RelayDock Agent 监听端口",
          } as T;
        }
        return {
          success: true,
          port: 2033,
          available: true,
          reason: "端口 2033 (tcp+udp) 可用",
        } as T;
      }
      throw new Error(`unexpected GET ${path}`);
    });

    const node: WorkbenchNode = {
      id: 99,
      raw_url: "",
      node_name: "HK Reality",
      protocol: "vless",
      parsed_config: JSON.stringify({ name: "HK Reality", type: "vless", server: "hk.example.com", port: 443 }),
      clash_config: JSON.stringify({ name: "HK Reality", type: "vless", server: "hk.example.com", port: 443 }),
      enabled: true,
      tag: "",
      original_server: "HK",
      original_domain: "hk.example.com",
      inbound_tag: "hk-reality",
    };

    render(<AnyDoorForwardDialog node={node} onClose={vi.fn()} onComplete={vi.fn(async () => {})} />);
    await act(async () => {
      await Promise.resolve();
    });

    const portInput = screen.getByRole("spinbutton", { name: "监听端口" });
    fireEvent.change(portInput, { target: { value: "23889" } });

    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(screen.getByText("端口 23889 为 RelayDock Agent 监听端口")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /创建任意门/ })).toBeDisabled();

    fireEvent.change(portInput, { target: { value: "2033" } });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(screen.getByText("端口 2033 (tcp+udp) 可用")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /创建任意门/ })).toBeEnabled();
  });
});
