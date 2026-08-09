import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Copy, KeyRound, ShieldCheck, ShieldOff } from "lucide-react";
import QRCode from "qrcode";
import { api } from "./api";
import { Badge, Button, Dialog, ErrorState, Field, Spinner, Surface } from "./ui";
import "./two-factor.css";

type Notify = (message: string, tone?: "success" | "error") => void;

interface ApiEnvelope {
  success?: boolean;
  error?: string;
  message?: string;
}

interface TwoFactorStatusResponse extends ApiEnvelope {
  enabled?: boolean;
}

interface TwoFactorSetupResponse extends ApiEnvelope {
  secret?: string;
  url?: string;
}

interface TwoFactorVerifyResponse extends ApiEnvelope {
  recovery_codes?: string[];
}

interface TwoFactorDisableResponse extends ApiEnvelope {
  status?: string;
}

function assertSuccessful<T extends ApiEnvelope>(response: T | null | undefined, fallback: string): T {
  if (!response || response.success === false) {
    throw new Error(response?.error || response?.message || fallback);
  }
  return response;
}

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}

export function TwoFactorSettings({ notify }: { notify: Notify }) {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [statusError, setStatusError] = useState("");
  const [setupStep, setSetupStep] = useState<"password" | "verify" | "recovery" | null>(null);
  const [password, setPassword] = useState("");
  const [setupData, setSetupData] = useState<{ secret: string; url: string } | null>(null);
  const [setupQRCode, setSetupQRCode] = useState("");
  const [setupQRCodeError, setSetupQRCodeError] = useState(false);
  const [setupCode, setSetupCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [recoveryAcknowledged, setRecoveryAcknowledged] = useState(false);
  const [recoveryCopyFailed, setRecoveryCopyFailed] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const [disableCode, setDisableCode] = useState("");
  const [working, setWorking] = useState(false);
  const [dialogError, setDialogError] = useState("");

  const refreshStatus = useCallback(async () => {
    setLoading(true);
    setStatusError("");
    try {
      const response = assertSuccessful(
        await api.get<TwoFactorStatusResponse>("/api/user/2fa/status"),
        "双因素认证状态加载失败",
      );
      if (typeof response.enabled !== "boolean") throw new Error("双因素认证状态响应无效");
      setEnabled(response.enabled);
    } catch (reason) {
      setStatusError(errorMessage(reason, "双因素认证状态加载失败"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refreshStatus(); }, [refreshStatus]);

  useEffect(() => {
    let cancelled = false;
    setSetupQRCode("");
    setSetupQRCodeError(false);
    if (!setupData?.url) return;
    void QRCode.toDataURL(setupData.url, { errorCorrectionLevel: "M", margin: 1, width: 220 })
      .then((value) => { if (!cancelled) setSetupQRCode(value); })
      .catch(() => { if (!cancelled) setSetupQRCodeError(true); });
    return () => { cancelled = true; };
  }, [setupData?.url]);

  const resetSetup = () => {
    setSetupStep(null);
    setPassword("");
    setSetupData(null);
    setSetupQRCode("");
    setSetupQRCodeError(false);
    setSetupCode("");
    setRecoveryCodes([]);
    setRecoveryAcknowledged(false);
    setRecoveryCopyFailed(false);
    setDialogError("");
  };

  const beginSetup = () => {
    setDialogError("");
    setSetupStep("password");
  };

  const submitPassword = async (event: FormEvent) => {
    event.preventDefault();
    setWorking(true);
    setDialogError("");
    try {
      const response = assertSuccessful(
        await api.post<TwoFactorSetupResponse>("/api/user/2fa/setup", { password }, { suppressUnauthorizedEvent: true }),
        "无法开始双因素认证设置",
      );
      if (!response.secret || !response.url) throw new Error("双因素认证设置响应缺少密钥");
      setSetupData({ secret: response.secret, url: response.url });
      setPassword("");
      setSetupStep("verify");
    } catch (reason) {
      setDialogError(errorMessage(reason, "无法开始双因素认证设置"));
    } finally {
      setWorking(false);
    }
  };

  const verifySetup = async (event: FormEvent) => {
    event.preventDefault();
    setWorking(true);
    setDialogError("");
    try {
      const response = assertSuccessful(
        await api.post<TwoFactorVerifyResponse>("/api/user/2fa/verify-setup", { code: setupCode.trim() }, { suppressUnauthorizedEvent: true }),
        "动态验证码验证失败",
      );
      if (!response.recovery_codes?.length) throw new Error("服务端未返回恢复码，请勿退出并联系管理员");
      setRecoveryCodes(response.recovery_codes);
      setRecoveryAcknowledged(false);
      setRecoveryCopyFailed(false);
      setEnabled(true);
      setSetupStep("recovery");
      notify("双因素认证已启用");
      void refreshStatus();
    } catch (reason) {
      setDialogError(errorMessage(reason, "动态验证码验证失败"));
    } finally {
      setWorking(false);
    }
  };

  const copyRecoveryCodes = async () => {
    try {
      if (!navigator.clipboard) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(recoveryCodes.join("\n"));
      setRecoveryCopyFailed(false);
      notify("恢复码已复制");
    } catch {
      setRecoveryCopyFailed(true);
      notify("复制失败，请手动保存恢复码", "error");
    }
  };

  const openDisable = () => {
    setDisableCode("");
    setDialogError("");
    setDisableOpen(true);
  };

  const closeDisable = () => {
    if (working) return;
    setDisableOpen(false);
    setDisableCode("");
    setDialogError("");
  };

  const disableTwoFactor = async (event: FormEvent) => {
    event.preventDefault();
    setWorking(true);
    setDialogError("");
    try {
      const response = assertSuccessful(
        await api.post<TwoFactorDisableResponse>("/api/user/2fa/disable", { code: disableCode.trim() }, { suppressUnauthorizedEvent: true }),
        "关闭双因素认证失败",
      );
      if (response.status && response.status !== "disabled") throw new Error(response.message || "关闭双因素认证失败");
      setEnabled(false);
      setDisableOpen(false);
      setDisableCode("");
      notify("双因素认证已关闭");
      void refreshStatus();
    } catch (reason) {
      setDialogError(errorMessage(reason, "关闭双因素认证失败"));
    } finally {
      setWorking(false);
    }
  };

  return (
    <>
      <Surface className="settings-section two-factor-settings">
        <div className="settings-heading">
          <span className="settings-icon"><ShieldCheck size={19} /></span>
          <div><h2>账号安全</h2><p>使用认证器动态验证码保护当前账号</p></div>
        </div>
        {statusError ? <ErrorState message={statusError} onRetry={() => void refreshStatus()} /> : null}
        <div className="setting-status two-factor-status">
          <span>
            <strong>双因素认证</strong>
            <small>{loading ? "正在检查保护状态" : enabled ? "登录时需要动态验证码" : "建议启用以防止密码泄露"}</small>
          </span>
          <div className="two-factor-actions">
            {loading ? <Spinner label="正在检查" /> : <Badge tone={enabled ? "good" : "warn"}>{enabled ? "已保护" : "未启用"}</Badge>}
            {!loading && !statusError ? enabled
              ? <Button type="button" variant="danger" onClick={openDisable}><ShieldOff size={16} />关闭 2FA</Button>
              : <Button type="button" onClick={beginSetup}><KeyRound size={16} />启用 2FA</Button> : null}
          </div>
        </div>
      </Surface>

      {setupStep === "password" ? (
        <Dialog title="启用双因素认证" description="先验证当前账号密码" onClose={resetSetup} dismissible={!working}>
          <form className="form-stack" onSubmit={submitPassword}>
            {dialogError ? <ErrorState message={dialogError} /> : null}
            <Field label="当前密码"><input autoFocus required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></Field>
            <div className="dialog-actions">
              <Button type="button" variant="secondary" onClick={resetSetup} disabled={working}>取消</Button>
              <Button type="submit" disabled={working || !password}>{working ? <Spinner label="正在验证" /> : "继续"}</Button>
            </div>
          </form>
        </Dialog>
      ) : null}

      {setupStep === "verify" && setupData ? (
        <Dialog title="连接认证器" description="将下方信息添加到认证器，再输入生成的动态验证码" onClose={resetSetup} wide dismissible={!working}>
          <form className="form-stack" onSubmit={verifySetup}>
            {dialogError ? <ErrorState message={dialogError} /> : null}
            <div className="two-factor-qr">
              {setupQRCode ? <img src={setupQRCode} alt="双因素认证设置二维码" /> : setupQRCodeError ? <small>二维码生成失败，请使用下方密钥手动添加。</small> : <Spinner label="正在生成二维码" />}
              <span>使用认证器扫描</span>
            </div>
            <div className="two-factor-credential"><span>手动输入密钥</span><code>{setupData.secret}</code></div>
            <div className="two-factor-credential"><span>otpauth URL</span><code>{setupData.url}</code></div>
            <Field label="6 位动态验证码"><input autoFocus required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={setupCode} onChange={(event) => setSetupCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" /></Field>
            <div className="dialog-actions">
              <Button type="button" variant="secondary" onClick={resetSetup} disabled={working}>取消</Button>
              <Button type="submit" disabled={working || !/^\d{6}$/.test(setupCode)}>{working ? <Spinner label="正在启用" /> : "验证并启用"}</Button>
            </div>
          </form>
        </Dialog>
      ) : null}

      {setupStep === "recovery" ? (
        <Dialog title="保存恢复码" description="恢复码只显示这一次，每个恢复码只能使用一次" onClose={resetSetup} wide dismissible={false}>
          <div className="form-stack">
            <div className="recovery-warning"><KeyRound size={20} /><p>认证器不可用时，恢复码是登录账号的唯一备用方式。请将它们保存在密码管理器或其他安全位置。</p></div>
            <div className="recovery-code-grid" aria-label="恢复码列表">
              {recoveryCodes.map((code) => <code key={code}>{code}</code>)}
            </div>
            {recoveryCopyFailed ? <ErrorState message="无法访问剪贴板，请手动选择并保存上方恢复码。" /> : null}
            <div className="recovery-copy-row"><Button type="button" variant="secondary" onClick={() => void copyRecoveryCodes()}><Copy size={16} />复制全部恢复码</Button></div>
            <label className="checkbox-row recovery-acknowledgement"><input type="checkbox" checked={recoveryAcknowledged} onChange={(event) => setRecoveryAcknowledged(event.target.checked)} />我已将这些恢复码保存在安全位置</label>
            <div className="dialog-actions"><Button type="button" onClick={resetSetup} disabled={!recoveryAcknowledged}><ShieldCheck size={16} />完成</Button></div>
          </div>
        </Dialog>
      ) : null}

      {disableOpen ? (
        <Dialog title="关闭双因素认证" description="输入当前认证器的动态验证码以确认此操作" onClose={closeDisable} dismissible={!working}>
          <form className="form-stack" onSubmit={disableTwoFactor}>
            {dialogError ? <ErrorState message={dialogError} /> : null}
            <Field label="6 位动态验证码"><input autoFocus required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={disableCode} onChange={(event) => setDisableCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" /></Field>
            <div className="dialog-actions">
              <Button type="button" variant="secondary" onClick={closeDisable} disabled={working}>取消</Button>
              <Button type="submit" variant="danger" disabled={working || !/^\d{6}$/.test(disableCode)}>{working ? <Spinner label="正在关闭" /> : "确认关闭"}</Button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </>
  );
}
