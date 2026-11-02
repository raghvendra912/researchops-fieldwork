"use client";

import Link from "./NavigationLink";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useAuth } from "../../src/features/auth/AuthProvider";
import { apiRequest } from "../../src/lib/api";
import { fraudRuleInfo } from "../../src/features/clients/return-signing";
import { evidenceSummary, filterableRuleCodes, filterableStatuses, fraudFiltersToQuery, heldAge, heldQueueFilters, parseFraudFilters, type FraudFilters } from "../../src/features/fraud/fraud-filters";

type Flag = {
  id: string;
  ruleCode: string;
  severity: string;
  status: string;
  createdAt?: string;
  evidence: Record<string, unknown>;
  canReview?: boolean;
  session: {
    respondentRef: string;
    supplierName?: string | null;
    project: { projectCode: string; projectName: string };
  };
};

type Resolution = "CONFIRMED" | "DISMISSED";
type Pending = { flag: Flag; status: Resolution };
type FlagResponse = { data: Flag[]; meta: { canOperate?: boolean } };

function RuleCell({ code, open }: { code: string; open: boolean }) {
  const info = fraudRuleInfo(code);
  return <><strong>{info.label}</strong>{info.explain ? <div className="panel-note">{info.explain}</div> : null}{info.holds && open ? <div className="panel-note">On hold: not counted as valid until resolved.</div> : null}</>;
}

