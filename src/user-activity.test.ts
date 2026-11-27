import { describe, expect, it } from "vitest";
import { presentUserActivity, type UserActivityRecord } from "./user-activity";

const record: UserActivityRecord = { actor: "package", action: "grant.materialized", kind: "server_grant", at: "2026-11-27T05:55:35Z" };
describe("readable user authorization history", () => {
 it("explains package synchronization and collapses its adjacent entries without claiming distinct resources", () => {
  const activity = presentUserActivity([record, { ...record, at: "2026-11-27T05:55:35.900Z" }, record]);
  expect(activity).toHaveLength(1);
  expect(activity[0]).toMatchObject({ title: "同步套餐授权", description: "系统按套餐配置同步服务器授权。", operator: "套餐自动同步", automatic: true, count: 3 });
 });
 it("keeps manual changes separate even when actor, type and timestamp match", () => {
  const manual = { ...record, actor: "admin", action: "batch_append", kind: "node" };
  expect(presentUserActivity([manual, manual])).toHaveLength(2);
  expect(presentUserActivity([manual])[0]).toMatchObject({ title: "追加节点授权", operator: "操作人：admin", automatic: false });
  expect(presentUserActivity([{...manual,actor:"package"},{...manual,actor:"package"}])).toHaveLength(2);
 });
 it("does not merge separate seconds, resource kinds or events across manual changes", () => {
  expect(presentUserActivity([record, { ...record, at: "2026-11-27T05:55:36Z" }, { ...record, kind: "tunnel_grant" }, { ...record, actor: "admin" }, record])).toHaveLength(5);
 });
 it("does not group invalid timestamps", () => {
  expect(presentUserActivity([{ ...record, at: "invalid" }, { ...record, at: "invalid" }])).toHaveLength(2);
 });
 it("uses a readable fallback for unknown historical action and entity codes", () => {
  const [item] = presentUserActivity([{ ...record, actor: "", action: "future.internal_action", kind: "unknown_resource" }]);
  expect(item).toMatchObject({ title: "授权信息变更", description: "历史记录未保存具体的变更说明。", operator: "操作人未记录" });
  expect(item.title + item.description).not.toMatch(/future|unknown_resource/);
 });
 it.each([
  ["grant.usage_reset", "重置服务器用量"], ["selection.limits_updated", "调整节点限额"],
  ["node_grant.provenance_revoked", "撤销失效的节点授权"], ["user.disabled", "停用账号"],
  ["node_grant.active", "启用节点授权"],
 ])("describes %s", (action, title) => {
  expect(presentUserActivity([{ ...record, action }])[0].title).toBe(title);
 });
});
