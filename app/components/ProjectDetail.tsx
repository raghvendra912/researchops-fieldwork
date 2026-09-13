"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { projects } from "../../src/features/projects/mockProjects";
import type { Project, ProjectStatus } from "../../src/features/projects/project.types";
import { useAuth } from "../../src/features/auth/AuthProvider";
import { apiRequest } from "../../src/lib/api";
import Link from "./NavigationLink";
import { ProjectMarketsEditor } from "./ProjectMarketsEditor";
import { ProjectSuppliersEditor } from "./ProjectSuppliersEditor";
import { ProjectEligibilityEditor } from "./ProjectEligibilityEditor";
import { ProjectQuotaCellsEditor } from "./ProjectQuotaCellsEditor";
import { ProjectAccessEditor } from "./ProjectAccessEditor";
import { ProjectSurveySetupEditor } from "./ProjectSurveySetupEditor";

const transitions: Record<ProjectStatus, Array<{ status: ProjectStatus; label: string }>> = { PENDING: [{ status: "LIVE", label: "Launch project" }], LIVE: [{ status: "PAUSED", label: "Pause fieldwork" }, { status: "ID_SUBMITTED", label: "Submit respondent IDs" }], PAUSED: [{ status: "LIVE", label: "Resume fieldwork" }, { status: "ID_SUBMITTED", label: "Submit respondent IDs" }], ID_SUBMITTED: [{ status: "INVOICED", label: "Mark invoiced" }, { status: "LIVE", label: "Reopen fieldwork" }], INVOICED: [{ status: "CLOSED", label: "Close project" }], CLOSED: [] };
const projectTypes = ["B2C", "B2B", "Recontact", "Healthcare"];
const categories = ["None", "Business & Professionals", "General Household", "Financial Technology", "Consumer Goods", "Healthcare", "Automotive", "Other"];

