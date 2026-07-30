const TOKEN_KEY = "arcway-session-token";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

interface RequestOptions {
  suppressUnauthorizedEvent?: boolean;
  idempotencyKey?: string;
}

export function getToken(): string {
  return localStorage.getItem(TOKEN_KEY) ?? "";
}

export function setToken(token: string): void {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

export async function request<T>(path: string, init: RequestInit = {}, options: RequestOptions = {}): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.idempotencyKey && !headers.has("Idempotency-Key")) headers.set("Idempotency-Key", options.idempotencyKey);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(path, { ...init, headers });
  } catch {
    throw new ApiError("无法连接控制端，请检查网络或服务状态", 0);
  }

  const contentType = response.headers.get("content-type") ?? "";
  let payload: unknown;
  if (response.status !== 204) {
    payload = contentType.includes("application/json")
      ? await response.json().catch(() => null)
      : await response.text().catch(() => "");
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
}

export async function requestStream(path: string, init: RequestInit = {}, options: RequestOptions = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.idempotencyKey && !headers.has("Idempotency-Key")) headers.set("Idempotency-Key", options.idempotencyKey);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(path, { ...init, headers });
  } catch {
    throw new ApiError("无法连接控制端，请检查网络或服务状态", 0);
  }

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
  const token = getToken();
  if (!token) {
    options.onClose?.();
    return () => undefined;
  }
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  let socket: WebSocket | undefined;
  let retryTimer: number | undefined;
  let stopped = false;
  let attempts = 0;

  const connect = () => {
    if (stopped) return;
    socket = new WebSocket(`${scheme}//${location.host}/api/ws/dashboard?token=${encodeURIComponent(token)}`);
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
      attempts += 1;
      retryTimer = window.setTimeout(connect, Math.min(30_000, 1_000 * 2 ** attempts));
    };
  };

  connect();
  const pingTimer = window.setInterval(() => {
    if (socket?.readyState === WebSocket.OPEN) socket.send("ping");
  }, 25_000);

  return () => {
    stopped = true;
    window.clearInterval(pingTimer);
    if (retryTimer) window.clearTimeout(retryTimer);
    socket?.close();
  };
}
