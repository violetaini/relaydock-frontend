import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { AccountWorkbenchPage } from "./account-workbench";
import type { Profile } from "./types";

vi.hoisted(() => {
  (globalThis as unknown as { process: { env: { NODE_ENV?: string } } }).process.env.NODE_ENV = "test";
});

const normalProfile: Profile = {
  username: "alice",
  email: "alice@example.com",
  nickname: "Alice",
  avatar_url: "",
  role: "user",
  is_admin: false,
};

const existingToken = {
  id: 7,
  name: "deploy-bot",
  created_at: "2026-07-01T08:00:00Z",
  last_used_at: "2026-07-18T08:00:00Z",
};

type TestAPIToken = {
  id: number;
  name: string;
  created_at: string;
  last_used_at?: string;
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
});

function mockAccountGets(options: {
  profile?: Profile;
  failProfile?: string;
  tokenBundle?: { token: string; user_short_code?: string; custom_user_short_code?: string };
  apiTokens?: TestAPIToken[];
  onAPITokenList?: () => TestAPIToken[];
} = {}) {
  const profile = options.profile ?? normalProfile;
  const tokenBundle = options.tokenBundle ?? { token: "subscription-secret", user_short_code: "a1b2c3", custom_user_short_code: "" };
  return vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
    if (path === "/api/user/profile") {
      if (options.failProfile) throw new Error(options.failProfile);
      return profile as T;
    }
    if (path === "/api/user/token") return tokenBundle as T;
    if (path === "/api/user/api-tokens") return { success: true, tokens: options.onAPITokenList?.() ?? options.apiTokens ?? [existingToken] } as T;
    if (path === "/api/user/2fa/status") return { enabled: false } as T;
    throw new Error(`unexpected GET ${path}`);
  });
}

