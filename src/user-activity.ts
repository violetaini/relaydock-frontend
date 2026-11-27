export type UserActivityRecord = { actor: string; action: string; kind: string; at: string };
export type UserActivity = UserActivityRecord & { title: string; description: string; operator: string; automatic: boolean; count: number };

const resourceNames: Record<string, string> = {
 node: "节点", server: "服务器", subscription: "订阅", package: "套餐", user: "账号",
 server_grant: "服务器授权", tunnel_grant: "转发授权", node_grant: "节点授权",
 node_selection: "自选节点", access_source: "节点访问权限",
};
const systemActors: Record<string, string> = {
 package: "套餐自动同步", reconciler: "系统自动检查", "user-status": "账号状态同步",
};
const actions: Record<string, [string, string]> = {
 "grant.created": ["新增服务器授权", "已为用户分配服务器访问权限。"],
 "grant.updated": ["调整服务器授权", "已更新服务器授权设置。"],
 "grant.deleted": ["撤销服务器授权", "已移除服务器访问权限。"],
 "grant.materialized": ["同步套餐授权", "系统按套餐配置同步{resource}。"],
 "grant.adopted_from_package": ["转为独立服务器授权", "原套餐内的服务器授权已改为独立管理。"],
 "grant.usage_reset": ["重置服务器用量", "已重置该服务器授权的周期流量统计。"],
 "node_grant.activated": ["启用节点授权", "已启用用户的节点访问权限。"],
 "node_grant.active": ["启用节点授权", "已启用用户的节点访问权限。"],
 "node_grant.inactive": ["暂停节点授权", "已暂停用户的节点访问权限。"],
 "node_grant.deleted": ["撤销节点授权", "已移除用户的节点访问权限。"],
 "node_grant.provenance_revoked": ["撤销失效的节点授权", "节点配置已变更，原授权已撤销。"],
 "selection.activated": ["启用自选节点", "已启用用户选择的节点。"],
 "selection.deactivated": ["停用自选节点", "已停用用户选择的节点。"],
 "selection.limits_updated": ["调整节点限额", "已更新自选节点的使用限额。"],
 "access_source.desired_changed": ["更新节点访问权限", "已更新节点访问权限设置。"],
 "package_credential.cleanup_prepared": ["清理旧套餐凭据", "已准备清理不再使用的套餐节点凭据。"],
 "user.disabled": ["停用账号", "账号已停用，相关访问权限已暂停。"],
 "user.deletion_prepared": ["准备删除账号", "已开始清理账号的访问权限。"],
 "user.deleted": ["删除账号", "账号及关联授权已删除。"],
};
const generalActions: Record<string, string> = {
 batch_append: "追加", batch_revoke: "撤销", create: "新增", update: "调整", delete: "撤销", activate: "启用", deactivate: "停用",
};

export function presentUserActivity(records: UserActivityRecord[]): UserActivity[] {
 const result: UserActivity[] = [];
 for (const record of records) {
  const automatic = (record.actor === "package" && record.action === "grant.materialized")
   || (record.actor === "reconciler" && record.action === "access_source.desired_changed")
   || (record.actor === "user-status" && record.action === "user.disabled");
  const resource = Object.hasOwn(resourceNames, record.kind) ? resourceNames[record.kind] : "授权资源";
  const known = Object.hasOwn(actions, record.action) ? actions[record.action] : undefined;
  const verb = Object.hasOwn(generalActions, record.action) ? generalActions[record.action] : undefined;
  const title = known?.[0] || (verb ? `${verb}${resource}${["node", "server", "subscription", "package"].includes(record.kind) ? "授权" : ""}` : "授权信息变更");
  const description = known?.[1].replace("{resource}", resource) || (verb ? `已${verb}用户的${resource}授权。` : "历史记录未保存具体的变更说明。");
  const time = Date.parse(record.at);
  const previous = result.at(-1);
  // Only collapse adjacent system events in the same second. Manual changes
  // always remain separate, and counts refer to records, not distinct resources.
  if (automatic && previous?.automatic && previous.actor === record.actor && previous.action === record.action && previous.kind === record.kind && Number.isFinite(time) && Math.floor(time / 1000) === Math.floor(Date.parse(previous.at) / 1000)) {
   previous.count++;
  } else {
   result.push({ ...record, title, description, automatic, count: 1, operator: automatic ? systemActors[record.actor] : record.actor ? `操作人：${record.actor}` : "操作人未记录" });
  }
 }
 return result;
}
