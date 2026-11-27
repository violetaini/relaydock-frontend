import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { UserBatchDialog, UserManagementPage } from "./user-management";

const alice = { username: "alice", nickname: "Alice", email: "alice@example.com", role: "user", is_active: true, created_at: "2026-11-20T10:00:00Z", traffic_used: 1024, resources: [{ kind: "server", id: 1, name: "香港服务器", source: "manual", state: "authorized" }] };
const listing = { users: [alice], total: 1, page: 1, pages: 1, matching_usernames: ["alice"], counts: { total: 1, active: 1 }, filter_options: { server: [{ id: 1, name: "香港服务器" }, { id: 2, name: "日本服务器" }] } };
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.location.hash = ""; });
function batchOptions() {
 return vi.spyOn(api, "get").mockImplementation(async path => {
  if (path === "/api/admin/nodes") return { nodes: [{ id: 1, node_name: "计费节点", enabled: true, direct_grant_eligible: true }, { id: 2, node_name: "共享节点", enabled: true, direct_grant_eligible: false }] };
  if (path === "/api/admin/remote-servers") return { servers: [{ id: 3, name: "香港服务器" }] };
  if (path === "/api/admin/subscribe-files") return { files: [{ id: 4, name: "用户订阅" }] };
  if (path === "/api/admin/packages") return { packages: [{ id: 5, name: "全球套餐" }] };
  throw new Error(path);
 });
}
describe("ordinary user management", () => {
 it("sends multi-resource, registration, status and sorting filters to the server", async () => {
  const get = vi.spyOn(api, "get").mockResolvedValue(listing);
  render(<UserManagementPage notify={vi.fn()}/>);
  await screen.findByText("Alice"); fireEvent.click(screen.getByRole("button", { name: "筛选" }));
  fireEvent.change(screen.getByLabelText("注册开始日期"), { target: { value: "2026-11-01" } });
  fireEvent.change(screen.getByLabelText("账号状态"), { target: { value: "active" } });
  fireEvent.click(screen.getByLabelText("香港服务器")); fireEvent.click(screen.getByLabelText("日本服务器"));
  fireEvent.change(screen.getByLabelText("用户排序"), { target: { value: "name" } });
  fireEvent.change(screen.getByLabelText("搜索用户"), { target: { value: "Alice" } });
  await waitFor(() => expect(get).toHaveBeenCalledWith(expect.stringMatching(/sort=name.*q=Alice.*status=active.*from=2026-11-01.*server=1%2C2/)));
 });
 it("distinguishes selection of this page from all matching results", async () => {
  vi.spyOn(api, "get").mockResolvedValue({ ...listing, total: 2, pages: 2, matching_usernames: ["alice", "bob"] });
  render(<UserManagementPage notify={vi.fn()}/>);
  fireEvent.click(await screen.findByRole("checkbox", { name: "选择本页用户" }));
  expect(screen.getByRole("button", { name: "批量授权" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "选择全部 2 个结果" }));
  expect(screen.getByText("共 2 位普通用户 · 已选 2 位")).toBeInTheDocument();
 });
 it("loads resource usage without adding overlapping subscriptions to the user total", async () => {
  vi.spyOn(api, "get").mockImplementation(async path => path.startsWith("/api/admin/users/management?") ? listing : {
   user: alice, as_of: "2026-11-26T11:00:00Z", usage_note: "订阅及套餐关联用量不重复累加。", records: [], resources: [
    { kind: "server", id: 1, name: "香港服务器", source: "manual", used: 100, limit: 1000, reset: "每月 1 日重置", state: "authorized", related: false },
    { kind: "subscription", id: 4, name: "用户订阅", source: "manual", used: 100, limit: 0, reset: "跟随关联节点", state: "authorized", related: true, note: "订阅关联用量；共享凭据无法区分具体通过哪份订阅使用" },
   ] });
  render(<UserManagementPage notify={vi.fn()}/>);
  fireEvent.click(await screen.findByRole("button", { name: /Alice.*alice@example/ }));
  const dialog = screen.getByRole("dialog");
  await within(dialog).findByText("1.0 KB");
  fireEvent.click(within(dialog).getByRole("tab", { name: "流量明细" }));
  expect(await within(dialog).findByText(/共享凭据无法区分/)).toBeInTheDocument();
  expect(within(dialog).getAllByRole("progressbar")).toHaveLength(1);
  expect(within(dialog).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "10");
 });
});
describe("user authorization wizard", () => {
 it("previews independent quotas before applying and retries only failed users", async () => {
  batchOptions(); const done = vi.fn();
  const post = vi.spyOn(api, "post").mockResolvedValueOnce({ results: [{ username: "alice", status: "ready" }, { username: "bob", status: "ready" }] }).mockResolvedValueOnce({ results: [{ username: "alice", status: "applied" }, { username: "bob", status: "failed", error: "节点下发失败" }] }).mockResolvedValueOnce({ results: [{ username: "bob", status: "applied" }] });
  render(<UserBatchDialog usernames={["alice", "bob"]} onClose={vi.fn()} onComplete={done}/>);
  fireEvent.click(await screen.findByLabelText("计费节点"));
  expect(screen.queryByLabelText("共享节点")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "下一步" }));
  fireEvent.change(screen.getByLabelText("每用户资源额度"), { target: { value: "100" } });
  expect(post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "预览变更" }));
  await screen.findByRole("button", { name: "确认应用" });
  expect(post).toHaveBeenLastCalledWith("/api/admin/users/management/batch", expect.objectContaining({ preview: true, usernames: ["alice", "bob"], traffic_gb: 100, operation: "append", kind: "node", ids: [1], replace_authorization: false }), expect.anything());
  fireEvent.click(screen.getByRole("button", { name: "确认应用" }));
  fireEvent.click(await screen.findByRole("button", { name: "仅重试失败用户" }));
  await screen.findByText(/2 位已处理，0 位失败/);
  expect(post).toHaveBeenLastCalledWith("/api/admin/users/management/batch", expect.objectContaining({ usernames: ["bob"], preview: false }), expect.anything());
  fireEvent.click(screen.getByRole("button", { name: "完成" })); await waitFor(() => expect(done).toHaveBeenCalledWith([]));
 });
 it("blocks applying conflicting users and allows returning to fix the request", async () => {
  batchOptions(); vi.spyOn(api, "post").mockResolvedValue({ results: [{ username: "alice", status: "failed", error: "该用户使用套餐" }] });
  render(<UserBatchDialog usernames={["alice"]} onClose={vi.fn()} onComplete={vi.fn()}/>);
  fireEvent.click(await screen.findByLabelText("计费节点"));fireEvent.click(screen.getByRole("button", { name: "下一步" }));fireEvent.click(screen.getByRole("button", { name: "预览变更" }));
  expect(await screen.findByRole("button", { name: "确认应用" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "上一步" }));
  expect(screen.getByRole("checkbox", { name: /确认撤销套餐/ })).not.toBeChecked();
 });
 it("does not proceed with incomplete authorization options", async () => {
  vi.spyOn(api, "get").mockRejectedValue(new Error("选项读取失败"));
  render(<UserBatchDialog usernames={["alice"]} onClose={vi.fn()} onComplete={vi.fn()}/>);
  expect(await screen.findByRole("alert")).toHaveTextContent("选项读取失败");
  expect(screen.getByRole("button", { name: "下一步" })).toBeDisabled();
 });
});
