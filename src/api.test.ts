import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, getToken, setToken } from "./api";

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
      expect(new Headers(init?.headers).get("MM-Authorization")).toBe("secret");
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
});
