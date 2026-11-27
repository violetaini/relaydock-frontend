import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import type { SubscribeFile } from "./content-workbench";
import { SubscriptionManager } from "./subscription-workbench";
import { subscriptionDeliveryURL } from "./subscription-delivery";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const assigned = { id: 1, name: "管理员线路", type: "create", kind: "strategy", filename: "shared.yaml", file_short_code: "shared", access_source: "assigned", available_clients: ["clashmeta", "clash-to-shadowrocket"], can_manage: false };
const owned: SubscribeFile = { id: 2, name: "我的机场", type: "upload", kind: "external", filename: "mine.yaml", auto_sync_custom_rules: false, access_source: "owned", available_clients: ["v2ray"] };
function mockInventory() {
  return vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
    if (path === "/api/subscriptions") return { subscriptions: [assigned, owned, { id: -1, name: "套餐线路", type: "package", kind: "custom", filename: "__package__", access_source: "package" }] } as T;
    if (path === "/api/user/token") return { token: "recipient-token", user_short_code: "member" } as T;
    if (path === "/api/admin/subscribe-files") return { files: [owned] } as T;
    if (path === "/api/admin/nodes") return { nodes: [] } as T;
    if (path === "/api/admin/rule-templates") return { templates: [] } as T;
    return [] as T;
  });
}
const props = { isAdmin: false, ImportDialog: () => null, ContentDialog: () => null };

describe("merged subscription inventory", () => {
  it("unions owned and assigned subscriptions without exposing assigned edit controls", async () => {
    mockInventory();
    render(<SubscriptionManager {...props} canManage />);
    await screen.findByText("管理员线路");
    expect(screen.getAllByText("我的机场", { exact: true })).toHaveLength(1);
    expect(screen.getByLabelText("编辑 我的机场")).toBeInTheDocument();
    expect(screen.queryByLabelText("编辑 管理员线路")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("选择来源 管理员线路")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("更多操作 管理员线路"));
    const row = screen.getByText("管理员线路").closest("tr")!;
    expect(within(row).queryByText("删除订阅")).not.toBeInTheDocument();
    expect(within(row).queryByText("修改配置内容")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "订阅归属" }), { target: { value: "assigned" } });
    expect(screen.getByText("管理员线路")).toBeInTheDocument();
    expect(screen.getByText("套餐线路")).toBeInTheDocument();
    expect(screen.queryByText("我的机场", { exact: true })).not.toBeInTheDocument();
  });

  it("keeps the unified page useful with view-only permission and no management API requests", async () => {
    const get = mockInventory();
    render(<SubscriptionManager {...props} canManage={false} />);
    await screen.findByText("管理员线路");
    expect(screen.getByText("我的机场", { exact: true })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "添加外部订阅" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("编辑 我的机场")).not.toBeInTheDocument();
    expect(get.mock.calls.some(([path]) => path.startsWith("/api/admin/"))).toBe(false);
    fireEvent.click(screen.getByLabelText("更多操作 管理员线路"));
    const row = screen.getByText("管理员线路").closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: "客户端订阅链接" }));
    const dialog = await screen.findByRole("dialog", { name: "管理员线路 · 订阅链接" });
    expect(within(dialog).getAllByRole("option")).toHaveLength(2);
    const link = within(dialog).getByLabelText("订阅地址") as HTMLInputElement;
    expect(link.value).toContain("/x/sharedmember");
    expect(link.value).toContain("t=clashmeta");
    fireEvent.change(within(dialog).getByRole("combobox", { name: "客户端" }), { target: { value: "clash-to-shadowrocket" } });
    await waitFor(() => expect(link.value).toContain("t=clash-to-shadowrocket"));
    expect(within(dialog).getByRole("link", { name: "导入客户端" }).getAttribute("href")).toContain("shadowrocket://");
  });

  it("uses the recipient token when a personal short code is unavailable", () => {
    const url = new URL(subscriptionDeliveryURL({ ...owned, auto_sync_custom_rules: false }, "recipient-only", "", "v2ray"));
    expect(url.searchParams.get("token")).toBe("recipient-only");
    expect(url.searchParams.get("filename")).toBe("mine.yaml");
  });
});
