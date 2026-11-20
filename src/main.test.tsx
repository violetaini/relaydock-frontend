import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, getToken, setToken } from "./api";
import { App, recoverFromPreloadError, revokeCurrentSession } from "./main";

vi.hoisted(() => {
  (globalThis as unknown as { process: { env: { NODE_ENV?: string } } }).process.env.NODE_ENV = "test";
});

describe("application bootstrap", () => {
  beforeEach(() => {
    localStorage.clear();
    location.hash = "";
    document.title = "RelayDock Console";
    const favicon = document.querySelector<HTMLLinkElement>("#app-favicon");
    if (favicon) favicon.href = "/brand.png";
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    window.history.pushState({}, "", "/");
    cleanup();
    vi.restoreAllMocks();
  });

  it("waits for appearance and providers before painting the complete login form", async () => {
    location.hash = "/login";
    sessionStorage.setItem("oidc-silent-checked", String(Date.now()));
    let resolveBrand!: (value: unknown) => void, resolveProviders!: (value: unknown) => void;
    const branding = new Promise(resolve => { resolveBrand = resolve; });
    const providers = new Promise(resolve => { resolveProviders = resolve; });
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/setup/status") return { needs_setup: false } as T;
      if (path === "/api/public/branding") return await branding as T;
      if (path === "/api/public/oauth/providers") return await providers as T;
      if (path === "/api/public/login-wallpaper") return { login_wallpaper: "https://images.example/official.jpg" } as T;
      if (path === "/api/captcha/config") return { enabled: false, site_key: "" } as T;
      return { enabled: false, servers: [] } as T;
    });
    render(<App />);
    expect(screen.queryByLabelText("账号")).not.toBeInTheDocument();
    await act(async () => resolveBrand({ name: "Configured", login_title: "官方登录", login_kicker: "CHITANDA SSO", auto_sso: true }));
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("/api/public/oauth/providers"));
    expect(screen.queryByLabelText("账号")).not.toBeInTheDocument();
    await act(async () => resolveProviders({ providers: [{ id: "oidc", name: "Unified login" }] }));
    expect(await screen.findByRole("heading", { name: "官方登录" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unified login" })).toBeInTheDocument();
    expect(screen.getByLabelText("账号")).toBeInTheDocument();
    expect(document.querySelector(".login-background-image")).toHaveAttribute("src", "https://images.example/official.jpg");
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

  it("renders the configured public probe metrics and keeps the management login reachable", async () => {
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/setup/status") return { needs_setup: false } as T;
      if (path === "/api/public/login-wallpaper") return { login_wallpaper: "https://images.example/login.jpg" } as T;
      if (path === "/api/public/probe-servers") return {
        enabled: true,
        title: "Edge Service Status",
        show_name: true,
        show_cpu: true,
        show_memory: true,
        show_disk: true,
        show_traffic: true,
        show_speed: true,
        servers: [{
          name: "Hong Kong Edge",
          country_code: "HK",
          upload_speed: 1024,
          download_speed: 2048,
          traffic_used: 4096,
          traffic_limit: 8192,
          cpu_pct: 12.5,
          loadavg: "0.12 0.08 0.03",
          mem_used: 3 * 1024 ** 3,
          mem_total: 8 * 1024 ** 3,
          disk_used: 18 * 1024 ** 3,
          disk_total: 50 * 1024 ** 3,
          online: true,
        }],
      } as T;
      if (path === "/api/captcha/config") return { enabled: false, site_key: "" } as T;
      throw new Error(`unexpected GET ${path}`);
    });

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Edge Service Status" })).toBeInTheDocument();
    expect(screen.getByText("Hong Kong Edge")).toBeInTheDocument();
    const flag = screen.getByTitle("HK");
    await waitFor(() => expect(flag.querySelector("img")).toHaveAttribute("src", expect.stringMatching(/(?:data:image\/svg\+xml|\.svg(?:\?|$))/)));
    expect(flag).not.toHaveTextContent("HK");
    expect(screen.getByRole("progressbar", { name: "CPU 13%" })).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "内存 38%" })).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "磁盘 36%" })).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "流量 4.0 KB" })).toBeInTheDocument();
    expect(screen.getByText("负载 0.12 / 0.08 / 0.03")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "列表视图" }));
    expect(screen.getByRole("button", { name: "列表视图" })).toHaveAttribute("aria-pressed", "true");
    expect(document.querySelector(".public-probe-grid")).toHaveClass("is-list");
    fireEvent.click(screen.getByRole("button", { name: "登录" }));
    expect(await screen.findByRole("heading", { name: "进入控制台" })).toBeInTheDocument();
    expect(document.querySelector(".login-background-image")).toHaveAttribute("src", "https://images.example/login.jpg");
  });

  it("uses public branding for the browser title and favicon", async () => {
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/setup/status") return { needs_setup: false } as T;
      if (path === "/api/public/branding") return {
        name: "Northstar", logo: "https://assets.example/northstar-logo.png", favicon: "https://assets.example/northstar.ico",
      } as T;
      if (path === "/api/public/login-wallpaper") return { login_wallpaper: "" } as T;
      if (path === "/api/public/probe-servers") return { enabled: false, servers: [] } as T;
      if (path === "/api/captcha/config") return { enabled: false, site_key: "" } as T;
      throw new Error(`unexpected GET ${path}`);
    });

    render(<App />);

    await waitFor(() => expect(document.title).toBe("Northstar Console"));
    expect(document.querySelector<HTMLLinkElement>("#app-favicon")?.href).toContain("https://assets.example/northstar.ico");
  });

  it("keeps the management login hidden when the public probe requests it", async () => {
    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/setup/status") return { needs_setup: false } as T;
      if (path === "/api/public/login-wallpaper") return { login_wallpaper: "" } as T;
      if (path === "/api/public/probe-servers") return {
        enabled: true,
        title: "Operations Status",
        block_login: true,
        show_cpu: true,
        show_memory: true,
        show_disk: true,
        servers: [{
          online: false,
          traffic_used: 0,
          cpu_pct: 75,
          mem_used: 6 * 1024 ** 3,
          mem_total: 8 * 1024 ** 3,
          disk_used: 40 * 1024 ** 3,
          disk_total: 50 * 1024 ** 3,
        }],
      } as T;
      throw new Error(`unexpected GET ${path}`);
    });

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Operations Status" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "登录" })).not.toBeInTheDocument();
    expect(screen.getByText("离线")).toBeInTheDocument();
    expect(screen.queryByText("CPU")).not.toBeInTheDocument();
    expect(screen.queryByText("内存")).not.toBeInTheDocument();
    expect(screen.queryByText("磁盘")).not.toBeInTheDocument();
  });

  it("exchanges oauth_code for a session token and cleans URL search params", async () => {
    window.history.pushState({}, "", "/?oauth_code=rd_auth_mock_code&oauth_username=alice&probe=1");
    const replaceState = vi.spyOn(window.history, "replaceState");

    const post = vi.spyOn(api, "post").mockImplementation(async <T,>(path: string, body?: unknown): Promise<T> => {
      if (path === "/api/public/oauth/exchange") {
        expect(body).toEqual({ code: "rd_auth_mock_code" });
        return { token: "exchanged-jwt-token", username: "alice" } as T;
      }
      throw new Error(`unexpected POST ${path}`);
    });

    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/setup/status") return { needs_setup: false } as T;
      if (path === "/api/user/profile") return { username: "alice", role: "admin", display_name: "Alice" } as T;
      if (path === "/api/public/branding") return {} as T;
      if (path === "/api/public/login-wallpaper") return { login_wallpaper: "" } as T;
      if (path === "/api/public/probe-servers") return { enabled: false, servers: [] } as T;
      if (path === "/api/captcha/config") return { enabled: false, site_key: "" } as T;
      throw new Error(`unexpected GET ${path}`);
    });

    render(<App />);
    expect(document.querySelector(".public-probe-layout")).toBeNull();
    expect(screen.queryByText("ちちゃんの探針")).not.toBeInTheDocument();
    expect(location.hash).toBe("#/dashboard");
    expect(location.search).not.toContain("probe=");

    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/public/oauth/exchange", { code: "rd_auth_mock_code" }));
    expect(getToken()).toBe("exchanged-jwt-token");
    expect(replaceState).toHaveBeenCalled();
  });

  it("handles sso_silent=guest by staying on the login screen quietly", async () => {
    window.history.pushState({}, "", "/?sso_silent=guest");
    const replaceState = vi.spyOn(window.history, "replaceState");

    vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/setup/status") return { needs_setup: false } as T;
      if (path === "/api/public/branding") return {} as T;
      if (path === "/api/public/login-wallpaper") return { login_wallpaper: "" } as T;
      if (path === "/api/public/probe-servers") return { enabled: false, servers: [] } as T;
      if (path === "/api/captcha/config") return { enabled: false, site_key: "" } as T;
      if (path === "/api/public/oauth/providers") return { providers: [], auto_register: true } as T;
      throw new Error(`unexpected GET ${path}`);
    });

    render(<App />);

    expect(await screen.findByRole("heading", { name: "进入控制台" })).toBeInTheDocument();
    expect(screen.queryByText(/第三方登录失败/)).not.toBeInTheDocument();
    expect(replaceState).toHaveBeenCalled();
  });
});

