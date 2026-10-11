"use client";

/* eslint-disable jsx-a11y/label-has-associated-control -- Research Defender labels contain mapped visible text and nested checkbox controls. */

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../src/features/auth/AuthProvider";
import { apiRequest } from "../../src/lib/api";
import { countryOptions, languageOptionsForCountry } from "../../src/lib/market-options";
import { automaticSurveyParameters, previewSurveyUrl } from "../../worker/domain/survey-url";
import Link from "./NavigationLink";

type Client = { name: string; status: string; salesUser?: string; respondentParameter?: string };
type Supplier = { name: string; status: string };
type Market = { countryCode: string; languageCode: string; targetQuota: string; expectedLoiMinutes: string; expectedIr: string };
type SecurityKey = "search" | "review" | "predupe" | "activity" | "emailVerify" | "fraudGuard" | "dfioPortal" | "survalidate" | "prescreeningCaptcha" | "speederTerminate" | "duplicateIp";

const types = ["B2C", "B2B", "Healthcare", "Recontact", "Tracker", "Qualitative", "Quantitative", "Mixed method", "IHUT", "CLT"];
const categories = ["None", "Business & Professionals", "General Household", "Financial Technology", "Consumer Goods", "Healthcare", "Automotive", "Other"];
const today = new Date().toISOString().slice(0, 10);
const newMarket = (): Market => ({ countryCode: "", languageCode: "en", targetQuota: "", expectedLoiMinutes: "", expectedIr: "" });
const defaultSecurity: Record<SecurityKey, boolean> = { search: false, review: false, predupe: true, activity: false, emailVerify: false, fraudGuard: false, dfioPortal: false, survalidate: false, prescreeningCaptcha: false, speederTerminate: false, duplicateIp: true };

