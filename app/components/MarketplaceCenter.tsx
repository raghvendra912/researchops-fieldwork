"use client";
import Link from "./NavigationLink";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useAuth } from "../../src/features/auth/AuthProvider";
import { apiRequest } from "../../src/lib/api";

type Marketplace = { id: string; name: string; provider: string; status: string; currency: string; reversalWindowDays: number | null; lastSyncedAt: string | null; secretEnv: string | null; secretConfigured: boolean; entrySigning: { enabled?: boolean } | null };
type Survey = {
  id: string; marketplaceId: string; marketplaceName: string; externalId: string; title: string; countryCode: string | null; languageCode: string | null;
  cpi: number; currency: string; loiMinutes: number | null; incidencePct: number | null; conversionPct: number | null; quotaRemaining: number | null;
  status: string; qualificationCount: number; importedProjectCode: string | null; estimatedEarningsPerClick: { value: number | null; basis: string | null };
};
type FinanceRow = { projectId: string; projectCode: string; projectName: string; marketplaceName: string | null; currency: string; completes: number; reversals: number; revenue: number; supplierCost: number; margin: number; pendingRevenue: number; confirmedRevenue: number };
type SupplierKpi = { marketplaceId: string; marketplaceName: string; supplierId: string; supplierName: string; currency: string; starts: number; completes: number; reversals: number; conversionPct: number | null; reversalRatePct: number | null; revenue: number; supplierCost: number; margin: number; earningsPerClick: number | null };
type Mapping = { externalCode: string; variableKey: string; operatorDefault: string; valueMap: Record<string, string> };
type Supplier = { id: string; name: string; status?: string };
type Tab = "inventory" | "marketplaces" | "finance";
type ImportRow = { supplierId: string; supplierCpi: string };

const money = (value: number, currency: string) => { try { return new Intl.NumberFormat(undefined, { style: "currency", currency, minimumFractionDigits: 2 }).format(value); } catch { return `${currency} ${value.toFixed(2)}`; } };
const pct = (value: number | null) => value === null ? "—" : `${value.toFixed(1)}%`;
const describe = (error: unknown) => error instanceof Error ? error.message : "Request failed";
const surveyPill = (status: string) => `status-pill ${status === "OPEN" ? "status-ACTIVE" : status === "PAUSED" ? "status-PAUSED" : "status-CLOSED"}`;

