import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialog, Dialog } from "./ui";

vi.hoisted(() => {
  (globalThis as unknown as { process: { env: { NODE_ENV?: string } } }).process.env.NODE_ENV = "test";
});

afterEach(() => cleanup());

function DialogHarness({ onClose = vi.fn() }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>打开设置</button>
      {open ? (
        <Dialog title="编辑设置" description="修改当前配置" onClose={() => { onClose(); setOpen(false); }}>
          <label>名称<input /></label>
          <button type="button">保存设置</button>
        </Dialog>
      ) : null}
    </>
  );
}

describe("Dialog accessibility", () => {
  it("closes with Escape and restores focus to the opener", async () => {
    const onClose = vi.fn();
    render(<DialogHarness onClose={onClose} />);
    const opener = screen.getByRole("button", { name: "打开设置" });
    opener.focus();
    fireEvent.click(opener);

    await waitFor(() => expect(screen.getByRole("dialog", { name: "编辑设置" }).contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog", { name: "编辑设置" })).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("keeps keyboard focus inside the active dialog", async () => {
    render(<DialogHarness />);
    fireEvent.click(screen.getByRole("button", { name: "打开设置" }));
    const dialog = screen.getByRole("dialog", { name: "编辑设置" });
    const close = screen.getByRole("button", { name: "关闭" });
    const save = screen.getByRole("button", { name: "保存设置" });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));

    save.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(close).toHaveFocus();

    close.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(save).toHaveFocus();
  });

  it("uses unique accessible label and description ids", () => {
    const { unmount } = render(
      <>
        <Dialog title="第一项" description="第一项说明" onClose={vi.fn()}>内容</Dialog>
        <Dialog title="第二项" description="第二项说明" onClose={vi.fn()}>内容</Dialog>
      </>,
    );

    const dialogs = screen.getAllByRole("dialog");
    expect(dialogs[0].getAttribute("aria-labelledby")).not.toBe(dialogs[1].getAttribute("aria-labelledby"));
    expect(dialogs[0].getAttribute("aria-describedby")).not.toBe(dialogs[1].getAttribute("aria-describedby"));
    expect(dialogs[0]).toHaveAccessibleName("第一项");
    expect(dialogs[1]).toHaveAccessibleName("第二项");
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("");
  });

  it("announces the concrete risk and cannot be dismissed while working", () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog title="删除节点" description="节点与远端凭据将被永久删除" confirmLabel="确认删除" working onCancel={onCancel} onConfirm={vi.fn()} />);

    const dialog = screen.getByRole("dialog", { name: "删除节点" });
    expect(dialog).toHaveAccessibleDescription("节点与远端凭据将被永久删除");
    expect(screen.queryByRole("button", { name: "关闭" })).not.toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "取消" })).toBeDisabled();
  });
});
