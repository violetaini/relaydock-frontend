import {
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  CalendarPlus,
  Network,
  Package as PackageIcon,
  Server,
  ShieldCheck,
  Users,
} from "lucide-react";
import { api } from "./api";
import { normalizeForwardingBillingMode } from "./forwarding-billing";
import {
  UserForwardingGrantsPanel,
  type TunnelTemplate,
} from "./forwarding-management";
import { UserNodeGrantsPanel } from "./node-grants";
import { ServerGrantsPanel, type ManagedBillingMode } from "./server-grants";
import type {
  ForwardingBillingMode,
  NodeItem,
  PackageItem,
  RemoteServer,
  UserItem,
} from "./types";
import { isPackageAuthorization } from "./user-authorization";
import {
  Button,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  Spinner,
  Toggle,
} from "./ui";
import "./service-authorization.css";

type NotifyTone = "success" | "error";
type AuthorizationMode = "package" | "custom";
type Notify = (message: string, tone?: NotifyTone) => void;

interface MutationResponse {
  success?: boolean;
  message?: string;
  error?: string;
  warnings?: unknown[];
  results?: ServiceAuthorizationResult[];
  applied_users?: string[];
}

interface ServiceAuthorizationResult {
  username: string;
  mode: AuthorizationMode;
  status: "applied" | "failed" | "rolled_back" | "rollback_failed";
  warnings?: unknown[];
  error?: string;
}

interface AuthorizationOutcome {
  message: string;
  tone?: NotifyTone;
  failedUsernames: string[];
}

function messageOf(reason: unknown, fallback: string) {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

function normalizeResetDay(value?: number) {
  const day = Math.floor(Number(value) || 1);
  return Math.min(31, Math.max(1, day));
}

function todayValue() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
}

function listFrom<T>(payload: unknown, ...keys: string[]): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (!payload || typeof payload !== "object") return [];
  const root = payload as Record<string, unknown>;
  for (const key of keys) if (Array.isArray(root[key])) return root[key] as T[];
  const data = root.data;
  if (data && typeof data === "object") {
    for (const key of keys) {
      const value = (data as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value as T[];
    }
  }
  return [];
}

function authorizationOutcome(
  response: MutationResponse,
  usernames: string[],
  successLabel: (count: number) => string,
): AuthorizationOutcome {
  const results = response.results ?? [];
  if (results.length) {
    const applied = new Set(
      results
        .filter((item) => item.status === "applied")
        .map((item) => item.username),
    );
    for (const username of response.applied_users ?? []) applied.add(username);
    const failures = usernames.filter((username) => !applied.has(username));
    const warningCount = results.reduce(
      (count, item) => count + (item.warnings?.length ?? 0),
      0,
    );
    const failureDetails = failures.slice(0, 3).map((username) => {
      const result = results.find((item) => item.username === username);
      return `${username}：${result?.error || (result?.status === "rolled_back" ? "已回滚" : result?.status === "rollback_failed" ? "回滚失败" : "应用失败")}`;
    });
    if (!applied.size)
      throw new Error(
        failureDetails.join("；") ||
          response.error ||
          response.message ||
          "服务授权失败",
      );
    const partial = failures.length
      ? `；${failures.length} 位未应用${failureDetails.length ? `（${failureDetails.join("；")}）` : ""}`
      : "";
    const warnings = warningCount ? `；${warningCount} 项下发警告` : "";
    return {
      message: `${successLabel(applied.size)}${partial}${warnings}`,
      tone: failures.length || warningCount ? "error" : undefined,
      failedUsernames: failures,
    };
  }
  if (response.success === false)
    throw new Error(response.error || response.message || "服务授权失败");
  if (
    response.applied_users &&
    response.applied_users.length < usernames.length
  ) {
    const applied = response.applied_users.length;
    if (!applied)
      throw new Error(response.error || response.message || "服务授权失败");
    return {
      message: `${successLabel(applied)}；${usernames.length - applied} 位未应用`,
      tone: "error",
      failedUsernames: usernames.filter(
        (username) => !response.applied_users?.includes(username),
      ),
    };
  }
  const warnings = response.warnings?.length ?? 0;
  return {
    message: `${successLabel(usernames.length)}${warnings ? `；${warnings} 项下发警告` : ""}`,
    tone: warnings ? "error" : undefined,
    failedUsernames: [],
  };
}

