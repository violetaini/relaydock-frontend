import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { NodeEditor, type WorkbenchNode } from "./nodes-workbench";

vi.hoisted(() => {
  (globalThis as unknown as { process: { env: { NODE_ENV?: string } } }).process.env.NODE_ENV = "test";
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const managedNode: WorkbenchNode = {
  id: 9,
  raw_url: "",
  node_name: "HK Premium",
  protocol: "vless",
  parsed_config: JSON.stringify({ name: "HK Premium", type: "vless", server: "hk.example.com", port: 443 }),
  clash_config: JSON.stringify({ name: "HK Premium", type: "vless", server: "hk.example.com", port: 443 }),
  enabled: true,
  tag: "香港",
  tags: ["香港"],
  original_server: "edge-hk",
  original_domain: "",
  inbound_tag: "vless-443",
};

describe("managed node offer editor", () => {
  it("publishes an eligible node with only the controlled offer fields", async () => {
    vi.spyOn(api, "put").mockResolvedValue({ success: true });
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true });
    const complete = vi.fn();
    render(<NodeEditor node={managedNode} onClose={vi.fn()} onComplete={complete} />);

    fireEvent.click(screen.getByRole("switch", { name: "允许获授权用户自助开通" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: /^目录排序/ }), { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: "保存节点" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/managed-node-offers", {
      node_id: 9,
      enabled: true,
      sort_order: 6,
    }));
    expect(complete).toHaveBeenCalledWith("节点已更新");
  });

  it("disables publishing when the node is not bound to a managed inbound", () => {
    render(<NodeEditor node={{ ...managedNode, original_server: "", inbound_tag: "" }} onClose={vi.fn()} onComplete={vi.fn()} />);
    expect(screen.getByRole("switch", { name: "允许获授权用户自助开通" })).toBeDisabled();
    expect(screen.getByText("需要受管服务器和入站标签后才能发布。")).toBeInTheDocument();
  });

  it("pauses an existing offer without deleting its identity", async () => {
    const put = vi.spyOn(api, "put").mockResolvedValue({ success: true });
    const remove = vi.spyOn(api, "delete").mockResolvedValue({ success: true });
    render(<NodeEditor node={managedNode} offer={{ id: 31, node_id: 9, server_id: 3, inbound_tag: "vless-443", enabled: true, sort_order: 2 }} onClose={vi.fn()} onComplete={vi.fn()} />);

    fireEvent.click(screen.getByRole("switch", { name: "允许获授权用户自助开通" }));
    fireEvent.click(screen.getByRole("button", { name: "保存节点" }));

    await waitFor(() => expect(put).toHaveBeenCalledWith("/api/admin/managed-node-offers/31", { enabled: false, sort_order: 2 }));
    expect(remove).not.toHaveBeenCalled();
  });
});
