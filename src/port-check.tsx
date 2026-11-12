import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { api } from "./api";

export type PortCheckStatus = "idle" | "checking" | "available" | "occupied" | "shared" | "invalid" | "error";

export interface PortCheckResult {
  success?: boolean;
  port?: number;
  available?: boolean;
  occupied_by?: string;
  network?: string;
  tag?: string;
  protocol?: string;
  server_id?: number;
  server_name?: string;
  reason?: string;
}

export interface PortCheckState {
  status: PortCheckStatus;
  message: string;
  occupiedBy?: string;
}

export interface UseDebouncedPortCheckOptions {
  enabled: boolean;
  url: string | null;
  port: string | number;
  minPort?: number;
  maxPort?: number;
  debounceMs?: number;
}

const DEFAULT_DEBOUNCE_MS = 500;

function unwrapPortCheckResponse(raw: unknown): PortCheckResult {
  if (!raw || typeof raw !== "object") return {};
  const obj = raw as Record<string, unknown>;
  if (obj.data && typeof obj.data === "object" && !Array.isArray(obj.data)) {
    return obj.data as PortCheckResult;
  }
  return obj as PortCheckResult;
}

/**
 * Normalizes a protocol identifier to network list used by backend port checks.
 */
export function portCheckNetworkForProtocol(protocol: string): string {
  const lower = protocol.trim().toLowerCase();
  if (lower === "wireguard" || lower === "hysteria" || lower === "hysteria2" || lower === "hy2") {
    return "udp";
  }
  if (
    lower === "tunnel" ||
    lower === "anydoor" ||
    lower === "dokodemo-door" ||
    lower === "chitanda" ||
    lower === "shadowsocks" ||
    lower === "ss"
  ) {
    return "tcp,udp";
  }
  if (!lower) return "tcp,udp";
  return "tcp";
}

/**
 * Performs a 500ms-debounced backend port check so rapid typing never triggers
 * redundant checks per keystroke. Aborts stale in-flight requests automatically.
 */
export function useDebouncedPortCheck({
  enabled,
  url,
  port,
  minPort = 1,
  maxPort = 65535,
  debounceMs = DEFAULT_DEBOUNCE_MS,
}: UseDebouncedPortCheckOptions): PortCheckState {
  const [state, setState] = useState<PortCheckState>({ status: "idle", message: "" });
  const seqRef = useRef(0);

  useEffect(() => {
    const seq = ++seqRef.current;
    const trimmed = String(port ?? "").trim();

    if (!enabled || !url || trimmed === "") {
      setState({ status: "idle", message: "" });
      return;
    }

    const parsed = Number(trimmed);
    if (!Number.isInteger(parsed) || parsed < minPort || parsed > maxPort) {
      setState({
        status: "invalid",
        message: `端口须为 ${minPort}-${maxPort} 的整数`,
      });
      return;
    }

    setState({
      status: "checking",
      message: "输入暂停后自动校验端口可用性...",
    });

    const abortController = new AbortController();
    const timer = window.setTimeout(() => {
      if (seqRef.current !== seq) return;
      setState({
        status: "checking",
        message: "正在向服务器校验端口可用性...",
      });
      void api.get<unknown>(url, { signal: abortController.signal }).then(
        (raw) => {
          if (seqRef.current !== seq || abortController.signal.aborted) return;
          const result = unwrapPortCheckResponse(raw);
          if (result.available) {
            if (result.occupied_by === "shared_nginx") {
              setState({
                status: "shared",
                occupiedBy: result.occupied_by,
                message: result.reason || "443 端口由 Nginx TLS 复用承载",
              });
              return;
            }
            setState({
              status: "available",
              message: result.reason || `端口 ${parsed} 可用`,
            });
            return;
          }
          setState({
            status: "occupied",
            occupiedBy: result.occupied_by,
            message: result.reason || `端口 ${parsed} 已被占用`,
          });
        },
        (reason) => {
          if (seqRef.current !== seq || abortController.signal.aborted) return;
          setState({
            status: "error",
            message: reason instanceof Error ? reason.message : "端口校验暂不可用，提交时仍由服务端验证",
          });
        },
      );
    }, debounceMs);

    return () => {
      window.clearTimeout(timer);
      abortController.abort();
    };
  }, [enabled, url, port, minPort, maxPort, debounceMs]);

  return state;
}

export function isPortCheckBlocking(state: PortCheckState): boolean {
  return state.status === "occupied" || state.status === "invalid";
}

export function PortCheckHint({ state }: { state: PortCheckState }) {
  if (state.status === "idle" || !state.message) return null;

  const toneClass =
    state.status === "available"
      ? "is-good"
      : state.status === "shared"
        ? "is-shared"
        : state.status === "occupied" || state.status === "invalid"
          ? "is-bad"
          : state.status === "error"
            ? "is-warn"
            : "is-checking";

  const icon =
    state.status === "checking" ? (
      <Loader2 size={14} className="pc-spin" />
    ) : state.status === "available" ? (
      <CheckCircle2 size={14} />
    ) : state.status === "shared" ? (
      <ShieldCheck size={14} />
    ) : (
      <AlertCircle size={14} />
    );

  return (
    <div className={`port-check-hint ${toneClass}`} role="status" aria-live="polite">
      {icon}
      <span>{state.message}</span>
    </div>
  );
}
