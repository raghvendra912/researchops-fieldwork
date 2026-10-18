"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { projects } from "../../src/features/projects/mockProjects";
import type { Project, ProjectStatus } from "../../src/features/projects/project.types";
import { useAuth } from "../../src/features/auth/AuthProvider";
import { apiRequest } from "../../src/lib/api";
import Link from "./NavigationLink";
import { ProjectAccessEditor } from "./ProjectAccessEditor";
import { ProjectEligibilityEditor } from "./ProjectEligibilityEditor";
import { ProjectMarketsEditor } from "./ProjectMarketsEditor";
import { ProjectOwnershipEditor } from "./ProjectOwnershipEditor";
import { ProjectQuotaCellsEditor } from "./ProjectQuotaCellsEditor";
import { ProjectResponseVariablesEditor } from "./ProjectResponseVariablesEditor";
import { ProjectScreeningQuestionsEditor } from "./ProjectScreeningQuestionsEditor";
import { ProjectSuppliersEditor } from "./ProjectSuppliersEditor";
import { ProjectSurveySetupEditor } from "./ProjectSurveySetupEditor";

const projectTypes = ["B2C", "B2B", "Healthcare", "Recontact", "Tracker", "Qualitative", "Quantitative", "Mixed method", "IHUT", "CLT"];
const categories = ["None", "Business & Professionals", "General Household", "Financial Technology", "Consumer Goods", "Healthcare", "Automotive", "Other"];
const securityLabels: Record<string, string> = { search: "Search", review: "Review", predupe: "Predupe", activity: "Activity", emailVerify: "Email verify", fraudGuard: "FraudGuard", dfioPortal: "DFIO Portal", survalidate: "Survalidate", prescreeningCaptcha: "Pre-screening Captcha", speederTerminate: "Speeder Term", duplicateIp: "Duplicate IP" };
const transitions: Record<ProjectStatus, Array<{ status: ProjectStatus; label: string }>> = { PENDING: [{ status: "LIVE", label: "Launch project" }], LIVE: [{ status: "PAUSED", label: "Pause fieldwork" }, { status: "ID_SUBMITTED", label: "Submit respondent IDs" }], PAUSED: [{ status: "LIVE", label: "Resume fieldwork" }, { status: "ID_SUBMITTED", label: "Submit respondent IDs" }], ID_SUBMITTED: [{ status: "INVOICED", label: "Mark invoiced" }, { status: "LIVE", label: "Reopen fieldwork" }], INVOICED: [{ status: "CLOSED", label: "Close project" }], CLOSED: [] };

