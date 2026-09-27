"use client";

import { FormEvent, useEffect, useState } from "react";
import { useAuth } from "../../../src/features/auth/AuthProvider";
import { apiRequest } from "../../../src/lib/api";

type OrganizationSettings = { id: string; name: string; slug: string; timezone: string; role: string };
const timezones = ["UTC", "Asia/Kolkata", "America/New_York", "Europe/London", "Asia/Singapore", "Australia/Sydney"];

export default function SettingsPage() {
  const { configured, session } = useAuth();
  const [settings, setSettings] = useState<OrganizationSettings | null>(null);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const token = session?.access_token;

  useEffect(() => {
    if (configured && !token) return;
    void apiRequest<{ data: OrganizationSettings }>("/api/organizations/current", { headers: token ? { authorization: `Bearer ${token}` } : undefined })
      .then((response) => setSettings(response.data))
      .catch(() => setMessage("Workspace settings could not be loaded."));
  }, [configured, token]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings) return;
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setMessage("");
    try {
      const response = await apiRequest<{ data: OrganizationSettings }>("/api/organizations/current", {
        method: "PATCH", headers: token ? { authorization: `Bearer ${token}` } : undefined,
        body: JSON.stringify({ name: form.get("name"), timezone: form.get("timezone") }),
      });
      setSettings(response.data);
      setMessage("Workspace settings saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Workspace settings could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  const canAdminister = settings?.role === "OWNER" || settings?.role === "ADMIN";
  return <div className="project-center-page"><form onSubmit={save}><section className="reference-filter" aria-label="Workspace settings"><div className="reference-filter-grid"><div className="field"><span className="field-label">Area</span><span className="control static-control">Workspace administration</span></div><div className="field"><span className="field-label">Scope</span><span className="control static-control">Exports · setup · audit</span></div><div className="field"><span className="field-label">Access</span><span className="control static-control">{settings ? settings.role : "Loading"}</span></div><div className="field"><span className="field-label">Controls</span><span className="control static-control">Enforced security</span></div><div className="reference-actions"><button className="reference-icon-button" type="submit" aria-label="Save workspace settings" title="Save workspace settings" disabled={!settings || saving || !canAdminister}>✓</button></div></div><div className="reference-filter-extra"><span className="panel-note">Settings · Organization defaults and enforced security controls.</span></div></section>
    {message ? <div className="form-error data-error" role="status">{message}</div> : null}
    <section className="panel form-panel">
      <div className="form-section"><div className="section-head"><div><h2>Organization</h2><p>Used across exports, project setup and audit events. Owner or administrator access is required to save changes.</p></div>{settings ? <span className="status-pill status-LIVE">{settings.role}</span> : null}</div><div className="form-grid"><div className="field"><label htmlFor="org-name">Organization name</label><input className="control" id="org-name" name="name" value={settings?.name ?? ""} minLength={2} maxLength={100} required disabled={!canAdminister} onChange={(event) => setSettings((current) => current ? { ...current, name: event.target.value } : current)} /></div><div className="field"><label htmlFor="timezone">Timezone</label><select className="control" id="timezone" name="timezone" value={settings?.timezone ?? "UTC"} disabled={!canAdminister} onChange={(event) => setSettings((current) => current ? { ...current, timezone: event.target.value } : current)}>{timezones.map((timezone) => <option key={timezone}>{timezone}</option>)}</select></div></div></div>
      <div className="form-section"><div className="section-head"><div><h2>Enforced security controls</h2><p>These protections are mandatory and cannot be disabled from the workspace UI.</p></div></div><div className="supplier-grid"><div className="choice-card"><span><strong>Signed callbacks</strong><span>Every provider event requires signature validation.</span></span></div><div className="choice-card"><span><strong>Tenant isolation</strong><span>Database policies isolate every organization.</span></span></div><div className="choice-card"><span><strong>Audit logging</strong><span>Every privileged change is recorded.</span></span></div></div></div>
    </section>
    <div className="table-footer"><span>{message || (saving ? "Saving…" : "Organization defaults and enforced controls")}</span>{canAdminister ? <button className="button small ghost" type="submit" disabled={!settings || saving}>{saving ? "Saving…" : "Save changes →"}</button> : null}</div>
  </form></div>;
}