export function MarketplaceCenter() {
  const { configured, session } = useAuth();
  const token = session?.access_token;
  const headers = useMemo(() => token ? { authorization: `Bearer ${token}` } : undefined, [token]);
  const ready = !configured || Boolean(token);

  const [tab, setTab] = useState<Tab>("inventory");
  const [marketplaces, setMarketplaces] = useState<Marketplace[]>([]);
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [finance, setFinance] = useState<FinanceRow[]>([]);
  const [kpis, setKpis] = useState<SupplierKpi[]>([]);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [canAdminister, setCanAdminister] = useState(!configured);
  const [source, setSource] = useState<"mock" | "supabase">("supabase");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [filter, setFilter] = useState({ marketplace: "", status: "OPEN", country: "", q: "", sort: "cpi" });
  const [importing, setImporting] = useState<Survey | null>(null);
  const [importName, setImportName] = useState("");
  const [importQuota, setImportQuota] = useState("");
  const [importRows, setImportRows] = useState<ImportRow[]>([{ supplierId: "", supplierCpi: "" }]);
  const [sync, setSync] = useState({ marketplaceId: "", format: "json" as "json" | "csv", text: "", fullSnapshot: false });
  const [mapMarketplace, setMapMarketplace] = useState("");

  // Fetchers are pure; state is applied in .then() callbacks inside effects (the
  // repo's lint rule forbids setState reachable synchronously from an effect body).
  const fetchMarketplaces = useCallback(() => apiRequest<{ data: Marketplace[]; meta: { source: "mock" | "supabase"; canAdminister?: boolean } }>("/api/marketplaces", { headers }), [headers]);
  const fetchSuppliers = useCallback(() => apiRequest<{ data: Supplier[] }>("/api/suppliers", { headers }), [headers]);
  const surveyQuery = useMemo(() => {
    const params = new URLSearchParams();
    if (filter.marketplace) params.set("marketplace", filter.marketplace);
    if (filter.status) params.set("status", filter.status);
    if (filter.country) params.set("country", filter.country.toUpperCase());
    if (filter.q) params.set("q", filter.q);
    if (filter.sort === "epc") params.set("sort", "epc");
    return params.toString();
  }, [filter]);
  const fetchSurveys = useCallback(() => apiRequest<{ data: Survey[] }>(`/api/marketplace-surveys?${surveyQuery}`, { headers }), [headers, surveyQuery]);
  const fetchFinance = useCallback(() => Promise.all([
    apiRequest<{ data: FinanceRow[] }>("/api/finance/summary", { headers }),
    apiRequest<{ data: SupplierKpi[] }>("/api/finance/suppliers", { headers }),
  ]), [headers]);
  const fetchMappings = useCallback((marketplaceId: string) => apiRequest<{ data: Mapping[] }>(`/api/marketplaces/${marketplaceId}/qualification-map`, { headers }), [headers]);

  const fail = useCallback((problem: unknown) => setError(describe(problem)), []);
  const applyMarketplaces = useCallback((response: { data: Marketplace[]; meta: { source: "mock" | "supabase"; canAdminister?: boolean } }) => {
    setMarketplaces(response.data); setSource(response.meta.source);
    if (response.meta.canAdminister !== undefined) setCanAdminister(response.meta.canAdminister);
  }, []);
  const applySuppliers = useCallback((response: { data: Supplier[] }) => setSuppliers(response.data.filter((supplier) => supplier.status !== "INACTIVE")), []);
  const applySurveys = useCallback((response: { data: Survey[] }) => setSurveys(response.data), []);
  const applyFinance = useCallback(([summary, supplierKpis]: [{ data: FinanceRow[] }, { data: SupplierKpi[] }]) => { setFinance(summary.data); setKpis(supplierKpis.data); }, []);
  const applyMappings = useCallback((response: { data: Mapping[] }) => setMappings(response.data), []);

  useEffect(() => { if (ready) void Promise.all([fetchMarketplaces().then(applyMarketplaces), fetchSuppliers().then(applySuppliers)]).catch(fail); }, [ready, fetchMarketplaces, fetchSuppliers, applyMarketplaces, applySuppliers, fail]);
  useEffect(() => { if (ready) void fetchSurveys().then(applySurveys).catch(fail); }, [ready, fetchSurveys, applySurveys, fail]);
  useEffect(() => { if (ready && tab === "finance") void fetchFinance().then(applyFinance).catch(fail); }, [ready, tab, fetchFinance, applyFinance, fail]);
  useEffect(() => { if (ready && tab === "marketplaces" && mapMarketplace) void fetchMappings(mapMarketplace).then(applyMappings).catch(fail); }, [ready, tab, mapMarketplace, fetchMappings, applyMappings, fail]);

  // Event handlers may refresh and set state directly.
  const refreshMarketplaces = async () => applyMarketplaces(await fetchMarketplaces());
  const refreshSurveys = async () => applySurveys(await fetchSurveys());
  const refreshFinance = async () => applyFinance(await fetchFinance());
  const refreshMappings = async () => applyMappings(await fetchMappings(mapMarketplace));


  async function run(action: () => Promise<void>, success: string) {
    setBusy(true); setError(""); setMessage("");
    try { await action(); if (success) setMessage(success); } catch (problem) { setError(describe(problem)); } finally { setBusy(false); }
  }

  function openImport(survey: Survey) {
    setImporting(survey); setImportName(survey.title); setImportQuota(survey.quotaRemaining ? String(survey.quotaRemaining) : "");
    setImportRows([{ supplierId: "", supplierCpi: "" }]);
  }

  const importValid = importing !== null && importRows.every((row) => row.supplierId && row.supplierCpi !== "" && Number(row.supplierCpi) >= 0 && Number(row.supplierCpi) <= importing.cpi)
    && new Set(importRows.map((row) => row.supplierId)).size === importRows.length && Number(importQuota) >= 1;

  async function submitImport(event: FormEvent) {
    event.preventDefault();
    if (!importing || !importValid) return;
    await run(async () => {
      const response = await apiRequest<{ data: { projectCode: string; mappedRules: number; unmappedCodes: string[] } }>(`/api/marketplace-surveys/${importing.id}/import`, {
        method: "POST", headers, body: JSON.stringify({ projectName: importName, quota: Number(importQuota), suppliers: importRows.map((row) => ({ supplierId: row.supplierId, supplierCpi: Number(row.supplierCpi) })) }),
      });
      const unmapped = response.data.unmappedCodes.length ? ` ${response.data.unmappedCodes.length} qualification(s) have no mapping (${response.data.unmappedCodes.join(", ")}) and are screened only by the marketplace.` : "";
      setMessage(`Created project ${response.data.projectCode} with ${response.data.mappedRules} eligibility rule(s).${unmapped}`);
      setImporting(null); await refreshSurveys();
    }, "");
  }

  async function submitSync(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      const response = await apiRequest<{ data: { inserted: number; updated: number; closed: number; pausedProjects: number; skipped: number; errors: string[] } }>(`/api/marketplaces/${sync.marketplaceId}/sync`, {
        method: "POST", headers, body: JSON.stringify({ format: sync.format, data: sync.text, fullSnapshot: sync.fullSnapshot }),
      });
      const { inserted, updated, closed, pausedProjects, skipped, errors } = response.data;
      setMessage(`Sync finished: ${inserted} new, ${updated} updated, ${closed} closed, ${pausedProjects} project(s) paused${skipped ? `, ${skipped} row(s) skipped (${errors[0]})` : ""}.`);
      await Promise.all([refreshSurveys(), refreshMarketplaces()]);
    }, "");
  }

  async function addMarketplace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget; const data = new FormData(form);
    await run(async () => {
      const signing = data.get("signing") === "on";
      await apiRequest("/api/marketplaces", { method: "POST", headers, body: JSON.stringify({
        name: data.get("name"), provider: data.get("provider"), currency: data.get("currency"),
        reversalWindowDays: data.get("reversalWindowDays") === "" ? null : Number(data.get("reversalWindowDays")),
        secretEnv: data.get("secretEnv") || undefined, entrySigning: signing ? { enabled: true, algorithm: data.get("algorithm"), param: data.get("param") || "hash" } : undefined,
      }) });
      form.reset(); await refreshMarketplaces();
    }, "Marketplace added. Add its secret to the server environment, then sync inventory.");
  }

  async function toggleMarketplace(marketplace: Marketplace) {
    await run(async () => {
      await apiRequest(`/api/marketplaces/${marketplace.id}`, { method: "PATCH", headers, body: JSON.stringify({ status: marketplace.status === "ACTIVE" ? "PAUSED" : "ACTIVE" }) });
      await refreshMarketplaces();
    }, `${marketplace.name} ${marketplace.status === "ACTIVE" ? "paused" : "activated"}.`);
  }

  async function saveMapping(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget; const data = new FormData(form);
    const valueMap = Object.fromEntries(String(data.get("valueMap") ?? "").split(",").map((pair) => pair.split("=").map((part) => part.trim())).filter((pair) => pair.length === 2 && pair[0] && pair[1]));
    await run(async () => {
      await apiRequest(`/api/marketplaces/${mapMarketplace}/qualification-map`, { method: "PUT", headers, body: JSON.stringify({ mappings: [{ externalCode: data.get("externalCode"), variableKey: data.get("variableKey"), operatorDefault: data.get("operatorDefault"), valueMap }] }) });
      form.reset(); await refreshMappings();
    }, "Mapping saved.");
  }

  async function removeMapping(code: string) {
    await run(async () => { await apiRequest(`/api/marketplaces/${mapMarketplace}/qualification-map?code=${encodeURIComponent(code)}`, { method: "DELETE", headers }); await refreshMappings(); }, "Mapping removed.");
  }

  async function submitReversal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget; const data = new FormData(form);
    await run(async () => {
      const response = await apiRequest<{ data: Array<{ reversedEntries: number; error?: string }> }>("/api/finance/reversals", { method: "POST", headers, body: JSON.stringify({ items: [{ sessionId: String(data.get("sessionId") ?? "").trim(), reason: data.get("reason") }] }) });
      const result = response.data[0]; if (result?.error) throw new Error(result.error);
      if (!result || result.reversedEntries === 0) throw new Error("Nothing to reverse: that session has no unreversed complete in the ledger.");
      form.reset(); await refreshFinance();
    }, "Reversal recorded; revenue and supplier cost were reversed.");
  }

  const totals = useMemo(() => {
    const byCurrency = new Map<string, { revenue: number; cost: number; margin: number; completes: number; reversals: number }>();
    for (const row of finance) {
      const current = byCurrency.get(row.currency) ?? { revenue: 0, cost: 0, margin: 0, completes: 0, reversals: 0 };
      current.revenue += row.revenue; current.cost += row.supplierCost; current.margin += row.margin; current.completes += row.completes; current.reversals += row.reversals;
      byCurrency.set(row.currency, current);
    }
    return [...byCurrency.entries()];
  }, [finance]);

  const importMargin = importing ? importRows.map((row) => row.supplierCpi === "" ? null : importing.cpi - Number(row.supplierCpi)) : [];

  return <div className="project-center-page">
    <section className="reference-filter" aria-label="Marketplace scope">
      <div className="reference-filter-grid">
        <div className="field"><span className="field-label">Marketplaces</span><span className="control static-control">{marketplaces.length} connected</span></div>
        <div className="field"><span className="field-label">Open surveys</span><span className="control static-control">{surveys.filter((survey) => survey.status === "OPEN").length} listed</span></div>
        <div className="field"><span className="field-label">Revenue basis</span><span className="control static-control">Confirmed completes</span></div>
        <div className="field"><span className="field-label">Access</span><span className="control static-control">{canAdminister ? "Can administer" : "Can operate"}</span></div>
        <div className="reference-actions"><Link className="reference-icon-button" href="/suppliers" aria-label="Open suppliers" title="Open suppliers">☰</Link></div>
      </div>
      <div className="reference-filter-extra">
        <span className="panel-note">Marketplace · import survey inventory, route supplier traffic, and track margin per confirmed complete.</span>
        {source === "mock" ? <span className="panel-note">Demo data — connect the database to save changes.</span> : null}
      </div>
    </section>
    {error ? <div className="form-error data-error" role="alert">{error}</div> : null}
    {message ? <div className="panel-note" role="status" style={{ margin: "0 0 12px" }}>{message}</div> : null}
    <div className="row-actions" role="tablist" aria-label="Marketplace sections" style={{ marginBottom: 12 }}>
      {(["inventory", "marketplaces", "finance"] as Tab[]).map((value) => <button key={value} type="button" role="tab" aria-selected={tab === value} className={`button small ${tab === value ? "primary" : ""}`} onClick={() => setTab(value)}>{value === "inventory" ? "Inventory" : value === "marketplaces" ? "Marketplaces" : "Finance"}</button>)}
    </div>

    {tab === "inventory" ? <section className="panel">
      <div className="panel-head"><h2 className="panel-title">Survey inventory</h2><span className="panel-note">Estimated earnings per click = CPI × system conversion; a “ceiling” uses incidence only.</span></div>
      <div className="form-grid three" style={{ padding: "0 16px 14px" }}>
        <div className="field"><label htmlFor="mk-marketplace">Marketplace</label><select className="control" id="mk-marketplace" value={filter.marketplace} onChange={(event) => setFilter({ ...filter, marketplace: event.target.value })}><option value="">All marketplaces</option>{marketplaces.map((marketplace) => <option key={marketplace.id} value={marketplace.id}>{marketplace.name}</option>)}</select></div>
        <div className="field"><label htmlFor="mk-status">Status</label><select className="control" id="mk-status" value={filter.status} onChange={(event) => setFilter({ ...filter, status: event.target.value })}><option value="OPEN">Open</option><option value="PAUSED">Paused</option><option value="CLOSED">Closed</option><option value="">Any</option></select></div>
        <div className="field"><label htmlFor="mk-country">Country (ISO)</label><input className="control" id="mk-country" maxLength={2} value={filter.country} onChange={(event) => setFilter({ ...filter, country: event.target.value.replace(/[^A-Za-z]/g, "") })} placeholder="IN" /></div>
        <div className="field"><label htmlFor="mk-search">Search title</label><input className="control" id="mk-search" value={filter.q} onChange={(event) => setFilter({ ...filter, q: event.target.value })} placeholder="Survey title" /></div>
        <div className="field"><label htmlFor="mk-sort">Sort by</label><select className="control" id="mk-sort" value={filter.sort} onChange={(event) => setFilter({ ...filter, sort: event.target.value })}><option value="cpi">Highest CPI</option><option value="epc">Highest earnings per click</option></select></div>
      </div>
      <div className="table-wrap"><table className="data-table">
        <thead><tr><th>Survey</th><th>Marketplace</th><th>Market</th><th>CPI</th><th>LOI</th><th>IR</th><th>Conv.</th><th>Est. per click</th><th>Quota left</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>{surveys.map((survey) => <tr key={survey.id}>
          <td><strong>{survey.title}</strong><br /><span className="panel-note">{survey.externalId} · {survey.qualificationCount} qualification(s)</span></td>
          <td>{survey.marketplaceName}</td>
          <td>{survey.countryCode ?? "—"} · {survey.languageCode ?? "—"}</td>
          <td>{money(survey.cpi, survey.currency)}</td>
          <td>{survey.loiMinutes ? `${survey.loiMinutes} min` : "—"}</td>
          <td>{pct(survey.incidencePct)}</td><td>{pct(survey.conversionPct)}</td>
          <td>{survey.estimatedEarningsPerClick.value === null ? "—" : `${money(survey.estimatedEarningsPerClick.value, survey.currency)}${survey.estimatedEarningsPerClick.basis === "incidence-ceiling" ? " ceiling" : ""}`}</td>
          <td>{survey.quotaRemaining ?? "—"}</td>
          <td><span className={surveyPill(survey.status)}>{survey.status}</span></td>
          <td>{survey.importedProjectCode ? <Link className="button small ghost" href={`/projects/${encodeURIComponent(survey.importedProjectCode)}`}>{survey.importedProjectCode}</Link> : <button className="button small" type="button" disabled={survey.status !== "OPEN" || busy} onClick={() => openImport(survey)}>Import</button>}</td>
        </tr>)}{surveys.length === 0 ? <tr><td colSpan={11} style={{ padding: 28, textAlign: "center" }}>No surveys match. Add a marketplace and sync its inventory on the Marketplaces tab.</td></tr> : null}</tbody>
      </table></div>
      <div className="table-footer"><span>{surveys.length} survey(s)</span></div>
    </section> : null}

    {tab === "marketplaces" ? <>
      <section className="panel">
        <div className="panel-head"><h2 className="panel-title">Connected marketplaces</h2><span className="panel-note">Secrets are never stored here — each marketplace names the server variable that holds its secret.</span></div>
        <div className="table-wrap"><table className="data-table">
          <thead><tr><th>Name</th><th>Provider</th><th>Currency</th><th>Reversal window</th><th>Secret</th><th>Entry signing</th><th>Last sync</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>{marketplaces.map((marketplace) => <tr key={marketplace.id}>
            <td><strong>{marketplace.name}</strong></td><td>{marketplace.provider}</td><td>{marketplace.currency}</td>
            <td>{marketplace.reversalWindowDays === null ? "Manual confirmation" : `${marketplace.reversalWindowDays} days`}</td>
            <td>{marketplace.secretEnv ? `${marketplace.secretEnv} ${marketplace.secretConfigured ? "✓ set" : "✗ missing"}` : "Not set"}</td>
            <td>{marketplace.entrySigning?.enabled ? "On" : "Off"}</td>
            <td>{marketplace.lastSyncedAt ? new Date(marketplace.lastSyncedAt).toLocaleString() : "Never"}</td>
            <td><span className={`status-pill status-${marketplace.status}`}>{marketplace.status}</span></td>
            <td><button className="button small ghost" type="button" disabled={!canAdminister || busy} onClick={() => void toggleMarketplace(marketplace)}>{marketplace.status === "ACTIVE" ? "Pause" : "Activate"}</button></td>
          </tr>)}{marketplaces.length === 0 ? <tr><td colSpan={9} style={{ padding: 28, textAlign: "center" }}>No marketplaces yet.</td></tr> : null}</tbody>
        </table></div>
      </section>

      {canAdminister ? <section className="panel directory-form" style={{ marginTop: 16 }}>
        <div className="section-head"><div><h2>Add marketplace</h2><p>A client record with the same name is created so the marketplace can return respondents to your client end links.</p></div></div>
        <form className="form-grid three" onSubmit={(event) => void addMarketplace(event)}>
          <div className="field"><label htmlFor="mk-name">Name</label><input className="control" id="mk-name" name="name" required minLength={2} maxLength={80} /></div>
          <div className="field"><label htmlFor="mk-provider">Provider</label><select className="control" id="mk-provider" name="provider" defaultValue="GENERIC">{["GENERIC", "CINT", "PURESPECTRUM", "DYNATA", "TOLUNA", "OTHER"].map((provider) => <option key={provider}>{provider}</option>)}</select></div>
          <div className="field"><label htmlFor="mk-currency">Currency</label><input className="control" id="mk-currency" name="currency" defaultValue="USD" pattern="[A-Za-z]{3}" required /></div>
          <div className="field"><label htmlFor="mk-window">Reversal window (days, blank = manual)</label><input className="control" id="mk-window" name="reversalWindowDays" type="number" min={0} max={365} /></div>
          <div className="field"><label htmlFor="mk-secret">Secret variable name</label><input className="control" id="mk-secret" name="secretEnv" placeholder="MARKETPLACE_CINT_SECRET" pattern="MARKETPLACE_[A-Z0-9_]{1,40}_SECRET" /></div>
          <div className="choice-card"><input aria-label="Sign entry links" name="signing" type="checkbox" /><span><strong>Sign entry links</strong><span>Append an HMAC of the survey URL (needs the secret variable).</span></span></div>
          <div className="field"><label htmlFor="mk-param">Signature parameter</label><input className="control" id="mk-param" name="param" defaultValue="hash" pattern="[A-Za-z][A-Za-z0-9_]{0,30}" /></div>
          <div className="field"><label htmlFor="mk-algorithm">Algorithm</label><select className="control" id="mk-algorithm" name="algorithm" defaultValue="SHA-256"><option>SHA-256</option><option>SHA-1</option></select></div>
          <div className="field full directory-submit"><button className="button primary" type="submit" disabled={busy}>Add marketplace</button></div>
        </form>
      </section> : null}

      <section className="panel directory-form" style={{ marginTop: 16 }}>
        <div className="section-head"><div><h2>Sync inventory</h2><p>Paste or upload the marketplace feed (JSON array, or CSV with a header row). A full snapshot closes surveys missing from the feed and pauses their live projects.</p></div></div>
        <form className="form-grid" onSubmit={(event) => void submitSync(event)}>
          <div className="field"><label htmlFor="sync-marketplace">Marketplace</label><select className="control" id="sync-marketplace" value={sync.marketplaceId} onChange={(event) => setSync({ ...sync, marketplaceId: event.target.value })} required><option value="">Choose…</option>{marketplaces.filter((marketplace) => marketplace.status === "ACTIVE").map((marketplace) => <option key={marketplace.id} value={marketplace.id}>{marketplace.name}</option>)}</select></div>
          <div className="field"><label htmlFor="sync-format">Format</label><select className="control" id="sync-format" value={sync.format} onChange={(event) => setSync({ ...sync, format: event.target.value as "json" | "csv" })}><option value="json">JSON</option><option value="csv">CSV</option></select></div>
          <div className="field full"><label htmlFor="sync-file">Upload file</label><input className="control" id="sync-file" type="file" accept=".json,.csv,text/csv,application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void file.text().then((text) => setSync((current) => ({ ...current, text, format: file.name.toLowerCase().endsWith(".csv") ? "csv" : "json" }))); }} /></div>
          <div className="field full"><label htmlFor="sync-text">Feed contents</label><textarea className="control" id="sync-text" rows={7} value={sync.text} onChange={(event) => setSync({ ...sync, text: event.target.value })} placeholder='[{"id":"S-1","title":"Wallet study","country":"IN","language":"en","cpi":2.5,"loi":10,"ir":40,"conversion":55,"url":"https://panel.example.com/s?id=1&uid={{respondent_id}}"}]' required style={{ height: "auto", padding: 10, fontFamily: "ui-monospace, monospace" }} /></div>
          <div className="choice-card"><input aria-label="Full snapshot" type="checkbox" checked={sync.fullSnapshot} onChange={(event) => setSync({ ...sync, fullSnapshot: event.target.checked })} /><span><strong>Full snapshot</strong><span>The feed lists every survey the marketplace still offers.</span></span></div>
          <div className="field full directory-submit"><button className="button primary" type="submit" disabled={busy || !sync.marketplaceId || !sync.text.trim()}>Sync inventory</button></div>
        </form>
      </section>

      <section className="panel" style={{ marginTop: 16 }}>
        <div className="panel-head"><h2 className="panel-title">Qualification mapping</h2><span className="panel-note">Maps the marketplace’s question codes to your eligibility variables so imported surveys screen respondents before they reach the client.</span></div>
        <div className="form-grid" style={{ padding: "0 16px 14px" }}>
          <div className="field"><label htmlFor="map-marketplace">Marketplace</label><select className="control" id="map-marketplace" value={mapMarketplace} onChange={(event) => setMapMarketplace(event.target.value)}><option value="">Choose…</option>{marketplaces.map((marketplace) => <option key={marketplace.id} value={marketplace.id}>{marketplace.name}</option>)}</select></div>
        </div>
        {mapMarketplace ? <>
          <div className="table-wrap"><table className="data-table">
            <thead><tr><th>Marketplace code</th><th>Variable</th><th>Default operator</th><th>Value map</th><th>Action</th></tr></thead>
            <tbody>{mappings.map((mapping) => <tr key={mapping.externalCode}>
              <td><strong>{mapping.externalCode}</strong></td><td>{mapping.variableKey}</td><td>{mapping.operatorDefault}</td>
              <td>{Object.entries(mapping.valueMap).map(([from, to]) => `${from}=${to}`).join(", ") || "—"}</td>
              <td><button className="button small ghost" type="button" disabled={!canAdminister || busy} onClick={() => void removeMapping(mapping.externalCode)}>Remove</button></td>
            </tr>)}{mappings.length === 0 ? <tr><td colSpan={5} style={{ padding: 28, textAlign: "center" }}>No mappings yet.</td></tr> : null}</tbody>
          </table></div>
          {canAdminister ? <form className="form-grid three" style={{ padding: 16 }} onSubmit={(event) => void saveMapping(event)}>
            <div className="field"><label htmlFor="map-code">Marketplace code</label><input className="control" id="map-code" name="externalCode" required maxLength={80} placeholder="AGE" /></div>
            <div className="field"><label htmlFor="map-variable">Your variable</label><input className="control" id="map-variable" name="variableKey" required pattern="[a-z][a-z0-9_]{0,49}" placeholder="age" /></div>
            <div className="field"><label htmlFor="map-operator">Default operator</label><select className="control" id="map-operator" name="operatorDefault" defaultValue="IN">{["IN", "EQ", "NE", "NOT_IN", "GTE", "LTE", "BETWEEN"].map((operator) => <option key={operator}>{operator}</option>)}</select></div>
            <div className="field full"><label htmlFor="map-values">Value map (optional, e.g. 1=male, 2=female)</label><input className="control" id="map-values" name="valueMap" /></div>
            <div className="field full directory-submit"><button className="button primary" type="submit" disabled={busy}>Save mapping</button></div>
          </form> : null}
        </> : null}
      </section>
    </> : null}

    {tab === "finance" ? <>
      <section className="panel">
        <div className="panel-head"><h2 className="panel-title">Revenue and margin</h2><span className="panel-note">Per confirmed-or-pending complete, net of reversals. Amounts are shown per currency; no FX is applied.</span></div>
        <div className="table-wrap"><table className="data-table">
          <thead><tr><th>Project</th><th>Marketplace</th><th>Currency</th><th>Completes</th><th>Reversals</th><th>Revenue</th><th>Supplier cost</th><th>Margin</th><th>Pending</th><th>Confirmed</th></tr></thead>
          <tbody>{finance.map((row) => <tr key={`${row.projectId}-${row.currency}`}>
            <td><Link href={`/projects/${encodeURIComponent(row.projectCode)}`}><strong>{row.projectCode}</strong></Link> · {row.projectName}</td><td>{row.marketplaceName ?? "Direct client"}</td><td>{row.currency}</td>
            <td>{row.completes}</td><td>{row.reversals}</td><td>{money(row.revenue, row.currency)}</td><td>{money(row.supplierCost, row.currency)}</td>
            <td><strong>{money(row.margin, row.currency)}</strong></td><td>{money(row.pendingRevenue, row.currency)}</td><td>{money(row.confirmedRevenue, row.currency)}</td>
          </tr>)}{finance.length === 0 ? <tr><td colSpan={10} style={{ padding: 28, textAlign: "center" }}>No completes have been recorded in the ledger yet.</td></tr> : null}</tbody>
        </table></div>
        <div className="table-footer">{totals.length === 0 ? <span>No totals yet</span> : totals.map(([currency, total]) => <span key={currency}>{currency}: revenue {money(total.revenue, currency)} · cost {money(total.cost, currency)} · margin {money(total.margin, currency)} · {total.completes} complete(s), {total.reversals} reversed</span>)}</div>
      </section>

      <section className="panel" style={{ marginTop: 16 }}>
        <div className="panel-head"><h2 className="panel-title">Supplier performance on marketplace surveys</h2><span className="panel-note">Marketplaces score suppliers on conversion and reversal rate; earnings per click is your margin driver.</span></div>
        <div className="table-wrap"><table className="data-table">
          <thead><tr><th>Supplier</th><th>Marketplace</th><th>Currency</th><th>Clicks</th><th>Completes</th><th>Conversion</th><th>Reversal rate</th><th>Revenue</th><th>Cost</th><th>Margin</th><th>Per click</th></tr></thead>
          <tbody>{kpis.map((kpi) => <tr key={`${kpi.marketplaceId}-${kpi.supplierId}-${kpi.currency}`}>
            <td><strong>{kpi.supplierName}</strong></td><td>{kpi.marketplaceName}</td><td>{kpi.currency}</td><td>{kpi.starts}</td><td>{kpi.completes}</td>
            <td>{pct(kpi.conversionPct)}</td><td>{pct(kpi.reversalRatePct)}</td><td>{money(kpi.revenue, kpi.currency)}</td><td>{money(kpi.supplierCost, kpi.currency)}</td>
            <td>{money(kpi.margin, kpi.currency)}</td><td>{kpi.earningsPerClick === null ? "—" : money(kpi.earningsPerClick, kpi.currency)}</td>
          </tr>)}{kpis.length === 0 ? <tr><td colSpan={11} style={{ padding: 28, textAlign: "center" }}>No marketplace traffic yet.</td></tr> : null}</tbody>
        </table></div>
      </section>

      <section className="panel directory-form" style={{ marginTop: 16 }}>
        <div className="section-head"><div><h2>Record a reversal</h2><p>When a marketplace rejects a complete after the fact, reverse it here (or send it through the signed marketplace callback). Revenue and supplier cost are both reversed once.</p></div></div>
        <form className="form-grid" onSubmit={(event) => void submitReversal(event)}>
          <div className="field"><label htmlFor="rev-session">ResearchOps session ID</label><input className="control" id="rev-session" name="sessionId" required pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}" placeholder="the rid / transaction id the marketplace reports" /></div>
          <div className="field"><label htmlFor="rev-reason">Reason</label><input className="control" id="rev-reason" name="reason" maxLength={500} placeholder="e.g. Marketplace quality rejection" /></div>
          <div className="field full directory-submit"><button className="button primary" type="submit" disabled={busy}>Reverse complete</button></div>
        </form>
      </section>
    </> : null}

    {importing ? <div className="modal-backdrop"><section aria-modal="true" className="panel links-modal" role="dialog" aria-label={`Import ${importing.title}`}>
      <div className="section-head"><div><div className="eyebrow">{importing.marketplaceName} · {importing.externalId}</div><h2>Import as project</h2><p>Creates a pending project with the marketplace as client, the survey link, and eligibility rules from your qualification mappings. Marketplace CPI: <strong>{money(importing.cpi, importing.currency)}</strong>.</p></div><button className="button small ghost" type="button" onClick={() => setImporting(null)}>Close</button></div>
      <form className="form-grid" onSubmit={(event) => void submitImport(event)}>
        <div className="field full"><label htmlFor="imp-name">Project name</label><input className="control" id="imp-name" value={importName} onChange={(event) => setImportName(event.target.value)} maxLength={200} required /></div>
        <div className="field"><label htmlFor="imp-quota">Target completes</label><input className="control" id="imp-quota" type="number" min={1} value={importQuota} onChange={(event) => setImportQuota(event.target.value)} required /></div>
        <div className="field full"><h3>Suppliers and what you pay them</h3><p className="panel-note">A supplier CPI above the marketplace CPI is rejected because every complete would lose money.</p></div>
        {importRows.map((row, index) => <div className="field full" key={index} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr auto", gap: 10, alignItems: "end" }}>
          <div className="field"><label htmlFor={`imp-sup-${index}`}>Supplier</label><select className="control" id={`imp-sup-${index}`} value={row.supplierId} onChange={(event) => setImportRows(importRows.map((current, position) => position === index ? { ...current, supplierId: event.target.value } : current))} required><option value="">Choose…</option>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></div>
          <div className="field"><label htmlFor={`imp-cpi-${index}`}>Supplier CPI</label><input className="control" id={`imp-cpi-${index}`} type="number" min={0} max={importing.cpi} step="0.01" value={row.supplierCpi} onChange={(event) => setImportRows(importRows.map((current, position) => position === index ? { ...current, supplierCpi: event.target.value } : current))} required /></div>
          <div className="field"><span className="field-label">Margin / complete</span><span className="control static-control">{importMargin[index] === null || importMargin[index] === undefined ? "—" : `${money(importMargin[index]!, importing.currency)} (${importing.cpi > 0 ? ((importMargin[index]! / importing.cpi) * 100).toFixed(0) : 0}%)`}</span></div>
          <button className="button small ghost" type="button" disabled={importRows.length === 1} onClick={() => setImportRows(importRows.filter((_, position) => position !== index))}>Remove</button>
        </div>)}
        <div className="field full"><button className="button small" type="button" onClick={() => setImportRows([...importRows, { supplierId: "", supplierCpi: "" }])}>Add supplier</button></div>
        <div className="modal-actions field full"><button className="button primary" type="submit" disabled={busy || !importValid}>Create project</button></div>
      </form>
    </section></div> : null}
  </div>;
}
