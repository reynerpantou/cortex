export type Scope = "id" | "row";
export type Source = "personal" | "other" | "ai";
export type Status = "backlog" | "researching" | "in_review" | "building" | "shipped" | "archived";

export const SCOPES: Scope[] = ["id", "row"];
export const SOURCES: Source[] = ["personal", "other", "ai"];
export const STATUSES: Status[] = ["backlog", "researching", "in_review", "building", "shipped", "archived"];

export interface Problem {
  id: number;
  scope: Scope[];
  source: Source[];
  title: string;
  body: string;
  status: Status;
  source_url?: string;
  recurrence: number;
  created_at: string;
  updated_at: string;
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
  title: string;
  body: string;
  status: Status;
}
