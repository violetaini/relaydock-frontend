import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { normalizeInviteList, TGBotInvitesPanel, type TGBotInvite } from "./tg-bot-invites";

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

describe("TG Bot invite operations", () => {
  it("accepts current and legacy list envelopes", () => {
    const item = invite();
    expect(normalizeInviteList({ success: true, items: [item] })).toEqual([item]);
    expect(normalizeInviteList([item])).toEqual([item]);
    expect(normalizeInviteList({ data: { invites: [item] } })).toEqual([item]);
  });

  it("creates an invite with the API payload", async () => {
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

  it("revokes usable invites and deletes unavailable invites", async () => {
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
