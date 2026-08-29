export type ProjectStatus = "DRAFT" | "LIVE" | "PENDING" | "PAUSED" | "CLOSED";

export interface Project {
  id: string;
  name: string;
  client: string;
  clientPo: string;
  market: string;
  type: string;
  manager: string;
  status: ProjectStatus;
  starts: number;
  reached: number;
  l24: number;
  completes: number;
  terminates: number;
  overQuota: number;
  qualityTerm: number;
  abandonRate: number;
  incidenceRate: number;
  conversionRate: number;
  cpi: number;
  quota?: number;
  category?: string;
  createdAt?: string;
  startDate?: string;
  endDate?: string;
  surveyUrl?: string;
  securityTerminateUrl?: string;
  averageDurationSeconds?: number;
  lastComplete: string;
}
