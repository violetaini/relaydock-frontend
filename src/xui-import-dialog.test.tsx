import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { XUIImportDialog } from "./xui-import-dialog";

vi.hoisted(() => {
  (globalThis as unknown as { process: { env: { NODE_ENV?: string } } }).process.env.NODE_ENV = "test";
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("XUIImportDialog", () => {
  it("renders non-destructive guarantee notice and completes json inspection and safe import", async () => {
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/remote-servers") {
        return {
          servers: [{ id: 1, name: "US-Edge-1", ip_address: "1.2.3.4" }]
        } as T;
      }
      throw new Error(`unexpected GET ${path}`);
    });

    const post = vi.spyOn(api, "post").mockImplementation(async <T,>(path: string, body?: any): Promise<T> => {
      if (path === "/api/admin/migrate/xui/inspect") {
        return {
          success: true,
          report: {
            total_inbounds: 2,
            total_clients: 5,
            total_traffic_up: 1024 * 1024,
            total_traffic_down: 10 * 1024 * 1024,
            protocols: { vless: 1, vmess: 1 },
            warnings: [],
            has_conflicts: false,
            inbound_details: [
              {
                id: 1,
                port: 443,
                protocol: "vless",
                remark: "US-VLESS",
                tag: "inbound-443",
                clients_count: 3,
                compatible: true,
                port_conflict: false
              },
              {
                id: 2,
                port: 8443,
                protocol: "vmess",
                remark: "US-VMESS",
                tag: "inbound-8443",
                clients_count: 2,
                compatible: true,
                port_conflict: false
              }
            ]
          }
        } as T;
      }
      if (path === "/api/admin/migrate/xui/import") {
        return {
          success: true,
          imported_nodes: 2,
          imported_clients: 5,
          imported_traffic_records: 5,
          created_managed_inbounds: 2,
          execution_time: "12ms"
        } as T;
      }
      throw new Error(`unexpected POST ${path}`);
    });

    const notify = vi.fn();
    const onClose = vi.fn();

    render(<XUIImportDialog notify={notify} onClose={onClose} />);

    // 1. Verify safe coexistence guarantee banner
    expect(screen.getByText("100% 安全共存保证（先不替代现网业务）")).toBeInTheDocument();

    // 2. Switch to JSON paste tab
    fireEvent.click(screen.getByRole("button", { name: /粘贴 3x-ui JSON 数据/i }));

    const textarea = screen.getByPlaceholderText(/{"success": true/i);
    fireEvent.change(textarea, { target: { value: '{"test": true}' } });

    fireEvent.click(screen.getByRole("button", { name: /开始只读预检分析/i }));

    // 3. Verify audit report rendered
    expect(await screen.findByText("预检审计报告")).toBeInTheDocument();
    expect(screen.getByText("US-VLESS")).toBeInTheDocument();
    expect(screen.getByText("US-VMESS")).toBeInTheDocument();
    expect(screen.getAllByText(/端口空闲 \/ 可共存/i).length).toBe(2);

    // 4. Confirm non-destructive import
    fireEvent.click(screen.getByRole("button", { name: /确认非侵入式备战导入/i }));

    // 5. Verify import success summary
    expect(await screen.findByText("3x-ui 节点与用户备战导入完成！")).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith(
      "/api/admin/migrate/xui/import",
      expect.objectContaining({
        import_historical_traffic: true,
        create_managed_resources: true
      })
    );
  });

  it("probes remote server 3x-ui side-by-side status without mutations", async () => {
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/admin/remote-servers") {
        return {
          servers: [{ id: 5, name: "Oracle-SJC", ip_address: "170.9.59.149" }]
        } as T;
      }
      if (path.includes("/api/admin/remote-servers/xui/detect")) {
        return {
          installed: true,
          running: true,
          inbound_count: 4,
          client_count: 8,
          active_ports: [443, 8443],
          detected_at: new Date().toISOString(),
          is_coexisting: true,
          message: "3x-ui 正在运行中 (平稳共存模式: 4 个入站, 8 个用户, 2 个活跃端口)"
        } as T;
      }
      throw new Error(`unexpected GET ${path}`);
    });

    const notify = vi.fn();
    render(<XUIImportDialog notify={notify} onClose={vi.fn()} />);

    // Switch to detect tab
    fireEvent.click(screen.getByRole("button", { name: /探测节点 3x-ui 现状/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /探测节点 3x-ui 状态/i })).toBeEnabled();
    });

    fireEvent.click(screen.getByRole("button", { name: /探测节点 3x-ui 状态/i }));

    expect(await screen.findByText(/平稳共存模式运行中/i)).toBeInTheDocument();
    expect(screen.getByText(/3x-ui 当前监听端口: 443, 8443/i)).toBeInTheDocument();
  });
});
