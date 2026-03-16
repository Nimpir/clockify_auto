export type MonthStatus = "untouched" | "partial" | "generated" | "submitted";

export interface MonthMeta {
  month: string;
  status: MonthStatus;
  tickets_loaded: boolean;
  report_loaded: boolean;
  plan_generated: boolean;
  submitted: boolean;
  submitted_at: string | null;
  entries_created: number;
  entries_failed: number;
  last_generated_at: string | null;
}

export interface Settings {
  clockify_api_key: string;
  workspace_id: string;
  timezone: string;
  work_start: string;
  work_end: string;
  skip_weekends: boolean;
  documents_path: string;
}

export interface PlanEntry {
  description: string;
  projectId: string;
  start: string;      // UTC ISO string
  end: string;        // UTC ISO string
  date: string;       // YYYY-MM-DD local
  localStart: string; // HH:MM local
  localEnd: string;   // HH:MM local
  ticketKey: string;
  hours: number;
  isExisting: boolean;
}

export interface Ticket {
  key: string;
  title: string;
  projectId: string;
}

export interface Toast {
  id: number;
  message: string;
  type: "success" | "error" | "info";
}
