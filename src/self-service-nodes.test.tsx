import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { SelfServiceNodes } from "./self-service-nodes";

vi.hoisted(() => {
  (globalThis as unknown as { process: { env: { NODE_ENV?: string } } }).process.env.NODE_ENV = "test";
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const nestedCatalog = {
  grants: [{
    id: 7, server_id: 3, server_name: "香港入口", state: "active", expires_at: "2026-09-01T00:00:00Z",
    max_active_nodes: 2, active_node_count: 0, speed_limit_mbps: 80, connection_limit: 4,
    traffic_limit_bytes: 50 * 1024 ** 3, billing_mode: "download",
  }],
  selected: [],
  catalog: [{
    offer: { id: 45, node_id: 9, server_id: 3, enabled: true },
    grant: { id: 7, server_id: 3, expires_at: "2026-09-01T00:00:00Z", speed_limit_mbps: 80, connection_limit: 4, billing_mode: "download" },
    node_name: "HK Premium", protocol: "vless", server_name: "香港入口", server_status: "online",
    grant_status: "active", can_create: true,
  }],
};

describe("self-service nodes", () => {
  it("normalizes the nested catalog and submits only the offer id", async () => {
    vi.spyOn(api, "get").mockResolvedValue(nestedCatalog);
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true });
    const notify = vi.fn();
    render(<SelfServiceNodes view="catalog" notify={notify} />);

    expect(await screen.findByText("HK Premium")).toBeInTheDocument();
    expect(screen.getByText("80 Mbps · 4 并发 · 下行计费")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "开通" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/user/managed-nodes", { offer_id: 45 }));
    expect(post.mock.calls[0]).toHaveLength(2);
    expect(notify).toHaveBeenCalledWith("HK Premium 已提交开通");
  });

  it("retries and removes a selection by its selection id", async () => {
    const payload = {
      grants: [], catalog: [], selected: [{
        id: 88, grant_id: 7, offer_id: 45, node_id: 9, node_name: "HK Premium", server_id: 3,
        server_name: "香港入口", protocol: "vless", desired_enabled: true, state: "error",
        effective_speed_limit_mbps: 80, effective_connection_limit: 4, effective_billing_mode: "download",
        last_error: "Agent offline",
      }],
    };
    vi.spyOn(api, "get").mockResolvedValue(payload);
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true });
    const remove = vi.spyOn(api, "delete").mockResolvedValue({ success: true });
    render(<SelfServiceNodes view="mine" notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "重试 HK Premium" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/user/managed-nodes/88/retry", {}));

    fireEvent.click(screen.getByRole("button", { name: "停用 HK Premium" }));
    fireEvent.click(screen.getByRole("button", { name: "确认停用" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith("/api/user/managed-nodes/88"));
  });
});