function ModeSelector({
  value,
  onChange,
  disabled = false,
}: {
  value: AuthorizationMode | null;
  onChange: (value: AuthorizationMode) => void;
  disabled?: boolean;
}) {
  const moveSelection = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "ArrowLeft" || event.key === "ArrowUp" ? "package" : "custom";
    const group = event.currentTarget;
    onChange(next);
    requestAnimationFrame(() => {
      group.querySelector<HTMLElement>(`[role="radio"][data-mode="${next}"]`)?.focus();
    });
  };
  return (
    <div
      className="service-auth-mode"
      role="radiogroup"
      aria-label="服务授权方式"
      onKeyDown={moveSelection}
    >
      <button
        type="button"
        role="radio"
        data-mode="package"
        aria-checked={value === "package"}
        tabIndex={value === "custom" ? -1 : 0}
        disabled={disabled}
        className={value === "package" ? "is-active" : ""}
        onClick={() => onChange("package")}
      >
        <PackageIcon size={20} />
        <span>
          <strong>套餐授权</strong>
          <small>按制式模板一次应用全部服务</small>
        </span>
      </button>
      <button
        type="button"
        role="radio"
        data-mode="custom"
        aria-checked={value === "custom"}
        tabIndex={value === "custom" ? 0 : -1}
        disabled={disabled}
        className={value === "custom" ? "is-active" : ""}
        onClick={() => onChange("custom")}
      >
        <ShieldCheck size={20} />
        <span>
          <strong>自定义授权</strong>
          <small>分别选择固定节点、服务器和转发线路</small>
        </span>
      </button>
    </div>
  );
}