export function ReferenceProjectCreationForm() {
  const { configured, session } = useAuth();
  const [clients, setClients] = useState<Client[]>(configured ? [] : [{ name: "Northstar Bank", status: "ACTIVE", salesUser: "Workspace sales", respondentParameter: "rid" }]);
  const [suppliers, setSuppliers] = useState<Supplier[]>(configured ? [] : [{ name: "CPX Research", status: "ACTIVE" }]);
  const [selectedClient, setSelectedClient] = useState("");
  const [surveyUrl, setSurveyUrl] = useState("");
  const [markets, setMarkets] = useState<Market[]>([newMarket()]);
  const [supplierRows, setSupplierRows] = useState<Array<{ name: string; cpi: string }>>([]);
  const [activeTab, setActiveTab] = useState<"details" | "security">("details");
  const [campaignBanner, setCampaignBanner] = useState<"HIDE" | "SHOW">("HIDE");
  const [geoSecurityEnabled, setGeoSecurityEnabled] = useState(false);
  const [securityControls, setSecurityControls] = useState(defaultSecurity);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState("");
  const token = session?.access_token;
  const headers = useMemo(() => token ? { authorization: `Bearer ${token}` } : undefined, [token]);

  useEffect(() => {
    if (configured && !session?.access_token) return;
    void Promise.all([apiRequest<{ data: Client[] }>("/api/clients", { headers }), apiRequest<{ data: Supplier[] }>("/api/suppliers", { headers })])
      .then(([clientResult, supplierResult]) => { setClients(clientResult.data.filter((item) => item.status === "ACTIVE")); setSuppliers(supplierResult.data.filter((item) => item.status === "ACTIVE")); })
      .catch(() => setError("Client and supplier lists could not be loaded."));
  }, [configured, headers, session?.access_token]);

  const client = clients.find((item) => item.name === selectedClient);
  const parameters = automaticSurveyParameters(surveyUrl, client?.respondentParameter);
  const implementationUrl = surveyUrl ? previewSurveyUrl(surveyUrl, parameters) : "";
  function updateMarket(index: number, patch: Partial<Market>) { setMarkets((current) => current.map((item, position) => position === index ? { ...item, ...patch } : item)); }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); setError("");
    try {
      const response = await apiRequest<{ data: { id: string } }>("/api/projects", { method: "POST", headers, body: JSON.stringify({ projectName: form.get("projectName"), type: form.get("type"), category: form.get("category"), surveyMultiLink: form.get("surveyMultiLink") === "ON", client: selectedClient, clientPo: form.get("clientPo"), clientCpi: form.get("clientCpi"), segment: form.get("segment"), endDate: form.get("endDate"), markets: markets.map((item) => ({ ...item, targetQuota: item.targetQuota || form.get("quota") })), surveyUrl, testSurveyUrl: "", addAutomaticParameters: true, supplierAssignments: supplierRows.map((item) => ({ name: item.name, supplierCpi: item.cpi || 0 })), prescreeningQuestions: [], securityControls, campaignBanner, geoSecurityEnabled }) });
      if (form.get("projectStatus") === "LIVE") await apiRequest(`/api/projects/${encodeURIComponent(response.data.id)}/transitions`, { method: "POST", headers, body: JSON.stringify({ status: "LIVE", launchConfirmed: true }) });
      setCreated(response.data.id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Project could not be created."); }
    finally { setBusy(false); }
  }

  return <section className="panel survey-reference-form"><div className="survey-reference-title">Create Project</div>{error ? <div className="form-error" role="alert">{error}</div> : null}{created ? <div className="success-banner"><span>Project {created} created.</span><Link href={`/projects/${created}`}>Open project →</Link></div> : null}<form onSubmit={submit}>
    <div className="survey-reference-tabs" role="tablist" aria-label="Project creation sections"><button className={activeTab === "details" ? "active" : ""} type="button" role="tab" aria-selected={activeTab === "details"} onClick={() => setActiveTab("details")}>Project setup</button><button className={activeTab === "security" ? "active" : ""} type="button" role="tab" aria-selected={activeTab === "security"} onClick={() => setActiveTab("security")}>Security</button></div>
    <div hidden={activeTab !== "details"}>
      <div className="survey-reference-grid top-row"><Field label="Survey Name" name="projectName" required /><Select label="Project Type" name="type" options={types} required /><Select label="Survey Multi Link" name="surveyMultiLink" options={["OFF", "ON"]} /><Select label="Survey Category" name="category" options={categories} /></div>
      <div className="survey-reference-grid manager-row"><Field label="Project Manager" name="projectManager" value="Current operator" readOnly /><Field label="Secondary Proj. Manager" name="secondaryManager" placeholder="Select Secondary Proj. Manager" /><Field label="Create Date" name="createDate" type="date" value={today} readOnly /><Field label="End Date" name="endDate" type="date" /></div>
      <SectionTitle>AI Pre-Screening Questions:</SectionTitle><div className="survey-reference-grid three-row"><Select label="Pre-Screening" name="prescreening" options={["Off", "On"]} /><Select label="AI Pre-Screening Status" name="aiPrescreening" options={["Off", "On"]} /><Select label="Number Of Questions" name="questionCount" options={["5", "4", "3", "2", "1"]} /></div>
      <SectionTitle>Client Information:</SectionTitle><div className="survey-reference-grid client-row"><div className="field"><label htmlFor="reference-client">Client</label><select className="control" id="reference-client" required value={selectedClient} onChange={(event) => setSelectedClient(event.target.value)}><option value="">Select Client</option>{clients.map((item) => <option key={item.name}>{item.name}</option>)}</select></div><Field label="Sales Person" name="salesPerson" value={client?.salesUser ?? ""} placeholder="Select Sales Person" /><Field label="Client PO#" name="clientPo" /><Field label="Variable" name="variable" value={parameters[0]?.name ?? client?.respondentParameter ?? ""} readOnly /><Field label="Quota" name="quota" type="number" required /></div>
      {markets.map((item, index) => <div className="survey-reference-market-wrap" key={index}>{index > 0 ? <button className="market-remove" type="button" aria-label={`Remove market ${index + 1}`} title="Remove this field" onClick={() => setMarkets((current) => current.filter((_, position) => position !== index))}>×</button> : null}<div className="survey-reference-grid market-row"><div className="field"><label htmlFor={`country-${index}`}>Country</label><select className="control" id={`country-${index}`} required value={item.countryCode} onChange={(event) => { const countryCode = event.target.value; updateMarket(index, { countryCode, languageCode: languageOptionsForCountry(countryCode)[0]?.code ?? "en" }); }}><option value="">Select Country</option>{countryOptions.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}</select></div><Field label="IR" name={`ir-${index}`} type="number" value={item.expectedIr} onChange={(value) => updateMarket(index, { expectedIr: value })} required /><Field label="LOI" name={`loi-${index}`} type="number" value={item.expectedLoiMinutes} onChange={(value) => updateMarket(index, { expectedLoiMinutes: value })} required /><Field label="CPI" name="clientCpi" type="number" required={index === 0} /><Field label="Segment" name="segment" /><div className="field"><label htmlFor={`survey-link-${index}`}>Survey Link</label><input className="control" id={`survey-link-${index}`} type="url" value={surveyUrl} onChange={(event) => setSurveyUrl(event.target.value)} placeholder="https://survey.example/start?vid=XXXX" />{implementationUrl ? <small>Detected: {parameters[0]?.name} · {implementationUrl}</small> : null}</div></div></div>)}
      <button className="button small reference-add" type="button" onClick={() => setMarkets((current) => [...current, newMarket()])}>Add More Field</button>
      <SectionTitle>ADD Supplier :</SectionTitle><div className="field supplier-multi-field"><label htmlFor="reference-suppliers">Name (select multiple)</label><select className="control supplier-multi-select" id="reference-suppliers" multiple size={Math.min(6, Math.max(3, suppliers.length))} value={supplierRows.map((item) => item.name)} onChange={(event) => { const selected = Array.from(event.currentTarget.selectedOptions, (option) => option.value); setSupplierRows((current) => selected.map((name) => current.find((item) => item.name === name) ?? { name, cpi: "" })); }}>{suppliers.map((supplier) => <option key={supplier.name} value={supplier.name}>{supplier.name}</option>)}</select><small>Ctrl (Windows) ya Cmd (Mac) daba kar ek saath multiple suppliers select karein. Selected suppliers neeche line-wise dikhenge.</small></div>
      {supplierRows.map((row, index) => <div className="survey-reference-grid supplier-row selected-supplier-row" key={row.name}><div className="field"><span className="field-label">Selected Supplier</span><span className="control static-control">{row.name}</span></div><Field label="Supplier CPI ($)" name={`supplier-cpi-${index}`} type="number" value={row.cpi} onChange={(value) => setSupplierRows((current) => current.map((item) => item.name === row.name ? { ...item, cpi: value } : item))} /><button className="market-remove supplier-remove" type="button" aria-label={`Remove ${row.name}`} onClick={() => setSupplierRows((current) => current.filter((item) => item.name !== row.name))}>×</button></div>)}
    </div>
    <div className="survey-security-tab" hidden={activeTab !== "security"}><SectionTitle>Project Status:</SectionTitle><div className="survey-reference-grid three-row"><Select label="Initial Status" name="projectStatus" options={["PENDING", "LIVE"]} /><Select label="Campaign Banner" name="campaignBannerDisplay" options={["HIDE", "SHOW"]} value={campaignBanner} onChange={(value) => setCampaignBanner(value as "HIDE" | "SHOW")} /><div className="field"><label htmlFor="reference-geo-security">Geo Security</label><select className="control" id="reference-geo-security" value={geoSecurityEnabled ? "ON" : "OFF"} onChange={(event) => setGeoSecurityEnabled(event.target.value === "ON")}><option>OFF</option><option>ON</option></select></div></div><SectionTitle>Research Defender:</SectionTitle><div className="security-check-grid">{([['search','Search'],['review','Review'],['predupe','Predupe'],['activity','Activity'],['emailVerify','Email verify']] as Array<[SecurityKey,string]>).map(([key,label]) => <label className="compact-check" key={key}><input type="checkbox" checked={securityControls[key]} onChange={(event) => setSecurityControls((current) => ({ ...current, [key]: event.target.checked }))} /><span><strong>{label}</strong></span></label>)}</div><SectionTitle>Digital Fingerprinting:</SectionTitle><div className="survey-reference-grid three-row">{([['fraudGuard','FraudGuard'],['dfioPortal','DFIO Portal'],['survalidate','Survalidate'],['prescreeningCaptcha','Pre-screening Captcha'],['speederTerminate','Speeder Term'],['duplicateIp','Duplicate IP']] as Array<[SecurityKey,string]>).map(([key,label]) => <div className="field" key={key}><label htmlFor={`reference-security-${key}`}>{label}</label><select className="control" id={`reference-security-${key}`} value={securityControls[key] ? "ON" : "OFF"} onChange={(event) => setSecurityControls((current) => ({ ...current, [key]: event.target.value === "ON" }))}><option>OFF</option><option>ON</option></select></div>)}</div></div>
    <div className="survey-reference-actions"><button className="button primary" disabled={busy} type="submit">{busy ? "Creating…" : "Create Project"}</button></div>
  </form></section>;
}

