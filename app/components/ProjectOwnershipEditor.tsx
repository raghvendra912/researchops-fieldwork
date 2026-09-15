"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiRequest } from "../../src/lib/api";

type Member = { userId: string; displayName: string; workspaceRole: string };
type Ownership = { primaryManagerId: string | null; primaryManager: string; secondaryManagerId: string | null; secondaryManager: string; salesPersonId: string | null; salesPerson: string };
type OwnershipResponse = { data: Ownership; meta: { canManage: boolean; managers: Member[]; salesPeople: Member[] } };

export function ProjectOwnershipEditor({ projectId, configured, token, onSaved }: { projectId: string; configured: boolean; token?: string; onSaved?: () => void }) {
  const [ownership, setOwnership] = useState<Ownership | null>(null);
  const [managers, setManagers] = useState<Member[]>([]);
  const [salesPeople, setSalesPeople] = useState<Member[]>([]);
  const [canManage, setCanManage] = useState(!configured);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const headers = useMemo(() => token ? { authorization: `Bearer ${token}` } : undefined, [token]);

  const load = useCallback(async () => {
    if (configured && !token) return;
    try {
      const response = await apiRequest<OwnershipResponse>(`/api/projects/${encodeURIComponent(projectId)}/ownership`, { headers });
      setOwnership(response.data); setManagers(response.meta.managers); setSalesPeople(response.meta.salesPeople); setCanManage(response.meta.canManage); setMessage("");
    } catch { setMessage("Project ownership could not be loaded."); }
  }, [configured, headers, projectId, token]);

  useEffect(() => { const initial = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(initial); }, [load]);

  async function save() {
    if (!ownership) return;
    setSaving(true); setMessage("");
    try {
      const response = await apiRequest<OwnershipResponse>(`/api/projects/${encodeURIComponent(projectId)}/ownership`, { method: "PUT", headers, body: JSON.stringify({ secondaryManagerId: ownership.secondaryManagerId, salesPersonId: ownership.salesPersonId }) });
      setOwnership(response.data); setEditing(false); setMessage("Project ownership saved."); onSaved?.();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Project ownership could not be saved."); }
    finally { setSaving(false); }
  }

  return <section className="panel ownership-panel" aria-label="Project ownership">
    <div className="panel-head"><div><h2 className="panel-title">Project ownership</h2><span className="panel-note">Secondary PM helps operate and review this project. Sales ownership does not grant financial access.</span></div>{canManage ? <button className="button small ghost" type="button" disabled={!ownership} onClick={() => editing ? void load().then(() => setEditing(false)) : setEditing(true)}>{editing ? "Cancel" : "Edit ownership"}</button> : null}</div>
    {message ? <div className="form-error data-error" role="status">{message}</div> : null}
    <div className="ownership-grid">
      <div className="field"><span className="field-label">Primary PM</span><strong>{ownership?.primaryManager ?? "Loading…"}</strong></div>
      <div className="field"><label htmlFor="secondary-pm">Secondary PM</label>{editing ? <select className="control" id="secondary-pm" value={ownership?.secondaryManagerId ?? ""} onChange={(event) => setOwnership((current) => current ? { ...current, secondaryManagerId: event.target.value || null } : current)}><option value="">Unassigned</option>{managers.map((manager) => <option key={manager.userId} value={manager.userId}>{manager.displayName}</option>)}</select> : <strong>{ownership?.secondaryManager || "Unassigned"}</strong>}</div>
      <div className="field"><label htmlFor="sales-person">Sales Person</label>{editing ? <select className="control" id="sales-person" value={ownership?.salesPersonId ?? ""} onChange={(event) => setOwnership((current) => current ? { ...current, salesPersonId: event.target.value || null } : current)}><option value="">Unassigned</option>{salesPeople.map((person) => <option key={person.userId} value={person.userId}>{person.displayName} · {person.workspaceRole}</option>)}</select> : <strong>{ownership?.salesPerson || "Unassigned"}</strong>}</div>
    </div>
    {editing ? <div className="table-footer"><span>Assignments must belong to this workspace.</span><button className="button primary small" disabled={saving || !ownership} type="button" onClick={() => void save()}>{saving ? "Saving…" : "Save ownership"}</button></div> : null}
  </section>;
}
