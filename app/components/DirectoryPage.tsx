"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../src/features/auth/AuthProvider";
import { apiRequest } from "../../src/lib/api";

type DirectoryKind = "clients" | "suppliers";
type Redirects = { completeUrl: string; terminateUrl: string; quotaFullUrl: string; securityTerminateUrl: string };
type DirectoryRecord = {
  id: string; name: string; code: string; status: "ACTIVE" | "INACTIVE"; projectCount: number;
  contactName: string; address: string; contactEmail: string; phone: string; redirectMode?: "STATIC" | "DYNAMIC";
  redirects: Redirects;
  links?: { complete?: string; terminate?: string; quotaFull?: string; securityTerminate?: string; test?: string; live?: string };
};

const emptyRedirects: Redirects = { completeUrl: "", terminateUrl: "", quotaFullUrl: "", securityTerminateUrl: "" };
const demoRecords: Record<DirectoryKind, DirectoryRecord[]> = {
  clients: [{ id: "client-northstar", name: "Northstar Bank", code: "NORTHSTAR", status: "ACTIVE", projectCount: 2, contactName: "Research team", address: "Mumbai", contactEmail: "research@northstar.example", phone: "+91 00000 00000", redirects: emptyRedirects }],
  suppliers: [{ id: "supplier-cpx", name: "CPX Research", code: "CPX", status: "ACTIVE", projectCount: 3, contactName: "Supply team", address: "Remote", contactEmail: "supply@cpx.example", phone: "+1 000 000 0000", redirectMode: "STATIC", redirects: emptyRedirects }],
};