describe("lazy release recovery", () => {
  it("reloads once per recovery window when an old hashed chunk disappears", () => {
    sessionStorage.clear();
    const reload = vi.fn();
    const first = new Event("vite:preloadError", { cancelable: true });
    expect(recoverFromPreloadError(first, reload, 100_000)).toBe(true);
    expect(first.defaultPrevented).toBe(true);
    expect(reload).toHaveBeenCalledOnce();

    const repeated = new Event("vite:preloadError", { cancelable: true });
    expect(recoverFromPreloadError(repeated, reload, 120_000)).toBe(false);
    expect(repeated.defaultPrevented).toBe(false);
    expect(reload).toHaveBeenCalledOnce();
  });

  it("lets the page boundary handle the failure when session storage is unavailable", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("storage disabled"); });
    const reload = vi.fn();
    const event = new Event("vite:preloadError", { cancelable: true });

    expect(recoverFromPreloadError(event, reload, 100_000)).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    getItem.mockRestore();
  });

  it("does not reload when the recovery marker cannot be written", () => {
    sessionStorage.clear();
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("storage full"); });
    const reload = vi.fn();
    const event = new Event("vite:preloadError", { cancelable: true });

    expect(recoverFromPreloadError(event, reload, 100_000)).toBe(false);
    expect(event.defaultPrevented).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    setItem.mockRestore();
  });
});

describe("session logout", () => {
  it("clears both local stores before the server logout request settles", () => {
    setToken("persistent-session", true);
    sessionStorage.setItem("arcway-session-token", "stale-session-copy");
    const pending = new Promise<never>(() => undefined);
    const post = vi.spyOn(api, "post").mockReturnValue(pending);

    expect(revokeCurrentSession()).toBe(pending);
    expect(post).toHaveBeenCalledWith("/api/logout", undefined, { suppressUnauthorizedEvent: true, timeoutMs: 5_000 });
    expect(getToken()).toBe("");
    expect(localStorage.getItem("arcway-session-token")).toBeNull();
    expect(sessionStorage.getItem("arcway-session-token")).toBeNull();
  });
});
