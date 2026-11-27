import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const qr = vi.hoisted(() => vi.fn());
vi.mock("qrcode", () => ({ default: { toDataURL: qr } }));
import { SubscriptionDeliveryDialog } from "./subscription-delivery";
afterEach(() => { cleanup(); qr.mockReset(); });

it("generates the QR and client import from the same selected recipient URL", async () => {
  qr.mockResolvedValue("data:image/png;base64,LOCAL_QR");
  render(<SubscriptionDeliveryDialog file={{ id: 1, name: "我的线路", filename: "mine.yaml", type: "create", auto_sync_custom_rules: false }} link={client => `https://panel.example/x/fileuser?t=${client}`} onClose={vi.fn()} onCopy={vi.fn()} />);
  expect(screen.getByRole("link", { name: "导入客户端" }).getAttribute("href")).toContain(encodeURIComponent("https://panel.example/x/fileuser?t=clashmeta"));
  fireEvent.change(screen.getByRole("combobox", { name: "客户端" }), { target: { value: "sing-box" } });
  fireEvent.click(screen.getByRole("button", { name: "二维码" }));
  expect(await screen.findByAltText("我的线路 订阅二维码")).toHaveAttribute("src", "data:image/png;base64,LOCAL_QR");
  expect(qr).toHaveBeenCalledWith("https://panel.example/x/fileuser?t=sing-box", expect.objectContaining({ width: 320, margin: 2 }));
  expect(screen.getByRole("link", { name: "导入客户端" }).getAttribute("href")).toContain("sing-box://");
  fireEvent.change(screen.getByRole("combobox", { name: "客户端" }), { target: { value: "v2ray" } });
  expect(screen.queryByRole("link", { name: "导入客户端" })).not.toBeInTheDocument();
  expect(screen.queryByAltText("我的线路 订阅二维码")).not.toBeInTheDocument();
});
