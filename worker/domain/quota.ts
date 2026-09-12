import { evaluateEligibility, type EligibilityRule } from "./eligibility.ts";

export type QuotaCell = {
  id?: string;
  name: string;
  targetQuota: number;
  priority: number;
  active: boolean;
  conditions: EligibilityRule[];
  completes?: number;
  reserved?: number;
  remaining?: number;
};

export function matchingQuotaCellIds(cells: QuotaCell[], answers: Record<string, string | undefined>) {
  return cells
    .filter((cell) => cell.active && evaluateEligibility(cell.conditions, answers).eligible)
    .sort((left, right) => left.priority - right.priority || left.name.localeCompare(right.name))
    .map((cell) => cell.id)
    .filter((id): id is string => Boolean(id));
}
