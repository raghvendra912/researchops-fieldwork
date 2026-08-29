"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../../src/features/auth/AuthProvider";
import { apiRequest } from "../../src/lib/api";

type Flag = {
  id: string;
  ruleCode: string;
  severity: string;
  status: string;
  evidence: Record<string, unknown>;
  session: {
    respondentRef: string;
    project: { projectCode: string; projectName: string };
  };
};

export function FraudReview() {
  const { configured, session } = useAuth();
  const [flags, setFlags] = useState<Flag[]>([]);
  const [canOperate, setCanOperate] = useState(!configured);
  const [error, setError] = useState("");
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

  return <>
    <div className="page-head">
      <div>
        <div className="eyebrow">Quality operations</div>
        <h1 className="page-title">Fraud review</h1>
        <p className="page-subtitle">Review explainable duplicate, speeding, and quality signals.</p>
      </div>
      {canOperate ? null : <span className="status-pill status-PENDING">Read only</span>}
    </div>
    {error ? <div className="form-error data-error" role="alert">{error}</div> : null}
    <section className="panel">
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Respondent</th><th>Project</th><th>Rule</th><th>Severity</th><th>Evidence</th><th>Status</th><th>Decision</th></tr></thead>
          <tbody>{flags.map((flag) => <tr key={flag.id}>
            <td><strong>{flag.session.respondentRef}</strong></td>
            <td>{flag.session.project.projectCode} · {flag.session.project.projectName}</td>
            <td>{flag.ruleCode.replaceAll("_", " ")}</td>
            <td>{flag.severity}</td>
            <td>{Object.entries(flag.evidence).map(([key, value]) => `${key}: ${String(value)}`).join(" · ")}</td>
            <td><span className={`status-pill status-${flag.status}`}>{flag.status}</span></td>
            <td>{flag.status === "OPEN" && canOperate
              ? <div className="row-actions"><button className="button small" type="button" onClick={() => void resolve(flag, "CONFIRMED")}>Confirm</button><button className="button small ghost" type="button" onClick={() => void resolve(flag, "DISMISSED")}>Dismiss</button></div>
              : flag.status === "OPEN" ? "Awaiting operator" : "Reviewed"}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>
  </>;
}
