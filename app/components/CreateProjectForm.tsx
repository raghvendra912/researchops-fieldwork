"use client";

import Link from "./NavigationLink";
import { FormEvent, useEffect, useState, useSyncExternalStore } from "react";
import { useAuth } from "../../src/features/auth/AuthProvider";
import { apiRequest } from "../../src/lib/api";
import {
  countryOptions,
  languageOptions,
  languageOptionsForCountry,
} from "../../src/lib/market-options";
import {
  automaticSurveyParameters,
  previewSurveyUrl,
} from "../../worker/domain/survey-url";

const projectTypes = [
  "B2C",
  "B2B",
  "Healthcare",
  "Recontact",
  "Tracker",
  "Qualitative",
  "Quantitative",
  "Mixed method",
  "IHUT",
  "CLT",
];
const categories = [
  "None",
  "Business & Professionals",
  "General Household",
  "Financial Technology",
  "Consumer Goods",
  "Healthcare",
  "Automotive",
  "Other",
];
const steps = [
  ["1", "Project info", "Core setup"],
  ["2", "Market", "Audience & quota"],
  ["3", "Suppliers", "Source allocation"],
  ["4", "Survey & security", "Live routing"],
];
const createdDate = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
}).format(new Date());
const subscribeToHydration = () => () => {};
const clientHydrated = () => true;
const serverNotHydrated = () => false;
type CreationMarket = {
  countryCode: string;
  languageCode: string;
  targetQuota: string;
  expectedLoiMinutes: string;
  expectedIr: string;
};
type PrescreeningQuestion = { question: string; answerType: string };
const newMarket = (countryCode = "IN"): CreationMarket => ({
  countryCode,
  languageCode: languageOptionsForCountry(countryCode)[0]?.code ?? "en",
  targetQuota: "",
  expectedLoiMinutes: "",
  expectedIr: "",
});

