export type Scope = "unknown" | "id" | "row";
export type Source = "unknown" | "personal" | "other" | "ai";
export type Status = "backlog" | "researching" | "in_review" | "building" | "shipped" | "archived";

export const SCOPES: Scope[] = ["unknown", "id", "row"];
export const SOURCES: Source[] = ["unknown", "personal", "other", "ai"];
export const STATUSES: Status[] = ["backlog", "researching", "in_review", "building", "shipped", "archived"];

export interface Problem {
  id: number;
  scope: Scope[];
  source: Source[];
  ai_assisted: boolean;
  title: string;
  body: string;
  status: Status;
  source_url?: string;
  recurrence: number;
  created_at: string;
  updated_at: string;

  // Present only on the single-problem detail response.
  context?: string;
  brainstorming?: string;
  research_brief?: string;
  findings?: string;
  related_ids?: number[];
  evidence?: Evidence[];
}

export interface Evidence {
  id: number;
  problem_id: number;
  text: string;
  url?: string;
  noted_at: string;
  created_at: string;
}

export interface Stats {
  total: number;
  new_today: number;
  indonesia: number;
  row: number;
  ai: number;
  validated: number;
}

export interface User {
  id: number;
  username: string;
}

export interface ProblemInput {
  scope: Scope[];
  source: Source[];
  ai_assisted: boolean;
  title: string;
  body: string;
  status: Status;
  context: string;
  brainstorming: string;
  research_brief: string;
  findings: string;
  related_ids: number[];
}
