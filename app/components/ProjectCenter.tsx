"use client";

import Link from "./NavigationLink";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../src/features/auth/AuthProvider";
import { projects as demoProjects } from "../../src/features/projects/mockProjects";
import type { Project, ProjectStatus } from "../../src/features/projects/project.types";
import { projectsToCsv } from "../../src/features/projects/project-export";
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
    facets: configured ? { clients: [], managers: [], types: [], statuses: initialStatuses } : initialFacets,
    summary: configured ? { statuses: { PENDING: 0, LIVE: 0, PAUSED: 0, ID_SUBMITTED: 0, INVOICED: 0, CLOSED: 0 }, totalCompletes: 0 } : initialSummary,
  });
  const [source, setSource] = useState<"loading" | "mock" | "supabase">(configured ? "loading" : "mock");
  const [loadError, setLoadError] = useState("");
  const [client, setClient] = useState("ALL");
  const [manager, setManager] = useState("ALL");
  const [selectedStatuses, setSelectedStatuses] = useState<ProjectStatus[]>([]);
  const [type, setType] = useState("ALL");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [query, setQuery] = useState("");
  const [projectIdQuery, setProjectIdQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [debouncedProjectId, setDebouncedProjectId] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(5);
  const [refreshKey, setRefreshKey] = useState(0);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedProjectId(projectIdQuery.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [projectIdQuery]);

  const projectParams = useCallback((requestedPage: number, requestedPageSize: number) => {
    const params = new URLSearchParams({ page: String(requestedPage), pageSize: String(requestedPageSize), sortBy: "createdAt", sortDirection: "desc", scope: "mine" });
    if (debouncedQuery) params.set("q", debouncedQuery);
    if (debouncedProjectId) params.set("projectId", debouncedProjectId);
    if (client !== "ALL") params.set("client", client);
    if (manager !== "ALL") params.set("manager", manager);
    if (selectedStatuses.length) params.set("status", selectedStatuses.join(","));
    if (type !== "ALL") params.set("type", type);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    return params;
  }, [client, debouncedProjectId, debouncedQuery, from, manager, selectedStatuses, to, type]);

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
      setSource(response.meta.source);
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
    setPage(1);
  }

  function toggleStatus(status: ProjectStatus) {
    resetPageAnd(() => setSelectedStatuses((current) => current.includes(status) ? current.filter((item) => item !== status) : [...current, status]));
  }

  function searchNow() {
    setPage(1);
    setDebouncedQuery(query.trim());
    setDebouncedProjectId(projectIdQuery.trim());
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

  const counts = meta.summary.statuses;
  const firstResult = meta.total === 0 ? 0 : (meta.page - 1) * meta.pageSize + 1;
  const lastResult = Math.min(meta.page * meta.pageSize, meta.total);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">Fieldwork control</div>
          <h1 className="page-title">Project Center</h1>
          <p className="page-subtitle">Your assigned studies, delivery risk, and fieldwork controls.</p>
        </div>
        <div className="head-actions">
          <button className="button ghost" type="button" onClick={() => setRefreshKey((current) => current + 1)}>Refresh</button>
          <button className="button" type="button" disabled={meta.total === 0 || exporting} onClick={() => void exportView()}>{exporting ? "Preparing CSV…" : "Download CSV"}</button>
          {meta.canOperate ? <Link className="button primary" href="/projects/new"><span aria-hidden="true">＋</span> New project</Link> : <span className="status-pill status-PENDING">Read only</span>}
        </div>
      </div>

      <div className="metric-strip">
        <MetricCard label="Live projects" value={counts.LIVE} detail="Currently fielding" tint="#cae7df" />
        <MetricCard label="Pending launch" value={counts.PENDING} detail="Awaiting fieldwork" tint="#f2dfbb" />
        <MetricCard label="Paused" value={counts.PAUSED} detail="Awaiting action" tint="#dbe3f2" />
        <MetricCard label="Total completes" value={meta.summary.totalCompletes.toLocaleString()} detail="Across this result set" tint="#f1d7ce" />
      </div>

      <section className="panel filter-panel" aria-label="Project filters">
        <div className="filter-grid">
          <div className="field"><label htmlFor="from-date">Created from</label><input id="from-date" className="control" type="date" value={from} onChange={(event) => resetPageAnd(() => setFrom(event.target.value))} /></div>
          <div className="field"><label htmlFor="to-date">Created to</label><input id="to-date" className="control" type="date" value={to} onChange={(event) => resetPageAnd(() => setTo(event.target.value))} /></div>
          <div className="field"><label htmlFor="client">Client</label><select id="client" className="control" value={client} onChange={(event) => resetPageAnd(() => setClient(event.target.value))}><option value="ALL">All clients</option>{meta.facets.clients.map((item) => <option key={item}>{item}</option>)}</select></div>
          <div className="field"><label htmlFor="manager">Project manager</label><select id="manager" className="control" value={manager} onChange={(event) => resetPageAnd(() => setManager(event.target.value))}><option value="ALL">All managers</option>{meta.facets.managers.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></div>
          <div className="field status-field"><span className="field-label">Statuses</span><div className="status-toggle-list" aria-label="Filter by project status">{initialStatuses.map((item) => <button className={`status-toggle ${selectedStatuses.includes(item) ? "selected" : ""}`} type="button" key={item} aria-pressed={selectedStatuses.includes(item)} onClick={() => toggleStatus(item)}>{item.replaceAll("_", " ")}</button>)}</div><span className="field-help">Click one or more statuses to filter.</span></div>
          <div className="field"><label htmlFor="type">Project type</label><select id="type" className="control" value={type} onChange={(event) => resetPageAnd(() => setType(event.target.value))}><option value="ALL">All types</option>{meta.facets.types.map((item) => <option key={item}>{item}</option>)}</select></div>
          <div className="field search-wrap"><label htmlFor="project-id-search">Internal project ID</label><input id="project-id-search" className="control search-control" placeholder="e.g. ROP-1050" value={projectIdQuery} onChange={(event) => resetPageAnd(() => setProjectIdQuery(event.target.value))} /></div>
          <div className="field search-wrap"><label htmlFor="search">General search</label><input id="search" className="control search-control" placeholder="Project name or client PO" value={query} onChange={(event) => resetPageAnd(() => setQuery(event.target.value))} /></div>
        </div>
        <div className="filter-actions"><button className="button small" type="button" onClick={searchNow}>Search</button><button className="button small ghost" type="button" onClick={() => setRefreshKey((current) => current + 1)}>Refresh</button><button className="button small ghost" type="button" onClick={resetFilters}>Clear filters</button></div>
      </section>

      {loadError ? <div className="form-error data-error" role="alert">{loadError}</div> : null}

      <section className="panel" aria-label="Project results">
        <div className="panel-head"><h2 className="panel-title">Active portfolio</h2><span className="panel-note">{source === "supabase" ? "Supabase · protected by workspace access" : source === "loading" ? "Loading protected workspace data…" : "Demo data · Supabase not configured"}</span></div>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Project ID</th><th>Project</th><th>Client</th><th>ST</th><th>RC</th><th>L24</th><th>CO</th><th>TE</th><th>OQ</th><th>QT</th><th>IR%</th><th>CV%</th><th>CPI</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>
              {projects.map((project) => (
                <tr key={project.id}>
                  <td><Link className="project-code" href={`/projects/${project.id}`}>{project.id}</Link></td>
                  <td className="project-name-cell"><strong>{project.name}</strong><span>{project.market} · {project.type}</span></td>
                  <td>{project.client}</td>
                  <td>{project.starts.toLocaleString()}</td><td>{project.reached.toLocaleString()}</td><td className="number-muted">{project.l24}</td><td>{project.completes.toLocaleString()}</td><td>{project.terminates}</td><td className="number-muted">{project.overQuota}</td><td className="number-muted">{project.qualityTerm}</td>
                  <td className="rate">{project.incidenceRate.toFixed(1)}</td><td>{project.conversionRate.toFixed(1)}</td><td>${project.cpi.toFixed(2)}</td>
                  <td><span className={`status-pill status-${project.status}`}>{project.status.replaceAll("_", " ")}</span></td>
                  <td><Link className="button small ghost" href={`/projects/${project.id}`}>Open →</Link></td>
                </tr>
              ))}
              {projects.length === 0 && <tr><td colSpan={15} style={{ textAlign: "center", padding: 36, color: "var(--muted)" }}>{loadError ? "No project data is available." : "No projects match these filters."}</td></tr>}
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

function MetricCard({ label, value, detail, tint }: { label: string; value: string | number; detail: string; tint: string }) {
  return <div className="panel metric-card" style={{ "--metric-tint": tint } as React.CSSProperties}><div className="metric-top"><span>{label}</span><span className="metric-delta">{detail}</span></div><div className="metric-value">{value}</div></div>;
}