describe("account workbench", () => {
  it("loads self-service data and sends the exact profile and password contracts for a normal user", async () => {
    const get = mockAccountGets();
    const updatedProfile: Profile = {
      ...normalProfile,
      username: "alice_new",
      email: "new@example.com",
      nickname: "Alice New",
      avatar_url: "https://img.example.com/alice.png",
    };
    const put = vi.spyOn(api, "put").mockImplementation(async <T,>(path: string, body?: unknown): Promise<T> => {
      if (path === "/api/user/settings") return { profile: updatedProfile } as T;
      throw new Error(`unexpected PUT ${path} ${JSON.stringify(body)}`);
    });
    const post = vi.spyOn(api, "post").mockImplementation(async <T,>(path: string, body?: unknown): Promise<T> => {
      if (path === "/api/user/password") return { status: "password_updated" } as T;
      throw new Error(`unexpected POST ${path} ${JSON.stringify(body)}`);
    });
    const notify = vi.fn();
    render(<AccountWorkbenchPage notify={notify} />);

    const username = await screen.findByLabelText("用户名");
    expect(username).toBeEnabled();
    expect(get).toHaveBeenCalledWith("/api/user/profile");
    expect(get).toHaveBeenCalledWith("/api/user/token");
    expect(get).toHaveBeenCalledWith("/api/user/api-tokens");
    expect(get).toHaveBeenCalledWith("/api/user/2fa/status");

    fireEvent.change(username, { target: { value: "alice_new" } });
    fireEvent.change(screen.getByLabelText("昵称"), { target: { value: "Alice New" } });
    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText("头像 URL"), { target: { value: "https://img.example.com/alice.png" } });
    fireEvent.click(screen.getByRole("button", { name: "保存资料" }));

    await waitFor(() => expect(put).toHaveBeenCalledWith("/api/user/settings", {
      username: "alice_new",
      email: "new@example.com",
      nickname: "Alice New",
      avatar_url: "https://img.example.com/alice.png",
    }));
    expect(notify).toHaveBeenCalledWith("个人资料已更新");

    fireEvent.change(screen.getByLabelText("当前密码"), { target: { value: "old-password" } });
    fireEvent.change(screen.getByLabelText("新密码"), { target: { value: "new-password-123" } });
    fireEvent.change(screen.getByLabelText("确认新密码"), { target: { value: "new-password-123" } });
    fireEvent.click(screen.getByRole("button", { name: "更新密码" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/user/password", {
      current_password: "old-password",
      new_password: "new-password-123",
    }));
    expect(notify).toHaveBeenCalledWith("密码已更新");
  });

  it("keeps the administrator username read-only while allowing supported profile fields", async () => {
    mockAccountGets({ profile: { ...normalProfile, username: "admin", role: "admin", is_admin: true } });
    render(<AccountWorkbenchPage notify={vi.fn()} />);

    expect(await screen.findByLabelText("用户名")).toBeDisabled();
    expect(screen.getByLabelText("昵称")).toBeEnabled();
    expect(screen.getByLabelText("邮箱")).toBeEnabled();
    expect(screen.getByLabelText("头像 URL")).toBeEnabled();
    expect(screen.getByText("管理员")).toBeInTheDocument();
  });

  it("reveals and copies subscription credentials, updates the short code, and confirms token reset", async () => {
    mockAccountGets();
    const put = vi.spyOn(api, "put").mockImplementation(async <T,>(path: string, body?: unknown): Promise<T> => {
      if (path === "/api/user/token") return { token: "subscription-secret", user_short_code: "hk_edge", custom_user_short_code: "hk_edge" } as T;
      throw new Error(`unexpected PUT ${path} ${JSON.stringify(body)}`);
    });
    const post = vi.spyOn(api, "post").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/user/token") return { token: "replacement-secret", user_short_code: "hk_edge", custom_user_short_code: "hk_edge" } as T;
      throw new Error(`unexpected POST ${path}`);
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const notify = vi.fn();
    render(<AccountWorkbenchPage notify={notify} />);

    const subscriptionToken = await screen.findByLabelText("订阅 Token");
    expect(subscriptionToken).toHaveAttribute("type", "password");
    fireEvent.click(screen.getByRole("button", { name: "显示订阅 Token" }));
    expect(subscriptionToken).toHaveAttribute("type", "text");
    fireEvent.click(screen.getByRole("button", { name: "复制订阅 Token" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("subscription-secret"));

    fireEvent.change(screen.getByLabelText("自定义短码"), { target: { value: "hk_edge" } });
    fireEvent.click(screen.getByRole("button", { name: "保存短码" }));
    await waitFor(() => expect(put).toHaveBeenCalledWith("/api/user/token", { custom_user_short_code: "hk_edge" }));
    expect(await screen.findByText("hk_edge")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "重置订阅 Token" }));
    expect(screen.getByRole("dialog", { name: "重置订阅 Token" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "确认重置" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/user/token"));
    expect(await screen.findByDisplayValue("replacement-secret")).toHaveAttribute("type", "text");
    expect(notify).toHaveBeenCalledWith("订阅 Token 已重置");
  });

  it("creates a one-time personal API secret and requires confirmation before it can be dismissed, then revokes by id", async () => {
    let listCount = 0;
    mockAccountGets({
      onAPITokenList: () => {
        listCount += 1;
        return listCount === 1 ? [existingToken] : [
          { ...existingToken, id: 8, name: "CI deploy", last_used_at: undefined },
          existingToken,
        ];
      },
    });
    const post = vi.spyOn(api, "post").mockImplementation(async <T,>(path: string, body?: unknown): Promise<T> => {
      if (path === "/api/user/api-tokens") return { success: true, token: "relaydock_one_time_secret", name: "CI deploy" } as T;
      throw new Error(`unexpected POST ${path} ${JSON.stringify(body)}`);
    });
    const remove = vi.spyOn(api, "delete").mockResolvedValue({ success: true });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const notify = vi.fn();
    render(<AccountWorkbenchPage notify={notify} />);

    await screen.findByText("deploy-bot");
    fireEvent.change(screen.getByLabelText("Token 名称"), { target: { value: "CI deploy" } });
    fireEvent.click(screen.getByRole("button", { name: "创建 Token" }));

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/user/api-tokens", { name: "CI deploy" }));
    const secretDialog = await screen.findByRole("dialog", { name: "保存个人 API Token" });
    expect(screen.getByText("relaydock_one_time_secret")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "关闭" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "完成" })).toBeDisabled();
    fireEvent.mouseDown(secretDialog.parentElement!);
    expect(secretDialog).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "复制新 API Token" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("relaydock_one_time_secret"));
    fireEvent.click(screen.getByRole("checkbox", { name: "我已将这个 Token 保存在安全位置" }));
    fireEvent.click(screen.getByRole("button", { name: "完成" }));
    expect(screen.queryByRole("dialog", { name: "保存个人 API Token" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "吊销 deploy-bot" }));
    fireEvent.click(screen.getByRole("button", { name: "确认吊销" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith("/api/user/api-tokens/7"));
    expect(screen.queryByText("deploy-bot")).not.toBeInTheDocument();
    expect(notify).toHaveBeenCalledWith("个人 API Token 已吊销");
  });

  it("isolates profile loading failures from subscription, API token, and 2FA controls", async () => {
    mockAccountGets({ failProfile: "profile offline" });
    render(<AccountWorkbenchPage notify={vi.fn()} />);

    expect(await screen.findByText("profile offline")).toBeInTheDocument();
    expect(await screen.findByLabelText("订阅 Token")).toHaveValue("subscription-secret");
    expect(await screen.findByText("deploy-bot")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "启用 2FA" })).toBeInTheDocument();
  });
});
