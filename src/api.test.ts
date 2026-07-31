import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, getToken, openDashboardSocket, setToken } from "./api";

describe("api client", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("stores and clears the session token", () => {
    setToken("session");
    expect(getToken()).toBe("session");
    setToken("");
    expect(getToken()).toBe("");
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
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const onMessage = vi.fn();
    const onOpen = vi.fn();
    const onClose = vi.fn();

    const cleanupSocket = openDashboardSocket(onMessage, { onOpen, onClose });
    const socket = FakeWebSocket.instances[0];
    expect(socket.url).toContain("/api/ws/dashboard?token=socket-token");
    socket.onopen?.();
    socket.onmessage?.({ data: JSON.stringify({ type: "realtime" }) });
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onMessage).toHaveBeenCalledWith({ type: "realtime" });

    socket.onclose?.();
    expect(onClose).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(FakeWebSocket.instances).toHaveLength(2);
    cleanupSocket();
    expect(onClose).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeWebSocket.instances).toHaveLength(2);
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
