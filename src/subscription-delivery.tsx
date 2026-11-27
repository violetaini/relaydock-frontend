import { useState } from "react";
import QRCode from "qrcode";
import { Copy, Download, Eye, EyeOff, QrCode } from "lucide-react";
import type { SubscribeFile } from "./content-workbench";
import { Button, Dialog, ErrorState, Field } from "./ui";

export function subscriptionClientIDs(file: SubscribeFile): string[] {
  return file.generation?.outputs?.length ? file.generation.outputs.map(out => out.client) : file.available_clients || [];
}

export function subscriptionDeliveryURL(file: SubscribeFile, token: string, userCode: string, client?: string): string {
  if (!token) return "";
  const code = file.custom_short_code || file.file_short_code;
  const url = code && userCode ? new URL(`/x/${encodeURIComponent(code + userCode)}`, location.origin) : new URL("/api/clash/subscribe", location.origin);
  if (!code || !userCode) { url.searchParams.set("filename", file.filename); url.searchParams.set("token", token); }
  if (client) url.searchParams.set("t", client);
  return url.toString();
}

const platforms = [
  { id: "clashmeta", name: "Clash / Mihomo", deep: (url: string, name: string) => `clash://install-config?url=${encodeURIComponent(url)}&name=${encodeURIComponent(name)}` },
  { id: "clash-to-shadowrocket", name: "Shadowrocket 小火箭", deep: (url: string, name: string) => `shadowrocket://add/sub://${btoa(url)}?title=${encodeURIComponent(name)}` },
  { id: "sing-box", name: "sing-box", deep: (url: string, name: string) => `sing-box://import-remote-profile?url=${encodeURIComponent(url)}#${encodeURIComponent(name)}` },
  { id: "clash-to-surge", name: "Surge", deep: (url: string) => `surge:///install-config?url=${encodeURIComponent(url)}` },
  { id: "clash-to-loon", name: "Loon", deep: (url: string, name: string) => `loon://import?n=${encodeURIComponent(name)}&url=${encodeURIComponent(url)}` },
  { id: "qx", name: "Quantumult X", deep: (url: string, name: string) => `quantumult-x:///add-resource?remote-resource=${encodeURIComponent(JSON.stringify({ server_remote: [`${url}, tag=${name}`] }))}` },
  { id: "stash", name: "Stash", deep: (url: string, name: string) => `stash://install-config?url=${encodeURIComponent(url)}&name=${encodeURIComponent(name)}` },
  { id: "v2ray", name: "v2rayN / v2rayNG", deep: undefined },
  { id: "uri", name: "通用 URI", deep: undefined },
];

export function SubscriptionDeliveryDialog({ file, link, onClose, onCopy, onDownloadRoutes }: { file: SubscribeFile; link: (client?: string) => string; onClose: () => void; onCopy: () => void; onDownloadRoutes?: () => void }) {
  const ids = subscriptionClientIDs(file);
  const options = ids.length ? ids.map(id => platforms.find(p => p.id === id) || { id, name: id === "shadowrocket" ? "小火箭 · 仅节点" : id, deep: undefined }) : platforms;
  const [client, setClient] = useState(options[0].id);
  const [visible, setVisible] = useState(false);
  const [qr, setQR] = useState<{ url: string; image: string } | null>(null);
  const [error, setError] = useState("");
  const selected = options.find(p => p.id === client) || options[0];
  const url = link(selected.id);
  const importURL = selected.deep?.(url, file.name);
  return <Dialog title={`${file.name} · 订阅链接`} description="链接使用当前账号的身份和授权，订阅更新后继续使用原链接。" onClose={onClose}>
    <div className="sm-delivery-panel">
      {error && <ErrorState message={error} />}
      <Field label="客户端"><select value={client} onChange={e => { setClient(e.target.value); setError(""); }}>{options.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
      <Field label="订阅地址"><input readOnly type={visible ? "text" : "password"} value={url} /></Field>
      <div className="sm-delivery-actions">
        <Button disabled={!url} onClick={() => { setError(""); void navigator.clipboard.writeText(url).then(onCopy).catch(() => setError("复制失败，请显示链接后手动复制")); }}><Copy size={16} />复制链接</Button>
        <Button variant="secondary" disabled={!url} onClick={() => { setError(""); void QRCode.toDataURL(url, { width: 320, margin: 2, errorCorrectionLevel: "M" }).then(image => setQR({ url, image })).catch(() => setError("二维码生成失败，请重试")); }}><QrCode size={16} />二维码</Button>
        {importURL && url && <a className="button button-secondary" href={importURL}><Download size={16} />导入客户端</a>}
        <Button variant="ghost" onClick={() => setVisible(value => !value)}>{visible ? <EyeOff size={16} /> : <Eye size={16} />}{visible ? "隐藏链接" : "显示链接"}</Button>
      </div>
      {qr?.url === url && <div className="sm-delivery-qr"><img src={qr.image} alt={`${file.name} 订阅二维码`} width={320} height={320} /><a className="button button-secondary" download="subscription-qr.png" href={qr.image}>下载二维码</a></div>}
      {onDownloadRoutes && client === "v2ray" && <Button variant="secondary" onClick={onDownloadRoutes}>导出 Xray 路由 JSON</Button>}
    </div>
  </Dialog>;
}
