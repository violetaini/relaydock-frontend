import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { ServerGrantsDialog } from "./server-grants";

vi.hoisted(() => {
  (globalThis as unknown as { process: { env: { NODE_ENV?: string } } }).process.env.NODE_ENV = "test";
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("server grants", () => {
  it("creates a grant with normalized dates, bytes and policy fields", async () => {
    vi.spyOn(api, "get").mockImplementation(async (path) => {
      if (path === "/api/admin/users/alice/server-grants") return { grants: [] };
      if (path === "/api/admin/users/alice/managed-nodes") return { items: [] };
      if (path === "/api/admin/remote-servers") return { success: true, servers: [{ id: 3, name: "香港入口", status: "online" }] };
      throw new Error(`unexpected GET ${path}`);
    });
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true });
    render(<ServerGrantsDialog username="alice" notify={vi.fn()} onClose={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "新增授权" }));
    fireEvent.change(screen.getByRole("combobox", { name: "授权服务器" }), { target: { value: "3" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: /^最大已开通节点/ }), { target: { value: "4" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: /^限速/ }), { target: { value: "80" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: /^并发连接数/ }), { target: { value: "5" } });
    fireEvent.change(screen.getByRole("spinbutton", { name: /^流量额度/ }), { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: "上下行" }));
    fireEvent.click(screen.getByRole("button", { name: "保存授权" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/users/alice/server-grants", expect.objectContaining({
      server_id: 3,
      enabled: true,
      max_active_nodes: 4,
      speed_limit_mbps: 80,
      connection_limit: 5,
      traffic_limit_bytes: 10 * 1024 ** 3,
      billing_mode: "both",
      reset_policy: "none",
      reset_day: 1,
      version: 1,
      starts_at: expect.stringMatching(/Z$/),
      expires_at: null,
    })));
  });
});