export function ProjectDetail({ projectId }: { projectId: string }) {
  const fallback = projects.find((item) => item.id === projectId) ?? projects[0];
  const { configured, session } = useAuth();
  const [project, setProject] = useState<Project>(fallback);
  const [activeTab, setActiveTab] = useState<"details" | "security">("details");
  const [busy, setBusy] = useState(false); const [refreshing, setRefreshing] = useState(false); const [loaded, setLoaded] = useState(!configured); const [canOperate, setCanOperate] = useState(!configured); const [message, setMessage] = useState(""); const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const token = session?.access_token;

  const loadProject = useCallback(async () => {
    if (configured && !token) return; setRefreshing(true);
    try { const response = await apiRequest<{ data: Project; meta: { canOperate?: boolean } }>(`/api/projects/${encodeURIComponent(projectId)}?refresh=${Date.now()}`, { headers: token ? { authorization: `Bearer ${token}` } : undefined, cache: "no-store" }); setProject(response.data); setCanOperate(response.meta.canOperate === true); setLastUpdated(new Date()); setMessage(""); }
    catch { setMessage("Project details could not be loaded."); }
    finally { setLoaded(true); setRefreshing(false); }
  }, [configured, projectId, token]);

  useEffect(() => { const timer = window.setTimeout(() => void loadProject(), 0); return () => window.clearTimeout(timer); }, [loadProject]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const payload = Object.fromEntries(new FormData(event.currentTarget).entries()); setBusy(true); setMessage("");
    try { await apiRequest(`/api/projects/${encodeURIComponent(project.id)}`, { method: "PATCH", headers: token ? { authorization: `Bearer ${token}` } : undefined, body: JSON.stringify(payload) }); setProject((current) => ({ ...current, name: String(payload.projectName), clientPo: String(payload.clientPo), type: String(payload.type), category: String(payload.category), cpi: Number(payload.clientCpi), quota: Number(payload.quota), endDate: String(payload.endDate) })); setMessage("Project details saved."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Project details could not be saved."); }
    finally { setBusy(false); }
  }

  async function transition(status: ProjectStatus) {
    if (status === "LIVE" && !window.confirm("Launch this project now? Confirm the survey URL, suppliers, quotas, and security settings have been double-checked.")) return;
    if (status === "CLOSED" && !window.confirm("Close this project? This lifecycle state is final.")) return;
    setBusy(true); setMessage("");
    try { await apiRequest(`/api/projects/${encodeURIComponent(project.id)}/transitions`, { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : undefined, body: JSON.stringify({ status, launchConfirmed: status === "LIVE" }) }); setProject((current) => ({ ...current, status })); setMessage(`Project moved to ${status}.`); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Project status could not be changed."); }
    finally { setBusy(false); }
  }

  if (!loaded) return <div className="project-center-page"><section className="panel survey-reference-form"><div className="survey-reference-title">Loading Project Details…</div></section></div>;
  const suppliers = project.supplierAssignments?.map((item) => item.supplierName).join(", ") || "No supplier assigned";

  return <div className="project-center-page project-detail-page"><section className="panel survey-reference-form project-detail-reference"><div className="project-detail-reference-head"><h1>Project Details</h1><div className="row-actions"><button className="button small ghost" type="button" disabled={refreshing} onClick={() => void loadProject()}>{refreshing ? "Refreshing…" : "Refresh"}</button><Link className="button small ghost" href="/projects">Back to Project Center</Link></div></div>{message ? <div className="form-error" role="status">{message}</div> : null}<form onSubmit={save}>
    <div className="survey-reference-tabs" role="tablist" aria-label="Project detail sections"><button className={activeTab === "details" ? "active" : ""} type="button" role="tab" aria-selected={activeTab === "details"} onClick={() => setActiveTab("details")}>Project setup</button><button className={activeTab === "security" ? "active" : ""} type="button" role="tab" aria-selected={activeTab === "security"} onClick={() => setActiveTab("security")}>Security</button></div>
    <div hidden={activeTab !== "details"}>
      <div className="survey-reference-grid top-row"><Field label="Survey Name" name="projectName" value={project.name} required disabled={!canOperate} /><Select label="Project Type" name="type" value={project.type} options={projectTypes} disabled={!canOperate} /><StaticField label="Survey Multi Link" value={project.surveyMultiLink ? "ON" : "OFF"} /><Select label="Survey Category" name="category" value={project.category ?? "None"} options={categories} disabled={!canOperate} /></div>
      <div className="survey-reference-grid manager-row"><StaticField label="Project Manager" value={project.manager} /><StaticField label="Secondary Proj. Manager" value={project.secondaryManager || "Unassigned"} /><StaticField label="Create Date" value={project.createdAt ? project.createdAt.slice(0, 10) : "Not set"} /><Field label="End Date" name="endDate" type="date" value={project.endDate ?? ""} disabled={!canOperate} /></div>
      <SectionTitle>Client Information:</SectionTitle><div className="survey-reference-grid client-row"><StaticField label="Client" value={project.client} /><StaticField label="Sales Person" value={project.salesPerson || "Unassigned"} /><Field label="Client PO#" name="clientPo" value={project.clientPo} disabled={!canOperate} /><Field label="Client CPI" name="clientCpi" type="number" value={String(project.cpi)} disabled={!canOperate} /><Field label="Quota" name="quota" type="number" value={String(project.quota ?? 0)} disabled={!canOperate} /></div>
      <SectionTitle>Market & Supplier:</SectionTitle><div className="survey-reference-grid three-row"><StaticField label="Market" value={project.market} /><StaticField label="Supplier" value={suppliers} /><StaticField label="Project Status" value={project.status} /></div>
      <SectionTitle>AI Pre-Screening Questions:</SectionTitle><ProjectScreeningQuestionsEditor projectId={project.id} configured={configured} token={token} canOperate={canOperate} />
    </div>
    <div hidden={activeTab !== "security"}>
      <SectionTitle>Survey URLs:</SectionTitle><div className="survey-reference-grid three-row"><StaticField label="Live Survey URL" value={project.surveyUrl || "Not configured"} /><StaticField label="Test Survey URL" value={project.testSurveyUrl || "Not configured"} /><StaticField label="Geo Security" value={project.geoSecurityEnabled ? "ON" : "OFF"} /></div>
      <SectionTitle>Project Security:</SectionTitle><div className="survey-reference-grid three-row"><StaticField label="Campaign Banner" value={project.campaignBanner ?? "HIDE"} />{Object.entries(securityLabels).map(([key, label]) => <StaticField key={key} label={label} value={project.securityControls?.[key] ? "ON" : "OFF"} />)}</div>
    </div>
    {canOperate ? <div className="survey-reference-actions"><button className="button primary" disabled={busy} type="submit">{busy ? "Saving…" : "Save Project Details"}</button></div> : null}
  </form></section>
  <nav className="panel project-option-bar" aria-label="Project detail options"><OptionLink href="#overview" glyph="OV" label="Overview" /><OptionLink href="#suppliers" glyph="SU" label="Suppliers" /><OptionLink href="#ownership" glyph="OW" label="Ownership" /><OptionLink href="#markets" glyph="MK" label="Markets" /><OptionLink href="#survey" glyph="SV" label="Survey setup" /><OptionLink href="#prescreening" glyph="PS" label="Pre-screening" /><OptionLink href="#quotas" glyph="QT" label="Quotas" /><OptionLink href="#access" glyph="AC" label="Access" /></nav>
  <div id="overview" className="project-detail-anchor" />
  <section className="panel project-outcomes" style={{ marginTop: 10 }}><div className="panel-head"><div><h2 className="panel-title">Live outcome breakdown</h2><span className="panel-note">IR = CO / (CO + TE) · Conversion = CO / RC · use Refresh for the latest totals</span></div><Link className="button small ghost" href={`/respondents?project=${encodeURIComponent(project.id)}`}>Respondent ledger →</Link></div><div className="outcome-grid project"><OutcomeMetric label="Reached survey" value={project.reached} /><OutcomeMetric label="Completed" value={project.completes} /><OutcomeMetric label="Terminated" value={project.terminates} /><OutcomeMetric label="Quota full" value={project.overQuota} /><OutcomeMetric label="Quality rejected" value={project.qualityTerm} /><OutcomeMetric label="Last trusted event" value={project.lastEventAt ? new Date(project.lastEventAt).toLocaleString() : "No events"} wide /></div><div className="outcome-grid project" style={{ marginTop: 12 }}><OutcomeMetric label="Test starts" value={project.testStarts ?? 0} /><OutcomeMetric label="Test completed" value={project.testCompletes ?? 0} /><OutcomeMetric label="Test terminated" value={project.testTerminates ?? 0} /><OutcomeMetric label="Test quota full" value={project.testOverQuota ?? 0} /><OutcomeMetric label="Test quality rejected" value={project.testQualityTerm ?? 0} /></div></section>
  <section className="panel" style={{ marginTop: 10 }}><div className="panel-head"><div><h2 className="panel-title">Fieldwork totals</h2><span className="panel-note">Starts · in progress · completes · abandoned · updated {lastUpdated ? lastUpdated.toLocaleString() : "on load"}</span></div>{canOperate ? <div className="row-actions">{transitions[project.status].map((action) => <button className="button small ghost" disabled={busy} key={action.status} type="button" onClick={() => void transition(action.status)}>{action.label}</button>)}</div> : <span className="panel-note">Read only</span>}</div><div className="outcome-grid project"><OutcomeMetric label="Starts" value={project.starts} /><OutcomeMetric label="In progress" value={project.inProgress ?? 0} /><OutcomeMetric label="Completes" value={project.completes} /><OutcomeMetric label="Abandoned" value={project.abandons ?? 0} /></div></section>
  <div id="suppliers" className="project-detail-anchor"><ProjectSuppliersEditor projectId={project.id} configured={configured} token={token} canOperate={canOperate} refreshKey={lastUpdated?.getTime()} /></div>
  <div id="ownership" className="project-detail-anchor"><ProjectOwnershipEditor projectId={project.id} configured={configured} token={token} onSaved={() => void loadProject()} /></div>
  <div id="markets" className="project-detail-anchor"><ProjectMarketsEditor projectId={project.id} configured={configured} token={token} canOperate={canOperate} /></div>
  <div id="survey" className="project-detail-anchor"><ProjectSurveySetupEditor projectId={project.id} configured={configured} token={token} canOperate={canOperate} /></div>
  <ProjectResponseVariablesEditor projectId={project.id} configured={configured} token={token} canOperate={canOperate} />
  <div id="prescreening" className="project-detail-anchor"><ProjectEligibilityEditor projectId={project.id} configured={configured} token={token} canOperate={canOperate} /></div>
  <div id="quotas" className="project-detail-anchor"><ProjectQuotaCellsEditor projectId={project.id} configured={configured} token={token} canOperate={canOperate} /></div>
  <div id="access" className="project-detail-anchor"><ProjectAccessEditor projectId={project.id} configured={configured} token={token} /></div>
  </div>;
}

function SectionTitle({ children }: { children: React.ReactNode }) { return <h3 className="survey-reference-section">{children}</h3>; }
function StaticField({ label, value }: { label: string; value: string }) { return <div className="field"><span className="field-label">{label}</span><span className="control static-control">{value}</span></div>; }
function Field({ label, name, value, type = "text", required = false, disabled = false }: { label: string; name: string; value: string; type?: string; required?: boolean; disabled?: boolean }) { return <div className="field"><label htmlFor={`detail-${name}`}>{label}</label><input className="control" id={`detail-${name}`} name={name} type={type} defaultValue={value} required={required} disabled={disabled} min={type === "number" ? 0 : undefined} step={name === "clientCpi" ? "0.01" : undefined} /></div>; }
function Select({ label, name, value, options, disabled }: { label: string; name: string; value: string; options: string[]; disabled: boolean }) { const values = options.includes(value) ? options : [value, ...options]; return <div className="field"><label htmlFor={`detail-${name}`}>{label}</label><select className="control" id={`detail-${name}`} name={name} defaultValue={value} disabled={disabled}>{values.map((item) => <option key={item}>{item}</option>)}</select></div>; }
function OutcomeMetric({ label, value, wide = false }: { label: string; value: string | number; wide?: boolean }) { return <div className={`outcome-card ${wide ? "wide" : ""}`}><span>{label}</span><strong>{typeof value === "number" ? value.toLocaleString() : value}</strong></div>; }
function OptionLink({ href, glyph, label }: { href: string; glyph: string; label: string }) { return <a className="project-option-link" href={href}><span>{glyph}</span><strong>{label}</strong></a>; }