function toggle(list: string[], value: string) {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

const statusLabel: Record<string, string> = { OPEN: "Open", CONFIRMED: "Confirmed", DISMISSED: "Dismissed" };

export function FraudReview() {
  const { configured, session } = useAuth();
  const [flags, setFlags] = useState<Flag[]>([]);
  const [held, setHeld] = useState<Flag[]>([]);
  const [canOperate, setCanOperate] = useState(!configured);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [view, setView] = useState<"all" | "held">("all");
  const [ruleCodes, setRuleCodes] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [projectInput, setProjectInput] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const urlProject = useSyncExternalStore(() => () => {}, () => new URLSearchParams(window.location.search).get("project")?.trim().toUpperCase() ?? "", () => "");
  const projectText = projectInput ?? urlProject;
  const projectCode = parseFraudFilters(new URLSearchParams({ projectCode: projectText })).projectCode;
  const token = session?.access_token;
  const filters: FraudFilters = { ruleCodes, statuses, projectCode };
  const query = fraudFiltersToQuery(filters);
  const heldQuery = fraudFiltersToQuery({ ...heldQueueFilters, projectCode });
  const anyFilter = ruleCodes.length > 0 || statuses.length > 0 || projectCode !== "";

  useEffect(() => {
    if (configured && !token) return;
    const headers = token ? { authorization: `Bearer ${token}` } : undefined;
    let current = true;
    void Promise.all([
      apiRequest<FlagResponse>(`/api/fraud-flags${query}`, { headers }),
      apiRequest<FlagResponse>(`/api/fraud-flags${heldQuery}`, { headers }),
    ]).then(([all, queue]) => {
      if (!current) return;
      setFlags(all.data);
      setHeld(queue.data);
      setCanOperate(all.meta.canOperate === true || queue.meta.canOperate === true);
      setError("");
    }).catch(() => { if (current) setError("Fraud flags could not be loaded."); });
    return () => { current = false; };
  }, [configured, token, query, heldQuery, reloadKey]);

  async function resolve(flag: Flag, status: Resolution) {
    setBusy(true);
    setPending(null);
    // Optimistic: take the flag out of the queue and mark it resolved in the list straight away.
    const previousHeld = held;
    const previousFlags = flags;
    setHeld((current) => current.filter((item) => item.id !== flag.id));
    setFlags((current) => current.map((item) => item.id === flag.id ? { ...item, status } : item));
    try {
      await apiRequest(`/api/fraud-flags/${flag.id}`, {
        method: "PATCH",
        headers: token ? { authorization: `Bearer ${token}` } : undefined,
        body: JSON.stringify({ status }),
      });
      setError("");
      setNotice(status === "DISMISSED" ? `Released ${flag.session.respondentRef}. The complete now counts as valid. The decision is recorded in the audit log.` : `Rejected ${flag.session.respondentRef}. The complete stays excluded and its quota is released. The decision is recorded in the audit log.`);
      setReloadKey((key) => key + 1);
    } catch {
      setHeld(previousHeld);
      setFlags(previousFlags);
      setNotice("");
      setError("The review decision could not be saved. Nothing was changed; please try again.");
    } finally {
      setBusy(false);
    }
  }

  function clearFilters() {
    setRuleCodes([]);
    setStatuses([]);
    setProjectInput("");
  }

  const canAct = (flag: Flag) => flag.status === "OPEN" && canOperate && flag.canReview !== false;
  const heldSorted = [...held].sort((a, b) => Date.parse(a.createdAt ?? "") - Date.parse(b.createdAt ?? ""));
  const heldBadge = held.length >= 100 ? "100+" : String(held.length);

  function decision(flag: Flag, release: string, reject: string) {
    if (pending?.flag.id === flag.id) {
      const releasing = pending.status === "DISMISSED";
      return <div className="row-actions" role="group" aria-label="Confirm decision">
        <span className="panel-note">{releasing ? "Release this complete so it counts as valid?" : "Reject this complete and keep it excluded?"}</span>
        <button className="button small" type="button" disabled={busy} onClick={() => void resolve(flag, pending.status)}>{releasing ? "Yes, release" : "Yes, reject"}</button>
        <button className="button small ghost" type="button" disabled={busy} onClick={() => setPending(null)}>Cancel</button>
      </div>;
    }
    if (!canAct(flag)) return <>{flag.status === "OPEN" ? "Awaiting operator" : "Reviewed"}</>;
    return <div className="row-actions">
      <button className="button small" type="button" disabled={busy} onClick={() => setPending({ flag, status: "DISMISSED" })}>{release}</button>
      <button className="button small ghost" type="button" disabled={busy} onClick={() => setPending({ flag, status: "CONFIRMED" })}>{reject}</button>
    </div>;
  }

  return <div className="project-center-page">
    <section className="reference-filter" aria-label="Fraud review scope">
      <div className="reference-filter-grid">
        <div className="field"><span className="field-label">Area</span><span className="control static-control">Quality operations</span></div>
        <div className="field"><span className="field-label">Signals</span><span className="control static-control">Duplicate · speeding · quality</span></div>
        <div className="field"><span className="field-label">Evidence</span><span className="control static-control">Explainable flags</span></div>
        <div className="field"><span className="field-label">Access</span><span className="control static-control">{canOperate ? "Can operate" : "Read only"}</span></div>
        <div className="reference-actions"><Link className="reference-icon-button" href="/respondents" aria-label="Open respondent ledger" title="Open respondent ledger">☰</Link></div>
      </div>
      <div className="reference-filter-extra"><span className="panel-note">Fraud review · {projectCode ? `Showing alerts for ${projectCode}` : "Review explainable duplicate, speeding, and quality signals."}</span>{projectCode ? <Link className="panel-note" href="/fraud" onClick={() => setProjectInput("")}>Clear project filter</Link> : null}</div>
    </section>
    {error ? <div className="form-error data-error" role="alert">{error}</div> : null}
    {notice ? <p className="panel-note" role="status">{notice}</p> : null}
    <p className="panel-note" role="note">Speeding, Unverified return and No client hand-off flags hold the complete out of valid delivery, supplier cost and quota until you release (dismiss) or reject (confirm) them.</p>
    <div className="traffic-switch" role="tablist" aria-label="Fraud review views">
      <button type="button" role="tab" aria-selected={view === "all"} className={view === "all" ? "active" : ""} onClick={() => setView("all")}>All flags</button>
      <button type="button" role="tab" aria-selected={view === "held"} className={view === "held" ? "active" : ""} onClick={() => setView("held")}>Held completes <span className="held-count-badge" style={{ marginLeft: 6, padding: "1px 7px", borderRadius: 999, background: heldBadge === "0" ? "#e3e1d8" : "#b4532a", color: heldBadge === "0" ? "#555" : "white" }} aria-label={`${heldBadge} held`}>{heldBadge}</span></button>
    </div>
    {view === "all" ? <section className="panel" aria-label="Flag filters" style={{ marginTop: 12 }}>
      <div className="panel-head"><h2 className="panel-title">Filters</h2>{anyFilter ? <button className="button small ghost" type="button" onClick={clearFilters}>Clear filters</button> : null}</div>
      <div style={{ padding: "0 18px 14px", display: "grid", gap: 10 }}>
        <div className="status-toggle-list" role="group" aria-label="Rule type">
          {filterableRuleCodes.map((code) => <button key={code} type="button" aria-pressed={ruleCodes.includes(code)} className={`status-toggle${ruleCodes.includes(code) ? " selected" : ""}`} onClick={() => setRuleCodes((current) => toggle(current, code))}>{fraudRuleInfo(code).label}</button>)}
        </div>
        <div className="status-toggle-list" role="group" aria-label="Status">
          {filterableStatuses.map((status) => <button key={status} type="button" aria-pressed={statuses.includes(status)} className={`status-toggle${statuses.includes(status) ? " selected" : ""}`} onClick={() => setStatuses((current) => toggle(current, status))}>{statusLabel[status]}</button>)}
        </div>
        <label className="field"><span className="field-label">Project code</span><input className="control" value={projectText} placeholder="PRJ-1048" maxLength={40} onChange={(event) => setProjectInput(event.target.value.toUpperCase())} /></label>
      </div>
    </section> : null}
    {view === "all" ? <section className="panel" style={{ marginTop: 12 }}><div className="panel-head"><h2 className="panel-title">Quality flags</h2><span className="panel-note">Duplicate · speeding · returns · quality</span></div>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Respondent</th><th>Project</th><th>Rule</th><th>Severity</th><th>Evidence</th><th>Status</th><th>Decision</th></tr></thead>
          <tbody>{flags.map((flag) => <tr key={flag.id}>
            <td><strong>{flag.session.respondentRef}</strong></td>
            <td>{flag.session.project.projectCode} · {flag.session.project.projectName}</td>
            <td><RuleCell code={flag.ruleCode} open={flag.status === "OPEN"} /></td>
            <td>{flag.severity}</td>
            <td>{evidenceSummary(flag.evidence)}</td>
            <td><span className={`status-pill status-${flag.status}`}>{flag.status}</span></td>
            <td>{decision(flag, "Dismiss", "Confirm")}</td>
          </tr>)}{flags.length === 0 ? <tr><td colSpan={7} style={{ padding: 28, textAlign: "center" }}>{anyFilter ? "No quality flags match these filters." : "No quality flags yet."}</td></tr> : null}</tbody>
        </table>
      </div>
      <div className="table-footer"><span>Explainable evidence · operator decisions</span></div>
    </section> : <section className="panel" aria-label="Held completes" style={{ marginTop: 12 }}><div className="panel-head"><h2 className="panel-title">Held completes</h2><span className="panel-note">Oldest first · release counts the complete, reject keeps it excluded</span></div>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Project</th><th>Supplier</th><th>Respondent</th><th>Reason</th><th>Held for</th><th>Evidence</th><th>Decision</th></tr></thead>
          <tbody>{heldSorted.map((flag) => <tr key={flag.id}>
            <td>{flag.session.project.projectCode} · {flag.session.project.projectName}</td>
            <td>{flag.session.supplierName ?? "-"}</td>
            <td><strong>{flag.session.respondentRef}</strong></td>
            <td><RuleCell code={flag.ruleCode} open /></td>
            <td>{heldAge(flag.createdAt)}</td>
            <td>{evidenceSummary(flag.evidence) || "-"}</td>
            <td>{decision(flag, "Release", "Reject")}</td>
          </tr>)}{heldSorted.length === 0 ? <tr><td colSpan={7} style={{ padding: 28, textAlign: "center" }}>No completes are being held{projectCode ? ` for ${projectCode}` : ""}.</td></tr> : null}</tbody>
        </table>
      </div>
      <div className="table-footer"><span>Decisions are written to the audit log</span></div>
    </section>}
  </div>;
}
