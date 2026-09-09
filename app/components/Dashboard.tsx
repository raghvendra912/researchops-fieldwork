"use client";

import Link from "./NavigationLink";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../../src/features/auth/AuthProvider";
import { apiRequest } from "../../src/lib/api";

type Portfolio = { starts: number; reached: number; completes: number; terminates: number; overQuota: number; qualityTerminates: number; abandons: number; inProgress: number; conversionRate: number; dropOffRate: number; lastEventAt: string | null };
type Analytics = { portfolio: Portfolio; suppliers: Array<{ name: string; starts: number; completes: number; incidenceRate: number; cost: number }> };
type Notice = { id: string; title: string; body: string; createdAt: string };
const emptyPortfolio: Portfolio = { starts: 0, reached: 0, completes: 0, terminates: 0, overQuota: 0, qualityTerminates: 0, abandons: 0, inProgress: 0, conversionRate: 0, dropOffRate: 0, lastEventAt: null };

export function Dashboard() {
  const { configured, session } = useAuth();
  const [data, setData] = useState<Analytics>({ portfolio: emptyPortfolio, suppliers: [] });
  const [live, setLive] = useState(0);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const token = session?.access_token;

  const load = useCallback(async () => {
    if (configured && !token) return;
    setRefreshing(true);
    const headers = token ? { authorization: `Bearer ${token}` } : undefined;
    try {
      const [analytics, projectResponse, notificationResponse] = await Promise.all([
        apiRequest<{ data: Analytics }>("/api/analytics", { headers }),
        apiRequest<{ meta: { summary: { statuses: { LIVE: number } } } }>("/api/projects?page=1&pageSize=1&scope=all", { headers }),
        apiRequest<{ data: Notice[] }>("/api/notifications", { headers }),
      ]);
      setData({ ...analytics.data, portfolio: { ...emptyPortfolio, ...analytics.data.portfolio } });
      setLive(projectResponse.meta.summary.statuses.LIVE);
      setNotices(notificationResponse.data.slice(0, 5));
      setLastUpdated(new Date());
      setError("");
    } catch {
      setError("Dashboard data could not be loaded.");
    } finally {
      setRefreshing(false);
    }
  }, [configured, token]);

  useEffect(() => {
    const initial = window.setTimeout(() => void load(), 0);
    const timer = window.setInterval(() => void load(), 30_000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, [load]);

  const p = data.portfolio;
  const cost = data.suppliers.reduce((sum, item) => sum + Number(item.cost || 0), 0);
  const maxStarts = Math.max(1, ...data.suppliers.map((item) => item.starts));
  const funnel = [
    { label: "Started", value: p.starts, tone: "start" },
    { label: "Reached survey", value: p.reached, tone: "reached" },
    { label: "Completed", value: p.completes, tone: "complete" },
  ];

  return <>
    {error ? <div className="form-error data-error" role="alert">{error}</div> : null}
    <div className="page-head"><div><div className="eyebrow">{new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</div><h1 className="page-title">Fieldwork overview</h1><p className="page-subtitle">Organization-wide respondent flow, outcomes, cost, and operational alerts.</p></div><div className="head-actions"><span className="panel-note">{lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "Waiting for live data"}</span><button className="button ghost" type="button" disabled={refreshing} onClick={() => void load()}>{refreshing ? "Refreshing…" : "Refresh"}</button><Link className="button" href="/analytics">View analytics</Link></div></div>
    <div className="metric-strip"><Metric label="Live projects" value={live} note="Across the organization" tint="#cae7df" /><Metric label="Monthly completes" value={p.completes} note={`${p.starts.toLocaleString()} starts`} tint="#f2dfbb" /><Metric label="In progress" value={p.inProgress} note="No terminal outcome yet" tint="#dbe3f2" /><Metric label="Supplier cost" value={`$${cost.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} note="Last 30 days" tint="#f1d7ce" /></div>
    <section className="panel tracking-panel"><div className="panel-head"><div><h2 className="panel-title">Respondent outcome tracking</h2><span className="panel-note">Refreshes every 30 seconds · sessions without activity for 24 hours become abandoned</span></div><Link className="button small ghost" href="/respondents">Open respondent ledger →</Link></div><div className="tracking-layout"><div className="funnel-list">{funnel.map((item) => <div className="funnel-row" key={item.label}><div className="funnel-copy"><span>{item.label}</span><strong>{item.value.toLocaleString()}</strong></div><div className="funnel-track"><span className={`funnel-fill ${item.tone}`} style={{ width: `${Math.max(item.value ? 3 : 0, 100 * item.value / Math.max(p.starts, 1))}%` }} /></div></div>)}</div><div className="outcome-grid"><Outcome label="Terminated" value={p.terminates} /><Outcome label="Quota full" value={p.overQuota} /><Outcome label="Quality rejected" value={p.qualityTerminates} /><Outcome label="Abandoned" value={p.abandons} warning={p.abandons > 0} /><Outcome label="Conversion" value={`${Number(p.conversionRate || 0).toFixed(1)}%`} /><Outcome label="Drop-off" value={`${Number(p.dropOffRate || 0).toFixed(1)}%`} warning={p.dropOffRate > 10} /></div></div><div className="tracking-foot">Last trusted event: <strong>{p.lastEventAt ? new Date(p.lastEventAt).toLocaleString() : "No respondent events yet"}</strong></div></section>
    <div className="dashboard-grid"><section className="panel chart-panel"><div className="panel-head" style={{ margin: "-20px -20px 0" }}><div><h2 className="panel-title">Supplier delivery</h2><span className="panel-note">Organization-wide starts and completes</span></div><Link className="button small ghost" href="/analytics">Open analytics →</Link></div><div className="chart-bars">{data.suppliers.slice(0, 7).map((item) => <div className="bar-group" key={item.name}><div className="bar" style={{ height: `${100 * item.starts / maxStarts}%` }} title={`${item.starts} starts`} /><div className="bar alt" style={{ height: `${100 * item.completes / maxStarts}%` }} title={`${item.completes} completes`} /><span className="bar-label">{item.name.slice(0, 4)}</span></div>)}</div></section><section className="panel"><div className="panel-head"><h2 className="panel-title">Live activity</h2><Link className="panel-note" href="/notifications">All alerts</Link></div><div className="activity-list">{notices.map((item) => <div className="activity-item" key={item.id}><span className="activity-dot" /><div><strong>{item.title}</strong><span>{item.body}</span></div><span className="activity-time">{new Date(item.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></div>)}{notices.length === 0 ? <p className="panel-note">No recent operational alerts.</p> : null}</div></section></div>
  </>;
}

function Metric({ label, value, note, tint }: { label: string; value: string | number; note: string; tint: string }) { return <div className="panel metric-card" style={{ "--metric-tint": tint } as React.CSSProperties}><div className="metric-top"><span>{label}</span><span className="metric-delta">{note}</span></div><div className="metric-value">{typeof value === "number" ? value.toLocaleString() : value}</div></div>; }
function Outcome({ label, value, warning = false }: { label: string; value: string | number; warning?: boolean }) { return <div className={`outcome-card ${warning ? "warning" : ""}`}><span>{label}</span><strong>{typeof value === "number" ? value.toLocaleString() : value}</strong></div>; }
