import { describe, expect, it } from "vitest";
import { forwardingOrderGroups, forwardingRows, isForwardingEntry } from "./node-forwarding-view";
const target = { id: 1, protocol: "shadowsocks" };
const entry = { id: 2, protocol: "shadowsocks", node_type: "forwarded", inbound_tag: "custom-entry", forward_node_id: 1 };
describe("forwarding node presentation", () => {
  it("groups verified forwarding entries after their target regardless of arrival order", () => {
    expect(isForwardingEntry(entry)).toBe(true);
    expect(forwardingRows([entry, target]).map(r => [r.node.id, r.depth])).toEqual([[1, 0], [2, 1]]);
    expect(forwardingOrderGroups([entry, target]).map(g => g.map(n => n.id))).toEqual([[1, 2]]);
  });
  it("does not infer target relationships from names or arbitrary tags", () => {
    const unbound = { ...entry, forward_node_id: undefined, inbound_tag: "anydoor-node-1" };
    expect(forwardingRows([unbound, target]).map(r => r.depth)).toEqual([0, 0]);
  });
  it("keeps filtered or missing-parent entries visible and breaks cycles", () => {
    expect(forwardingRows([entry]).map(r => [r.node.id, r.depth])).toEqual([[2, 0]]);
    const cycle = { ...entry, id: 1, forward_node_id: 2 };
    expect(forwardingRows([entry, cycle]).map(r => r.node.id)).toEqual([2, 1]);
  });
});