function SectionTitle({ children }: { children: React.ReactNode }) { return <h3 className="survey-reference-section">{children}</h3>; }
function Select({ label, name, options, required = false, value, onChange }: { label: string; name: string; options: string[]; required?: boolean; value?: string; onChange?: (value: string) => void }) { return <div className="field"><label htmlFor={`reference-${name}`}>{label}</label><select className="control" id={`reference-${name}`} name={name} required={required} value={onChange ? value : undefined} defaultValue={onChange ? undefined : ""} onChange={onChange ? (event) => onChange(event.target.value) : undefined}><option value="">-select option-</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></div>; }
function Field({ label, name, type = "text", value, placeholder, required = false, readOnly = false, onChange }: { label: string; name: string; type?: string; value?: string; placeholder?: string; required?: boolean; readOnly?: boolean; onChange?: (value: string) => void }) { return <div className="field"><label htmlFor={`reference-${name}`}>{label}</label><input className="control" id={`reference-${name}`} name={name} type={type} value={onChange || readOnly ? value ?? "" : undefined} defaultValue={!onChange && !readOnly ? value : undefined} placeholder={placeholder} required={required} readOnly={readOnly} step={type === "number" ? "any" : undefined} onChange={onChange ? (event) => onChange(event.target.value) : undefined} /></div>; }
