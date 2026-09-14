import type { Problem, ProblemInput, Stats, User } from "./types";

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function csrfToken(): string {
  const m = document.cookie.match(/(?:^|;\s*)cortex_csrf=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : "";
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET" && method !== "HEAD") headers["X-CSRF-Token"] = csrfToken();

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    credentials: "same-origin",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return undefined as T;

  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!res.ok) {
    const err = data as { code?: string; message?: string } | null;
    throw new ApiError(res.status, err?.code ?? "error", err?.message ?? "request failed");
  }
  return data as T;
}

export const api = {
  login: (username: string, password: string) =>
    request<User>("POST", "/login", { username, password }),
  logout: () => request<void>("POST", "/logout"),
  me: () => request<User>("GET", "/me"),
  stats: () => request<Stats>("GET", "/stats"),

  listProblems: (params: Record<string, string> = {}) => {
    const q = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== "")
    ).toString();
    return request<Problem[]>("GET", `/problems${q ? `?${q}` : ""}`);
  },
  createProblem: (input: ProblemInput) => request<Problem>("POST", "/problems", input),
  updateProblem: (id: number, input: ProblemInput) =>
    request<Problem>("PUT", `/problems/${id}`, input),
  deleteProblem: (id: number) => request<void>("DELETE", `/problems/${id}`),
};
