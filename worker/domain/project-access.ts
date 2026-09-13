import type { WorkspaceRole } from "../lib/authorization";

export type ProjectAccessRole = "EDITOR" | "REVIEWER" | "VIEWER";
export type ProjectAccessGrant = { id?: string; userId: string; displayName?: string; workspaceRole?: WorkspaceRole; accessRole: ProjectAccessRole };

export const projectAccessOptions: Record<WorkspaceRole, ProjectAccessRole[]> = {
  OWNER: [],
  ADMIN: [],
  PM: ["EDITOR", "VIEWER"],
  ANALYST: ["REVIEWER", "VIEWER"],
  MEMBER: ["VIEWER"],
};

export function validProjectAccessRole(workspaceRole: WorkspaceRole, accessRole: ProjectAccessRole) {
  return projectAccessOptions[workspaceRole].includes(accessRole);
}