export function ServiceAuthorizationPanel({
  user,
  notify,
  onChanged,
  onOpenExtend,
}: {
  user: UserItem;
  notify: Notify;
  onChanged: (message: string, tone?: NotifyTone) => Promise<void>;
  onOpenExtend: () => void;
}) {
  const currentMode: AuthorizationMode = isPackageAuthorization(user)
    ? "package"
    : user.authorization_mode ?? "custom";
  const packageMode = currentMode === "package";
  const [mode, setMode] = useState<AuthorizationMode | null>(currentMode);
  const [packages, setPackages] = useState<PackageItem[]>([]);
  const [packageID, setPackageID] = useState(String(user.package_id ?? ""));
  const [startDate, setStartDate] = useState("");
  const [expireDate, setExpireDate] = useState(user.package_end_date ?? "");
  const [resetEnabled, setResetEnabled] = useState(Boolean(user.is_reset));
  const [resetDay, setResetDay] = useState(
    String(normalizeResetDay(user.reset_day)),
  );
  const [resetOverrideDirty, setResetOverrideDirty] = useState(
    Boolean(user.package_id),
  );
  const [loading, setLoading] = useState(true);
  const [packageLoadError, setPackageLoadError] = useState("");
  const [packageLoadAttempt, setPackageLoadAttempt] = useState(0);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [confirmCustom, setConfirmCustom] = useState(false);

  useEffect(() => {
    if (currentMode) setMode(currentMode);
    setPackageID(String(user.package_id ?? ""));
    setExpireDate(user.package_end_date ?? "");
    setResetEnabled(Boolean(user.is_reset));
    setResetDay(String(normalizeResetDay(user.reset_day)));
    setResetOverrideDirty(Boolean(user.package_id));
  }, [
    currentMode,
    user.is_reset,
    user.package_end_date,
    user.package_id,
    user.reset_day,
  ]);

  useEffect(() => {
    setLoading(true);
    setPackageLoadError("");
    api
      .get<{ packages?: PackageItem[] }>("/api/admin/packages")
      .then((response) => setPackages(response.packages ?? []))
      .catch((reason) =>
        setPackageLoadError(messageOf(reason, "套餐列表加载失败")),
      )
      .finally(() => setLoading(false));
  }, [packageLoadAttempt]);

  const selectedPackage = packages.find(
    (item) => item.id === Number(packageID),
  );
  const today = todayValue();

  const selectPackage = (value: string) => {
    setPackageID(value);
    const nextPackage = packages.find((item) => item.id === Number(value));
    if (!nextPackage) return;
    if (Number(value) === user.package_id) {
      setResetEnabled(Boolean(user.is_reset));
      setResetDay(String(normalizeResetDay(user.reset_day)));
      setResetOverrideDirty(true);
      return;
    }
    setResetEnabled(Boolean(nextPackage.is_reset));
    setResetDay(String(normalizeResetDay(nextPackage.reset_day)));
    setResetOverrideDirty(false);
  };

  const assignPackage = async (event: FormEvent) => {
    event.preventDefault();
    if (!packageID) return setError("请选择套餐");
    if (startDate && startDate > today)
      return setError("当前仅支持立即生效，开始日期不能晚于今天");
    if (expireDate && expireDate <= (startDate || today))
      return setError("到期日期必须晚于开始日期");
    if (
      resetOverrideDirty &&
      resetEnabled &&
      (Number(resetDay) < 1 || Number(resetDay) > 31)
    )
      return setError("重置日必须在 1 到 31 之间");
    setWorking(true);
    setError("");
    try {
      const response = await api.put<MutationResponse>(
        `/api/admin/users/${encodeURIComponent(user.username)}/service-authorization`,
        {
          mode: "package",
          package: {
            package_id: Number(packageID),
            ...(startDate ? { start_date: startDate } : {}),
            ...(expireDate ? { expire_date: expireDate } : {}),
            is_reset: resetEnabled,
            ...(resetEnabled ? { reset_day: Number(resetDay) } : {}),
          },
        },
      );
      const outcome = authorizationOutcome(
        response,
        [user.username],
        () =>
          `已为 ${user.username} ${user.package_id ? "更新" : "分配"}“${selectedPackage?.name ?? "套餐"}”`,
      );
      setMode("package");
      await onChanged(outcome.message, outcome.tone);
    } catch (reason) {
      setError(messageOf(reason, "套餐分配失败"));
    } finally {
      setWorking(false);
    }
  };

  const switchToCustom = async () => {
    setWorking(true);
    setError("");
    try {
      const response = await api.put<MutationResponse>(
        `/api/admin/users/${encodeURIComponent(user.username)}/service-authorization`,
        {
          mode: "custom",
          custom: {
            fixed_node_grants: [],
            server_grants: [],
            forwarding_grants: [],
          },
        },
      );
      const outcome = authorizationOutcome(
        response,
        [user.username],
        () => `已将 ${user.username} 切换为自定义授权`,
      );
      setConfirmCustom(false);
      await onChanged(outcome.message, outcome.tone);
      setMode("custom");
    } catch (reason) {
      setError(messageOf(reason, "切换自定义授权失败"));
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="service-auth-panel">
      {packageMode ? (
        <div className="service-auth-current-mode" aria-label="当前授权方式">
          <PackageIcon size={20} />
          <span>
            <strong>当前使用套餐授权</strong>
            <small>节点、服务器和转发线路由当前套餐统一维护</small>
          </span>
        </div>
      ) : (
        <ModeSelector
          value={mode}
          disabled={working}
          onChange={(nextMode) => {
            setError("");
            setMode(nextMode);
          }}
        />
      )}
      {packageLoadError ? (
        <ErrorState
          message={packageLoadError}
          onRetry={() => setPackageLoadAttempt((value) => value + 1)}
        />
      ) : null}
      {error ? <ErrorState message={error} /> : null}
      {!mode ? (
        <EmptyState
          icon={<ShieldCheck size={24} />}
          title="选择授权方式"
          description="套餐授权与自定义授权互斥，请先选择一种方式。"
        />
      ) : null}
      {mode === "package" ? (
        <section className="service-auth-package" aria-label="套餐授权设置">
          {loading ? (
            <div className="service-auth-loading">
              <Spinner label="正在加载套餐" />
            </div>
          ) : (
            <form
              className="user-package-form"
              onSubmit={(event) => void assignPackage(event)}
            >
              <Field label="套餐模板">
                <select
                  aria-label="用户套餐"
                  required
                  value={packageID}
                  onChange={(event) => selectPackage(event.target.value)}
                >
                  <option value="">请选择套餐模板</option>
                  {packages.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {item.nodes?.length ?? 0} 节点 /{" "}
                      {item.server_grants?.length ?? 0} 服务器 /{" "}
                      {item.forwarding_grants?.length ?? 0} 线路
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="开始日期" hint="留空表示今天；暂不支持预约生效">
                <input
                  type="date"
                  aria-label="套餐开始日期"
                  max={today}
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                />
              </Field>
              <Field
                label="到期日期"
                hint={`留空表示开始后 ${selectedPackage?.cycle_days ?? 30} 天`}
              >
                <input
                  type="date"
                  aria-label="套餐到期日期"
                  value={expireDate}
                  onChange={(event) => setExpireDate(event.target.value)}
                />
              </Field>
              <div className="user-package-reset">
                <div>
                  <Toggle
                    checked={resetEnabled}
                    onChange={(value) => {
                      setResetEnabled(value);
                      setResetOverrideDirty(true);
                    }}
                    label="按自然月重置该用户流量"
                  />
                  <small>
                    {resetOverrideDirty
                      ? "已使用用户级策略，不再跟随套餐默认值"
                      : selectedPackage?.is_reset
                        ? `默认每月 ${selectedPackage.reset_day} 日重置`
                        : "默认按套餐周期重置"}
                  </small>
                </div>
                <Field label="重置日" hint="每月 1 到 31 日">
                  <input
                    aria-label="套餐流量重置日"
                    type="number"
                    min="1"
                    max="31"
                    step="1"
                    disabled={!resetEnabled}
                    value={resetDay}
                    onChange={(event) => {
                      setResetDay(event.target.value);
                      setResetOverrideDirty(true);
                    }}
                  />
                </Field>
              </div>
              <div className="user-package-actions">
                <Button type="submit" disabled={working || !packageID}>
                  {working ? (
                    <Spinner label="正在下发" />
                  ) : (
                    <>
                      <PackageIcon size={16} />
                      {user.package_id ? "更新套餐" : "分配套餐"}
                    </>
                  )}
                </Button>
              </div>
            </form>
          )}
          {packageMode ? (
            <div className="user-package-current">
              <span>
                当前套餐：
                <strong>
                  {user.package_name || `套餐 #${user.package_id}`}
                </strong>
              </span>
              <span>
                {user.package_end_date
                  ? `到期 ${user.package_end_date}`
                  : "未设置到期日"}
              </span>
              <Button type="button" variant="ghost" onClick={onOpenExtend}>
                <CalendarPlus size={15} />
                续期
              </Button>
            </div>
          ) : null}
          {packageMode ? (
            <div className="service-auth-package-switch">
              <span>
                <strong>需要改用独立服务授权？</strong>
                <small>切换会解除当前套餐，并以空的自定义授权重新开始。</small>
              </span>
              <Button
                type="button"
                variant="danger"
                onClick={() => setConfirmCustom(true)}
                disabled={working}
              >
                解除套餐并切换为自定义授权
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}
      {mode === "custom" && !packageMode ? (
        <div className="service-auth-custom" aria-label="自定义服务授权">
          <section>
            <div className="service-auth-custom-heading">
              <ShieldCheck size={18} />
              <span>
                <strong>固定节点</strong>
                <small>授权现有节点进入该账号订阅</small>
              </span>
            </div>
            <UserNodeGrantsPanel username={user.username} notify={notify} />
          </section>
          <section>
            <div className="service-auth-custom-heading">
              <Server size={18} />
              <span>
                <strong>服务器自助节点</strong>
                <small>允许账号在指定服务器创建或开通节点</small>
              </span>
            </div>
            <ServerGrantsPanel username={user.username} notify={notify} />
          </section>
          <section>
            <div className="service-auth-custom-heading">
              <Network size={18} />
              <span>
                <strong>转发线路</strong>
                <small>授权线路、转发名额和独立流量额度</small>
              </span>
            </div>
            <UserForwardingGrantsPanel
              username={user.username}
              notify={notify}
            />
          </section>
        </div>
      ) : null}
      {confirmCustom ? (
        <ConfirmDialog
          title="解除套餐并切换为自定义授权"
          description={`将解除 ${user.username} 的当前套餐，并以空的自定义授权开始；当前服务授权会被统一替换。`}
          confirmLabel="解除套餐并切换"
          working={working}
          onCancel={() => setConfirmCustom(false)}
          onConfirm={() => void switchToCustom()}
        />
      ) : null}
    </div>
  );
}

interface BatchCustomState {
  expiresAt: string;
  fixedNodeIDs: number[];
  serverIDs: number[];
  tunnelIDs: number[];
  serverMaxNodes: string;
  serverTrafficGB: string;
  serverBilling: ManagedBillingMode;
  forwardingMaxForwards: string;
  forwardingTrafficGB: string;
  forwardingBilling: ForwardingBillingMode;
}

const initialBatchCustom: BatchCustomState = {
  expiresAt: "",
  fixedNodeIDs: [],
  serverIDs: [],
  tunnelIDs: [],
  serverMaxNodes: "0",
  serverTrafficGB: "0",
  serverBilling: "download",
  forwardingMaxForwards: "1",
  forwardingTrafficGB: "0",
  forwardingBilling: "both",
};

export function BatchServiceAuthorizationDialog({
  usernames,
  onClose,
  onComplete,
}: {
  usernames: string[];
  onClose: () => void;
  onComplete: (
    message: string,
    tone?: NotifyTone,
    failedUsernames?: string[],
  ) => Promise<void>;
}) {
  const [mode, setMode] = useState<AuthorizationMode | null>(null);
  const [packages, setPackages] = useState<PackageItem[]>([]);
  const [nodes, setNodes] = useState<NodeItem[]>([]);
  const [servers, setServers] = useState<RemoteServer[]>([]);
  const [tunnels, setTunnels] = useState<TunnelTemplate[]>([]);
  const [packageID, setPackageID] = useState("");
  const [startDate, setStartDate] = useState("");
  const [expireDate, setExpireDate] = useState("");
  const [resetEnabled, setResetEnabled] = useState(false);
  const [resetDay, setResetDay] = useState("1");
  const [custom, setCustom] = useState(initialBatchCustom);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    setLoadError("");
    Promise.all([
      api.get<unknown>("/api/admin/packages"),
      api.get<unknown>("/api/admin/nodes"),
      api.get<unknown>("/api/admin/remote-servers"),
      api.get<unknown>("/api/admin/tunnel-templates"),
    ])
      .then(([packagePayload, nodePayload, serverPayload, tunnelPayload]) => {
        setPackages(listFrom<PackageItem>(packagePayload, "packages"));
        setNodes(listFrom<NodeItem>(nodePayload, "nodes"));
        setServers(listFrom<RemoteServer>(serverPayload, "servers"));
        setTunnels(
          listFrom<TunnelTemplate>(tunnelPayload, "tunnels", "templates"),
        );
      })
      .catch((reason) =>
        setLoadError(messageOf(reason, "服务授权选项加载失败")),
      )
      .finally(() => setLoading(false));
  }, [loadAttempt]);

  const fixedNodes = useMemo(
    () =>
      nodes.filter(
        (node) =>
          node.enabled &&
          node.node_type !== "routed" &&
          node.direct_grant_eligible === true,
      ),
    [nodes],
  );
  const availableServers = useMemo(
    () => servers.filter((server) => !server.is_federated),
    [servers],
  );
  const availableTunnels = useMemo(
    () => tunnels.filter((tunnel) => tunnel.state === "active"),
    [tunnels],
  );
  const today = todayValue();

  const toggle = (
    key: "fixedNodeIDs" | "serverIDs" | "tunnelIDs",
    id: number,
  ) =>
    setCustom((current) => ({
      ...current,
      [key]: current[key].includes(id)
        ? current[key].filter((value) => value !== id)
        : [...current[key], id],
    }));

  const selectPackage = (value: string) => {
    setPackageID(value);
    const selected = packages.find((item) => item.id === Number(value));
    if (selected) {
      setResetEnabled(Boolean(selected.is_reset));
      setResetDay(String(normalizeResetDay(selected.reset_day)));
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (loading || loadError)
      return setError("服务授权选项尚未完整加载，请重试");
    if (!mode) return setError("请选择套餐授权或自定义授权");
    if (mode === "package" && !packageID) return setError("请选择套餐");
    if (mode === "package" && startDate && startDate > today)
      return setError("开始日期不能晚于今天");
    if (mode === "package" && expireDate && expireDate <= (startDate || today))
      return setError("到期日期必须晚于开始日期");
    if (
      mode === "package" &&
      resetEnabled &&
      (Number(resetDay) < 1 || Number(resetDay) > 31)
    )
      return setError("重置日必须在 1 到 31 之间");
    if (mode === "custom" && Number(custom.forwardingMaxForwards) < 1)
      return setError("转发名额至少为 1");

    const startsAt = new Date().toISOString();
    const expiresAt = custom.expiresAt
      ? new Date(custom.expiresAt).toISOString()
      : null;
    const payload =
      mode === "package"
        ? {
            usernames,
            mode,
            package: {
              package_id: Number(packageID),
              ...(startDate ? { start_date: startDate } : {}),
              ...(expireDate ? { expire_date: expireDate } : {}),
              is_reset: resetEnabled,
              ...(resetEnabled ? { reset_day: Number(resetDay) } : {}),
            },
          }
        : {
            usernames,
            mode,
            custom: {
              fixed_node_grants: custom.fixedNodeIDs.map((nodeID) => ({
                node_id: nodeID,
                expires_at: expiresAt,
              })),
              server_grants: custom.serverIDs.map((serverID) => ({
                server_id: serverID,
                enabled: true,
                starts_at: startsAt,
                expires_at: expiresAt,
                max_active_nodes: Math.max(
                  0,
                  Math.floor(Number(custom.serverMaxNodes) || 0),
                ),
                speed_limit_mbps: 0,
                connection_limit: 0,
                traffic_limit_bytes: Math.round(
                  Math.max(0, Number(custom.serverTrafficGB) || 0) * 1024 ** 3,
                ),
                billing_mode: custom.serverBilling,
                reset_policy: "none",
                reset_day: 1,
                allowed_protocols: [],
                allowed_protocol_profiles: [],
              })),
              forwarding_grants: custom.tunnelIDs.map((tunnelID) => ({
                tunnel_id: tunnelID,
                enabled: true,
                starts_at: startsAt,
                expires_at: expiresAt,
                max_active_forwards: Math.max(
                  1,
                  Math.floor(Number(custom.forwardingMaxForwards) || 1),
                ),
                per_forward_speed_mbps: 0,
                per_forward_connection_limit: 0,
                traffic_limit_bytes: Math.round(
                  Math.max(0, Number(custom.forwardingTrafficGB) || 0) *
                    1024 ** 3,
                ),
                billing_mode_override: normalizeForwardingBillingMode(
                  custom.forwardingBilling,
                ),
                allow_custom_public_target: false,
              })),
            },
          };

    setWorking(true);
    setError("");
    try {
      const response = await api.post<MutationResponse>(
        "/api/admin/users/service-authorization/batch",
        payload,
      );
      const outcome = authorizationOutcome(
        response,
        usernames,
        (count) =>
          `已为 ${count}/${usernames.length} 位用户应用${mode === "package" ? "套餐" : "自定义"}授权`,
      );
      await onComplete(
        outcome.message,
        outcome.tone,
        outcome.failedUsernames,
      );
    } catch (reason) {
      setError(messageOf(reason, "批量服务授权失败"));
    } finally {
      setWorking(false);
    }
  };

  return (
    <Dialog
      title={`批量服务授权 · ${usernames.length} 位用户`}
      description="所选用户将统一使用同一种授权方式"
      onClose={onClose}
      wide
      dismissible={!working}
    >
      <form
        className="batch-service-auth"
        onSubmit={(event) => void submit(event)}
      >
        <div className="batch-service-users">
          <Users size={17} />
          <span title={usernames.join("、")}>{usernames.join("、")}</span>
        </div>
        <ModeSelector
          value={mode}
          disabled={working}
          onChange={(nextMode) => {
            setMode(nextMode);
            setError("");
          }}
        />
        {loadError ? (
          <ErrorState
            message={loadError}
            onRetry={() => setLoadAttempt((value) => value + 1)}
          />
        ) : null}
        {error ? <ErrorState message={error} /> : null}
        {loading ? (
          <div className="service-auth-loading">
            <Spinner label="正在加载服务授权选项" />
          </div>
        ) : null}
        {!loading && mode === "package" ? (
          <div className="batch-service-package">
            <Field label="套餐模板">
              <select
                aria-label="批量套餐"
                value={packageID}
                onChange={(event) => selectPackage(event.target.value)}
              >
                <option value="">请选择套餐</option>
                {packages.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="开始日期" hint="留空表示今天">
              <input
                aria-label="批量套餐开始日期"
                type="date"
                max={today}
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
            </Field>
            <Field label="到期日期" hint="留空使用套餐周期">
              <input
                aria-label="批量套餐到期日期"
                type="date"
                value={expireDate}
                onChange={(event) => setExpireDate(event.target.value)}
              />
            </Field>
            <div className="batch-service-reset">
              <Toggle
                checked={resetEnabled}
                onChange={setResetEnabled}
                label="按自然月重置流量"
              />
              {resetEnabled ? (
                <Field label="重置日">
                  <input
                    aria-label="批量套餐重置日"
                    type="number"
                    min="1"
                    max="31"
                    value={resetDay}
                    onChange={(event) => setResetDay(event.target.value)}
                  />
                </Field>
              ) : null}
            </div>
          </div>
        ) : null}
        {!loading && mode === "custom" ? (
          <div className="batch-service-custom">
            <p>以下选择会作为所选用户的完整自定义服务授权，并解绑现有套餐。</p>
            <Field label="统一到期时间" hint="留空表示长期有效">
              <input
                aria-label="批量自定义到期时间"
                type="datetime-local"
                value={custom.expiresAt}
                onChange={(event) =>
                  setCustom({ ...custom, expiresAt: event.target.value })
                }
              />
            </Field>
            <BatchResourceList
              title="固定节点"
              items={fixedNodes.map((node) => ({
                id: node.id,
                label: node.node_name,
                note: `${node.protocol} · ${node.original_server}`,
              }))}
              selected={custom.fixedNodeIDs}
              onToggle={(id) => toggle("fixedNodeIDs", id)}
              empty="暂无可独立授权的固定节点"
            />
            <BatchResourceList
              title="服务器自助节点"
              items={availableServers.map((server) => ({
                id: server.id,
                label: server.name,
                note: server.status || "未知状态",
              }))}
              selected={custom.serverIDs}
              onToggle={(id) => toggle("serverIDs", id)}
              empty="暂无可授权服务器"
            />
            {custom.serverIDs.length ? (
              <div className="batch-policy-grid">
                <Field label="每台服务器节点名额" hint="0 表示不限">
                  <input
                    aria-label="批量服务器节点名额"
                    type="number"
                    min="0"
                    value={custom.serverMaxNodes}
                    onChange={(event) =>
                      setCustom({
                        ...custom,
                        serverMaxNodes: event.target.value,
                      })
                    }
                  />
                </Field>
                <Field label="每台服务器流量 GB" hint="0 表示不限">
                  <input
                    aria-label="批量服务器流量"
                    type="number"
                    min="0"
                    step="0.01"
                    value={custom.serverTrafficGB}
                    onChange={(event) =>
                      setCustom({
                        ...custom,
                        serverTrafficGB: event.target.value,
                      })
                    }
                  />
                </Field>
                <Field label="服务器流量计算">
                  <select
                    aria-label="批量服务器流量计算"
                    value={custom.serverBilling}
                    onChange={(event) =>
                      setCustom({
                        ...custom,
                        serverBilling: event.target.value as ManagedBillingMode,
                      })
                    }
                  >
                    <option value="download">仅下行</option>
                    <option value="both">上下行</option>
                  </select>
                </Field>
              </div>
            ) : null}
            <BatchResourceList
              title="转发线路"
              items={availableTunnels.map((tunnel) => ({
                id: Number(tunnel.id),
                label: tunnel.name,
                note: `${tunnel.hops?.length ?? tunnel.server_ids?.length ?? 0} 跳`,
              }))}
              selected={custom.tunnelIDs}
              onToggle={(id) => toggle("tunnelIDs", id)}
              empty="暂无可授权转发线路"
            />
            {custom.tunnelIDs.length ? (
              <div className="batch-policy-grid">
                <Field label="每条线路转发名额">
                  <input
                    aria-label="批量转发名额"
                    type="number"
                    min="1"
                    value={custom.forwardingMaxForwards}
                    onChange={(event) =>
                      setCustom({
                        ...custom,
                        forwardingMaxForwards: event.target.value,
                      })
                    }
                  />
                </Field>
                <Field label="每条线路流量 GB" hint="0 表示不限">
                  <input
                    aria-label="批量转发流量"
                    type="number"
                    min="0"
                    step="0.01"
                    value={custom.forwardingTrafficGB}
                    onChange={(event) =>
                      setCustom({
                        ...custom,
                        forwardingTrafficGB: event.target.value,
                      })
                    }
                  />
                </Field>
                <Field label="转发流量计算">
                  <select
                    aria-label="批量转发流量计算"
                    value={custom.forwardingBilling}
                    onChange={(event) =>
                      setCustom({
                        ...custom,
                        forwardingBilling: event.target
                          .value as ForwardingBillingMode,
                      })
                    }
                  >
                    <option value="both">双向</option>
                    <option value="upload">仅算上行</option>
                    <option value="download">仅算下行</option>
                  </select>
                </Field>
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="dialog-actions">
          <Button
            type="button"
            variant="secondary"
            disabled={working}
            onClick={onClose}
          >
            取消
          </Button>
          <Button
            type="submit"
            disabled={
              working ||
              loading ||
              Boolean(loadError) ||
              !mode ||
              (mode === "package" && !packageID)
            }
          >
            {working ? (
              <Spinner label="正在批量应用" />
            ) : (
              <>应用到 {usernames.length} 位用户</>
            )}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function BatchResourceList({
  title,
  items,
  selected,
  onToggle,
  empty,
}: {
  title: string;
  items: Array<{ id: number; label: string; note: string }>;
  selected: number[];
  onToggle: (id: number) => void;
  empty: string;
}) {
  return (
    <fieldset className="batch-resource-list">
      <legend>
        {title}（{selected.length}）
      </legend>
      {items.length ? (
        <div>
          {items.map((item) => (
            <label
              key={item.id}
              className={selected.includes(item.id) ? "is-selected" : ""}
            >
              <input
                type="checkbox"
                checked={selected.includes(item.id)}
                onChange={() => onToggle(item.id)}
              />
              <span>
                <strong>{item.label}</strong>
                <small>{item.note}</small>
              </span>
            </label>
          ))}
        </div>
      ) : (
        <small>{empty}</small>
      )}
    </fieldset>
  );
}
