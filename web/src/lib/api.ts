import type { AiSummary, Evidence, NavLayout, Problem, ProblemInput, Stats, User } from "./types";

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
  updateMe: (input: {
    username: string;
    display_name_en: string;
    display_name_id: string;
    display_name_zh: string;
    current_password?: string;
    new_password?: string;
  }) => request<User>("PUT", "/me", input),

  getNav: () => request<NavLayout>("GET", "/nav"),
  updateNav: (input: {
    groups: { tempId: string; name: string; position: number }[];
    placements: { item_key: string; group: string | null; position: number }[];
  }) => request<NavLayout>("PUT", "/nav", input),

  // Radar module — namespaced under /radar so its endpoints (and, on the
  // server, its tables) can't collide with another module's down the line.
  stats: () => request<Stats>("GET", "/radar/stats"),

  listProblems: (params: Record<string, string> = {}) => {
    const q = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== "")
    ).toString();
    return request<Problem[]>("GET", `/radar/problems${q ? `?${q}` : ""}`);
  },
  getProblem: (id: number) => request<Problem>("GET", `/radar/problems/${id}`),
  // Quick capture only needs a title; every other field defaults server-side.
  createProblem: (input: Partial<ProblemInput> & { title: string }) =>
    request<Problem>("POST", "/radar/problems", input),
  updateProblem: (id: number, input: ProblemInput) =>
    request<Problem>("PUT", `/radar/problems/${id}`, input),
  deleteProblem: (id: number) => request<void>("DELETE", `/radar/problems/${id}`),

  addEvidence: (problemId: number, input: { text: string; url?: string }) =>
    request<Evidence>("POST", `/radar/problems/${problemId}/evidence`, input),
  deleteEvidence: (problemId: number, evidenceId: number) =>
    request<void>("DELETE", `/radar/problems/${problemId}/evidence/${evidenceId}`),

  // Hands the on-screen snapshot to OpenClaw for a "Summary & Suggestions"
  // read. No real OpenClaw connection yet — the backend returns a mock
  // shaped like the eventual real response, marked `mock: true`.
  aiSummary: (
    problemId: number,
    input: {
      title: string;
      body: string;
      scope: string[];
      source: string[];
      context: string;
      brainstorming: string;
      research_brief: string;
      findings: string;
    }
  ) => request<AiSummary>("POST", `/radar/problems/${problemId}/ai-summary`, input),
};