export function DirectoryPage({ kind, eyebrow, title, subtitle, action }: { kind: DirectoryKind; eyebrow: string; title: string; subtitle: string; action: string }) {
  const { configured, session } = useAuth();
  const [records, setRecords] = useState<DirectoryRecord[]>(() => configured ? [] : demoRecords[kind]);
  const [query, setQuery] = useState(""); const [formOpen, setFormOpen] = useState(false); const [editing, setEditing] = useState<DirectoryRecord | null>(null); const [linkRecord, setLinkRecord] = useState<DirectoryRecord | null>(null); const [error, setError] = useState(""); const [source, setSource] = useState<"mock" | "supabase">("mock"); const [canOperate, setCanOperate] = useState(!configured); const [copied, setCopied] = useState("");
  const accessToken = session?.access_token;

  useEffect(() => {
    if (configured && !accessToken) return;
    const headers = accessToken ? { authorization: `Bearer ${accessToken}` } : undefined;
    void apiRequest<{ data: DirectoryRecord[]; meta: { source: "mock" | "supabase"; canOperate?: boolean } }>(`/api/${kind}`, { headers }).then((response) => { setRecords(response.data); setSource(response.meta.source); setCanOperate(response.meta.canOperate === true); setError(""); }).catch(() => setError(`${title} could not be loaded.`));
  }, [accessToken, configured, kind, title]);

  const filtered = useMemo(() => { const term = query.trim().toLowerCase(); return records.filter((record) => !term || [record.name, record.code, record.contactEmail].some((value) => value.toLowerCase().includes(term))); }, [query, records]);
  function openCreate() { setEditing(null); setFormOpen(true); setError(""); }
  function openEdit(record: DirectoryRecord) { setEditing(record); setFormOpen(true); setError(""); }
  function openLinks(record: DirectoryRecord) { setLinkRecord(record); setCopied(""); }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const payload = {
      name: form.get("name"), code: form.get("code"), contactName: form.get("contactName"), address: form.get("address"), contactEmail: form.get("contactEmail"), phone: form.get("phone"),
      ...(kind === "suppliers" ? { redirectMode: form.get("redirectMode"), redirects: { completeUrl: form.get("completeUrl"), terminateUrl: form.get("terminateUrl"), quotaFullUrl: form.get("quotaFullUrl"), securityTerminateUrl: form.get("securityTerminateUrl") } } : {}),
    };
    try {
      const response = await apiRequest<{ data: DirectoryRecord }>(editing ? `/api/${kind}/${encodeURIComponent(editing.id)}` : `/api/${kind}`, { method: editing ? "PATCH" : "POST", headers: accessToken ? { authorization: `Bearer ${accessToken}` } : undefined, body: JSON.stringify(payload) });
      setRecords((current) => editing ? current.map((record) => record.id === editing.id ? { ...record, ...response.data } : record) : [...current, response.data].sort((a, b) => a.name.localeCompare(b.name)));
      setFormOpen(false); setEditing(null); setError("");
    } catch (requestError) { setError(requestError instanceof Error ? requestError.message : `${title} could not be saved.`); }
  }

  async function toggleStatus(record: DirectoryRecord) {
    try { const response = await apiRequest<{ data: DirectoryRecord }>(`/api/${kind}/${encodeURIComponent(record.id)}`, { method: "PATCH", headers: accessToken ? { authorization: `Bearer ${accessToken}` } : undefined, body: JSON.stringify({ status: record.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" }) }); setRecords((current) => current.map((item) => item.id === record.id ? { ...item, ...response.data } : item)); setError(""); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Status could not be changed."); }
  }

  async function copyLink(label: string, link: string) { await navigator.clipboard.writeText(link); setCopied(label); window.setTimeout(() => setCopied(""), 1800); }
  const visibleLinks = Object.entries(linkRecord?.links ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === "string" && Boolean(entry[1]));
  async function copyAll() { if (!visibleLinks.length) return; await navigator.clipboard.writeText(visibleLinks.map(([label, link]) => `${linkLabel(kind, label)}: ${link}`).join("\n")); setCopied("all"); window.setTimeout(() => setCopied(""), 1800); }
  const editRedirects = editing?.redirects ?? emptyRedirects;

  return <>
    <div className="page-head"><div><div className="eyebrow">{eyebrow}</div><h1 className="page-title">{title}</h1><p className="page-subtitle">{subtitle}</p></div>{canOperate ? <button className="button primary" type="button" onClick={openCreate}>＋ {action}</button> : <span className="status-pill status-PENDING">{kind === "clients" ? "Admin managed" : "Read only"}</span>}</div>
    {error ? <div className="form-error data-error" role="alert">{error}</div> : null}
    <section className="panel"><div className="panel-head"><h2 className="panel-title">{title} directory</h2><div className="field search-wrap" style={{ width: 300 }}><input aria-label={`Search ${title.toLowerCase()}`} className="control search-control" placeholder="Search name, code or contact email" value={query} onChange={(event) => setQuery(event.target.value)} /></div></div>
      <div className="table-wrap"><table className="data-table" style={{ minWidth: 900 }}><thead><tr><th>#</th><th>Name</th><th>Contact</th>{kind === "suppliers" ? <th>Redirect mode</th> : null}<th>Projects</th><th>Status</th><th>Links</th>{canOperate ? <th>Actions</th> : null}</tr></thead><tbody>{filtered.map((record, index) => <tr key={record.id}><td>{index + 1}</td><td className="project-name-cell"><strong>{record.name}</strong><span>{record.code}</span></td><td className="project-name-cell"><strong>{record.contactName || "Not set"}</strong><span>{record.contactEmail || record.phone || "No contact details"}</span></td>{kind === "suppliers" ? <td>{record.redirectMode}</td> : null}<td className="rate">{record.projectCount}</td><td><span className={`status-pill status-${record.status}`}>{record.status}</span></td><td>{record.links ? <button className="button small ghost" type="button" onClick={() => openLinks(record)}>View links</button> : "Restricted"}</td>{canOperate ? <td><div className="row-actions"><button className="button small ghost" type="button" onClick={() => openEdit(record)}>Edit</button><button className="button small ghost" type="button" onClick={() => void toggleStatus(record)}>{record.status === "ACTIVE" ? "Deactivate" : "Activate"}</button></div></td> : null}</tr>)}{filtered.length === 0 ? <tr><td colSpan={canOperate ? (kind === "suppliers" ? 8 : 7) : (kind === "suppliers" ? 7 : 6)} style={{ textAlign: "center", padding: 32, color: "var(--muted)" }}>No matching records.</td></tr> : null}</tbody></table></div>
      <div className="table-footer"><span>{filtered.length} of {records.length} records</span><span>{source === "supabase" ? "Supabase workspace data" : "Demo data"}</span></div>
    </section>
    {formOpen ? <section className="panel directory-form" style={{ marginTop: 16 }}>
      <div className="section-head"><div><h2>{editing ? `Edit ${editing.name}` : action}</h2><p>{kind === "clients" ? "Maintain client identity and contact details. Redirect destinations are intentionally managed outside this record." : "Maintain supplier contact and redirect destinations."}</p></div><button className="button small ghost" type="button" onClick={() => setFormOpen(false)}>Close</button></div>
      <form className="form-grid three" onSubmit={save}>
        <Field label="Name" name="name" value={editing?.name} required /><Field label="Code" name="code" value={editing?.code} required pattern="[A-Za-z0-9][A-Za-z0-9_-]+" /><Field label="Contact name" name="contactName" value={editing?.contactName} />
        <Field label="Contact email" name="contactEmail" value={editing?.contactEmail} type="email" /><Field label="Phone number" name="phone" value={editing?.phone} /><div className="field"><label htmlFor="directory-address">Address</label><textarea className="control" id="directory-address" name="address" defaultValue={editing?.address} maxLength={500} /></div>
        {kind === "suppliers" ? <><div className="field"><label htmlFor="redirect-mode">Redirect mode</label><select className="control" id="redirect-mode" name="redirectMode" defaultValue={editing?.redirectMode ?? "STATIC"}><option value="STATIC">Static — reused for every project</option><option value="DYNAMIC">Dynamic — supports project/respondent placeholders</option></select></div><div className="field full"><h3>Redirect destinations</h3><p className="panel-note">Dynamic URLs may use {"{{respondent_id}}"} and {"{{project_id}}"}.</p></div><Field label="Complete URL" name="completeUrl" value={editRedirects.completeUrl} type="url" /><Field label="Terminate URL" name="terminateUrl" value={editRedirects.terminateUrl} type="url" /><Field label="Quota-full URL" name="quotaFullUrl" value={editRedirects.quotaFullUrl} type="url" /><Field label="Security-terminate URL" name="securityTerminateUrl" value={editRedirects.securityTerminateUrl} type="url" /></> : null}
        <div className="field full directory-submit"><button className="button primary" type="submit">{editing ? "Save changes" : action}</button></div>
      </form>
    </section> : null}
      {linkRecord ? <div className="modal-backdrop"><section aria-modal="true" className="panel links-modal" role="dialog" aria-label={`${linkRecord.name} links`}><div className="section-head"><div><div className="eyebrow">{kind === "suppliers" ? "Supplier setup" : "Client handoff"}</div><h2>{linkRecord.name} {kind === "suppliers" ? "entry routes" : "outcome links"}</h2><p>{kind === "suppliers" ? "These supplier-level routes are not ready-to-send respondent links. The Test route sends a synthetic outcome to a configured supplier return URL; the Live route needs a project code and the supplier's unique attempt ID. Copy project-specific Test and Live links from Project details → Supplier delivery → Links." : "Copy these four outcome URLs into the client survey platform. Return the ResearchOps attempt ID received at survey entry in the respondent placeholder."}</p></div><button className="button small ghost" type="button" onClick={() => setLinkRecord(null)}>Close</button></div>
      <div className="info-list">{visibleLinks.map(([label, link]) => <div className="info-row link-row" key={label}><span>{linkLabel(kind, label)}</span><code>{link}</code><button className="button small ghost" type="button" onClick={() => void copyLink(label, link)}>{copied === label ? "Copied" : "Copy"}</button></div>)}</div><div className="modal-actions"><button className="button primary" type="button" disabled={!visibleLinks.length} onClick={() => void copyAll()}>{copied === "all" ? "Copied all" : `Copy all ${visibleLinks.length} ${kind === "suppliers" ? "routes" : "links"}`}</button></div>
    </section></div> : null}
  </>;
}

function Field({ label, name, value, type = "text", required = false, pattern }: { label: string; name: string; value?: string; type?: string; required?: boolean; pattern?: string }) { return <div className="field"><label htmlFor={`directory-${name}`}>{label}</label><input className="control" id={`directory-${name}`} name={name} defaultValue={value} type={type} required={required} pattern={pattern} maxLength={type === "url" ? 2048 : 254} /></div>; }
function humanize(value: string) { return value.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase()); }
function linkLabel(kind: DirectoryKind, value: string) {
  if (kind === "suppliers") return value === "test" ? "Return URL check" : value === "live" ? "Launch route base" : humanize(value);
  return value === "quotaFull" ? "Quota Full" : value === "securityTerminate" ? "Security Terminate" : humanize(value);
}
