import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { TwoFactorSettings } from "./two-factor";

vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn().mockResolvedValue("data:image/png;base64,arcway-2fa") } }));

vi.hoisted(() => {
  (globalThis as unknown as { process: { env: { NODE_ENV?: string } } }).process.env.NODE_ENV = "test";
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
});

function status(enabled: boolean) {
  return vi.spyOn(api, "get").mockResolvedValue({ enabled });
}

async function openSetup(password = "correct-password") {
  fireEvent.click(await screen.findByRole("button", { name: "启用 2FA" }));
  fireEvent.change(screen.getByLabelText("当前密码"), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: "继续" }));
}

describe("two-factor settings", () => {
  it("completes setup and makes the one-time recovery codes impossible to dismiss accidentally", async () => {
    let statusRequests = 0;
    const get = vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path !== "/api/user/2fa/status") throw new Error(`unexpected GET ${path}`);
      statusRequests += 1;
      return { enabled: statusRequests > 1 } as T;
    });
    const post = vi.spyOn(api, "post").mockImplementation(async <T,>(path: string, body?: unknown): Promise<T> => {
      if (path === "/api/user/2fa/setup") return { secret: "JBSWY3DPEHPK3PXP", url: "otpauth://totp/Arcway:admin?secret=JBSWY3DPEHPK3PXP" } as T;
      if (path === "/api/user/2fa/verify-setup") return { recovery_codes: ["alpha-111", "bravo-222"] } as T;
      throw new Error(`unexpected POST ${path} ${JSON.stringify(body)}`);
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const notify = vi.fn();
    const { container } = render(<TwoFactorSettings notify={notify} />);

    await openSetup();

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/user/2fa/setup", { password: "correct-password" }, { suppressUnauthorizedEvent: true }));
    expect(await screen.findByRole("img", { name: "双因素认证设置二维码" })).toHaveAttribute("src", "data:image/png;base64,arcway-2fa");
    expect(await screen.findByText("JBSWY3DPEHPK3PXP")).toBeInTheDocument();
    expect(screen.getByText(/otpauth:\/\/totp\/Arcway:admin/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("6 位动态验证码"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "验证并启用" }));

    expect(await screen.findByText("alpha-111")).toBeInTheDocument();
    expect(screen.getByText("bravo-222")).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith("/api/user/2fa/verify-setup", { code: "123456" }, { suppressUnauthorizedEvent: true });
    expect(notify).toHaveBeenCalledWith("双因素认证已启用");
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));

    const recoveryDialog = screen.getByRole("dialog", { name: "保存恢复码" });
    expect(screen.queryByRole("button", { name: "关闭" })).not.toBeInTheDocument();
    fireEvent.mouseDown(container.querySelector(".dialog-backdrop")!);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(recoveryDialog).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "完成" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "复制全部恢复码" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("alpha-111\nbravo-222"));
    fireEvent.click(screen.getByRole("checkbox", { name: "我已将这些恢复码保存在安全位置" }));
    fireEvent.click(screen.getByRole("button", { name: "完成" }));
    expect(screen.queryByRole("dialog", { name: "保存恢复码" })).not.toBeInTheDocument();
    expect(await screen.findByText("登录时需要动态验证码")).toBeInTheDocument();
  });

  it("keeps the password dialog open when setup returns HTTP 200 with success:false", async () => {
    status(false);
    const post = vi.spyOn(api, "post").mockResolvedValue({ success: false, message: "当前密码错误" });
    const notify = vi.fn();
    render(<TwoFactorSettings notify={notify} />);

    await openSetup("wrong-password");

    expect(await screen.findByRole("alert")).toHaveTextContent("当前密码错误");
    expect(screen.getByRole("dialog", { name: "启用双因素认证" })).toBeInTheDocument();
    expect(post).toHaveBeenCalledWith("/api/user/2fa/setup", { password: "wrong-password" }, { suppressUnauthorizedEvent: true });
    expect(notify).not.toHaveBeenCalled();
  });

  it("requires a current TOTP code before disabling and refreshes the status afterwards", async () => {
    let statusRequests = 0;
    const get = vi.spyOn(api, "get").mockImplementation(async <T,>(): Promise<T> => {
      statusRequests += 1;
      return { enabled: statusRequests === 1 } as T;
    });
    const post = vi.spyOn(api, "post").mockResolvedValue({ status: "disabled" });
    const notify = vi.fn();
    render(<TwoFactorSettings notify={notify} />);

    fireEvent.click(await screen.findByRole("button", { name: "关闭 2FA" }));
    const confirm = screen.getByRole("button", { name: "确认关闭" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("6 位动态验证码"), { target: { value: "654321" } });
    fireEvent.click(confirm);

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/user/2fa/disable", { code: "654321" }, { suppressUnauthorizedEvent: true }));
    expect(notify).toHaveBeenCalledWith("双因素认证已关闭");
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("建议启用以防止密码泄露")).toBeInTheDocument();
  });

  it("does not report success when disable returns HTTP 200 with success:false", async () => {
    status(true);
    vi.spyOn(api, "post").mockResolvedValue({ success: false, error: "动态验证码无效" });
    const notify = vi.fn();
    render(<TwoFactorSettings notify={notify} />);

    fireEvent.click(await screen.findByRole("button", { name: "关闭 2FA" }));
    fireEvent.change(screen.getByLabelText("6 位动态验证码"), { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: "确认关闭" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("动态验证码无效");
    expect(screen.getByRole("dialog", { name: "关闭双因素认证" })).toBeInTheDocument();
    expect(notify).not.toHaveBeenCalledWith("双因素认证已关闭");
  });
});
