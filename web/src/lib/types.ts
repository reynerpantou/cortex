export type Scope = "id" | "row";
export type Source = "personal" | "other" | "ai";
export type Status = "inbox" | "validated" | "parked" | "dropped";

export interface Problem {
  id: number;
  scope: Scope;
  source: Source;
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
  scope: Scope;
  source: Source;
  title: string;
  body: string;
  status: Status;
}
