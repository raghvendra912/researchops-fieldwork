"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../../src/features/auth/AuthProvider";
import { apiRequest } from "../../../src/lib/api";

type Role = "OWNER" | "ADMIN" | "PM" | "ANALYST" | "MEMBER";
type Member = { userId: string; email: string; displayName: string; role: Role; createdAt: string };
const roles: Role[] = ["ADMIN", "PM", "ANALYST", "MEMBER"];
const roleHelp: Record<Role, string> = { OWNER: "Full workspace ownership", ADMIN: "Users, settings, clients and projects", PM: "Projects and suppliers", ANALYST: "Analysis and review", MEMBER: "Assigned project access" };

export default function AdminPage() {
  const { configured, session } = useAuth(); const token = session?.access_token;
  const [members, setMembers] = useState<Member[]>([]); const [actorRole, setActorRole] = useState<Role | "">(configured ? "" : "OWNER");
  const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const headers = useMemo(() => token ? { authorization: `Bearer ${token}` } : undefined, [token]);
  const load = useCallback(async () => { if (configured && !token) return; try { const response = await apiRequest<{ data: Member[]; meta: { role: Role } }>("/api/organization-members", { headers }); setMembers(response.data); setActorRole(response.meta.role); } catch (error) { setMessage(error instanceof Error ? error.message : "Users could not be loaded."); } }, [configured, headers, token]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); setBusy(true); setMessage("");
    try { await apiRequest("/api/organization-members", { method: "POST", headers, body: JSON.stringify({ displayName: data.get("displayName"), email: data.get("email"), role: data.get("role") }) }); form.reset(); setMessage("Invitation sent and organization access created."); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "User could not be created."); } finally { setBusy(false); }
  }
  async function updateRole(userId: string, role: Role) { setBusy(true); try { await apiRequest(`/api/organization-members/${userId}`, { method: "PATCH", headers, body: JSON.stringify({ role }) }); setMessage("Role updated."); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : "Role could not be updated."); } finally { setBusy(false); } }
  async function revoke(member: Member) { if (!window.confirm(`Remove ${member.email} from this organization?`)) return; setBusy(true); try { await apiRequest(`/api/organization-members/${member.userId}`, { method: "DELETE", headers }); setMessage("Organization access removed."); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : "Access could not be removed."); } finally { setBusy(false); } }
  const manageable = (member: Member) => member.role !== "OWNER" && !(actorRole === "ADMIN" && member.role === "ADMIN") && member.userId !== session?.user?.id;

  return <div className="project-center-page">
    <section className="reference-filter" aria-label="User administration"><div className="reference-filter-grid"><div className="field"><span className="field-label">Area</span><span className="control static-control">Organization users</span></div><div className="field"><span className="field-label">Members</span><span className="control static-control">{members.length}</span></div><div className="field"><span className="field-label">Your access</span><span className="control static-control">{actorRole || "Loading"}</span></div><div className="field"><span className="field-label">Security</span><span className="control static-control">Role based</span></div></div><div className="reference-filter-extra"><span className="panel-note">Admin · Invite users, assign roles, and revoke organization access.</span></div></section>
    {message ? <div className="form-error data-error" role="status">{message}</div> : null}
    <section className="panel form-panel"><form onSubmit={invite}><div className="form-section"><div className="section-head"><div><h2>Create organization user</h2><p>The user receives an email invitation. Their selected role applies only inside this organization.</p></div></div><div className="form-grid"><div className="field"><label htmlFor="member-name">Full name</label><input className="control" id="member-name" name="displayName" required minLength={2} maxLength={100} /></div><div className="field"><label htmlFor="member-email">Work email</label><input className="control" id="member-email" name="email" type="email" required /></div><div className="field"><label htmlFor="member-role">Organization role</label><select className="control" id="member-role" name="role" defaultValue="MEMBER">{roles.filter((role) => actorRole === "OWNER" || role !== "ADMIN").map((role) => <option key={role} value={role}>{role} · {roleHelp[role]}</option>)}</select></div></div></div><div className="table-footer"><span>Owner access cannot be assigned or removed here.</span><button className="button primary small" disabled={busy || !["OWNER", "ADMIN"].includes(actorRole)} type="submit">{busy ? "Working…" : "Invite user"}</button></div></form></section>
    <section className="panel" style={{ marginTop: 16 }}><div className="panel-head"><div><h2 className="panel-title">Organization access</h2><span className="panel-note">Changes take effect on the user’s next authorized request.</span></div></div><div className="table-wrap"><table className="data-table"><thead><tr><th>User</th><th>Email</th><th>Role</th><th>Access</th><th>Joined</th><th>Action</th></tr></thead><tbody>{members.map((member) => <tr key={member.userId}><td><strong>{member.displayName}</strong></td><td>{member.email}</td><td>{manageable(member) ? <select className="control" aria-label={`Role for ${member.email}`} value={member.role} disabled={busy} onChange={(event) => void updateRole(member.userId, event.target.value as Role)}>{roles.filter((role) => actorRole === "OWNER" || role !== "ADMIN").map((role) => <option key={role}>{role}</option>)}</select> : <span className={`status-pill status-${member.role === "OWNER" ? "LIVE" : "ACTIVE"}`}>{member.role}</span>}</td><td>{roleHelp[member.role]}</td><td>{new Date(member.createdAt).toLocaleDateString()}</td><td>{manageable(member) ? <button className="button small ghost" disabled={busy} type="button" onClick={() => void revoke(member)}>Remove</button> : <span className="panel-note">Protected</span>}</td></tr>)}{!members.length ? <tr><td colSpan={6} style={{ padding: 28, textAlign: "center" }}>No organization users found.</td></tr> : null}</tbody></table></div></section>
  </div>;
}
