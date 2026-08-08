import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, openDashboardSocket } from "./api";
import { filterTrafficHistoryByRange, localDateDaysAgo, TrafficWorkbenchPage } from "./traffic-workbench";
import type { Profile, TrafficSummary } from "./types";

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, openDashboardSocket: vi.fn(() => () => undefined) };
});

vi.hoisted(() => {
  (globalThis as unknown as { process: { env: { NODE_ENV?: string } } }).process.env.NODE_ENV = "test";
});

const admin: Profile = {
  username: "admin",
  email: "admin@example.com",
  nickname: "Admin",
  avatar_url: "",
  role: "admin",
  is_admin: true,
};

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
    unlimited_used_gb: 4,
  },
  history: [
    { date: "2026-07-17", used_gb: 1 },
    { date: "2026-07-18", used_gb: 2 },
    { date: "2026-07-19", used_gb: 3 },
  ],
};

const alice = {
  username: "alice+ops",
  total_uplink: 10_000,
  total_downlink: 20_000,
  cycle_uplink: 1_000,
  cycle_downlink: 2_000,
  servers: [{ server_id: 11, username: "alice+ops", uplink: 1_000, downlink: 2_000, total_uplink: 9_000, total_downlink: 18_000 }],
};

const node = {
  node_id: 42,
  node_name: "香港入口",
  server_name: "Edge Hong Kong",
  node_type: "inbound",
  uplink: 4_000,
  downlink: 8_000,
  last_uplink: 14_000,
  last_downlink: 18_000,
};

function dateDaysAgo(days: number): string {
  return localDateDaysAgo(days);
}

describe("traffic calendar ranges", () => {
  const localMidnight = new Date(2026, 7, 8, 0, 30);

  it("uses the local calendar date around the UTC rollover", () => {
    expect(localDateDaysAgo(0, localMidnight)).toBe("2026-08-08");
    expect(localDateDaysAgo(6, localMidnight)).toBe("2026-08-02");
  });

  it("filters sparse history by date instead of taking the latest item count", () => {
    const sparse = [
      { date: "2026-07-01", used_gb: 1 },
      { date: "2026-08-01", used_gb: 2 },
      { date: "2026-08-02", used_gb: 3 },
      { date: "2026-08-08", used_gb: 4 },
      { date: "2026-08-09", used_gb: 5 },
    ];
    expect(filterTrafficHistoryByRange(sparse, "week", localMidnight)).toEqual([
      { date: "2026-08-02", used_gb: 3 },
      { date: "2026-08-08", used_gb: 4 },
    ]);
  });
});

function mockAdminReads(options: { users?: typeof alice[]; nodes?: typeof node[] } = {}) {
  return vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
    if (path === "/api/traffic/summary") return summary as T;
    if (path === "/api/admin/traffic/users") return { users: options.users ?? [alice] } as T;
    if (path === "/api/admin/traffic/node-totals") return { success: true, items: options.nodes ?? [node] } as T;
    if (path === "/api/admin/traffic/user-connections") return { success: true, connections: { "alice+ops": 3 } } as T;
    throw new Error(`unexpected GET ${path}`);
  });
}

