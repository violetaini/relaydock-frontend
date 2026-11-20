export interface ForwardingViewNode {
  id: number;
  protocol: string;
  node_type?: string;
  inbound_tag?: string;
  forward_node_id?: number | null;
}

export function isForwardingEntry(node: ForwardingViewNode | undefined): boolean {
  if (!node || node.node_type === "routed") return false;
  return node.node_type === "forwarded" || (node.inbound_tag || "").trim().toLowerCase().startsWith("anydoor-") || ["dokodemo-door", "tunnel", "anydoor"].includes(node.protocol.trim().toLowerCase());
}

export function forwardingTargetID(node: ForwardingViewNode): number | undefined {
  const id = node.forward_node_id;
  return isForwardingEntry(node) && Number.isSafeInteger(id) && Number(id) > 0 && id !== node.id ? Number(id) : undefined;
}

// Only group nodes already in the filtered scope. Missing parents and cycles
// cannot hide rows or pull unrelated nodes into a filtered result.
export function forwardingRows<T extends ForwardingViewNode>(nodes: T[]): Array<{ node: T; depth: number }> {
  const ids = new Set(nodes.map(n => n.id)), children = new Map<number, T[]>(), result: Array<{ node: T; depth: number }> = [], seen = new Set<number>();
  for (const node of nodes) { const target = forwardingTargetID(node); if (target && ids.has(target)) children.set(target, [...(children.get(target) || []), node]); }
  const visit = (node: T, depth: number) => { if (seen.has(node.id)) return; seen.add(node.id); result.push({ node, depth }); for (const child of children.get(node.id) || []) visit(child, depth + 1); };
  for (const node of nodes) { const target = forwardingTargetID(node); if (!target || !ids.has(target)) visit(node, 0); }
  for (const node of nodes) visit(node, 0);
  return result;
}

export function forwardingOrderGroups<T extends ForwardingViewNode>(nodes: T[]): T[][] {
  const groups: T[][] = [];
  for (const row of forwardingRows(nodes)) { if (!row.depth) groups.push([]); groups[groups.length - 1].push(row.node); }
  return groups;
}