export function ProjectDetail({ projectId }: { projectId: string }) {
  const fallback = projects.find((item) => item.id === projectId) ?? projects[0];
  const { configured, session } = useAuth();
  const [project, setProject] = useState<Project>(fallback);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [canOperate, setCanOperate] = useState(!configured);
  const [message, setMessage] = useState("");
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const token = session?.access_token;

  const loadProject = useCallback(async () => {
    if (configured && !token) return;
    const headers = token ? { authorization: `Bearer ${token}` } : undefined;
    try {
      const response = await apiRequest<{ data: Project; meta: { canOperate?: boolean } }>(`/api/projects/${encodeURIComponent(projectId)}`, { headers });
      setProject(response.data);
      setCanOperate(response.meta.canOperate === true);
      setLastUpdated(new Date());
      setMessage("");
    } catch {
      setMessage("Project details could not be loaded.");
    }
  }, [configured, projectId, token]);

  useEffect(() => {
    const initial = window.setTimeout(() => void loadProject(), 0);
    const timer = window.setInterval(() => void loadProject(), 30_000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, [loadProject]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage(""); const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
    try { await apiRequest(`/api/projects/${encodeURIComponent(project.id)}`, { method: "PATCH", headers: token ? { authorization: `Bearer ${token}` } : undefined, body: JSON.stringify(payload) }); setProject((current) => ({ ...current, name: String(payload.projectName), clientPo: String(payload.clientPo), type: String(payload.type), category: String(payload.category), cpi: Number(payload.clientCpi), quota: Number(payload.quota), endDate: String(payload.endDate), surveyUrl: String(payload.surveyUrl), securityTerminateUrl: String(payload.securityTerminateUrl) })); setEditing(false); setMessage("Project details saved."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Project details could not be saved."); } finally { setBusy(false); }
  }

  async function transition(status: ProjectStatus) {
    if (status === "CLOSED" && !window.confirm("Close this project? This lifecycle state is final.")) return;
    setBusy(true); setMessage("");
    try { await apiRequest(`/api/projects/${encodeURIComponent(project.id)}/transitions`, { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : undefined, body: JSON.stringify({ status }) }); setProject((current) => ({ ...current, status })); setMessage(`Project moved to ${status}.`); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Project status could not be changed."); } finally { setBusy(false); }
  }

  return <>
    <div className="page-head"><div><div className="eyebrow">{project.id} · {project.client}</div><h1 className="page-title">Project workspace</h1><p className="page-subtitle">Operational detail, supplier delivery, and live respondent outcomes.</p></div><div className="head-actions"><span className="panel-note">{lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "Loading live metrics"}</span><button className="button ghost" type="button" onClick={() => void loadProject()}>Refresh</button>{canOperate ? transitions[project.status].map((action, index) => <button className={`button ${index === 0 ? "primary" : ""}`} disabled={busy} key={action.status} type="button" onClick={() => void transition(action.status)}>{action.label}</button>) : <span className="status-pill status-PENDING">Read only</span>}</div></div>
    {message ? <div className="form-error data-error" role="status">{message}</div> : null}
    <section className="panel detail-hero"><div><span className={`status-pill status-${project.status}`}>{project.status}</span><h1>{project.name}</h1><p>{project.market} · {project.type} · PM {project.manager}</p></div><div className="hero-metrics"><div className="hero-metric"><span>Completes</span><strong>{project.completes}</strong></div><div className="hero-metric"><span>Incidence</span><strong>{project.incidenceRate}%</strong></div><div className="hero-metric"><span>Avg. duration</span><strong>{formatDuration(project.averageDurationSeconds ?? 0)}</strong></div></div></section>
    <div className="metric-strip"><Metric label="Starts" value={project.starts} note="All suppliers" /><Metric label="In progress" value={project.inProgress ?? 0} note="Awaiting an outcome" /><Metric label="Completes" value={project.completes} note={`${project.conversionRate.toFixed(1)}% conversion`} /><Metric label="Abandoned" value={project.abandons ?? 0} note={`${project.abandonRate.toFixed(1)}% drop-off`} /></div>
    <section className="panel project-outcomes"><div className="panel-head"><div><h2 className="panel-title">Outcome breakdown</h2><span className="panel-note">Automatically refreshed every 30 seconds</span></div><Link className="button small ghost" href={`/respondents?project=${encodeURIComponent(project.id)}`}>Respondent ledger →</Link></div><div className="outcome-grid project"><OutcomeMetric label="Reached survey" value={project.reached} /><OutcomeMetric label="Terminated" value={project.terminates} /><OutcomeMetric label="Quota full" value={project.overQuota} /><OutcomeMetric label="Quality rejected" value={project.qualityTerm} /><OutcomeMetric label="Last trusted event" value={project.lastEventAt ? new Date(project.lastEventAt).toLocaleString() : "No events"} wide /></div></section>
    <div className="split-grid"><ProjectSuppliersEditor projectId={project.id} configured={configured} token={token} canOperate={canOperate} refreshKey={lastUpdated?.getTime()} /><section className="panel"><div className="panel-head"><h2 className="panel-title">Project details</h2>{canOperate ? <button className="button small ghost" type="button" onClick={() => setEditing((value) => !value)}>{editing ? "Cancel" : "Edit"}</button> : null}</div>
      {editing ? <form className="form-section" onSubmit={save}><div className="form-grid"><Field label="Project name" name="projectName" value={project.name} required /><Field label="Client PO" name="clientPo" value={project.clientPo} /><SelectField label="Project type" name="type" value={project.type} options={projectTypes} /><SelectField label="Category" name="category" value={project.category ?? "None"} options={categories} /><Field label="Target completes" name="quota" value={project.quota ?? 500} type="number" required /><Field label="Client CPI" name="clientCpi" value={project.cpi} type="number" required /><Field label="End date" name="endDate" value={project.endDate ?? ""} type="date" /></div><div className="form-actions"><button className="button primary" disabled={busy} type="submit">{busy ? "Saving…" : "Save changes"}</button></div></form>
      : <div className="info-list"><Info label="Client" value={project.client} /><Info label="Client PO" value={project.clientPo || "Not set"} /><Info label="Created" value={project.createdAt ? new Date(project.createdAt).toLocaleDateString() : "Not set"} /><Info label="Project type" value={project.type} /><Info label="Category" value={project.category || "None"} /><Info label="Target completes" value={String(project.quota ?? 500)} /><Info label="Client CPI" value={`$${project.cpi.toFixed(2)}`} /><Info label="Last complete" value={project.lastComplete} /></div>}
    </section></div><ProjectMarketsEditor projectId={project.id} configured={configured} token={token} canOperate={canOperate} /><ProjectSurveySetupEditor projectId={project.id} configured={configured} token={token} canOperate={canOperate} /><ProjectEligibilityEditor projectId={project.id} configured={configured} token={token} canOperate={canOperate} /><ProjectQuotaCellsEditor projectId={project.id} configured={configured} token={token} canOperate={canOperate} /><ProjectAccessEditor projectId={project.id} configured={configured} token={token} />
  </>;
}

function Field({ label, name, value, type = "text", required = false }: { label: string; name: string; value: string | number; type?: string; required?: boolean }) { return <div className="field"><label htmlFor={`edit-${name}`}>{label}</label><input className="control" id={`edit-${name}`} name={name} type={type} min={type === "number" ? (name === "quota" ? 1 : 0) : undefined} step={name === "clientCpi" ? "0.01" : undefined} defaultValue={value} required={required} /></div>; }
function SelectField({ label, name, value, options }: { label: string; name: string; value: string; options: string[] }) { const values = options.includes(value) ? options : [value, ...options]; return <div className="field"><label htmlFor={`edit-${name}`}>{label}</label><select className="control" id={`edit-${name}`} name={name} defaultValue={value}>{values.map((item) => <option key={item}>{item}</option>)}</select></div>; }
function Metric({ label, value, note }: { label: string; value: string | number; note: string }) { return <div className="panel metric-card"><div className="metric-top"><span>{label}</span><span className="metric-delta">{note}</span></div><div className="metric-value">{value.toLocaleString()}</div></div>; }
function OutcomeMetric({ label, value, wide = false }: { label: string; value: string | number; wide?: boolean }) { return <div className={`outcome-card ${wide ? "wide" : ""}`}><span>{label}</span><strong>{typeof value === "number" ? value.toLocaleString() : value}</strong></div>; }
function Info({ label, value }: { label: string; value: string }) { return <div className="info-row"><span>{label}</span><strong>{value}</strong></div>; }
function formatDuration(seconds: number) { if (!seconds) return "—"; const minutes = Math.floor(seconds / 60); return `${minutes}m ${seconds % 60}s`; }
