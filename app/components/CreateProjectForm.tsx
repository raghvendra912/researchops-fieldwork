"use client";

import Link from "./NavigationLink";
import { FormEvent, useEffect, useState } from "react";
import { useAuth } from "../../src/features/auth/AuthProvider";
import { apiRequest } from "../../src/lib/api";
import { countryOptions, languageOptions } from "../../src/lib/market-options";

const projectTypes = ["B2C", "B2B", "Healthcare", "Recontact", "Tracker", "Qualitative", "Quantitative", "Mixed method", "IHUT", "CLT"];
const categories = ["None", "Business & Professionals", "General Household", "Financial Technology", "Consumer Goods", "Healthcare", "Automotive", "Other"];
const steps = [["1", "Project info", "Core setup"], ["2", "Market", "Audience & quota"], ["3", "Suppliers", "Source allocation"], ["4", "Survey & security", "Live routing"]];

export function CreateProjectForm() {
  const { configured, session } = useAuth();
  const [createdId, setCreatedId] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [canOperate, setCanOperate] = useState(!configured);
  const [clients, setClients] = useState(["Northstar Bank", "Arc Technologies", "Halo Consumer", "Aperture Auto"]);
  const [suppliers, setSuppliers] = useState(["CPX Research", "BitLabs", "PureSpectrum"]);

  useEffect(() => {
    if (configured && !session?.access_token) return;
    const headers = session?.access_token ? { authorization: `Bearer ${session.access_token}` } : undefined;
    void Promise.all([
      apiRequest<{ data: Array<{ name: string; status: string }> }>("/api/clients", { headers }),
      apiRequest<{ data: Array<{ name: string; status: string }>; meta: { canOperate?: boolean } }>("/api/suppliers", { headers }),
    ]).then(([clientResponse, supplierResponse]) => {
      setClients(clientResponse.data.filter((item) => item.status === "ACTIVE").map((item) => item.name));
      setSuppliers(supplierResponse.data.filter((item) => item.status === "ACTIVE").map((item) => item.name));
      setCanOperate(supplierResponse.meta.canOperate === true);
    }).catch(() => configured && setError("Client and supplier options could not be loaded."));
  }, [configured, session?.access_token]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      projectName: form.get("projectName"), client: form.get("client"), clientPo: form.get("clientPo"), type: form.get("type"), category: form.get("category"),
      clientCpi: form.get("clientCpi"), countryCode: form.get("country"), languageCode: form.get("language"), quota: form.get("quota"), loi: form.get("loi"), incidence: form.get("incidence"),
      suppliers: form.getAll("suppliers"), surveyUrl: form.get("surveyUrl"), securityTerminateUrl: form.get("securityTerminateUrl"),
    };
    setSubmitting(true); setError("");
    try {
      const response = await apiRequest<{ data: { id: string } }>("/api/projects", { method: "POST", headers: session?.access_token ? { authorization: `Bearer ${session.access_token}` } : undefined, body: JSON.stringify(payload) });
      setCreatedId(response.data.id); window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : "The project could not be created."); }
    finally { setSubmitting(false); }
  }

  return <>
    {!canOperate ? <div className="form-error data-error" role="status">Your workspace role has read-only access. An owner, administrator, or project manager must create projects.</div> : null}
    {createdId ? <div className="success-banner"><span>Pending project {createdId} created and assigned to the signed-in operator.</span><Link href={`/projects/${createdId}`}>Open project →</Link></div> : null}
    {error ? <div className="form-error data-error" role="alert">{error}</div> : null}
    <form className="form-shell" onSubmit={submit}>
      <aside className="panel steps" aria-label="Project setup progress">{steps.map(([number, label, hint], index) => <div className={`step ${index === 0 ? "active" : ""}`} key={number}><span className="step-number">{number}</span><span><strong>{label}</strong><span>{hint}</span></span></div>)}</aside>
      <div className="panel form-panel">
        <section className="form-section"><div className="section-head"><div><h2>Project information</h2><p>Choose an existing client and controlled study classification.</p></div><span className="status-pill status-PENDING">PENDING</span></div><div className="form-grid">
          <div className="field full"><label htmlFor="project-name">Project name</label><input className="control" id="project-name" name="projectName" required /></div>
          <div className="field"><label htmlFor="client">Client</label><select className="control" id="client" name="client" required defaultValue=""><option value="" disabled>Select client</option>{clients.map((client) => <option key={client}>{client}</option>)}</select></div>
          <div className="field"><label htmlFor="po">Client PO</label><input className="control" id="po" name="clientPo" /></div>
          <div className="field"><label htmlFor="project-type">Project type</label><select className="control" id="project-type" name="type" defaultValue="B2C">{projectTypes.map((item) => <option key={item}>{item}</option>)}</select></div>
          <div className="field"><label htmlFor="category">Category</label><select className="control" id="category" name="category" defaultValue="None">{categories.map((item) => <option key={item}>{item}</option>)}</select></div>
          <div className="field"><span className="field-label">Project manager</span><div className="control" aria-label="Project manager">Signed-in operator</div></div>
          <div className="field"><span className="field-label">Created date</span><div className="control" aria-label="Created date">{new Date().toLocaleDateString()}</div></div>
          <div className="field"><label htmlFor="client-cpi">Client CPI (USD)</label><input className="control" id="client-cpi" name="clientCpi" type="number" min="0" step="0.01" required /></div>
        </div></section>
        <section className="form-section"><div className="section-head"><div><h2>Market & quota</h2><p>Define the first audience. More markets can be added after creation.</p></div></div><div className="form-grid three">
          <div className="field"><label htmlFor="country">Country</label><select className="control" id="country" name="country" defaultValue="IN">{countryOptions.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select></div>
          <div className="field"><label htmlFor="language">Language</label><select className="control" id="language" name="language" defaultValue="en">{languageOptions.map((item) => <option key={item.code} value={item.code}>{item.name}</option>)}</select></div>
          <div className="field"><label htmlFor="quota">Target completes</label><input className="control" id="quota" name="quota" type="number" min="1" required /></div>
          <div className="field"><label htmlFor="loi">Expected LOI (minutes)</label><input className="control" id="loi" name="loi" type="number" min="1" /></div>
          <div className="field"><label htmlFor="ir">Expected incidence (%)</label><input className="control" id="ir" name="incidence" type="number" min="0" max="100" /></div>
        </div></section>
        <section className="form-section"><div className="section-head"><div><h2>Supplier assignment</h2><p>Select any number of saved suppliers. Quotas, CPI, IDs, and traffic state can be tuned in the project workspace.</p></div></div><div className="supplier-grid">{suppliers.map((supplier) => <label className="choice-card" key={supplier}><input aria-label={`Assign ${supplier}`} type="checkbox" name="suppliers" value={supplier} /><span><strong>{supplier}</strong><span>Saved supplier</span></span></label>)}</div></section>
        <section className="form-section"><div className="section-head"><div><h2>Survey & security</h2><p>The survey URL receives masked outcome callbacks. Security termination can be configured separately.</p></div></div><div className="form-grid">
          <label className="choice-card"><input aria-label="Duplicate prevention is mandatory" type="checkbox" checked disabled readOnly /><span><strong>Duplicate prevention</strong><span>IP and device signals are checked before client routing.</span></span></label>
          <label className="choice-card"><input aria-label="Controlled routing is mandatory" type="checkbox" checked disabled readOnly /><span><strong>Controlled routing</strong><span>Only active project-supplier links can send live traffic.</span></span></label>
          <div className="field full"><label htmlFor="survey-url">Client survey URL</label><input className="control" id="survey-url" name="surveyUrl" type="url" placeholder="https://survey.example.com/start?rid={{respondent_id}}" /></div>
          <div className="field full"><label htmlFor="security-url">Project security terminate URL (optional)</label><input className="control" id="security-url" name="securityTerminateUrl" type="url" placeholder="https://client.example.com/security-terminate" /></div>
        </div></section>
        <div className="form-actions"><span className="save-note">A dated pending project is created when you submit.</span><div className="head-actions"><Link className="button ghost" href="/projects">Cancel</Link><button className="button primary" type="submit" disabled={submitting || !canOperate}>{submitting ? "Creating…" : "Create project →"}</button></div></div>
      </div>
    </form>
  </>;
}
