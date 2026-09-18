"use client";

import Link from "./NavigationLink";
import { FormEvent, useEffect, useState, useSyncExternalStore } from "react";
import { useAuth } from "../../src/features/auth/AuthProvider";
import { apiRequest } from "../../src/lib/api";
import { countryOptions, languageOptions, languageOptionsForCountry } from "../../src/lib/market-options";

const projectTypes = ["B2C", "B2B", "Healthcare", "Recontact", "Tracker", "Qualitative", "Quantitative", "Mixed method", "IHUT", "CLT"];
const categories = ["None", "Business & Professionals", "General Household", "Financial Technology", "Consumer Goods", "Healthcare", "Automotive", "Other"];
const steps = [["1", "Project info", "Core setup"], ["2", "Market", "Audience & quota"], ["3", "Suppliers", "Source allocation"], ["4", "Survey & security", "Live routing"]];
const createdDate = new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata" }).format(new Date());
const subscribeToHydration = () => () => {};
const clientHydrated = () => true;
const serverNotHydrated = () => false;

export function CreateProjectForm() {
  const { configured, session } = useAuth();
  const [createdId, setCreatedId] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const hydrated = useSyncExternalStore(subscribeToHydration, clientHydrated, serverNotHydrated);
  const [canOperate, setCanOperate] = useState(!configured);
  const [clients, setClients] = useState(["Northstar Bank", "Arc Technologies", "Halo Consumer", "Aperture Auto"]);
  const [suppliers, setSuppliers] = useState(["CPX Research", "BitLabs", "PureSpectrum"]);
  const [supplierCpis, setSupplierCpis] = useState<Record<string, string>>({});
  const [surveyParameters, setSurveyParameters] = useState([{ name: "pid", value: "{{transaction_id}}" }, { name: "uid", value: "{{respondent_id}}" }]);
  const [country, setCountry] = useState("IN");
  const [language, setLanguage] = useState("hi");
  const preferredLanguages = languageOptionsForCountry(country);
  const otherLanguages = languageOptions.filter((option) => !preferredLanguages.some((preferred) => preferred.code === option.code));

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
      supplierAssignments: Object.entries(supplierCpis).map(([name, supplierCpi]) => ({ name, supplierCpi })), surveyUrl: form.get("surveyUrl"), testSurveyUrl: form.get("testSurveyUrl"), surveyParameters,
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
          <div className="field"><span className="field-label">Created date</span><div className="control" aria-label="Created date">{createdDate}</div></div>
          <div className="field"><label htmlFor="client-cpi">Client CPI (USD)</label><input className="control" id="client-cpi" name="clientCpi" type="number" min="0" step="0.01" required /></div>
        </div></section>
        <section className="form-section"><div className="section-head"><div><h2>Market & quota</h2><p>Define the first audience. More markets can be added after creation.</p></div></div><div className="form-grid three">
          <div className="field"><label htmlFor="country">Country</label><select className="control" id="country" name="country" value={country} disabled={!hydrated} onInput={(event) => { const next = event.currentTarget.value; setCountry(next); setLanguage(languageOptionsForCountry(next)[0]?.code ?? "en"); }}>{countryOptions.map((item) => <option key={item.code} value={item.code}>{item.name} ({item.code})</option>)}</select></div>
          <div className="field"><label htmlFor="language">Language</label><select className="control" id="language" name="language" value={language} disabled={!hydrated} onChange={(event) => setLanguage(event.target.value)}><optgroup label={`Common in ${countryOptions.find((option) => option.code === country)?.name ?? country}`}>{preferredLanguages.map((item) => <option key={item.code} value={item.code}>{item.name} ({item.code})</option>)}</optgroup><optgroup label="All other languages">{otherLanguages.map((item) => <option key={item.code} value={item.code}>{item.name} ({item.code})</option>)}</optgroup></select></div>
          <div className="field"><label htmlFor="quota">Target completes</label><input className="control" id="quota" name="quota" type="number" min="1" required /></div>
          <div className="field"><label htmlFor="loi">Expected LOI (minutes)</label><input className="control" id="loi" name="loi" type="number" min="1" /></div>
          <div className="field"><label htmlFor="ir">Expected incidence (%)</label><input className="control" id="ir" name="incidence" type="number" min="0" max="100" /></div>
        </div></section>
        <section className="form-section"><div className="section-head"><div><h2>Supplier assignment</h2><p>Select multiple suppliers and set the buying CPI saved on each project assignment.</p></div></div><details className="multi-select"><summary>{Object.keys(supplierCpis).length ? `${Object.keys(supplierCpis).length} supplier${Object.keys(supplierCpis).length === 1 ? "" : "s"} selected` : "Select suppliers"}</summary><div className="multi-select-menu">{suppliers.map((supplier) => { const selected = Object.hasOwn(supplierCpis, supplier); return <div className="supplier-select-row" key={supplier}><label><input aria-label={`Assign ${supplier}`} type="checkbox" checked={selected} onChange={(event) => setSupplierCpis((current) => { const next = { ...current }; if (event.target.checked) next[supplier] = "0"; else delete next[supplier]; return next; })} /><span>{supplier}</span></label><div className="field"><label htmlFor={`supplier-cpi-${supplier.replace(/\W/g, "-")}`}>Supplier CPI (USD)</label><input className="control" id={`supplier-cpi-${supplier.replace(/\W/g, "-")}`} aria-label={`${supplier} supplier CPI`} type="number" min="0" step="0.01" value={supplierCpis[supplier] ?? ""} disabled={!selected} onChange={(event) => setSupplierCpis((current) => ({ ...current, [supplier]: event.target.value }))} /></div></div>; })}</div></details></section>
        <section className="form-section"><div className="section-head"><div><h2>Survey routing</h2><p>Test traffic uses the test URL; live traffic uses the live URL. Parameters are appended automatically for every respondent.</p></div></div><div className="form-grid">
          <label className="choice-card"><input aria-label="Duplicate prevention is mandatory" type="checkbox" checked disabled readOnly /><span><strong>Duplicate prevention</strong><span>IP and device signals are checked before client routing.</span></span></label>
          <label className="choice-card"><input aria-label="Controlled routing is mandatory" type="checkbox" checked disabled readOnly /><span><strong>Controlled routing</strong><span>Only active project-supplier links can send live traffic.</span></span></label>
          <div className="field full"><label htmlFor="survey-url">Live survey URL (clientlink)</label><input className="control" id="survey-url" name="surveyUrl" type="url" placeholder="https://survey.example.com/start" /></div>
          <div className="field full"><label htmlFor="test-survey-url">Test survey URL (test client link, optional)</label><input className="control" id="test-survey-url" name="testSurveyUrl" type="url" placeholder="https://survey.example.com/test" /><span className="panel-note">When blank, test traffic safely falls back to the live survey URL.</span></div>
        </div><div className="section-head parameter-head"><div><h3>Survey URL parameters (replace key → value)</h3><p>pid = [TOID] per-entry session UUID · uid = [unique_id] supplier panelist ID. Incoming eligibility keys like {"{{country}}"} work as values too.</p></div><button className="button small ghost" type="button" onClick={() => setSurveyParameters((current) => [...current, { name: "", value: "" }])}>Add parameter</button></div><div className="parameter-list">{surveyParameters.map((parameter, index) => <div className="parameter-row" key={index}><div className="field"><label htmlFor={`parameter-name-${index}`}>Parameter name</label><input className="control" id={`parameter-name-${index}`} aria-label={`Survey parameter name ${index + 1}`} placeholder="PID" value={parameter.name} onChange={(event) => setSurveyParameters((current) => current.map((item, position) => position === index ? { ...item, name: event.target.value } : item))} /></div><div className="field"><label htmlFor={`parameter-value-${index}`}>Value template</label><input className="control" id={`parameter-value-${index}`} aria-label={`Survey parameter value ${index + 1}`} placeholder="{{project_id}}" value={parameter.value} onChange={(event) => setSurveyParameters((current) => current.map((item, position) => position === index ? { ...item, value: event.target.value } : item))} /></div><button className="button small ghost parameter-remove" type="button" disabled={surveyParameters.length === 1} onClick={() => setSurveyParameters((current) => current.filter((_, position) => position !== index))}>Remove</button></div>)}</div><p className="panel-note">Available system values: {"{{transaction_id}}"} [TOID], {"{{respondent_id}}"} [unique_id], {"{{project_id}}"}, {"{{session_id}}"}, {"{{complete_url}}"}, {"{{terminate_url}}"}, {"{{quota_full_url}}"}, {"{{security_terminate_url}}"}.</p></section>
        <div className="form-actions"><span className="save-note">A dated pending project is created when you submit.</span><div className="head-actions"><Link className="button ghost" href="/projects">Cancel</Link><button className="button primary" type="submit" disabled={submitting || !canOperate}>{submitting ? "Creating…" : "Create project →"}</button></div></div>
      </div>
    </form>
  </>;
}
