const TOKEN_KEY = "arcway-session-token";
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export interface RequestOptions {
  suppressUnauthorizedEvent?: boolean;
  idempotencyKey?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export function getToken(): string {
  return sessionStorage.getItem(TOKEN_KEY) ?? localStorage.getItem(TOKEN_KEY) ?? "";
}

export function setToken(token: string, remember = true): void {
  if (token) {
    if (remember) {
      localStorage.setItem(TOKEN_KEY, token);
      sessionStorage.removeItem(TOKEN_KEY);
    } else {
      sessionStorage.setItem(TOKEN_KEY, token);
      localStorage.removeItem(TOKEN_KEY);
    }
  } else {
    localStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
  }
}

function requestHeaders(init: RequestInit, options: RequestOptions): Headers {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.idempotencyKey && !headers.has("Idempotency-Key")) headers.set("Idempotency-Key", options.idempotencyKey);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return headers;
}

async function fetchWithControls<T>(
  path: string,
  init: RequestInit,
  options: RequestOptions,
  headers: Headers,
  consume: (response: Response, signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const inputSignals = [init.signal, options.signal].filter((signal): signal is AbortSignal => Boolean(signal));
  const abortFromInput = (event: Event) => {
    const signal = event.currentTarget as AbortSignal;
    controller.abort(signal.reason);
  };
  for (const signal of inputSignals) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener("abort", abortFromInput, { once: true });
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  let timedOut = false;
  const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0
    ? window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs)
    : undefined;

  try {
    const response = await fetch(path, { ...init, headers, signal: controller.signal });
    return await consume(response, controller.signal);
  } catch (reason) {
    if (reason instanceof ApiError) throw reason;
    if (timedOut) throw new ApiError("请求超时，请稍后重试", 0);
    if (controller.signal.aborted || (reason instanceof DOMException && reason.name === "AbortError")) {
      throw new ApiError("请求已取消", 0);
    }
    throw new ApiError("无法连接控制端，请检查网络或服务状态", 0);
  } finally {
    if (timeout !== undefined) window.clearTimeout(timeout);
    for (const signal of inputSignals) signal.removeEventListener("abort", abortFromInput);
  }
}

export async function request<T>(path: string, init: RequestInit = {}, options: RequestOptions = {}): Promise<T> {
  const headers = requestHeaders(init, options);
  return fetchWithControls(path, init, options, headers, async (response, signal) => {
    const contentType = response.headers.get("content-type") ?? "";
    let payload: unknown;
    if (response.status !== 204) {
      payload = contentType.includes("application/json")
        ? await response.json().catch((reason) => {
          if (signal.aborted) throw reason;
          return null;
        })
        : await response.text().catch((reason) => {
          if (signal.aborted) throw reason;
          return "";
        });
    }

    if (!response.ok) {
      const body = payload as { error?: string; message?: string } | string | null;
      const message = typeof body === "string"
        ? body
        : body?.error ?? body?.message ?? `请求失败 (${response.status})`;
      if (response.status === 401 && !options.suppressUnauthorizedEvent) {
        window.dispatchEvent(new CustomEvent("arcway:unauthorized"));
      }
      throw new ApiError(message, response.status);
    }

    return payload as T;
  });
}

export async function requestStream(path: string, init: RequestInit = {}, options: RequestOptions = {}): Promise<Response> {
  const headers = requestHeaders(init, options);
  return fetchWithControls(path, init, options, headers, async (response) => {
    if (!response.ok) {
      const contentType = response.headers.get("content-type") ?? "";
      const payload = contentType.includes("application/json")
        ? await response.json().catch(() => null) as { error?: string; message?: string } | null
        : await response.text().catch(() => "");
      const message = typeof payload === "string"
        ? payload
        : payload?.error ?? payload?.message ?? `请求失败 (${response.status})`;
      if (response.status === 401 && !options.suppressUnauthorizedEvent) {
        window.dispatchEvent(new CustomEvent("arcway:unauthorized"));
      }
      throw new ApiError(message || `请求失败 (${response.status})`, response.status);
    }

    if (!response.body) throw new ApiError("远端未返回可读取的执行日志", response.status);
    return response;
  });
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>(path, {}, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>(path, {
    method: "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  }, options),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>(path, {
    method: "PUT",
    body: body === undefined ? undefined : JSON.stringify(body),
  }, options),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>(path, {
    method: "PATCH",
    body: body === undefined ? undefined : JSON.stringify(body),
  }, options),
  delete: <T>(path: string, body?: unknown, options?: RequestOptions) => request<T>(path, {
    method: "DELETE",
    body: body === undefined ? undefined : JSON.stringify(body),
  }, options),
};

interface DashboardSocketOptions {
  onOpen?: () => void;
  onClose?: () => void;
}

export function openDashboardSocket(onMessage: (data: unknown) => void, options: DashboardSocketOptions = {}): () => void {
  if (!getToken()) {
    options.onClose?.();
    return () => undefined;
  }
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  let socket: WebSocket | undefined;
  let retryTimer: number | undefined;
  let ticketAbort: AbortController | undefined;
  let stopped = false;
  let attempts = 0;

  const scheduleReconnect = () => {
    if (stopped) return;
    attempts += 1;
    retryTimer = window.setTimeout(() => { void connect(); }, Math.min(30_000, 1_000 * 2 ** attempts));
  };

  const connect = async () => {
    if (stopped) return;
    if (!getToken()) {
      options.onClose?.();
      return;
    }
    ticketAbort = new AbortController();
    try {
      const response = await api.post<{ ticket: string }>("/api/ws/ticket", undefined, {
        signal: ticketAbort.signal,
        timeoutMs: 10_000,
      });
      if (stopped) return;
      if (!response.ticket) throw new ApiError("控制端未签发实时连接凭据", 0);
      socket = new WebSocket(`${scheme}//${location.host}/api/ws/dashboard?ticket=${encodeURIComponent(response.ticket)}`);
    } catch {
      if (stopped) return;
      options.onClose?.();
      scheduleReconnect();
      return;
    } finally {
      ticketAbort = undefined;
    }
    socket.onopen = () => {
      attempts = 0;
      options.onOpen?.();
    };
    socket.onmessage = (event) => {
      try { onMessage(JSON.parse(event.data)); } catch { /* Ignore malformed frames. */ }
    };
    socket.onclose = () => {
      if (stopped) return;
      options.onClose?.();
      scheduleReconnect();
    };
  };

  void connect();
  const pingTimer = window.setInterval(() => {
    if (socket?.readyState === WebSocket.OPEN) socket.send("ping");
  }, 25_000);

  return () => {
    stopped = true;
    window.clearInterval(pingTimer);
    if (retryTimer) window.clearTimeout(retryTimer);
    ticketAbort?.abort();
    socket?.close();
  };
}
