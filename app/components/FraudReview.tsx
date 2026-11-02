"use client";

import Link from "./NavigationLink";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useAuth } from "../../src/features/auth/AuthProvider";
import { apiRequest } from "../../src/lib/api";
import { fraudRuleInfo } from "../../src/features/clients/return-signing";

type Flag = {
  id: string;
  ruleCode: string;
  severity: string;
  status: string;
  evidence: Record<string, unknown>;
  canReview?: boolean;
  session: {
    respondentRef: string;
    project: { projectCode: string; projectName: string };
  };
};

function RuleCell({ code, open }: { code: string; open: boolean }) {
  const info = fraudRuleInfo(code);
  return <><strong>{info.label}</strong>{info.explain ? <div className="panel-note">{info.explain}</div> : null}{info.holds && open ? <div className="panel-note">On hold: not counted as valid until resolved.</div> : null}</>;
}

export function FraudReview() {
  const { configured, session } = useAuth();
  const [flags, setFlags] = useState<Flag[]>([]);
  const [canOperate, setCanOperate] = useState(!configured);
  const [error, setError] = useState("");
  const projectFilter = useSyncExternalStore(() => () => {}, () => new URLSearchParams(window.location.search).get("project")?.trim().toUpperCase() ?? "", () => "");
  const token = session?.access_token;

  useEffect(() => {
    if (configured && !token) return;
    const headers = token ? { authorization: `Bearer ${token}` } : undefined;
    void apiRequest<{ data: Flag[]; meta: { canOperate?: boolean } }>("/api/fraud-flags", { headers })
      .then((response) => {
        setFlags(response.data);
        setCanOperate(response.meta.canOperate === true);
      })
      .catch(() => setError("Fraud flags could not be loaded."));
  }, [configured, token]);

  const visibleFlags = projectFilter ? flags.filter((flag) => flag.session.project.projectCode === projectFilter) : flags;

  async function resolve(flag: Flag, status: "CONFIRMED" | "DISMISSED") {
    try {
      await apiRequest(`/api/fraud-flags/${flag.id}`, {
        method: "PATCH",
        headers: token ? { authorization: `Bearer ${token}` } : undefined,
        body: JSON.stringify({ status }),
      });
      setFlags((current) => current.map((item) => item.id === flag.id ? { ...item, status } : item));
      setError("");
    } catch {
      setError("The review decision could not be saved.");
    }
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
      <div className="reference-filter-extra"><span className="panel-note">Fraud review · {projectFilter ? `Showing alerts for ${projectFilter}` : "Review explainable duplicate, speeding, and quality signals."}</span>{projectFilter ? <Link className="panel-note" href="/fraud">Clear project filter</Link> : null}</div>
    </section>
    {error ? <div className="form-error data-error" role="alert">{error}</div> : null}
    <p className="panel-note" role="note">Unverified return and No client hand-off flags hold the complete out of valid delivery, supplier cost and quota until you confirm or dismiss them.</p>
    <section className="panel"><div className="panel-head"><h2 className="panel-title">Quality flags</h2><span className="panel-note">Duplicate · speeding · returns · quality</span></div>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Respondent</th><th>Project</th><th>Rule</th><th>Severity</th><th>Evidence</th><th>Status</th><th>Decision</th></tr></thead>
          <tbody>{visibleFlags.map((flag) => <tr key={flag.id}>
            <td><strong>{flag.session.respondentRef}</strong></td>
            <td>{flag.session.project.projectCode} · {flag.session.project.projectName}</td>
            <td><RuleCell code={flag.ruleCode} open={flag.status === "OPEN"} /></td>
            <td>{flag.severity}</td>
            <td>{Object.entries(flag.evidence).map(([key, value]) => `${key}: ${String(value)}`).join(" · ")}</td>
            <td><span className={`status-pill status-${flag.status}`}>{flag.status}</span></td>
            <td>{flag.status === "OPEN" && canOperate && flag.canReview !== false
              ? <div className="row-actions"><button className="button small" type="button" onClick={() => void resolve(flag, "CONFIRMED")}>Confirm</button><button className="button small ghost" type="button" onClick={() => void resolve(flag, "DISMISSED")}>Dismiss</button></div>
              : flag.status === "OPEN" ? "Awaiting operator" : "Reviewed"}</td>
          </tr>)}{visibleFlags.length === 0 ? <tr><td colSpan={7} style={{ padding: 28, textAlign: "center" }}>No quality flags match this project.</td></tr> : null}</tbody>
        </table>
      </div>
      <div className="table-footer"><span>Explainable evidence · operator decisions</span></div>
    </section>
  </div>;
}
