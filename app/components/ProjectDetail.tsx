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
import { ProjectOwnershipEditor } from "./ProjectOwnershipEditor";
import { ProjectSurveySetupEditor } from "./ProjectSurveySetupEditor";
import { ProjectResponseVariablesEditor } from "./ProjectResponseVariablesEditor";

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
  const [hasLoadedLiveProject, setHasLoadedLiveProject] = useState(!configured);
  const [refreshing, setRefreshing] = useState(false);
  const token = session?.access_token;

  const loadProject = useCallback(async () => {
    if (configured && !token) return;
    setRefreshing(true);
    const headers = token ? { authorization: `Bearer ${token}` } : undefined;
    try {
      const response = await apiRequest<{ data: Project; meta: { canOperate?: boolean } }>(`/api/projects/${encodeURIComponent(projectId)}?refresh=${Date.now()}`, { headers, cache: "no-store" });
      setProject(response.data);
      setCanOperate(response.meta.canOperate === true);
      setLastUpdated(new Date());
      setMessage("");
    } catch {
      setMessage("Project details could not be loaded.");
    } finally {
      setHasLoadedLiveProject(true);
      setRefreshing(false);
    }
  }, [configured, projectId, token]);

  useEffect(() => {
    const initial = window.setTimeout(() => void loadProject(), 0);
    const timer = window.setInterval(() => void loadProject(), 30_000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, [loadProject]);

  if (!hasLoadedLiveProject) {
    return <div className="project-center-page">
      <section className="reference-filter" aria-label="Project scope"><div className="reference-filter-grid"><div className="field"><span className="field-label">Project</span><span className="control static-control">{projectId}</span></div><div className="field"><span className="field-label">Metrics</span><span className="control static-control">Loading fresh data…</span></div></div><div className="reference-filter-extra"><span className="panel-note">Fetching the current project record and respondent totals.</span></div></section>
      <section className="panel" aria-busy="true"><div className="panel-head"><div><h1 className="panel-title">Loading project</h1><span className="panel-note">Counts will appear when the live response is ready.</span></div></div></section>
    </div>;
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage(""); const payload = Object.fromEntries(new FormData(event.currentTarget).entries());
    try { await apiRequest(`/api/projects/${encodeURIComponent(project.id)}`, { method: "PATCH", headers: token ? { authorization: `Bearer ${token}` } : undefined, body: JSON.stringify(payload) }); setProject((current) => ({ ...current, name: String(payload.projectName), clientPo: String(payload.clientPo), type: String(payload.type), category: String(payload.category), cpi: Number(payload.clientCpi), quota: Number(payload.quota), endDate: String(payload.endDate), surveyUrl: String(payload.surveyUrl), securityTerminateUrl: String(payload.securityTerminateUrl) })); setEditing(false); setMessage("Project details saved."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Project details could not be saved."); } finally { setBusy(false); }
  }

  async function transition(status: ProjectStatus) {
    if (status === "LIVE" && !window.confirm("Launch this project now? Confirm the survey URL, suppliers, quotas, and security settings have been double-checked.")) return;
    if (status === "CLOSED" && !window.confirm("Close this project? This lifecycle state is final.")) return;
    setBusy(true); setMessage("");
    try { await apiRequest(`/api/projects/${encodeURIComponent(project.id)}/transitions`, { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : undefined, body: JSON.stringify({ status, launchConfirmed: status === "LIVE" }) }); setProject((current) => ({ ...current, status })); setMessage(`Project moved to ${status}.`); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Project status could not be changed."); } finally { setBusy(false); }
  }

  return <div className="project-center-page project-detail-page">
    <section className="reference-filter" aria-label="Project details controls"><div className="reference-filter-grid"><div className="field"><span className="field-label">Project ID</span><span className="control static-control">{project.id}</span></div><div className="field"><span className="field-label">Client</span><span className="control static-control">{project.client}</span></div><div className="field"><span className="field-label">Project manager</span><span className="control static-control">{project.manager}</span></div><div className="field"><span className="field-label">Status</span><span className="control static-control">{project.status}</span></div><div className="reference-actions"><button className="reference-icon-button" type="button" aria-label="Refresh project" title="Refresh project" disabled={refreshing} onClick={() => void loadProject()}>{refreshing ? "…" : "↻"}</button><Link className="reference-icon-button" href="/projects" aria-label="Back to Project Center" title="Back to Project Center">←</Link></div></div><div className="reference-filter-extra"><span className="panel-note">Project Details · {project.name} · {project.market} · {project.type}</span>{message ? <span className="panel-note">{message}</span> : null}</div></section>
    <section className="panel project-detail-summary"><div className="panel-head"><div><h1 className="panel-title">Project Details</h1><span className="panel-note">Complete project identity, delivery setup and fieldwork controls</span></div><span className={`status-pill status-${project.status}`}>{project.status}</span></div><div className="project-detail-summary-grid"><DetailCell label="Project ID" value={project.id} /><DetailCell label="Project name" value={project.name} wide /><DetailCell label="Project type" value={project.type} /><DetailCell label="Project manager" value={project.manager} /><DetailCell label="Sales person" value={project.salesPerson || "Unassigned"} /><DetailCell label="Client" value={project.client} /><DetailCell label="Supplier" value={project.supplierAssignments?.map((item) => item.supplierName).join(", ") || "Open Supplier delivery"} wide /><DetailCell label="Market" value={project.market} /><DetailCell label="Status" value={project.status} /><DetailCell label="Client PO" value={project.clientPo || "Not set"} /><DetailCell label="Last updated" value={lastUpdated ? lastUpdated.toLocaleString() : "Loading live data"} /></div></section>
    <nav className="panel project-option-bar" aria-label="Project detail options"><OptionLink href="#overview" glyph="OV" label="Overview" /><OptionLink href="#suppliers" glyph="SU" label="Suppliers" /><OptionLink href="#ownership" glyph="OW" label="Ownership" /><OptionLink href="#markets" glyph="MK" label="Markets" /><OptionLink href="#survey" glyph="SV" label="Survey setup" /><OptionLink href="#prescreening" glyph="PS" label="Pre-screening" /><OptionLink href="#quotas" glyph="QT" label="Quotas" /><OptionLink href="#access" glyph="AC" label="Access" /></nav>
    <div id="overview" className="project-detail-anchor" />
    <section className="panel project-outcomes" style={{ marginTop: 10 }}><div className="panel-head"><div><h2 className="panel-title">Live outcome breakdown</h2><span className="panel-note">IR = CO / (CO + TE) · Conversion = CO / RC · refreshed every 30 seconds</span></div><Link className="button small ghost" href={`/respondents?project=${encodeURIComponent(project.id)}`}>Respondent ledger →</Link></div><div className="outcome-grid project"><OutcomeMetric label="Reached survey" value={project.reached} /><OutcomeMetric label="Completed" value={project.completes} /><OutcomeMetric label="Terminated" value={project.terminates} /><OutcomeMetric label="Quota full" value={project.overQuota} /><OutcomeMetric label="Quality rejected" value={project.qualityTerm} /><OutcomeMetric label="Last trusted event" value={project.lastEventAt ? new Date(project.lastEventAt).toLocaleString() : "No events"} wide /></div><div className="outcome-grid project" style={{ marginTop: 12 }}><OutcomeMetric label="Test starts" value={project.testStarts ?? 0} /><OutcomeMetric label="Test completed" value={project.testCompletes ?? 0} /><OutcomeMetric label="Test terminated" value={project.testTerminates ?? 0} /><OutcomeMetric label="Test quota full" value={project.testOverQuota ?? 0} /><OutcomeMetric label="Test quality rejected" value={project.testQualityTerm ?? 0} /></div></section>
    <section className="panel" style={{ marginTop: 10 }}><div className="panel-head"><div><h2 className="panel-title">Fieldwork totals</h2><span className="panel-note">Starts · in progress · completes · abandoned</span></div>{canOperate ? <div className="row-actions">{transitions[project.status].map((action) => <button className="button small ghost" disabled={busy} key={action.status} type="button" onClick={() => void transition(action.status)}>{action.label}</button>)}</div> : <span className="panel-note">Read only</span>}</div><div className="outcome-grid project"><OutcomeMetric label="Starts" value={project.starts} /><OutcomeMetric label="In progress" value={project.inProgress ?? 0} /><OutcomeMetric label="Completes" value={project.completes} /><OutcomeMetric label="Abandoned" value={project.abandons ?? 0} /></div></section>
    <div className="dashboard-grid" style={{ marginTop: 10 }}><div id="suppliers" className="project-detail-anchor"><ProjectSuppliersEditor projectId={project.id} configured={configured} token={token} canOperate={canOperate} refreshKey={lastUpdated?.getTime()} /></div><section className="panel"><div className="panel-head"><h2 className="panel-title">Project information</h2>{canOperate ? <button className="button small ghost" type="button" onClick={() => setEditing((value) => !value)}>{editing ? "Cancel" : "Edit"}</button> : null}</div>
      {editing ? <form className="form-section" onSubmit={save}><div className="form-grid"><Field label="Project name" name="projectName" value={project.name} required /><Field label="Client PO" name="clientPo" value={project.clientPo} /><SelectField label="Project type" name="type" value={project.type} options={projectTypes} /><SelectField label="Category" name="category" value={project.category ?? "None"} options={categories} /><Field label="Target completes" name="quota" value={project.quota ?? 500} type="number" required /><Field label="Client CPI" name="clientCpi" value={project.cpi} type="number" required /><Field label="End date" name="endDate" value={project.endDate ?? ""} type="date" /></div><div className="table-footer"><span>Controlled project fields</span><button className="button small ghost" disabled={busy} type="submit">{busy ? "Saving…" : "Save changes →"}</button></div></form>
      : <div className="info-list"><Info label="Client" value={project.client} /><Info label="Client PO" value={project.clientPo || "Not set"} /><Info label="Created" value={project.createdAt ? new Date(project.createdAt).toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata" }) : "Not set"} /><Info label="Project type" value={project.type} /><Info label="Category" value={project.category || "None"} /><Info label="Target completes" value={String(project.quota ?? 500)} /><Info label="Client CPI" value={`$${project.cpi.toFixed(2)}`} /><Info label="Last complete" value={project.lastComplete} /></div>}
    </section></div><div id="ownership" className="project-detail-anchor"><ProjectOwnershipEditor projectId={project.id} configured={configured} token={token} onSaved={() => void loadProject()} /></div><div id="markets" className="project-detail-anchor"><ProjectMarketsEditor projectId={project.id} configured={configured} token={token} canOperate={canOperate} /></div><div id="survey" className="project-detail-anchor"><ProjectSurveySetupEditor projectId={project.id} configured={configured} token={token} canOperate={canOperate} /></div><ProjectResponseVariablesEditor projectId={project.id} configured={configured} token={token} canOperate={canOperate} /><div id="prescreening" className="project-detail-anchor"><ProjectEligibilityEditor projectId={project.id} configured={configured} token={token} canOperate={canOperate} /></div><div id="quotas" className="project-detail-anchor"><ProjectQuotaCellsEditor projectId={project.id} configured={configured} token={token} canOperate={canOperate} /></div><div id="access" className="project-detail-anchor"><ProjectAccessEditor projectId={project.id} configured={configured} token={token} /></div>
  </div>;
}

function Field({ label, name, value, type = "text", required = false }: { label: string; name: string; value: string | number; type?: string; required?: boolean }) { return <div className="field"><label htmlFor={`edit-${name}`}>{label}</label><input className="control" id={`edit-${name}`} name={name} type={type} min={type === "number" ? (name === "quota" ? 1 : 0) : undefined} step={name === "clientCpi" ? "0.01" : undefined} defaultValue={value} required={required} /></div>; }
function SelectField({ label, name, value, options }: { label: string; name: string; value: string; options: string[] }) { const values = options.includes(value) ? options : [value, ...options]; return <div className="field"><label htmlFor={`edit-${name}`}>{label}</label><select className="control" id={`edit-${name}`} name={name} defaultValue={value}>{values.map((item) => <option key={item}>{item}</option>)}</select></div>; }
function OutcomeMetric({ label, value, wide = false }: { label: string; value: string | number; wide?: boolean }) { return <div className={`outcome-card ${wide ? "wide" : ""}`}><span>{label}</span><strong>{typeof value === "number" ? value.toLocaleString() : value}</strong></div>; }
function Info({ label, value }: { label: string; value: string }) { return <div className="info-row"><span>{label}</span><strong>{value}</strong></div>; }
function DetailCell({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) { return <div className={`project-detail-cell${wide ? " wide" : ""}`}><span>{label}</span><strong>{value}</strong></div>; }
function OptionLink({ href, glyph, label }: { href: string; glyph: string; label: string }) { return <a className="project-option-link" href={href}><span>{glyph}</span><strong>{label}</strong></a>; }
function formatDuration(seconds: number) { if (!seconds) return "—"; const wholeSeconds = Math.max(0, Math.round(seconds)); const hours = Math.floor(wholeSeconds / 3600); const minutes = Math.floor((wholeSeconds % 3600) / 60); const remainingSeconds = wholeSeconds % 60; return hours ? `${hours}h ${minutes}m` : `${minutes}m ${remainingSeconds}s`; }
