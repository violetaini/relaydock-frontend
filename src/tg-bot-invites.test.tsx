import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { normalizeInviteList, TGBotInvitesPanel, type TGBotInvite } from "./tg-bot-invites";
import type { PackageItem, UserItem } from "./types";

vi.hoisted(() => {
  (globalThis as unknown as { process: { env: { NODE_ENV?: string } } }).process.env.NODE_ENV = "test";
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function invite(overrides: Partial<TGBotInvite> = {}): TGBotInvite {
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

const standardPackage: PackageItem = {
  id: 7,
  name: "标准月付",
  description: "",
  traffic_limit_gb: 200,
  cycle_days: 30,
  is_reset: false,
  reset_day: 1,
  nodes: [],
  speed_limit_mbps: 0,
  device_limit: 0,
  short_code: "standard",
  traffic_mode: "sum",
};

const bindUser: UserItem = {
  username: "alice",
  email: "alice@example.com",
  nickname: "Alice",
  role: "user",
  is_active: true,
  remark: "",
  traffic_used: 0,
  traffic_limit: 0,
  is_over_limit: false,
  speed_limit_mbps: 0,
  device_limit: 0,
};

function mockLists(invites: TGBotInvite[], packages: PackageItem[] = [standardPackage], users: UserItem[] = [bindUser]) {
  return vi.spyOn(api, "get").mockImplementation(async <T,>(path: string) => {
    if (path === "/api/admin/tgbot/invites") return { success: true, items: invites } as T;
    if (path === "/api/admin/packages") return { packages } as T;
    if (path === "/api/admin/users") return { users } as T;
    throw new Error(`unexpected GET ${path}`);
  });
}

describe("TG Bot invite operations", () => {
  it("accepts current and legacy list envelopes", () => {
    const item = invite();
    expect(normalizeInviteList({ success: true, items: [item] })).toEqual([item]);
    expect(normalizeInviteList([item])).toEqual([item]);
    expect(normalizeInviteList({ data: { invites: [item] } })).toEqual([item]);
  });

  it("creates an invite with the API payload", async () => {
    mockLists([invite({ package_id: standardPackage.id })]);
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true, code: "NEWCODE12345" });
    const notify = vi.fn();
    render(<TGBotInvitesPanel notify={notify} />);

    expect(await screen.findByText("邀请码由独立 Telegram Bot 使用")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "创建邀请码" }));
    expect(await screen.findByText("标准月付", { selector: ".cell-note" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: /^注册套餐/ }), { target: { value: "7" } });
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

  it("selects an active existing user for bind invites", async () => {
    const disabled = { ...bindUser, username: "disabled", nickname: "停用账号", is_active: false };
    const admin = { ...bindUser, username: "admin", nickname: "管理员", role: "admin" };
    mockLists([invite()], [standardPackage], [bindUser, disabled, admin]);
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true, code: "BINDCODE1234" });
    render(<TGBotInvitesPanel notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "创建邀请码" }));
    fireEvent.change(screen.getByRole("combobox", { name: "用途" }), { target: { value: "bind" } });
    const account = screen.getByRole("combobox", { name: "Arcway 账号" });
    expect(within(account).getByRole("option", { name: "Alice（alice）" })).toBeInTheDocument();
    expect(within(account).queryByRole("option", { name: /disabled|停用账号/ })).not.toBeInTheDocument();
    expect(within(account).queryByRole("option", { name: /admin|管理员/ })).not.toBeInTheDocument();
    fireEvent.change(account, { target: { value: "alice" } });
    fireEvent.click(within(screen.getByRole("dialog", { name: "创建 TG Bot 邀请码" })).getByRole("button", { name: "创建邀请码" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/tgbot/invites", expect.objectContaining({
      kind: "bind",
      bind_username: "alice",
      package_id: null,
      duration_months: 0,
    })));
  });

  it("requires an account returned by the active user list", async () => {
    mockLists([invite()], [standardPackage], []);
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: true, code: "LATEUSER1234" });
    render(<TGBotInvitesPanel notify={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "创建邀请码" }));
    fireEvent.change(screen.getByRole("combobox", { name: "用途" }), { target: { value: "bind" } });
    const account = screen.getByRole("combobox", { name: "Arcway 账号" });
    expect(account).toBeDisabled();
    expect(within(account).getByRole("option", { name: "没有可绑定的有效普通用户" })).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it("revokes usable invites and deletes unavailable invites", async () => {
    const active = invite();
    const revoked = invite({ code: "REVOKED12345", revoked: true, usable: false });
    mockLists([active, revoked]);
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