beforeEach(() => {
  vi.mocked(openDashboardSocket).mockImplementation(() => () => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("traffic workbench", () => {
  it("loads the admin summary, user and node aggregates, and live connection contract", async () => {
    const get = mockAdminReads();
    render(<TrafficWorkbenchPage profile={admin} />);

    const row = (await screen.findByText("alice+ops")).closest("tr")!;
    expect(within(row).getByText("3")).toBeInTheDocument();
    expect(within(row).getByText("2.9 KB")).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith("/api/traffic/summary");
    expect(get).toHaveBeenCalledWith("/api/admin/traffic/users");
    expect(get).toHaveBeenCalledWith("/api/admin/traffic/node-totals");
    expect(get).toHaveBeenCalledWith("/api/admin/traffic/user-connections");
    expect(get).not.toHaveBeenCalledWith(expect.stringContaining("user-snapshots"));
    expect(openDashboardSocket).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("tab", { name: /节点汇总/ }));
    expect(screen.getByText("香港入口")).toBeInTheDocument();
  });

  it("keeps admin-only traffic APIs and realtime sockets out of a normal user's view", async () => {
    const get = vi.spyOn(api, "get").mockResolvedValue(summary);
    render(<TrafficWorkbenchPage profile={member} />);

    expect(await screen.findByText("25%")).toBeInTheDocument();
    const progress = screen.getByRole("progressbar", { name: "本期流量使用率" });
    expect(progress).toHaveAttribute("aria-valuenow", "25");
    expect(progress.closest(".traffic-progress")).toHaveAttribute("data-tone", "good");
    expect(screen.queryByRole("tablist", { name: "流量汇总维度" })).not.toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith("/api/traffic/summary");
    expect(openDashboardSocket).not.toHaveBeenCalled();
  });

  it("supports keyboard navigation and roving focus in the admin dimension tabs", async () => {
    mockAdminReads();
    render(<TrafficWorkbenchPage profile={admin} />);

    await screen.findByText("alice+ops");
    const usersTab = screen.getByRole("tab", { name: /用户汇总/ });
    const nodesTab = screen.getByRole("tab", { name: /节点汇总/ });
    expect(usersTab).toHaveAttribute("tabindex", "0");
    expect(nodesTab).toHaveAttribute("tabindex", "-1");
    expect(usersTab).toHaveAttribute("aria-controls", "traffic-admin-panel");

    usersTab.focus();
    fireEvent.keyDown(usersTab, { key: "ArrowRight" });

    expect(nodesTab).toHaveFocus();
    expect(nodesTab).toHaveAttribute("aria-selected", "true");
    expect(nodesTab).toHaveAttribute("tabindex", "0");
    expect(usersTab).toHaveAttribute("tabindex", "-1");
    expect(screen.getByRole("tabpanel", { name: /节点汇总/ })).toHaveAttribute("id", "traffic-admin-panel");

    fireEvent.keyDown(nodesTab, { key: "Home" });
    expect(usersTab).toHaveFocus();
    expect(usersTab).toHaveAttribute("aria-selected", "true");
  });

  it("supports keyboard navigation and panel relationships in the range tabs", async () => {
    const accessibleSummary = { ...summary, history: [{ date: localDateDaysAgo(0), used_gb: 3 }] };
    vi.spyOn(api, "get").mockResolvedValue(accessibleSummary);
    render(<TrafficWorkbenchPage profile={member} />);

    await screen.findByText("25%");
    const cycleTab = screen.getByRole("tab", { name: "本周期" });
    const monthTab = screen.getByRole("tab", { name: "近 30 日" });
    expect(cycleTab).toHaveAttribute("tabindex", "0");
    expect(monthTab).toHaveAttribute("tabindex", "-1");
    expect(cycleTab).toHaveAttribute("aria-controls", "traffic-history-panel");
    expect(screen.getByRole("img", { name: new RegExp(`${localDateDaysAgo(0)} 3 GB`) })).toBeInTheDocument();

    cycleTab.focus();
    fireEvent.keyDown(cycleTab, { key: "ArrowLeft" });

    expect(monthTab).toHaveFocus();
    expect(monthTab).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "近 30 日" })).toHaveAttribute("id", "traffic-history-panel");

    fireEvent.keyDown(monthTab, { key: "Home" });
    expect(cycleTab).toHaveFocus();
    expect(cycleTab).toHaveAttribute("aria-selected", "true");
  });

  it("passes the selected baseline to summaries and both drilldown directions", async () => {
    const baselineDate = dateDaysAgo(6);
    const get = vi.spyOn(api, "get").mockImplementation(async <T,>(path: string): Promise<T> => {
      if (path === "/api/traffic/summary") return summary as T;
      if (path === "/api/admin/traffic/users") return { users: [alice] } as T;
      if (path === "/api/admin/traffic/node-totals") return { items: [node] } as T;
      if (path === `/api/admin/traffic/node-totals?date=${baselineDate}`) return { items: [{ ...node, uplink: 700, downlink: 1_400 }] } as T;
      if (path === "/api/admin/traffic/user-connections") return { connections: { "alice+ops": 3 } } as T;
      if (path === `/api/admin/traffic/user-snapshots?date=${baselineDate}`) return { snapshots: [{ server_id: 11, username: "alice+ops", uplink: 100, downlink: 500 }] } as T;
      if (path === `/api/admin/traffic/user-nodes?username=alice%2Bops&date=${baselineDate}`) return { items: [{ node_id: 42, node_name: "香港入口", server_name: "Edge Hong Kong", uplink: 900, downlink: 1_500, last_uplink: 1_000, last_downlink: 2_000 }] } as T;
      if (path === `/api/admin/traffic/node-users?node_id=42&date=${baselineDate}`) return { items: [{ username: "alice+ops", uplink: 900, downlink: 1_500, last_uplink: 1_000, last_downlink: 2_000 }] } as T;
      throw new Error(`unexpected GET ${path}`);
    });
    render(<TrafficWorkbenchPage profile={admin} />);

    await screen.findByText("alice+ops");
    fireEvent.click(screen.getByRole("tab", { name: "近 7 日" }));
    await waitFor(() => expect(get).toHaveBeenCalledWith(`/api/admin/traffic/node-totals?date=${baselineDate}`));
    expect(get).toHaveBeenCalledWith(`/api/admin/traffic/user-snapshots?date=${baselineDate}`);

    const userRow = screen.getByText("alice+ops").closest("tr")!;
    expect(within(userRow).getByText("900 B")).toBeInTheDocument();
    expect(within(userRow).getByText("1.5 KB")).toBeInTheDocument();
    fireEvent.click(within(userRow).getByRole("button", { name: "查看 alice+ops 节点流量" }));
    expect(await screen.findByRole("dialog", { name: "alice+ops 的节点流量" })).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith(`/api/admin/traffic/user-nodes?username=alice%2Bops&date=${baselineDate}`);

    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    fireEvent.click(screen.getByRole("tab", { name: /节点汇总/ }));
    const nodeRow = screen.getByText("香港入口").closest("tr")!;
    fireEvent.click(within(nodeRow).getByRole("button", { name: "查看 香港入口 用户流量" }));
    expect(await screen.findByRole("dialog", { name: "香港入口 的用户流量" })).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith(`/api/admin/traffic/node-users?node_id=42&date=${baselineDate}`);
  });

  it("applies dashboard websocket updates without another HTTP poll", async () => {
    let push: ((data: unknown) => void) | undefined;
    vi.mocked(openDashboardSocket).mockImplementation((callback) => {
      push = callback;
      return () => undefined;
    });
    mockAdminReads();
    render(<TrafficWorkbenchPage profile={admin} />);
    const initialRow = (await screen.findByText("alice+ops")).closest("tr")!;
    expect(within(initialRow).getByText("3")).toBeInTheDocument();

    act(() => push?.({
      type: "realtime",
      userConnections: { "alice+ops": 9 },
      trafficSummary: { ...summary, metrics: { ...summary.metrics, total_used_gb: 31 } },
    }));

    expect(within(screen.getByText("alice+ops").closest("tr")!).getByText("9")).toBeInTheDocument();
    expect(screen.getByText("31 GB")).toBeInTheDocument();
  });

  it("renders retryable errors and empty admin states", async () => {
    const get = vi.spyOn(api, "get")
      .mockRejectedValueOnce(new Error("统计服务暂不可用"))
      .mockImplementation(async <T,>(path: string): Promise<T> => {
        if (path === "/api/traffic/summary") return summary as T;
        if (path === "/api/admin/traffic/users") return { users: [] } as T;
        if (path === "/api/admin/traffic/node-totals") return { items: [] } as T;
        if (path === "/api/admin/traffic/user-connections") return { connections: {} } as T;
        throw new Error(`unexpected GET ${path}`);
      });
    render(<TrafficWorkbenchPage profile={admin} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("统计服务暂不可用");
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("暂无用户流量")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /节点汇总/ }));
    expect(screen.getByText("暂无节点流量")).toBeInTheDocument();
    expect(get).toHaveBeenCalled();
  });
});
