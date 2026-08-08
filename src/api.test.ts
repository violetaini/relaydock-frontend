import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, getToken, openDashboardSocket, setToken } from "./api";

describe("api client", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("stores and clears the session token", () => {
    setToken("session");
    expect(getToken()).toBe("session");
    setToken("");
    expect(getToken()).toBe("");
  });

  it("uses session storage when remember-me is disabled", () => {
    setToken("session-only", false);
    expect(sessionStorage.getItem("arcway-session-token")).toBe("session-only");
    expect(localStorage.getItem("arcway-session-token")).toBeNull();
    expect(getToken()).toBe("session-only");
  });

  it("sends the backend authorization header", async () => {
    setToken("secret");
    vi.stubGlobal("fetch", vi.fn(async (_path, init) => {
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer secret");
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }));
    await expect(api.get<{ ok: boolean }>("/api/test")).resolves.toEqual({ ok: true });
  });

  it("sends an idempotency key for retry-safe writes", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_path, init) => {
      expect(new Headers(init?.headers).get("Idempotency-Key")).toBe("request-123");
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }));
    await expect(api.post<{ ok: boolean }>("/api/test", {}, { idempotencyKey: "request-123" })).resolves.toEqual({ ok: true });
  });

  it("does not expire the session when an authenticated challenge rejects its input", async () => {
    const unauthorized = vi.fn();
    window.addEventListener("arcway:unauthorized", unauthorized);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "invalid 2FA code" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    })));

    await expect(api.post("/api/user/2fa/verify-setup", { code: "000000" }, { suppressUnauthorizedEvent: true }))
      .rejects.toEqual(expect.objectContaining({ status: 401, message: "invalid 2FA code" }));
    expect(unauthorized).not.toHaveBeenCalled();
    window.removeEventListener("arcway:unauthorized", unauthorized);
  });

  it("reports dashboard socket connectivity, reconnects with backoff and stops after cleanup", async () => {
    vi.useFakeTimers();
    class FakeWebSocket {
      static instances: FakeWebSocket[] = [];
      static OPEN = 1;
      onopen: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      onclose: (() => void) | null = null;
      readyState = FakeWebSocket.OPEN;
      constructor(readonly url: string) { FakeWebSocket.instances.push(this); }
      send() { /* Ping frames are intentionally ignored by the fake. */ }
      close() { this.onclose?.(); }
    }
    setToken("socket-token");
    let ticketNumber = 0;
    vi.stubGlobal("fetch", vi.fn(async (path: string | URL | Request) => {
      expect(String(path)).toBe("/api/ws/ticket");
      ticketNumber += 1;
      return new Response(JSON.stringify({ ticket: `ticket-${ticketNumber}` }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }));
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const onMessage = vi.fn();
    const onOpen = vi.fn();
    const onClose = vi.fn();

    const cleanupSocket = openDashboardSocket(onMessage, { onOpen, onClose });
    await vi.advanceTimersByTimeAsync(0);
    const socket = FakeWebSocket.instances[0];
    expect(socket.url).toContain("/api/ws/dashboard?ticket=ticket-1");
    expect(socket.url).not.toContain("socket-token");
    socket.onopen?.();
    socket.onmessage?.({ data: JSON.stringify({ type: "realtime" }) });
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onMessage).toHaveBeenCalledWith({ type: "realtime" });

    socket.onclose?.();
    expect(onClose).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(FakeWebSocket.instances[1].url).toContain("ticket=ticket-2");
    cleanupSocket();
    expect(onClose).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("aborts requests at the configured timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_path, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
    })));
    const pending = api.get("/api/slow", { timeoutMs: 100 });
    const rejected = expect(pending).rejects.toEqual(expect.objectContaining({ status: 0, message: "请求超时，请稍后重试" }));
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps the timeout active while reading a normal response body", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async (_path, init) => {
      const stream = new ReadableStream({
        start(controller) {
          init?.signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")), { once: true });
        },
      });
      return new Response(stream, { status: 200, headers: { "content-type": "application/json" } });
    }));
    const pending = api.get("/api/slow-body", { timeoutMs: 100 });
    const rejected = expect(pending).rejects.toEqual(expect.objectContaining({ status: 0, message: "请求超时，请稍后重试" }));
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("reports dashboard fallback immediately when no session token exists", () => {
    const onClose = vi.fn();
    const cleanupSocket = openDashboardSocket(vi.fn(), { onClose });
    expect(onClose).toHaveBeenCalledOnce();
    cleanupSocket();
  });
});
