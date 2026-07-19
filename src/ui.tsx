import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { AlertCircle, CheckCircle2, LoaderCircle, TriangleAlert, X } from "lucide-react";

export function Button({ className = "", variant = "primary", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" | "ghost" }) {
  return <button className={`button button-${variant} ${className}`} {...props} />;
}

export function IconButton({ label, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <button className={`icon-button ${className}`} aria-label={label} title={label} {...props} />;
}

export function Badge({ tone = "neutral", children }: { tone?: "good" | "warn" | "bad" | "info" | "neutral"; children: ReactNode }) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Spinner({ label = "正在加载" }: { label?: string }) {
  return <span className="spinner" role="status"><LoaderCircle size={16} />{label}</span>;
}

export function EmptyState({ icon, title, description, action }: { icon: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <span className="empty-icon">{icon}</span>
      <strong>{title}</strong>
      {description ? <p>{description}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-state" role="alert">
      <AlertCircle size={19} />
      <span>{message}</span>
      {onRetry ? <Button variant="secondary" onClick={onRetry}>重试</Button> : null}
    </div>
  );
}

export function Dialog({ title, description, children, onClose, wide = false, dismissible = true }: { title: string; description?: string; children: ReactNode; onClose: () => void; wide?: boolean; dismissible?: boolean }) {
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => dismissible && event.target === event.currentTarget && onClose()}>
      <section className={`dialog ${wide ? "dialog-wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <header className="dialog-header">
          <div>
            <h2 id="dialog-title">{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          {dismissible ? <IconButton label="关闭" onClick={onClose}><X size={19} /></IconButton> : null}
        </header>
        <div className="dialog-body">{children}</div>
      </section>
    </div>
  );
}

export function ConfirmDialog({ title, description, confirmLabel, tone = "danger", working = false, onCancel, onConfirm }: {
  title: string;
  description: string;
  confirmLabel: string;
  tone?: "danger" | "primary";
  working?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog title={title} description="请确认操作影响" onClose={onCancel}>
      <div className="confirm-content">
        <span className="confirm-icon"><TriangleAlert size={22} /></span>
        <p>{description}</p>
      </div>
      <div className="dialog-actions">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={working}>取消</Button>
        <Button type="button" variant={tone} onClick={onConfirm} disabled={working}>
          {working ? <Spinner label="正在处理" /> : confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}

export function Toast({ message, tone, onClose }: { message: string; tone: "success" | "error"; onClose: () => void }) {
  return (
    <div className={`toast toast-${tone}`} role="status">
      {tone === "success" ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
      <span>{message}</span>
      <IconButton label="关闭提示" onClick={onClose}><X size={16} /></IconButton>
    </div>
  );
}

export function Field({ label, hint, children, className = "" }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={`field ${className}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

export function Toggle({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: (checked: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <label className="toggle-row">
      <button type="button" className={`toggle ${checked ? "is-on" : ""}`} role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)}>
        <span />
      </button>
      <span>{label}</span>
    </label>
  );
}

export function PageHeader({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}

export function Surface({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`surface ${className}`} {...props} />;
}

export function formatBytes(value: number | null | undefined, speed = false): string {
  const bytes = Number(value ?? 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return speed ? "0 B/s" : "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const amount = bytes / 1024 ** index;
  return `${amount >= 100 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}${speed ? "/s" : ""}`;
}

export function relativeTime(value?: string): string {
  if (!value) return "暂无上报";
  const elapsed = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(elapsed)) return "时间未知";
  const seconds = Math.max(0, Math.floor(elapsed / 1000));
  if (seconds < 60) return `${seconds} 秒前`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`;
  return `${Math.floor(seconds / 86400)} 天前`;
}

export function statusTone(status: string): "good" | "warn" | "bad" | "neutral" {
  const value = status.toLowerCase();
  if (["online", "active", "connected", "running"].includes(value)) return "good";
  if (["pending", "connecting", "warning"].includes(value)) return "warn";
  if (["offline", "disabled", "failed", "error"].includes(value)) return "bad";
  return "neutral";
}
