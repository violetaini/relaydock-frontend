import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { api } from "./api";
import { SubscriptionWizard } from "./subscription-workbench";
import type { SubscribeFile } from "./content-workbench";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const files: SubscribeFile[] = [
  { id: 1, name: "外部机场", filename: "airport.yaml", type: "import", auto_sync_custom_rules: false },
  { id: 2, name: "自建专线", filename: "custom.yaml", type: "create", auto_sync_custom_rules: false, selected_node_ids: [7] },
];
const props = { files, nodes: [{ id: 7, node_name: "HKT 03", protocol: "ss", clash_config: "{}", enabled: true }], templates: ["__relaydock_balanced__", "custom.yaml"], onClose: vi.fn(), onSaved: vi.fn() };
const preview = { input: 4, duplicate: 1, filtered: 0, dead: 0, unknown: 4, output: 3, warnings: [], content: "proxies: []", client: "clashmeta" };
function advanceToOutputs() { fireEvent.click(screen.getByRole("button", { name: "下一步" })); fireEvent.click(screen.getByRole("button", { name: "下一步" })); }

describe("unified subscription wizard", () => {
  it("edits rules without forcing a legacy subscription to replace its saved nodes", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue(preview);
    const file = { ...files[1], name: "旧订阅" };
    const nodes = [{ ...props.nodes[0], subscription_eligible: false, subscription_ineligible_reason: "无法按用户统计" }];
    render(<SubscriptionWizard {...props} nodes={nodes} kind="custom" file={file} />);
    expect(screen.getByRole("checkbox", { name: "选择节点 HKT 03" })).toBeChecked();
    expect(screen.getByRole("button", { name: "下一步" })).toBeEnabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "选择节点 HKT 03" }));
    expect(screen.getByRole("checkbox", { name: "选择节点 HKT 03" })).toBeEnabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "选择节点 HKT 03" }));
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    fireEvent.click(screen.getByRole("tab", { name: "自定义规则" }));
    fireEvent.click(screen.getByRole("button", { name: "生成预览" }));
    await screen.findByText("预览已生成");
    fireEvent.click(screen.getByRole("button", { name: "保存订阅" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/subscribe-files/generation", expect.objectContaining({ id: file.id, selected_node_ids: [7], generation: expect.objectContaining({ outputs: [expect.objectContaining({ rule_mode: "custom" })] }) })));
  });

  it("allows a single external source to preserve its upstream rules", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue(preview);
    render(<SubscriptionWizard {...props} kind="strategy" sourceIDs={[1]} />);
    advanceToOutputs();
    expect(screen.getByRole("option", { name: "保留上游规则" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "规则配置" }), { target: { value: "source" } });
    fireEvent.click(screen.getByRole("button", { name: "生成预览" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/subscribe-files/generation/preview", expect.objectContaining({ generation: expect.objectContaining({ source_ids: [1], outputs: [expect.objectContaining({ mode: "source" })] }) })));
  });

  it("does not offer ambiguous upstream-rule inheritance for multiple sources", () => {
    render(<SubscriptionWizard {...props} kind="strategy" sourceIDs={[1, 2]} />);
    advanceToOutputs();
    expect(screen.queryByRole("option", { name: "保留上游规则" })).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /^规则模板/ })).toHaveValue("__relaydock_balanced__");
  });

  it("clearly separates the V2Ray URI output from rule templates", () => {
    render(<SubscriptionWizard {...props} kind="strategy" sourceIDs={[2]} />);
    advanceToOutputs();
    fireEvent.change(screen.getByRole("combobox", { name: "输出客户端" }), { target: { value: "v2ray" } });
    expect(screen.getByRole("combobox", { name: "规则配置" })).toHaveValue("nodes");
    expect(screen.queryByRole("combobox", { name: /^规则模板/ })).not.toBeInTheDocument();
    expect(screen.getByText(/普通 URI.*仅携带节点/)).toBeInTheDocument();
  });

  it("saves different templates for independent client outputs", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue(preview);
    render(<SubscriptionWizard {...props} kind="strategy" sourceIDs={[1, 2]} />);
    advanceToOutputs();
    fireEvent.click(screen.getByRole("button", { name: "添加其他客户端输出" }));
    fireEvent.change(screen.getByRole("combobox", { name: /^规则模板 2/ }), { target: { value: "custom.yaml" } });
    fireEvent.click(screen.getByRole("button", { name: "生成预览" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/subscribe-files/generation/preview", expect.objectContaining({ generation: expect.objectContaining({ outputs: [expect.objectContaining({ client: "clashmeta", template_filename: "__relaydock_balanced__" }), expect.objectContaining({ client: "clash-to-shadowrocket", template_filename: "custom.yaml" })] }) })));
  });

  it("never saves after a template preview fails", async () => {
    const post = vi.spyOn(api, "post").mockRejectedValue(new Error("模板包含该客户端不支持的规则"));
    render(<SubscriptionWizard {...props} kind="strategy" sourceIDs={[1]} />);
    advanceToOutputs(); fireEvent.click(screen.getByRole("button", { name: "生成预览" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("不支持的规则");
    expect(screen.queryByRole("button", { name: "保存订阅" })).not.toBeInTheDocument();
    expect(post.mock.calls.every(([path]) => path.endsWith("preview"))).toBe(true);
  });

  it("locks the form and dialog while a preview is in flight", async () => {
    let finish!: (value: typeof preview) => void;
    vi.spyOn(api, "post").mockImplementation(<T,>() => new Promise<T>(resolve => { finish = resolve as typeof finish; }));
    const close = vi.fn();
    render(<SubscriptionWizard {...props} kind="strategy" sourceIDs={[1]} onClose={close} />);
    advanceToOutputs(); fireEvent.click(screen.getByRole("button", { name: "生成预览" }));
    expect(screen.getByRole("combobox", { name: "输出客户端" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "关闭" })).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" }); expect(close).not.toHaveBeenCalled();
    finish(preview); await screen.findByText("预览已生成");
  });

  it("starts custom subscriptions with an explicit empty selection and prevents exporting every node accidentally", () => {
    render(<SubscriptionWizard {...props} kind="custom" />);
    expect(screen.getByRole("button", { name: "下一步" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "选择可用节点" }));
    expect(screen.getByRole("checkbox", { name: "选择节点 HKT 03" })).toBeChecked();
    expect(screen.getByRole("button", { name: "下一步" })).not.toBeDisabled();
  });

  it("shows a saved existing recipe without flattening its sources to node IDs", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue(preview);
    const file: SubscribeFile = { id: 4, name: "现有策略", filename: "combined.yaml", type: "create", auto_sync_custom_rules: false, generation: { kind: "strategy", source_ids: [1, 2], processing: { deduplicate: true, remove_dead: true }, outputs: [{ client: "clashmeta", mode: "full", template_filename: "custom.yaml" }] } };
    render(<SubscriptionWizard {...props} kind="strategy" file={file} />);
    expect(screen.getByRole("checkbox", { name: "绑定来源 外部机场" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "绑定来源 自建专线" })).toBeChecked();
    advanceToOutputs(); fireEvent.click(screen.getByRole("button", { name: "生成预览" }));
    await screen.findByText("预览已生成"); fireEvent.click(screen.getByRole("button", { name: "保存订阅" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/subscribe-files/generation", expect.objectContaining({ id: 4, selected_node_ids: [], generation: expect.objectContaining({ source_ids: [1, 2] }) })));
  });

  it("lets the user inspect every validated client output in the preview", async () => {
    vi.spyOn(api, "post").mockResolvedValue({ ...preview, outputs: [preview, { ...preview, client: "v2ray", content: "uri-output", output: 2 }] });
    render(<SubscriptionWizard {...props} kind="strategy" sourceIDs={[1]} />);
    advanceToOutputs(); fireEvent.click(screen.getByRole("button", { name: "生成预览" }));
    await screen.findByText("预览已生成"); fireEvent.click(screen.getByRole("button", { name: "查看生成配置" }));
    fireEvent.change(screen.getByRole("combobox", { name: "预览客户端" }), { target: { value: "1" } });
    expect(screen.getByText("uri-output")).toBeInTheDocument();
  });
  it("saves custom categories with the subscription rather than a generated snapshot", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue(preview);
    render(<SubscriptionWizard {...props} kind="custom" />);
    fireEvent.click(screen.getByRole("checkbox", { name: "选择节点 HKT 03" }));
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    fireEvent.click(screen.getByRole("tab", { name: "自定义规则" }));
    expect(screen.getByRole("button", { name: "广告拦截" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "油管视频" }));
    fireEvent.click(screen.getByRole("button", { name: "Github" }));
    fireEvent.click(screen.getByRole("button", { name: "生成预览" }));
    await screen.findByText("预览已生成");
    fireEvent.change(screen.getByRole("textbox", { name: "订阅名称" }), { target: { value: "自定义分类" } });
    fireEvent.click(screen.getByRole("button", { name: "保存订阅" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/subscribe-files/generation", expect.objectContaining({ generation: expect.objectContaining({ outputs: [expect.objectContaining({ rule_mode: "custom", rule_categories: ["ads", "ai", "google", "private", "cn", "telegram", "github"] })] }) })));
  });

  it("restores custom categories when editing and retains them across template mode", () => {
    const file = { ...files[1], generation: { kind: "custom" as const, source_ids: [], processing: { deduplicate: true, remove_dead: false }, outputs: [{ client: "clashmeta", mode: "full" as const, rule_mode: "custom" as const, rule_categories: ["github"] }] } };
    render(<SubscriptionWizard {...props} kind="custom" file={file} />);
    fireEvent.click(screen.getByRole("button", { name: "下一步" }));
    expect(screen.getByRole("button", { name: "Github" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "广告拦截" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("tab", { name: "使用模板" }));
    expect(screen.getByRole("combobox", { name: /^规则模板/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "自定义规则" }));
    expect(screen.getByRole("button", { name: "Github" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "广告拦截" })).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps an explicitly empty custom selection instead of reapplying defaults", async () => {
    const post = vi.spyOn(api, "post").mockResolvedValue(preview);
    render(<SubscriptionWizard {...props} kind="strategy" sourceIDs={[2]} />);
    advanceToOutputs();
    fireEvent.click(screen.getByRole("tab", { name: "自定义规则" }));
    fireEvent.click(screen.getByRole("button", { name: "清空分类" }));
    fireEvent.click(screen.getByRole("tab", { name: "使用模板" }));
    fireEvent.click(screen.getByRole("tab", { name: "自定义规则" }));
    fireEvent.click(screen.getByRole("button", { name: "生成预览" }));
    await waitFor(() => expect(post).toHaveBeenCalledWith("/api/admin/subscribe-files/generation/preview", expect.objectContaining({ generation: expect.objectContaining({ outputs: [expect.objectContaining({ rule_mode: "custom", rule_categories: [] })] }) })));
  });

});
