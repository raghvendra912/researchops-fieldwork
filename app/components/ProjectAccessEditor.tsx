"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest } from "../../src/lib/api";

type AccessRole = "EDITOR" | "REVIEWER" | "VIEWER";
type Grant = { id?: string; userId: string; displayName?: string; workspaceRole?: string; accessRole: AccessRole };
type Member = { userId: string; displayName: string; workspaceRole: string; allowedRoles: AccessRole[] };
type AccessResponse = { data: Grant[]; meta: { canManage: boolean; members: Member[] } };

const roleHelp: Record<AccessRole, string> = {
  EDITOR: "Can configure and operate this project",
  REVIEWER: "Can review this project's quality flags",
  VIEWER: "Read-only project access",
};

export function ProjectAccessEditor({ projectId, configured, token }: { projectId: string; configured: boolean; token?: string }) {
  const [grants, setGrants] = useState<Grant[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [canManage, setCanManage] = useState(!configured);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const headers = useMemo(() => token ? { authorization: `Bearer ${token}` } : undefined, [token]);

  const load = useCallback(async () => {
    if (configured && !token) return;
    try {
      const response = await apiRequest<AccessResponse>(`/api/projects/${encodeURIComponent(projectId)}/access`, { headers });
      setGrants(response.data); setMembers(response.meta.members); setCanManage(response.meta.canManage); setMessage("");
    } catch { setMessage("Project team access could not be loaded."); }
  }, [configured, headers, projectId, token]);

  useEffect(() => { const initial = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(initial); }, [load]);
  const available = members.filter((member) => !grants.some((grant) => grant.userId === member.userId));

  function add() {
    const member = available[0]; if (!member) return;
    setGrants((current) => [...current, { userId: member.userId, displayName: member.displayName, workspaceRole: member.workspaceRole, accessRole: member.allowedRoles[0] }]);
    setEditing(true);
  }

  async function save() {
    setBusy(true); setMessage("");
    try {
      const response = await apiRequest<AccessResponse>(`/api/projects/${encodeURIComponent(projectId)}/access`, { method: "PUT", headers, body: JSON.stringify({ grants: grants.map(({ userId, accessRole }) => ({ userId, accessRole })) }) });
      setGrants(response.data); setMembers(response.meta.members); setEditing(false); setMessage("Project team access saved.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Project team access could not be saved."); }
    finally { setBusy(false); }
  }

  function memberFor(grant: Grant) { return members.find((member) => member.userId === grant.userId); }
  function updateMember(index: number, userId: string) {
    const member = members.find((item) => item.userId === userId); if (!member) return;
    setGrants((current) => current.map((grant, position) => position === index ? { ...grant, userId, displayName: member.displayName, workspaceRole: member.workspaceRole, accessRole: member.allowedRoles[0] } : grant));
  }

  return <section className="panel" style={{ marginTop: 16 }}>
    <div className="panel-head"><div><h2 className="panel-title">Project team access</h2><span className="panel-note">Owner, administrators, and the assigned project manager already have implicit access.</span></div>{canManage ? <div className="head-actions"><button className="button small ghost" type="button" disabled={!available.length} onClick={add}>Add member</button><button className="button small ghost" type="button" onClick={() => editing ? void load().then(() => setEditing(false)) : setEditing(true)}>{editing ? "Cancel" : "Edit access"}</button></div> : null}</div>
    {message ? <div className="form-error data-error" role="status">{message}</div> : null}
    <div className="table-wrap"><table className="data-table"><thead><tr><th>Member</th><th>Workspace role</th><th>Project role</th><th>Permission</th>{editing ? <th>Action</th> : null}</tr></thead><tbody>
      {grants.map((grant, index) => { const member = memberFor(grant); const choices = member?.allowedRoles ?? [grant.accessRole]; return <tr key={`${grant.userId}-${index}`}><td>{editing ? <select className="control" aria-label={`Project member ${index + 1}`} value={grant.userId} onChange={(event) => updateMember(index, event.target.value)}>{members.filter((item) => item.userId === grant.userId || !grants.some((existing) => existing.userId === item.userId)).map((item) => <option key={item.userId} value={item.userId}>{item.displayName}</option>)}</select> : <strong>{grant.displayName ?? "Team member"}</strong>}</td><td>{member?.workspaceRole ?? grant.workspaceRole ?? "Member"}</td><td>{editing ? <select className="control" aria-label={`Project role ${index + 1}`} value={grant.accessRole} onChange={(event) => setGrants((current) => current.map((item, position) => position === index ? { ...item, accessRole: event.target.value as AccessRole } : item))}>{choices.map((role) => <option key={role}>{role}</option>)}</select> : <span className={`status-pill status-${grant.accessRole === "EDITOR" ? "LIVE" : "PENDING"}`}>{grant.accessRole}</span>}</td><td>{roleHelp[grant.accessRole]}</td>{editing ? <td><button className="button small ghost" type="button" onClick={() => setGrants((current) => current.filter((_, position) => position !== index))}>Remove</button></td> : null}</tr>; })}
      {!grants.length ? <tr><td colSpan={editing ? 5 : 4} style={{ textAlign: "center", padding: 28 }}>No explicit collaborators. Access is limited to workspace leadership and the assigned project manager.</td></tr> : null}
    </tbody></table></div>
    {editing ? <div className="table-footer"><span>{available.length ? `${available.length} workspace member${available.length === 1 ? "" : "s"} available` : "All eligible members are assigned"}</span><button className="button primary small" disabled={busy} type="button" onClick={() => void save()}>{busy ? "Saving…" : "Save access"}</button></div> : null}
  </section>;
}
