import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { ConsoleApp, filterTrafficHistory } from "./console";
import type { Profile, TrafficSummary } from "./types";

vi.hoisted(() => {
  (globalThis as unknown as { process: { env: { NODE_ENV?: string } } }).process.env.NODE_ENV = "test";
});

const member: Profile = {
  username: "member",
  email: "member@example.com",
  nickname: "Member",
  avatar_url: "",
  role: "user",
  is_admin: false,
};

const summary: TrafficSummary = {
  metrics: {
    total_limit_gb: 100,
    total_used_gb: 25,
    total_remaining_gb: 75,
    usage_percentage: 25,
    unlimited_used_gb: 0,
  },
  history: [],
};

function renderMemberConsole(pages: string[]) {
  const get = vi.spyOn(api, "get").mockImplementation(async (path) => {
    if (path === "/api/user/permissions") return { pages };
    if (path === "/api/user/profile") return member;
    if (path === "/api/admin/nodes") return { nodes: [] };
    if (path === "/api/traffic/summary") return summary;
    throw new Error(`unexpected GET ${path}`);
  });
  render(createElement(ConsoleApp, { profile: member, onLogout: vi.fn() }));
  return get;
}

beforeEach(() => {
  localStorage.clear();
  location.hash = "";
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
  cleanup();
  vi.restoreAllMocks();
});

const history = [
  { date: "2026-07-31", used_gb: 1 },
  { date: "2026-08-01", used_gb: 2 },
  { date: "2026-08-03", used_gb: 3 },
  { date: "2026-08-08", used_gb: 4 },
];

describe("dashboard traffic periods", () => {
  const now = new Date(2026, 7, 8, 12);

  it("uses the current local calendar day", () => {
    expect(filterTrafficHistory(history, "today", now).map((item) => item.date)).toEqual(["2026-08-08"]);
  });

  it("uses Monday as the start of the current week", () => {
    expect(filterTrafficHistory(history, "week", now).map((item) => item.date)).toEqual(["2026-08-03", "2026-08-08"]);
  });

  it("does not include the previous month", () => {
    expect(filterTrafficHistory(history, "month", now).map((item) => item.date)).toEqual(["2026-08-01", "2026-08-03", "2026-08-08"]);
  });
});

describe("member console navigation permissions", () => {
  it("hides forwarding and redirects a direct route without the forwarding page grant", async () => {
    location.hash = "/forwarding";
    renderMemberConsole([]);

    await waitFor(() => expect(location.hash).toBe("#/dashboard"));
    expect(screen.queryByRole("button", { name: "转发管理" })).not.toBeInTheDocument();
  });

  it("shows forwarding when effective page permissions include it", async () => {
    const get = renderMemberConsole(["forwarding"]);

    expect(await screen.findByRole("button", { name: "转发管理" })).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith("/api/user/permissions");
  });
});
