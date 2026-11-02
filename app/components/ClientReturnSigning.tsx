"use client";

import { useEffect, useState } from "react";
import { ApiRequestError, apiRequest } from "../../src/lib/api";
import { policyOptions, signingErrorMessage, validateSigning, type SignedReturnPolicy } from "../../src/features/clients/return-signing";

type Signing = { signingSecretEnv: string; signedReturnPolicy: SignedReturnPolicy; secretConfigured: boolean; postbackUrl: string };

export function ClientReturnSigning({ clientId, clientName, accessToken }: { clientId: string; clientName: string; accessToken?: string }) {
  const path = `/api/clients/${encodeURIComponent(clientId)}/return-signing`;
  const [state, setState] = useState<Signing | null>(null);
  const [policy, setPolicy] = useState<SignedReturnPolicy>("OFF");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState("");
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void apiRequest<{ data: Signing }>(path, { headers: accessToken ? { authorization: `Bearer ${accessToken}` } : undefined })
      .then((response) => { if (!active) return; setState(response.data); setPolicy(response.data.signedReturnPolicy); setName(response.data.signingSecretEnv); setMessage(""); })
      .catch((error) => { if (active) setMessage(signingErrorMessage(error instanceof ApiRequestError ? error.status : undefined)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [path, accessToken]);

  const validation = validateSigning(policy, name);

  async function save() {
    if (validation) { setMessage(validation); return; }
    try {
      const response = await apiRequest<{ data: Signing }>(path, { method: "PUT", headers: accessToken ? { authorization: `Bearer ${accessToken}` } : undefined, body: JSON.stringify({ signedReturnPolicy: policy, signingSecretEnv: name.trim() }) });
      setState(response.data); setPolicy(response.data.signedReturnPolicy); setName(response.data.signingSecretEnv);
      setMessage(""); setSaved("Return signing settings saved.");
    } catch (error) { setSaved(""); setMessage(signingErrorMessage(error instanceof ApiRequestError ? error.status : undefined)); }
  }

  async function copy() {
    if (!state) return;
    try { await navigator.clipboard.writeText(state.postbackUrl); setCopied(true); window.setTimeout(() => setCopied(false), 1800); } catch { setMessage("Copy was blocked by the browser. Select the address and copy it manually."); }
  }

  const help = policyOptions.find((option) => option.value === policy)?.help;
  const needsSecret = policy !== "OFF";

  return <section className="panel directory-form" style={{ marginTop: 16 }} aria-label={`${clientName} return signing`}>
    <div className="section-head"><div><h2>Return signing</h2><p>Make sure completes really come from this client&apos;s platform. The client signs each return with a shared secret that only the two platforms know.</p></div></div>
    {message ? <div className="form-error data-error" role="alert">{message}</div> : null}
    {saved ? <p className="panel-note" role="status">{saved}</p> : null}
    {loading ? <p className="panel-note">Loading return signing settings…</p> : state ? <div className="form-grid three">
      <div className="field"><label htmlFor="signing-policy">Policy</label><select id="signing-policy" className="control" value={policy} onChange={(event) => { setPolicy(event.target.value as SignedReturnPolicy); setSaved(""); }}>{policyOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><span className="panel-note">{help}</span></div>
      <div className="field"><label htmlFor="signing-secret-name">Secret variable name</label><input id="signing-secret-name" className="control" value={name} placeholder="CLIENT_ACME_SECRET" maxLength={60} spellCheck={false} autoComplete="off" onChange={(event) => { setName(event.target.value.toUpperCase()); setSaved(""); }} aria-invalid={validation ? true : undefined} /><span className="panel-note">Only the variable name is stored here. Set its value in the hosting environment variables, never in this form.</span></div>
      <div className="field"><span className="field-label">Secret status</span><span className="control static-control" role="status">{!name.trim() ? "No secret variable named" : state.secretConfigured ? "Secret found on the server" : "Secret NOT configured - set the variable in the hosting environment before enabling HOLD or REJECT"}</span>{needsSecret && !state.secretConfigured ? <span className="panel-note">Until the secret exists on the server, signed returns for this client cannot be accepted.</span> : null}</div>
      <div className="field full"><span className="field-label">Postback URL (read only)</span><div className="info-row link-row"><code>{state.postbackUrl}</code><button className="button small ghost" type="button" onClick={() => void copy()}>{copied ? "Copied" : "Copy"}</button></div></div>
      <div className="field full"><details><summary>How the client signs a return</summary>
        <p className="panel-note">Browser return: append <code>&amp;h=</code> to the return link, where <code>h = hex(HMAC-SHA256(secret, &quot;&lt;session uuid&gt;|&lt;complete|terminate|quota-full|security-terminate&gt;&quot;))</code>.</p>
        <p className="panel-note">Server-to-server: POST <code>{"{rid,status}"}</code> to the postback URL with headers <code>x-researchops-timestamp</code> and <code>x-researchops-signature</code>, where the signature is <code>HMAC-SHA256(secret, &quot;&lt;timestamp&gt;.&lt;raw body&gt;&quot;)</code>.</p>
      </details></div>
      <div className="field full directory-submit"><button className="button primary" type="button" disabled={Boolean(validation)} onClick={() => void save()}>Save return signing</button>{validation ? <span className="panel-note"> {validation}</span> : null}</div>
    </div> : null}
  </section>;
}
