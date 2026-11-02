"use client";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../src/features/auth/AuthProvider";
import { apiRequest } from "../../src/lib/api";

type Ratios = { clickToStart: number; startToReached: number; reachedToComplete: number; rejectionRate: number };
type Row = { supplierId: string | null; supplierName: string; clicks: number; routed: number; rejected: number; rejections: Record<string, number>; starts: number; reachedClient: number; completes: number; terminates: number; quotaFull: number; qualityTerminates: number; ratios: Ratios };
type Meta = { source: "mock" | "supabase"; from: string; to: string; clamped?: boolean; total: number };
type Option = { id: string; name: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const number = (value: number) => value.toLocaleString();
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const day = (offset: number) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10);

export function SupplierFunnel() {
  const { configured, session } = useAuth();
  const token = session?.access_token;
  const [from, setFrom] = useState(() => day(30));
  const [to, setTo] = useState(() => day(0));
  const [projectCode, setProjectCode] = useState("");
  const [supplierId, setSupplierId] = useState("");
  const [projects, setProjects] = useState<Option[]>([]);
  const [suppliers, setSuppliers] = useState<Option[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [meta, setMeta] = useState<Meta | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "forbidden" | "failed">("loading");
  const headers = useMemo(() => (token ? { authorization: `Bearer ${token}` } : undefined), [token]);

  useEffect(() => {
    if (configured && !token) return;
    void apiRequest<{ data: Array<{ id: string; name: string }> }>("/api/projects?pageSize=100", { headers }).then((response) => setProjects(response.data.map((item) => ({ id: item.id, name: `${item.id} · ${item.name}` })))).catch(() => undefined);
    void apiRequest<{ data: Array<{ id: string; name: string }> }>("/api/suppliers", { headers }).then((response) => setSuppliers(response.data.map((item) => ({ id: item.id, name: item.name })))).catch(() => undefined);
  }, [configured, token, headers]);

  useEffect(() => {
    if (configured && !token) return;
    const params = new URLSearchParams({ from, to });
    if (projectCode) params.set("projectCode", projectCode);
    if (supplierId && UUID.test(supplierId)) params.set("supplierId", supplierId);
    let cancelled = false;
    void apiRequest<{ data: Row[]; meta: Meta }>(`/api/routing/funnel?${params}`, { headers })
      .then((response) => { if (!cancelled) { setRows(response.data); setMeta(response.meta); setState("ready"); } })
      .catch((reason: unknown) => { if (!cancelled) setState((reason as { status?: number })?.status === 403 ? "forbidden" : "failed"); });
    return () => { cancelled = true; };
  }, [configured, token, headers, from, to, projectCode, supplierId]);

  const totals = rows.reduce((sum, row) => ({ clicks: sum.clicks + row.clicks, starts: sum.starts + row.starts, reached: sum.reached + row.reachedClient, completes: sum.completes + row.completes, rejected: sum.rejected + row.rejected }), { clicks: 0, starts: 0, reached: 0, completes: 0, rejected: 0 });
  const max = Math.max(1, ...rows.map((row) => row.clicks));

  return <div className="project-center-page">
    <section className="reference-filter" aria-label="Supplier funnel filters"><div className="reference-filter-grid">
      <div className="field"><label htmlFor="funnel-from">Date from</label><input id="funnel-from" className="control" type="date" value={from} max={to} onChange={(event) => { setState("loading"); setFrom(event.target.value); }} /></div>
      <div className="field"><label htmlFor="funnel-to">Date to</label><input id="funnel-to" className="control" type="date" value={to} min={from} onChange={(event) => { setState("loading"); setTo(event.target.value); }} /></div>
      <div className="field"><label htmlFor="funnel-project">Project</label><select id="funnel-project" className="control" value={projectCode} onChange={(event) => { setState("loading"); setProjectCode(event.target.value); }}><option value="">All projects</option>{projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
      <div className="field"><label htmlFor="funnel-supplier">Supplier</label><select id="funnel-supplier" className="control" value={supplierId} onChange={(event) => { setState("loading"); setSupplierId(event.target.value); }}><option value="">All suppliers</option>{suppliers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
    </div><div className="reference-filter-extra"><span className="panel-note">Clicks are supplier entry hits at the router. Windows are limited to 92 days.</span></div></section>

    {state === "forbidden" ? <div className="form-error data-error" role="alert">Supplier funnel reporting is available to workspace operators.</div> : null}
    {state === "failed" ? <div className="form-error data-error" role="alert">The supplier funnel is not available right now. Please try again shortly.</div> : null}
    {meta?.clamped ? <div className="panel-note" role="status">The date range was shortened to the most recent 92 days.</div> : null}

    <section className="panel" aria-label="Funnel totals"><div className="panel-head"><div><h2 className="panel-title">Funnel totals</h2><span className="panel-note">Click, start, reached client and valid complete</span></div></div>
      <div className="outcome-grid project">
        <div className="outcome-card"><span>Clicks</span><strong>{number(totals.clicks)}</strong></div>
        <div className="outcome-card"><span>Starts</span><strong>{number(totals.starts)}</strong></div>
        <div className="outcome-card"><span>Reached client</span><strong>{number(totals.reached)}</strong></div>
        <div className="outcome-card"><span>Valid completes</span><strong>{number(totals.completes)}</strong></div>
      </div></section>

    <section className="panel" style={{ marginTop: 10 }} aria-label="Supplier funnel table"><div className="panel-head"><div><h2 className="panel-title">Supplier funnel</h2><span className="panel-note">Percentages show conversion from the previous step</span></div></div>
      {state === "loading" ? <p className="panel-note">Loading the supplier funnel…</p> : null}
      {state === "ready" && !rows.length ? <p className="panel-note">No supplier traffic was recorded for these filters.</p> : null}
      {rows.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th>Supplier</th><th>Clicks</th><th>Starts</th><th>Click to start</th><th>Reached client</th><th>Start to reached</th><th>Valid completes</th><th>Reached to complete</th><th>Rejected clicks</th><th>Terminates</th><th>Quota full</th><th>Quality</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.supplierId ?? row.supplierName}>
          <td><strong>{row.supplierName}</strong><div aria-hidden="true" style={{ height: 6, marginTop: 4, borderRadius: 999, background: "#ebece7" }}><div style={{ width: `${(100 * row.clicks) / max}%`, height: "100%", borderRadius: 999, background: "var(--brand)" }} /></div></td>
          <td>{number(row.clicks)}</td><td>{number(row.starts)}</td><td>{percent(row.ratios.clickToStart)}</td><td>{number(row.reachedClient)}</td><td>{percent(row.ratios.startToReached)}</td><td>{number(row.completes)}</td><td>{percent(row.ratios.reachedToComplete)}</td><td>{number(row.rejected)} ({percent(row.ratios.rejectionRate)})</td><td>{number(row.terminates)}</td><td>{number(row.quotaFull)}</td><td>{number(row.qualityTerminates)}</td></tr>)}</tbody></table></div> : null}
      <div className="table-footer"><span>{rows.length} supplier(s){meta?.source === "mock" ? " · sample data" : ""}</span></div></section>

    <section className="panel" style={{ marginTop: 10 }} aria-label="Rejection reasons"><div className="panel-head"><div><h2 className="panel-title">Rejection reasons</h2><span className="panel-note">Why supplier clicks were not routed to a survey</span></div></div>
      {state === "ready" && !rows.some((row) => row.rejected > 0) ? <p className="panel-note">No clicks were rejected in this period.</p> : null}
      <div style={{ display: "grid", gap: 14, padding: "8px 0" }}>{rows.filter((row) => row.rejected > 0).map((row) => <div key={row.supplierId ?? row.supplierName}>
        <strong>{row.supplierName}</strong>
        <ul style={{ listStyle: "none", margin: "6px 0 0", padding: 0, display: "grid", gap: 6 }}>{Object.entries(row.rejections).sort((a, b) => b[1] - a[1]).map(([reason, hits]) => <li key={reason}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}><span>{reason.replaceAll("_", " ").toLowerCase()}</span><span>{number(hits)} ({percent(hits / Math.max(1, row.clicks))})</span></div>
          <div aria-hidden="true" style={{ height: 6, borderRadius: 999, background: "#ebece7" }}><div style={{ width: `${(100 * hits) / Math.max(1, row.rejected)}%`, height: "100%", borderRadius: 999, background: "var(--brand)" }} /></div></li>)}</ul></div>)}</div></section>
  </div>;
}
