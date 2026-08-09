import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "./api";
import { LoginScreen } from "./auth-screens";

vi.hoisted(() => {
  (globalThis as unknown as { process: { env: { NODE_ENV?: string } } }).process.env.NODE_ENV = "test";
});

afterEach(() => {
  cleanup();
  document.querySelectorAll("script[data-arcway-turnstile]").forEach((script) => script.remove());
  delete window.turnstile;
  vi.restoreAllMocks();
});

describe("login screen resilience", () => {
  it("shows a retryable Turnstile script error and remains fail-closed until a token arrives", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ enabled: true, site_key: "site-key" });
    const renderWidget = vi.fn();
    const removeWidget = vi.fn();
    render(<LoginScreen onLogin={vi.fn()} />);

    const login = await screen.findByRole("button", { name: "登录" });
    expect(login).toBeDisabled();
    const script = await waitFor(() => {
      const candidate = document.querySelector<HTMLScriptElement>("script[data-arcway-turnstile]");
      expect(candidate).not.toBeNull();
      return candidate;
    });
    expect(script).not.toBeNull();
    fireEvent.error(script!);

    expect(await screen.findByRole("alert")).toHaveTextContent("人机验证脚本加载失败");
    window.turnstile = {
      render: renderWidget.mockImplementation((_element, options) => {
        (renderWidget as typeof renderWidget & { options?: typeof options }).options = options;
        return "widget-1";
      }),
      remove: removeWidget,
    };
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    await waitFor(() => expect(renderWidget).toHaveBeenCalledOnce());

    fireEvent.change(screen.getByRole("textbox", { name: "账号" }), { target: { value: "admin" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "password" } });
    act(() => (renderWidget as typeof renderWidget & { options: { callback: (token: string) => void } }).options.callback("verified-token"));
    expect(login).toBeEnabled();

    act(() => (renderWidget as typeof renderWidget & { options: { "expired-callback": () => void } }).options["expired-callback"]());
    expect(login).toBeDisabled();
  });

  it("normalizes a six-digit second factor and can return to password login", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ enabled: false, site_key: "" });
    const post = vi.spyOn(api, "post").mockResolvedValueOnce({ requires_2fa: true, two_factor_token: "pending-token" });
    render(<LoginScreen onLogin={vi.fn()} />);

    fireEvent.change(await screen.findByRole("textbox", { name: "账号" }), { target: { value: "admin" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "password" } });
    fireEvent.click(screen.getByRole("button", { name: "登录" }));
    expect(await screen.findByText("验证第二因素")).toBeInTheDocument();

    const code = screen.getByRole("textbox", { name: "动态验证码" });
    fireEvent.change(code, { target: { value: "12a34567" } });
    expect(code).toHaveValue("123456");
    expect(screen.getByRole("button", { name: "验证并登录" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "返回账号密码登录" }));

    expect(await screen.findByText("进入控制台")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "账号" })).toHaveValue("admin");
    expect(post).toHaveBeenCalledWith("/api/login", expect.objectContaining({ username: "admin", password: "password" }));
  });

  it("requires a fresh Turnstile token after returning from second-factor login", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ enabled: true, site_key: "site-key" });
    const widgetOptions: Array<{ callback: (token: string) => void }> = [];
    const renderWidget = vi.fn((_element: HTMLElement, options: { callback: (token: string) => void }) => {
      widgetOptions.push(options);
      return `widget-${widgetOptions.length}`;
    });
    const removeWidget = vi.fn();
    window.turnstile = { render: renderWidget, remove: removeWidget };
    vi.spyOn(api, "post").mockResolvedValue({ requires_2fa: true, two_factor_token: "pending-token" });
    render(<LoginScreen onLogin={vi.fn()} />);

    fireEvent.change(await screen.findByRole("textbox", { name: "账号" }), { target: { value: "admin" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "password" } });
    await waitFor(() => expect(renderWidget).toHaveBeenCalledTimes(1));
    act(() => widgetOptions[0].callback("consumed-token"));
    fireEvent.click(screen.getByRole("button", { name: "登录" }));
    fireEvent.click(await screen.findByRole("button", { name: "返回账号密码登录" }));

    await waitFor(() => expect(renderWidget).toHaveBeenCalledTimes(2));
    expect(removeWidget).toHaveBeenCalledWith("widget-1");
    expect(screen.getByRole("button", { name: "登录" })).toBeDisabled();
    act(() => widgetOptions[1].callback("fresh-token"));
    expect(screen.getByRole("button", { name: "登录" })).toBeEnabled();
  });

  it("requires a fresh Turnstile token after a rejected password attempt", async () => {
    vi.spyOn(api, "get").mockResolvedValue({ enabled: true, site_key: "site-key" });
    const widgetOptions: Array<{ callback: (token: string) => void }> = [];
    const renderWidget = vi.fn((_element: HTMLElement, options: { callback: (token: string) => void }) => {
      widgetOptions.push(options);
      return `widget-${widgetOptions.length}`;
    });
    const removeWidget = vi.fn();
    window.turnstile = { render: renderWidget, remove: removeWidget };
    const post = vi.spyOn(api, "post")
      .mockRejectedValueOnce(new ApiError("invalid credentials", 401))
      .mockResolvedValueOnce({ token: "session-token", username: "admin" });
    const onLogin = vi.fn();
    render(<LoginScreen onLogin={onLogin} />);

    fireEvent.change(await screen.findByRole("textbox", { name: "账号" }), { target: { value: "admin" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "wrong-password" } });
    await waitFor(() => expect(renderWidget).toHaveBeenCalledTimes(1));
    act(() => widgetOptions[0].callback("consumed-token"));
    fireEvent.click(screen.getByRole("button", { name: "登录" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("账号或密码错误");
    await waitFor(() => expect(renderWidget).toHaveBeenCalledTimes(2));
    expect(removeWidget).toHaveBeenCalledWith("widget-1");
    expect(screen.getByRole("button", { name: "登录" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "correct-password" } });
    act(() => widgetOptions[1].callback("fresh-token"));
    fireEvent.click(screen.getByRole("button", { name: "登录" }));

    await waitFor(() => expect(onLogin).toHaveBeenCalledWith(expect.objectContaining({ token: "session-token" })));
    expect(post).toHaveBeenNthCalledWith(1, "/api/login", expect.objectContaining({ turnstile_token: "consumed-token" }));
    expect(post).toHaveBeenNthCalledWith(2, "/api/login", expect.objectContaining({ turnstile_token: "fresh-token" }));
  });
});
