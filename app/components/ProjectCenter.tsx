"use client";

import Link from "./NavigationLink";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../src/features/auth/AuthProvider";
import { projects as demoProjects } from "../../src/features/projects/mockProjects";
import type { Project, ProjectStatus } from "../../src/features/projects/project.types";
import { projectsToCsv } from "../../src/features/projects/project-export";
import { buildFieldworkWorkbook, type FieldworkSession, type FieldworkSpecification } from "../../src/features/projects/fieldwork-workbook";
import { apiRequest } from "../../src/lib/api";

type ManagerFacet = { value: string; label: string };
type ProjectFacets = { clients: string[]; managers: ManagerFacet[]; types: string[]; statuses: ProjectStatus[] };
type ProjectSummary = { statuses: Record<ProjectStatus, number>; totalCompletes: number };
type ProjectMeta = {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  source: "mock" | "supabase";
  canOperate: boolean;
  workspaceRole: "OWNER" | "ADMIN" | "PM" | "ANALYST" | "MEMBER";
  fullPortfolio: boolean;
  facets: ProjectFacets;
  summary: ProjectSummary;
};
type ProjectsResponse = { data: Project[]; meta: ProjectMeta };

const initialStatuses: ProjectStatus[] = ["PENDING", "LIVE", "PAUSED", "ID_SUBMITTED", "INVOICED", "CLOSED"];
const initialSummary = demoProjects.reduce<ProjectSummary>((summary, project) => {
  summary.statuses[project.status] += 1;
  summary.totalCompletes += project.completes;
  return summary;
}, { statuses: { PENDING: 0, LIVE: 0, PAUSED: 0, ID_SUBMITTED: 0, INVOICED: 0, CLOSED: 0 }, totalCompletes: 0 });
const initialFacets: ProjectFacets = {
  clients: Array.from(new Set(demoProjects.map((project) => project.client))).sort(),
  managers: Array.from(new Set(demoProjects.map((project) => project.manager))).sort().map((manager) => ({ value: manager, label: manager })),
  types: Array.from(new Set(demoProjects.map((project) => project.type))).sort(),
  statuses: initialStatuses,
};

function pagesAround(current: number, total: number) {
  const start = Math.max(1, Math.min(current - 2, total - 4));
  const end = Math.min(total, start + 4);
  return Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => start + index);
}

