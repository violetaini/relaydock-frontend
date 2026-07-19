import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, getToken, setToken } from "./api";
import { App } from "./main";

vi.hoisted(() => {
  (globalThis as unknown as { process: { env: { NODE_ENV?: string } } }).process.env.NODE_ENV = "test";
});

describe("application bootstrap", () => {
  beforeEach(() => {
    localStorage.clear();
    location.hash = "";
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it.each([
    [0, "网络暂时不可用"],
    [503, "控制端暂时不可用"],
  ])("keeps the session and offers retry when profile loading fails with status %i", async (status, message) => {
    setToken("existing-session");
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/setup/status") return { needs_setup: false } as T;
      throw new ApiError(message, status);
    });

    render(<App />);

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新连接" })).toBeEnabled();
    expect(getToken()).toBe("existing-session");
  });

  it.each([401, 403])("clears the session when profile loading is rejected with status %i", async (status) => {
    setToken("expired-session");
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/setup/status") return { needs_setup: false } as T;
      throw new ApiError("登录已失效", status);
    });

    render(<App />);

    expect(await screen.findByRole("heading", { name: "进入控制台" })).toBeInTheDocument();
    expect(getToken()).toBe("");
  });

  it("renders the configured public probe and keeps the management login reachable", async () => {
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/setup/status") return { needs_setup: false } as T;
      if (path === "/api/public/login-wallpaper") return { login_wallpaper: "https://images.example/login.jpg" } as T;
      if (path === "/api/public/probe-servers") return {
        enabled: true,
        title: "Edge Service Status",
        show_name: true,
        servers: [{ name: "Hong Kong Edge", upload_speed: 1024, download_speed: 2048, traffic_used: 4096, traffic_limit: 8192, online: true }],
      } as T;
      if (path === "/api/captcha/config") return { enabled: false, site_key: "" } as T;
      throw new Error(`unexpected GET ${path}`);
    });

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Edge Service Status" })).toBeInTheDocument();
    expect(screen.getByText("Hong Kong Edge")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "进入管理登录" }));
    expect(await screen.findByRole("heading", { name: "进入控制台" })).toBeInTheDocument();
    expect(document.querySelector(".auth-layout")).toHaveStyle({ backgroundImage: "url(https://images.example/login.jpg)" });
  });
});
