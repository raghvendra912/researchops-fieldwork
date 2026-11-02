"use client";
import { useState } from "react";
import { apiRequest } from "../../src/lib/api";

type Item = { at: string; source: "ROUTER" | "EVENT" | "FLAG"; label: string; status?: string; httpStatus?: number; targetHost?: string; country?: string; latencyMs?: number };
type State = { phase: "idle" | "loading" | "ready" | "failed"; items: Item[]; routerHitsVisible: boolean };
const sourceLabel = { ROUTER: "Router", EVENT: "Survey", FLAG: "Review" } as const;

// Loaded lazily on click so selecting a respondent never costs an extra request.
export function ClickTimeline({ sessionId, token }: { sessionId: string; token?: string }) {
  const [state, setState] = useState<State>({ phase: "idle", items: [], routerHitsVisible: true });
  function load() {
    setState((current) => ({ ...current, phase: "loading" }));
    apiRequest<{ data: Item[]; meta?: { routerHitsVisible?: boolean } }>(`/api/respondents/${sessionId}/timeline`, { headers: token ? { authorization: `Bearer ${token}` } : undefined })
      .then((response) => setState({ phase: "ready", items: response.data, routerHitsVisible: response.meta?.routerHitsVisible !== false }))
      .catch(() => setState((current) => ({ ...current, phase: "failed" })));
  }
  return <div className="click-timeline" aria-live="polite">
    <div className="panel-head"><h3 className="panel-title">Click timeline</h3>
      {state.phase === "idle" || state.phase === "failed" ? <button className="button small ghost" type="button" onClick={load}>{state.phase === "failed" ? "Try again" : "Show click timeline"}</button> : null}</div>
    {state.phase === "loading" ? <p className="panel-note">Loading the click timeline…</p> : null}
    {state.phase === "failed" ? <p className="panel-note">The click timeline is not available right now.</p> : null}
    {state.phase === "ready" && !state.items.length ? <p className="panel-note">No clicks or events have been recorded for this respondent yet.</p> : null}
    {state.phase === "ready" && state.items.length && !state.routerHitsVisible ? <p className="panel-note">Router hits are visible to operators only; survey events and review flags are shown.</p> : null}
    {state.phase === "ready" && state.items.length ? <ol className="info-list" aria-label="Click timeline">{state.items.map((item, index) => <li className="info-row" key={`${item.at}-${item.source}-${index}`}>
      <span>{new Date(item.at).toLocaleString()}</span>
      <strong>{sourceLabel[item.source]} · {item.label}{item.status ? ` · ${item.status}` : ""}{item.httpStatus ? ` (${item.httpStatus})` : ""}{item.targetHost ? ` → ${item.targetHost}` : ""}{item.country ? ` · ${item.country}` : ""}{typeof item.latencyMs === "number" ? ` · ${item.latencyMs} ms` : ""}</strong></li>)}</ol> : null}
  </div>;
}