export function ProjectCenter() {
  const { configured, session } = useAuth();
  const [projects, setProjects] = useState<Project[]>(() => configured ? [] : demoProjects.slice(0, 5));
  const [meta, setMeta] = useState<ProjectMeta>({
    total: configured ? 0 : demoProjects.length,
    page: 1,
    pageSize: 5,
    totalPages: configured ? 1 : Math.ceil(demoProjects.length / 5),
    source: "mock",
    canOperate: !configured,
    workspaceRole: "PM",
    fullPortfolio: true,
    facets: configured ? { clients: [], managers: [], types: [], statuses: initialStatuses } : initialFacets,
    summary: configured ? { statuses: { PENDING: 0, LIVE: 0, PAUSED: 0, ID_SUBMITTED: 0, INVOICED: 0, CLOSED: 0 }, totalCompletes: 0 } : initialSummary,
  });
  const [loadError, setLoadError] = useState("");
  const [client, setClient] = useState("ALL");
  const [manager, setManager] = useState("ALL");
  const [selectedStatuses, setSelectedStatuses] = useState<ProjectStatus[]>([]);
  const [type, setType] = useState("ALL");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [query, setQuery] = useState("");
  const [projectIdQuery, setProjectIdQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [appliedProjectId, setAppliedProjectId] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const [refreshKey, setRefreshKey] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportingWorkbook, setExportingWorkbook] = useState(false);
  const [trafficView, setTrafficView] = useState<"live" | "test">("live");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  const projectParams = useCallback((requestedPage: number, requestedPageSize: number) => {
    const params = new URLSearchParams({ page: String(requestedPage), pageSize: String(requestedPageSize), sortBy: "createdAt", sortDirection, scope: "all" });
    if (appliedQuery) params.set("q", appliedQuery);
    if (appliedProjectId) params.set("projectId", appliedProjectId);
    if (client !== "ALL") params.set("client", client);
    if (manager !== "ALL") params.set("manager", manager);
    if (selectedStatuses.length) params.set("status", selectedStatuses.join(","));
    if (type !== "ALL") params.set("type", type);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    return params;
  }, [appliedProjectId, appliedQuery, client, from, manager, selectedStatuses, sortDirection, to, type]);

  useEffect(() => {
    if (configured && !session?.access_token) return;
    const controller = new AbortController();
    const params = projectParams(page, pageSize);
    void apiRequest<ProjectsResponse>(`/api/projects?${params}`, {
      signal: controller.signal,
      headers: session?.access_token ? { authorization: `Bearer ${session.access_token}` } : undefined,
    }).then((response) => {
      setProjects(response.data);
      setMeta(response.meta);
      setLoadError("");
    }).catch(() => {
      if (controller.signal.aborted) return;
      setProjects([]);
      setLoadError("Project data could not be loaded. Check the API and Supabase configuration.");
    });
    return () => controller.abort();
  }, [configured, page, pageSize, projectParams, refreshKey, session?.access_token]);

  function resetPageAnd(action: () => void) {
    setPage(1);
    action();
  }

  function resetFilters() {
    setClient("ALL");
    setManager("ALL");
    setSelectedStatuses([]);
    setType("ALL");
    setFrom("");
    setTo("");
    setQuery("");
    setProjectIdQuery("");
    setAppliedQuery("");
    setAppliedProjectId("");
    setSortDirection("desc");
    setPage(1);
    setRefreshKey((current) => current + 1);
  }

  function toggleStatus(status: ProjectStatus) {
    resetPageAnd(() => setSelectedStatuses((current) => current.includes(status) ? current.filter((item) => item !== status) : [...current, status]));
  }

  function searchNow() {
    setPage(1);
    setAppliedQuery(query.trim());
    setAppliedProjectId(projectIdQuery.trim());
  }

  async function exportView() {
    if (meta.total === 0 || exporting) return;
    setExporting(true);
    try {
      const exported: Project[] = [];
      const exportPageSize = 100;
      const totalPages = Math.max(1, Math.ceil(meta.total / exportPageSize));
      for (let exportPage = 1; exportPage <= totalPages; exportPage += 1) {
        const response = await apiRequest<ProjectsResponse>(`/api/projects?${projectParams(exportPage, exportPageSize)}`, {
          headers: session?.access_token ? { authorization: `Bearer ${session.access_token}` } : undefined,
        });
        const specifications = await apiRequest<{ data: Array<{ projectCode: string; liveSurveyUrl: string; testSurveyUrl: string; surveyParameters: Project["surveyParameters"]; markets: Project["markets"]; suppliers: Project["supplierAssignments"]; eligibilityRules: Project["eligibilityRules"]; quotaCells: Project["quotaCells"] }> }>(`/api/projects/specifications?codes=${response.data.map((project) => encodeURIComponent(project.id)).join(",")}`, { headers: session?.access_token ? { authorization: `Bearer ${session.access_token}` } : undefined });
        const specs = new Map(specifications.data.map((item) => [item.projectCode, item]));
        exported.push(...response.data.map((project) => { const spec = specs.get(project.id); return { ...project, surveyUrl: spec?.liveSurveyUrl, testSurveyUrl: spec?.testSurveyUrl, surveyParameters: spec?.surveyParameters, markets: spec?.markets, supplierAssignments: spec?.suppliers, eligibilityRules: spec?.eligibilityRules, quotaCells: spec?.quotaCells }; }));
      }
      const blob = new Blob(["\uFEFF", projectsToCsv(exported)], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "researchops-projects.csv";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      setLoadError("Project CSV could not be generated.");
    } finally {
      setExporting(false);
    }
  }

  async function exportWorkbook() {
    if (meta.total === 0 || exportingWorkbook) return;
    setExportingWorkbook(true);
    try {
      const exported: Project[] = [];
      const specifications: FieldworkSpecification[] = [];
      const exportPageSize = 100;
      const totalPages = Math.max(1, Math.ceil(meta.total / exportPageSize));
      for (let exportPage = 1; exportPage <= totalPages; exportPage += 1) {
        const response = await apiRequest<ProjectsResponse>(`/api/projects?${projectParams(exportPage, exportPageSize)}`, { headers: session?.access_token ? { authorization: `Bearer ${session.access_token}` } : undefined });
        const specResponse = await apiRequest<{ data: FieldworkSpecification[] }>(`/api/projects/specifications?codes=${response.data.map((project) => encodeURIComponent(project.id)).join(",")}`, { headers: session?.access_token ? { authorization: `Bearer ${session.access_token}` } : undefined });
        const specs = new Map(specResponse.data.map((item) => [item.projectCode, item]));
        specifications.push(...specResponse.data);
        exported.push(...response.data.map((project) => { const spec = specs.get(project.id); return { ...project, surveyUrl: spec?.liveSurveyUrl, testSurveyUrl: spec?.testSurveyUrl, surveyParameters: spec?.surveyParameters, markets: spec?.markets, supplierAssignments: spec?.suppliers, eligibilityRules: spec?.eligibilityRules, quotaCells: spec?.quotaCells }; }));
      }
      const respondents = await apiRequest<{ data: FieldworkSession[]; meta?: { truncated?: boolean } }>(`/api/respondents?export=1&projects=${exported.map((project) => encodeURIComponent(project.id)).join(",")}`, { headers: session?.access_token ? { authorization: `Bearer ${session.access_token}` } : undefined });
      if (respondents.meta?.truncated) throw new Error("The workbook exceeds the current 5,000-respondent limit. Narrow the Project Center filters and try again.");
      const bytes = buildFieldworkWorkbook(exported, specifications, respondents.data);
      const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `researchops-fieldwork-${new Date().toISOString().slice(0, 10)}.xlsx`; document.body.append(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
    } catch (error) { setLoadError(error instanceof Error ? error.message : "Fieldwork workbook could not be generated."); }
    finally { setExportingWorkbook(false); }
  }

  const firstResult = meta.total === 0 ? 0 : (meta.page - 1) * meta.pageSize + 1;
  const lastResult = Math.min(meta.page * meta.pageSize, meta.total);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Fieldwork control</div>
          <h1 className="page-title">Project Center</h1>
          <p className="page-subtitle">All workspace studies, delivery risk, and fieldwork controls.</p>
        </div>
        <div className="head-actions">
          <button className="button ghost" type="button" onClick={() => setRefreshKey((current) => current + 1)}>Refresh</button>
          <button className="button" type="button" disabled={meta.total === 0 || exporting} onClick={() => void exportView()}>{exporting ? "Preparing CSV…" : "Download CSV"}</button>
          <button className="button primary" type="button" disabled={meta.total === 0 || exportingWorkbook} onClick={() => void exportWorkbook()}>{exportingWorkbook ? "Preparing workbook…" : "Download Fieldwork Workbook"}</button>
          {meta.canOperate ? <Link className="button primary" href="/projects/new"><span aria-hidden="true">＋</span> New project</Link> : <span className="status-pill status-PENDING">Read only</span>}
        </div>
      </div>

      <section className="panel filter-panel" aria-label="Project filters">
        <div className="filter-grid">
          <div className="field"><label htmlFor="from-date">Created from</label><input id="from-date" className="control" type="date" value={from} onChange={(event) => resetPageAnd(() => setFrom(event.target.value))} /></div>
          <div className="field"><label htmlFor="to-date">Created to</label><input id="to-date" className="control" type="date" value={to} onChange={(event) => resetPageAnd(() => setTo(event.target.value))} /></div>
          <div className="field"><label htmlFor="create-sort">Create-date order</label><select id="create-sort" className="control" value={sortDirection} onChange={(event) => resetPageAnd(() => setSortDirection(event.target.value as "asc" | "desc"))}><option value="desc">Newest first</option><option value="asc">Oldest first</option></select></div>
          <div className="field"><label htmlFor="client">Client</label><select id="client" className="control" value={client} onChange={(event) => resetPageAnd(() => setClient(event.target.value))}><option value="ALL">All clients</option>{meta.facets.clients.map((item) => <option key={item}>{item}</option>)}</select></div>
          {meta.fullPortfolio ? <div className="field"><label htmlFor="manager">Project manager</label><select id="manager" className="control" value={manager} onChange={(event) => resetPageAnd(() => setManager(event.target.value))}><option value="ALL">All managers</option>{meta.facets.managers.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div> : null}
          <div className="field status-field"><span className="field-label">Statuses</span><div className="status-toggle-list" aria-label="Filter by project status">{initialStatuses.map((item) => <button className={`status-toggle ${selectedStatuses.includes(item) ? "selected" : ""}`} type="button" key={item} aria-pressed={selectedStatuses.includes(item)} onClick={() => toggleStatus(item)}>{item.replaceAll("_", " ")}</button>)}</div><span className="field-help">Click one or more statuses to filter.</span></div>
          <div className="field"><label htmlFor="type">Project type</label><select id="type" className="control" value={type} onChange={(event) => resetPageAnd(() => setType(event.target.value))}><option value="ALL">All types</option>{meta.facets.types.map((item) => <option key={item}>{item}</option>)}</select></div>
          <div className="field search-wrap"><label htmlFor="project-id-search">Internal project ID</label><input id="project-id-search" className="control search-control" placeholder="e.g. ROP-1050" value={projectIdQuery} onChange={(event) => setProjectIdQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") searchNow(); }} /></div>
          <div className="field search-wrap"><label htmlFor="search">General search</label><input id="search" className="control search-control" placeholder="Project name or client PO" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") searchNow(); }} /></div>
        </div>
        <div className="filter-actions"><button className="button small" type="button" onClick={searchNow}>Search</button><button className="button small ghost" type="button" onClick={() => setRefreshKey((current) => current + 1)}>Refresh</button><button className="button small ghost" type="button" onClick={resetFilters}>Clear filters</button></div>
      </section>

      {loadError ? <div className="form-error data-error" role="alert">{loadError}</div> : null}

      <section className="panel" aria-label="Project results">
        <div className="panel-head"><div><h2 className="panel-title">Active portfolio</h2><span className="panel-note">{meta.fullPortfolio ? `${meta.workspaceRole} portfolio view · all workspace projects` : `${meta.workspaceRole} scoped view · only assigned projects`} · {trafficView === "live" ? "IR = CO / (CO + TE) · CV = CO / RC" : "Test outcomes are excluded from live delivery, quota and cost"}</span></div><div className="traffic-switch" aria-label="Metric traffic view"><button type="button" className={trafficView === "live" ? "active" : ""} aria-pressed={trafficView === "live"} onClick={() => setTrafficView("live")}>Live metrics</button><button type="button" className={trafficView === "test" ? "active" : ""} aria-pressed={trafficView === "test"} onClick={() => setTrafficView("test")}>Test metrics</button></div></div>
        <div className="table-wrap">
          <table className="data-table project-center-table">
            <thead>{trafficView === "live" ? <tr><th>Project ID</th><th>Project Name</th>{meta.fullPortfolio ? <><th title="Client code">CC</th><th title="Client purchase order">CC PO#</th></> : null}<th title="Starts">ST</th><th title="Reached client">RC</th><th title="Completes in last 24 hours">L24</th><th title="Completes / target">CO</th><th title="Terminates">TE</th><th title="Over quota">OQ</th><th title="Quality terminates">QT</th><th title="Abandon rate">AB%</th><th title="Incidence rate">IR%</th><th title="Conversion rate">CV%</th>{meta.fullPortfolio ? <th title="Client cost per interview">CPI</th> : null}<th>Status</th>{meta.fullPortfolio ? <><th title="Project manager / secondary project manager">PM/SPM</th><th title="Last update date">LU Date</th><th>Last Complete</th></> : null}<th>Action</th></tr> : <tr><th>Project ID</th><th>Project Name</th><th>Test ST</th><th>Test CO</th><th>Test TE</th><th>Test OQ</th><th>Test QT</th><th>Test IR%</th><th>Status</th><th>Action</th></tr>}</thead>
            <tbody>
              {projects.map((project) => (
                <tr key={project.id}>
                  <td><Link className="project-code" href={`/projects/${project.id}`}>{project.id}</Link></td>
                  <td className="project-name-cell"><strong>{project.name}</strong><span>{project.client} · {project.market} · {project.type}</span></td>
                  {trafficView === "live" ? <>{meta.fullPortfolio ? <><td>{project.clientCode || "—"}</td><td>{project.clientPo || "—"}</td></> : null}<td>{project.starts.toLocaleString()}</td><td>{project.reached.toLocaleString()}</td><td className="number-muted">{project.l24}</td><td><strong>{project.completes.toLocaleString()}</strong>/{project.quota?.toLocaleString() ?? "—"}</td><td>{project.terminates}</td><td className="number-muted">{project.overQuota}</td><td className="number-muted">{project.qualityTerm}</td><td>{project.abandonRate.toFixed(1)}</td><td className="rate">{project.incidenceRate.toFixed(1)}</td><td>{project.conversionRate.toFixed(1)}</td>{meta.fullPortfolio ? <td>${project.cpi.toFixed(2)}</td> : null}</> : <><td>{project.testStarts ?? 0}</td><td>{project.testCompletes ?? 0}</td><td>{project.testTerminates ?? 0}</td><td>{project.testOverQuota ?? 0}</td><td>{project.testQualityTerm ?? 0}</td><td className="rate">{testIncidence(project).toFixed(1)}</td></>}
                  <td><span className={`status-pill status-${project.status}`}>{project.status.replaceAll("_", " ")}</span></td>
                  {trafficView === "live" && meta.fullPortfolio ? <><td>{project.manager}</td><td>{shortDate(project.lastEventAt ?? project.createdAt)}</td><td>{relativeTime(project.lastComplete)}</td></> : null}
                  <td><Link className="button small ghost" href={`/projects/${project.id}`}>Open →</Link></td>
                </tr>
              ))}
              {projects.length === 0 && <tr><td colSpan={trafficView === "live" ? (meta.fullPortfolio ? 20 : 14) : 10} style={{ textAlign: "center", padding: 36, color: "var(--muted)" }}>{loadError ? "No project data is available." : "No projects match these filters."}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="table-footer">
          <span>Showing {firstResult}–{lastResult} of {meta.total} projects</span>
          <div className="table-pagination-controls">
            <label htmlFor="page-size">Rows</label>
            <select id="page-size" className="page-size" value={pageSize} onChange={(event) => resetPageAnd(() => setPageSize(Number(event.target.value)))}><option value={5}>5</option><option value={10}>10</option><option value={25}>25</option></select>
            <div className="pagination">
              <button className="page-button" type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>‹</button>
              {pagesAround(page, meta.totalPages).map((pageNumber) => <button className={`page-button ${pageNumber === page ? "active" : ""}`} type="button" key={pageNumber} aria-current={pageNumber === page ? "page" : undefined} onClick={() => setPage(pageNumber)}>{pageNumber}</button>)}
              <button className="page-button" type="button" aria-label="Next page" disabled={page >= meta.totalPages} onClick={() => setPage((current) => Math.min(meta.totalPages, current + 1))}>›</button>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function testIncidence(project: Project) {
  const completes = project.testCompletes ?? 0;
  const terminates = project.testTerminates ?? 0;
  return completes + terminates > 0 ? (completes / (completes + terminates)) * 100 : 0;
}

function shortDate(value?: string) {
  if (!value || Number.isNaN(new Date(value).getTime())) return "—";
  return new Intl.DateTimeFormat("en-GB").format(new Date(value));
}

function relativeTime(value: string) {
  const timestamp = new Date(value).getTime();
  if (!value || value === "Not started" || Number.isNaN(timestamp)) return "Never";
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