export function CreateProjectForm() {
  const { configured, session } = useAuth();
  const [createdId, setCreatedId] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    clientHydrated,
    serverNotHydrated,
  );
  const [canOperate, setCanOperate] = useState(!configured);
  const [clients, setClients] = useState([
    { name: "Northstar Bank", respondentParameter: "rid" },
    { name: "Arc Technologies", respondentParameter: "" },
    { name: "Halo Consumer", respondentParameter: "" },
    { name: "Aperture Auto", respondentParameter: "" },
  ]);
  const [selectedClient, setSelectedClient] = useState("");
  const [suppliers, setSuppliers] = useState([
    "CPX Research",
    "BitLabs",
    "PureSpectrum",
  ]);
  const [supplierCpis, setSupplierCpis] = useState<Record<string, string>>({});
  const [liveSurveyUrl, setLiveSurveyUrl] = useState("");
  const [testSurveyUrl, setTestSurveyUrl] = useState("");
  const [launchTab, setLaunchTab] = useState<"urls" | "security">("urls");
  const [addAutomaticParameters, setAddAutomaticParameters] = useState(true);
  const [geoSecurityEnabled, setGeoSecurityEnabled] = useState(false);
  const [surveyMultiLink, setSurveyMultiLink] = useState(false);
  const [campaignBanner, setCampaignBanner] = useState<"HIDE" | "SHOW">("HIDE");
  const [prescreeningQuestions, setPrescreeningQuestions] = useState<PrescreeningQuestion[]>(Array.from({ length: 5 }, () => ({ question: "", answerType: "SINGLE_SELECT" })));
  const [securityControls, setSecurityControls] = useState({ search: false, review: false, predupe: true, activity: false, emailVerify: false, fraudGuard: false, dfioPortal: false, survalidate: false, prescreeningCaptcha: false, speederTerminate: false, duplicateIp: true });
  const [markets, setMarkets] = useState<CreationMarket[]>([newMarket()]);

  useEffect(() => {
    if (configured && !session?.access_token) return;
    const headers = session?.access_token
      ? { authorization: `Bearer ${session.access_token}` }
      : undefined;
    void Promise.all([
      apiRequest<{ data: Array<{ name: string; status: string; respondentParameter?: string }> }>(
        "/api/clients",
        { headers },
      ),
      apiRequest<{
        data: Array<{ name: string; status: string }>;
        meta: { canOperate?: boolean };
      }>("/api/suppliers", { headers }),
    ])
      .then(([clientResponse, supplierResponse]) => {
        setClients(
          clientResponse.data
            .filter((item) => item.status === "ACTIVE")
            .map((item) => ({ name: item.name, respondentParameter: item.respondentParameter ?? "" })),
        );
        setSuppliers(
          supplierResponse.data
            .filter((item) => item.status === "ACTIVE")
            .map((item) => item.name),
        );
        setCanOperate(supplierResponse.meta.canOperate === true);
      })
      .catch(
        () =>
          configured &&
          setError("Client and supplier options could not be loaded."),
      );
  }, [configured, session?.access_token]);

  const clientRespondentParameter = clients.find((client) => client.name === selectedClient)?.respondentParameter ?? "";
  const detectedSurveyParameters = automaticSurveyParameters(liveSurveyUrl || testSurveyUrl, clientRespondentParameter);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = {
      projectName: form.get("projectName"),
      client: form.get("client"),
      clientPo: form.get("clientPo"),
      type: form.get("type"),
      category: form.get("category"),
      segment: form.get("segment"),
      surveyMultiLink,
      campaignBanner,
      prescreeningQuestions,
      securityControls,
      clientCpi: form.get("clientCpi"),
      markets: markets.map((market) => ({
        countryCode: market.countryCode,
        languageCode: market.languageCode,
        targetQuota: market.targetQuota,
        expectedLoiMinutes: market.expectedLoiMinutes,
        expectedIr: market.expectedIr,
      })),
      supplierAssignments: Object.entries(supplierCpis).map(
        ([name, supplierCpi]) => ({ name, supplierCpi }),
      ),
      surveyUrl: liveSurveyUrl,
      testSurveyUrl,
      geoSecurityEnabled,
      addAutomaticParameters,
    };
    setSubmitting(true);
    setError("");
    try {
      const response = await apiRequest<{ data: { id: string } }>(
        "/api/projects",
        {
          method: "POST",
          headers: session?.access_token
            ? { authorization: `Bearer ${session.access_token}` }
            : undefined,
          body: JSON.stringify(payload),
        },
      );
      setCreatedId(response.data.id);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "The project could not be created.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      {!canOperate ? (
        <div className="form-error data-error" role="status">
          Your workspace role has read-only access. An owner, administrator, or
          project manager must create projects.
        </div>
      ) : null}
      {createdId ? (
        <div className="success-banner">
          <span>
            Pending project {createdId} created and assigned to the signed-in
            operator.
          </span>
          <Link href={`/projects/${createdId}`}>Open project →</Link>
        </div>
      ) : null}
      {error ? (
        <div className="form-error data-error" role="alert">
          {error}
        </div>
      ) : null}
      <form onSubmit={submit}>
        <div className="project-create-layout">
          <section className="panel project-create-progress">
            <div className="panel-head">
              <h2 className="panel-title">Setup progress</h2>
              <span className="panel-note">4 steps · pending project</span>
            </div>
            <div className="info-list">
              {steps.map(([number, label, hint], index) => (
                <div
                  className={`info-row${index === 0 ? " active" : ""}`}
                  key={number}
                >
                  <span>
                    {number} · {label}
                  </span>
                  <strong>{index === 0 ? "Current" : hint}</strong>
                </div>
              ))}
            </div>
          </section>
          <div className="panel form-panel">
            <section className="form-section">
              <div className="section-head">
                <div>
                  <h2>Project information</h2>
                  <p>
                    Choose an existing client and controlled study
                    classification.
                  </p>
                </div>
                <span className="status-pill status-PENDING">PENDING</span>
              </div>
              <div className="form-grid">
                <div className="field full">
                  <label htmlFor="project-name">Project name</label>
                  <input
                    className="control"
                    id="project-name"
                    name="projectName"
                    required
                  />
                </div>
                <div className="field">
                  <label htmlFor="client">Client</label>
                  <select
                    className="control"
                    id="client"
                    name="client"
                    required
                    value={selectedClient}
                    onChange={(event) => setSelectedClient(event.target.value)}
                  >
                    <option value="" disabled>
                      Select client
                    </option>
                    {clients.map((client) => (
                      <option key={client.name} value={client.name}>{client.name}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="survey-multi-link">Survey multi link</label>
                  <select className="control" id="survey-multi-link" value={surveyMultiLink ? "ON" : "OFF"} onChange={(event) => setSurveyMultiLink(event.target.value === "ON")}><option value="OFF">Off</option><option value="ON">On</option></select>
                </div>
                <div className="field">
                  <label htmlFor="segment">Segment</label>
                  <input className="control" id="segment" name="segment" placeholder="Audience segment" />
                </div>
                <div className="field">
                  <label htmlFor="po">Client PO</label>
                  <input className="control" id="po" name="clientPo" />
                </div>
                <div className="field">
                  <label htmlFor="project-type">Project type</label>
                  <select
                    className="control"
                    id="project-type"
                    name="type"
                    defaultValue="B2C"
                  >
                    {projectTypes.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="category">Category</label>
                  <select
                    className="control"
                    id="category"
                    name="category"
                    defaultValue="None"
                  >
                    {categories.map((item) => (
                      <option key={item}>{item}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <span className="field-label">Project manager</span>
                  <div className="control" aria-label="Project manager">
                    Signed-in operator
                  </div>
                </div>
                <div className="field">
                  <span className="field-label">Created date</span>
                  <div className="control" aria-label="Created date">
                    {createdDate}
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="client-cpi">Client CPI (USD)</label>
                  <input
                    className="control"
                    id="client-cpi"
                    name="clientCpi"
                    type="number"
                    min="0"
                    step="0.01"
                    required
                  />
                </div>
              </div>
            </section>
            <section className="form-section">
              <div className="section-head"><div><h2>Pre-screening questions</h2><p>Configure up to five respondent-facing questions, matching the reference Q.1–Q.5 workflow.</p></div><span className="status-pill status-PENDING">5 MAX</span></div>
              <div className="prescreen-builder">
                {prescreeningQuestions.map((item, index) => <div className="prescreen-row" key={index}><span className="question-badge">Q.{index + 1}</span><div className="field"><label htmlFor={`prescreen-question-${index}`}>Question</label><input className="control" id={`prescreen-question-${index}`} value={item.question} onChange={(event) => setPrescreeningQuestions((current) => current.map((question, position) => position === index ? { ...question, question: event.target.value } : question))} /></div><div className="field"><label htmlFor={`prescreen-answer-${index}`}>Answer type</label><select className="control" id={`prescreen-answer-${index}`} value={item.answerType} onChange={(event) => setPrescreeningQuestions((current) => current.map((question, position) => position === index ? { ...question, answerType: event.target.value } : question))}><option value="SINGLE_SELECT">Single select</option><option value="MULTI_SELECT">Multi select</option><option value="TEXT">Text</option><option value="NUMBER">Number</option><option value="BOOLEAN">Yes / No</option></select></div></div>)}
              </div>
            </section>
            <section className="form-section">
              <div className="section-head">
                <div>
                  <h2>Markets & quotas</h2>
                  <p>
                    Add every country/language audience required for this
                    project.
                  </p>
                </div>
                <button
                  className="button small ghost"
                  type="button"
                  onClick={() =>
                    setMarkets((current) => [...current, newMarket("US")])
                  }
                >
                  ＋ Add market
                </button>
              </div>
              <div className="market-create-list">
                {markets.map((market, index) => {
                  const preferredLanguages = languageOptionsForCountry(
                    market.countryCode,
                  );
                  const otherLanguages = languageOptions.filter(
                    (option) =>
                      !preferredLanguages.some(
                        (preferred) => preferred.code === option.code,
                      ),
                  );
                  const update = (change: Partial<CreationMarket>) =>
                    setMarkets((current) =>
                      current.map((item, position) =>
                        position === index ? { ...item, ...change } : item,
                      ),
                    );
                  return (
                    <div className="market-create-row" key={index}>
                      <div className="form-grid three">
                        <div className="field">
                          <label htmlFor={`country-${index}`}>Country</label>
                          <select
                            className="control"
                            id={`country-${index}`}
                            aria-label={`Market ${index + 1} country`}
                            value={market.countryCode}
                            disabled={!hydrated}
                            onChange={(event) => {
                              const countryCode = event.target.value;
                              update({
                                countryCode,
                                languageCode:
                                  languageOptionsForCountry(countryCode)[0]
                                    ?.code ?? "en",
                              });
                            }}
                          >
                            {countryOptions.map((item) => (
                              <option key={item.code} value={item.code}>
                                {item.name} ({item.code})
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="field">
                          <label htmlFor={`language-${index}`}>Language</label>
                          <select
                            className="control"
                            id={`language-${index}`}
                            aria-label={`Market ${index + 1} language`}
                            value={market.languageCode}
                            disabled={!hydrated}
                            onChange={(event) =>
                              update({ languageCode: event.target.value })
                            }
                          >
                            <optgroup
                              label={`Common in ${countryOptions.find((option) => option.code === market.countryCode)?.name ?? market.countryCode}`}
                            >
                              {preferredLanguages.map((item) => (
                                <option key={item.code} value={item.code}>
                                  {item.name} ({item.code})
                                </option>
                              ))}
                            </optgroup>
                            <optgroup label="All other languages">
                              {otherLanguages.map((item) => (
                                <option key={item.code} value={item.code}>
                                  {item.name} ({item.code})
                                </option>
                              ))}
                            </optgroup>
                          </select>
                        </div>
                        <div className="field">
                          <label htmlFor={`quota-${index}`}>
                            Target completes
                          </label>
                          <input
                            className="control"
                            id={`quota-${index}`}
                            aria-label={`Market ${index + 1} target completes`}
                            type="number"
                            min="1"
                            required
                            value={market.targetQuota}
                            onChange={(event) =>
                              update({ targetQuota: event.target.value })
                            }
                          />
                        </div>
                        <div className="field">
                          <label htmlFor={`loi-${index}`}>
                            Expected LOI (minutes)
                          </label>
                          <input
                            className="control"
                            id={`loi-${index}`}
                            aria-label={`Market ${index + 1} expected LOI`}
                            type="number"
                            min="1"
                            required
                            value={market.expectedLoiMinutes}
                            onChange={(event) =>
                              update({ expectedLoiMinutes: event.target.value })
                            }
                          />
                        </div>
                        <div className="field">
                          <label htmlFor={`ir-${index}`}>
                            Expected incidence (%)
                          </label>
                          <input
                            className="control"
                            id={`ir-${index}`}
                            aria-label={`Market ${index + 1} expected incidence`}
                            type="number"
                            min="0"
                            max="100"
                            step="0.1"
                            required
                            value={market.expectedIr}
                            onChange={(event) =>
                              update({ expectedIr: event.target.value })
                            }
                          />
                        </div>
                        <div className="field market-remove">
                          <span className="field-label">
                            Market {index + 1}
                          </span>
                          <button
                            className="button small ghost"
                            type="button"
                            disabled={markets.length === 1}
                            onClick={() =>
                              setMarkets((current) =>
                                current.filter(
                                  (_, position) => position !== index,
                                ),
                              )
                            }
                          >
                            Remove market
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="panel-note">
                Project target completes will be the sum of all market quotas.
              </p>
            </section>
            <section className="form-section">
              <div className="section-head">
                <div>
                  <h2>Supplier assignment</h2>
                  <p>
                    Select multiple suppliers and set the buying CPI saved on
                    each project assignment.
                  </p>
                </div>
              </div>
              <details className="multi-select">
                <summary>
                  {Object.keys(supplierCpis).length
                    ? `${Object.keys(supplierCpis).length} supplier${Object.keys(supplierCpis).length === 1 ? "" : "s"} selected`
                    : "Select suppliers"}
                </summary>
                <div className="multi-select-menu">
                  {suppliers.map((supplier) => {
                    const selected = Object.hasOwn(supplierCpis, supplier);
                    return (
                      <div className="supplier-select-row" key={supplier}>
                        <label>
                          <input
                            aria-label={`Assign ${supplier}`}
                            type="checkbox"
                            checked={selected}
                            onChange={(event) =>
                              setSupplierCpis((current) => {
                                const next = { ...current };
                                if (event.target.checked) next[supplier] = "0";
                                else delete next[supplier];
                                return next;
                              })
                            }
                          />
                          <span>{supplier}</span>
                        </label>
                        <div className="field">
                          <label
                            htmlFor={`supplier-cpi-${supplier.replace(/\W/g, "-")}`}
                          >
                            Supplier CPI (USD)
                          </label>
                          <input
                            className="control"
                            id={`supplier-cpi-${supplier.replace(/\W/g, "-")}`}
                            aria-label={`${supplier} supplier CPI`}
                            type="number"
                            min="0"
                            step="0.01"
                            value={supplierCpis[supplier] ?? ""}
                            disabled={!selected}
                            onChange={(event) =>
                              setSupplierCpis((current) => ({
                                ...current,
                                [supplier]: event.target.value,
                              }))
                            }
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </details>
            </section>
            <section className="form-section">
              <div className="section-head">
                <div>
                  <h2>Survey setup</h2>
                  <p>Keep survey URLs and project security in separate tabs.</p>
                </div>
              </div>
              <div
                className="setup-tabs"
                role="tablist"
                aria-label="Survey setup"
              >
                <button
                  className={`setup-tab${launchTab === "urls" ? " active" : ""}`}
                  type="button"
                  role="tab"
                  aria-selected={launchTab === "urls"}
                  onClick={() => setLaunchTab("urls")}
                >
                  Survey URLs
                </button>
                <button
                  className={`setup-tab${launchTab === "security" ? " active" : ""}`}
                  type="button"
                  role="tab"
                  aria-selected={launchTab === "security"}
                  onClick={() => setLaunchTab("security")}
                >
                  Security
                </button>
              </div>
              {launchTab === "urls" ? (
                <div className="setup-tab-panel" role="tabpanel">
                  <div className="form-grid">
                    <div className="field">
                      <label htmlFor="survey-url">
                        Live survey URL (client link)
                      </label>
                      <input
                        className="control"
                        id="survey-url"
                        name="surveyUrl"
                        type="url"
                        placeholder="https://survey.example.com/start"
                        value={liveSurveyUrl}
                        onChange={(event) =>
                          setLiveSurveyUrl(event.target.value)
                        }
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="test-survey-url">
                        Test survey URL (optional)
                      </label>
                      <input
                        className="control"
                        id="test-survey-url"
                        name="testSurveyUrl"
                        type="url"
                        placeholder="https://survey.example.com/test"
                        value={testSurveyUrl}
                        onChange={(event) =>
                          setTestSurveyUrl(event.target.value)
                        }
                      />
                      <span className="panel-note">
                        Blank uses the Live URL.
                      </span>
                    </div>
                  </div>
                  <label className="compact-check">
                    <input
                      aria-label="Add automatic URL parameters"
                      type="checkbox"
                      checked={addAutomaticParameters}
                      onChange={(event) =>
                        setAddAutomaticParameters(event.target.checked)
                      }
                    />
                    <span>
                      <strong>Add automatic URL parameters</strong>
                      <small>
                        {detectedSurveyParameters[0]?.name || "pid"} = session/TOID; URL parameter is detected automatically
                      </small>
                    </span>
                  </label>
                  {addAutomaticParameters ? (
                    <div className="form-grid implementation-url-pair">
                      <div className="field">
                        <span className="field-label">
                          Live implementation URL
                        </span>
                        <code className="control static-control implementation-url">
                          {previewSurveyUrl(
                            liveSurveyUrl,
                            detectedSurveyParameters,
                          ) || "Enter the Live survey URL"}
                        </code>
                      </div>
                      <div className="field">
                        <span className="field-label">
                          Test implementation URL
                        </span>
                        <code className="control static-control implementation-url">
                          {previewSurveyUrl(
                            testSurveyUrl || liveSurveyUrl,
                            detectedSurveyParameters,
                            true,
                          ) || "Enter the Test or Live survey URL"}
                        </code>
                      </div>
                    </div>
                  ) : (
                    <p className="panel-note">
                      Client respondent parameters will not be appended. Signed outcome callbacks
                      remain protected and automatic.
                    </p>
                  )}
                </div>
              ) : (
                <div className="setup-tab-panel" role="tabpanel">
                  <h3>Research Defender</h3><div className="security-check-grid">{([['search','Search'],['review','Review'],['predupe','Predupe'],['activity','Activity'],['emailVerify','Email verify']] as const).map(([key,label]) => <label className="compact-check" key={key}><input type="checkbox" checked={securityControls[key]} onChange={(event) => setSecurityControls((current) => ({ ...current, [key]: event.target.checked }))} /><span><strong>{label}</strong></span></label>)}</div>
                  <h3>Digital fingerprinting</h3><div className="form-grid three">{([['fraudGuard','FraudGuard'],['dfioPortal','DFIO Portal'],['survalidate','Survalidate'],['prescreeningCaptcha','Pre-screening Captcha'],['speederTerminate','Speeder Term'],['duplicateIp','Duplicate IP']] as const).map(([key,label]) => <div className="field" key={key}><label htmlFor={`security-${key}`}>{label}</label><select className="control" id={`security-${key}`} value={securityControls[key] ? "ON" : "OFF"} onChange={(event) => setSecurityControls((current) => ({ ...current, [key]: event.target.value === "ON" }))}><option value="OFF">Off</option><option value="ON">On</option></select></div>)}</div>
                  <div className="form-grid">
                  <label className="choice-card">
                    <input
                      aria-label="Duplicate prevention is mandatory"
                      type="checkbox"
                      checked
                      disabled
                      readOnly
                    />
                    <span>
                      <strong>Duplicate prevention</strong>
                      <span>
                        IP and device signals are checked before client routing.
                      </span>
                    </span>
                  </label>
                  <label className="choice-card">
                    <input
                      aria-label="Controlled routing is mandatory"
                      type="checkbox"
                      checked
                      disabled
                      readOnly
                    />
                    <span>
                      <strong>Controlled routing</strong>
                      <span>
                        Only active project-supplier links can send live
                        traffic.
                      </span>
                    </span>
                  </label>
                  <label className="choice-card full">
                    <input
                      aria-label="Enable geo-location security"
                      type="checkbox"
                      checked={geoSecurityEnabled}
                      onChange={(event) =>
                        setGeoSecurityEnabled(event.target.checked)
                      }
                    />
                    <span>
                      <strong>Geo-location security</strong>
                      <span>
                        Compare hosting-edge location with all selected project
                        markets and include the result in Excel. No GPS or raw
                        IP is stored.
                      </span>
                    </span>
                  </label>
                  <div className="field"><label htmlFor="campaign-banner">Campaign banner</label><select className="control" id="campaign-banner" value={campaignBanner} onChange={(event) => setCampaignBanner(event.target.value as "HIDE" | "SHOW")}><option value="HIDE">Hide</option><option value="SHOW">Show</option></select></div>
                  </div>
                </div>
              )}
            </section>
            <div className="table-footer">
              <span>A dated pending project is created when you submit</span>
              <div className="row-actions">
                <Link className="button small ghost" href="/projects">
                  Cancel
                </Link>
                <button
                  className="button small"
                  type="submit"
                  disabled={submitting || !canOperate}
                >
                  {submitting ? "Creating…" : "Create project →"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </form>
    </>
  );
}
