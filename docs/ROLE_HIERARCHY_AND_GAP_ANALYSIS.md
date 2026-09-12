# ResearchOps role hierarchy and market-research gap analysis

Last reviewed: 2026-09-12

## 1. Executive assessment

ResearchOps already has a credible fieldwork-control core: multi-tenant projects, supplier routing, immutable respondent events, live funnel metrics, quality flags, audit logging, and basic role-aware interfaces.

Its current maturity is best described as an **operational fieldwork MVP**, not yet an end-to-end enterprise market-research management platform. The largest structural risk is that five named roles collapse into only three practical permission tiers. The largest product gaps are study governance, sample/quotas beyond country-language totals, membership administration, respondent privacy lifecycle, financial reconciliation, and certified provider integrations.

This assessment uses the implementation and tracker as evidence. Industry expectations are informed by:

- [ISO 20252:2026](https://www.iso.org/standard/88881.html), which covers service requirements for market, opinion, and social research including insights and data analytics;
- the [ISO/TC 225 overview](https://committee.iso.org/home/tc225), which frames quality across planning, execution, supervision, and client reporting;
- the [2025 ICC/ESOMAR International Code](https://community.esomar.org/uploads/public/knowledge-and-standards/codes-and-guidelines/ICCESOMAR-International-Code_English.pdf), emphasizing duty of care, privacy, transparency, responsibility, and human oversight;
- the [Insights Association Code of Standards and Ethics](https://www.insightsassociation.org/About-Us/Code-of-Standards/Resources/Code-of-Standards), emphasizing fit-for-purpose design, documented specifications, transparency, and independently assessable quality;
- the [Insights Association Participant Bill of Rights](https://www.insightsassociation.org/Resources/Data-Quality-Standards/Participant-Bill-of-Rights), emphasizing participant experience and protection;
- the [European Commission GDPR principles](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/principles-gdpr_en), including purpose limitation, minimization, retention, security, and accountability.

This document is a product gap analysis, not a claim of ISO certification or legal advice.

## 2. Recommended organization hierarchy

```text
OWNER
  └─ ADMIN / Operations Director
       ├─ PM / Project Manager
       │    ├─ ANALYST / Quality & Reporting
       │    └─ MEMBER / Coordinator & Viewer
       ├─ Finance (future specialized role)
       └─ Compliance / DPO (future specialized role)
```

The existing role names can remain, but access should evolve from broad role checks to explicit capabilities and project scopes.

## 3. Current versus target role design

### OWNER

**Business viewpoint:** accountable for the workspace, contracts, risk, billing policy, security, and ultimate data responsibility.

Current access:

- everything ADMIN can do;
- an `own` capability exists in code, but there are almost no owner-exclusive workflows.

Target access:

- invite/remove users and transfer ownership;
- set roles and project/client scopes;
- approve provider credentials and organization-wide integrations;
- approve finance, tax, FX, retention, privacy, and deletion policy;
- view all projects, margins, audit exports, security events, and compliance posture;
- enforce MFA/SSO and session policy;
- approve irreversible closure, data deletion, and legal hold.

Critical OWNER gaps:

1. No team/member administration.
2. No ownership transfer or break-glass recovery.
3. No organization billing/currency/tax model.
4. No data retention, subject-request, consent, or deletion workflow.
5. No security dashboard, MFA/SSO policy, API-key management, or integration administration.
6. No formal approval gates for project launch, ID submission, invoice, or closure.

### ADMIN / Operations Director

**Business viewpoint:** runs daily operations, clients, suppliers, controls, and service quality.

Current access:

- all workspace reads;
- project and supplier operation;
- client administration;
- organization settings;
- notification rules and fraud decisions.

Target access:

- manage team membership except ownership;
- own client/supplier master data and contracts;
- configure standardized project templates, quality policies, SLA rules, and outcome mappings;
- approve PM launch requests and supplier changes;
- manage escalations, provider incidents, and audit evidence;
- see portfolio capacity, delivery risk, supplier scorecards, and client SLA performance.

Critical ADMIN gaps:

1. No member/role management UI or API.
2. No supplier contract, compliance document, certification, rate card, or geography capability model.
3. No client-specific terminology, SLA, quota, callback, security, or reporting template.
4. Notification rules exist, but email delivery and scheduled evaluation are incomplete.
5. No operational approvals, comments, attachments, tasks, or escalation ownership.
6. Audit log is stored but has no dedicated searchable/exportable UI.

### PM / Project Manager

**Business viewpoint:** configures and controls individual studies, traffic, quotas, suppliers, and client delivery.

Current access:

- create and update projects;
- manage markets and supplier assignments;
- launch/pause/advance lifecycle;
- review fraud flags;
- read all tenant data;
- cannot manage clients or organization settings.

Target access:

- see only assigned projects by default, with explicit collaboration scopes;
- capture client brief, methodology, audience, feasibility, SOW, deadlines, deliverables, and change history;
- configure nested/interlocking quota cells and soft/hard quota behavior;
- allocate quota across multiple suppliers and markets with pacing targets;
- manage test/UAT evidence and launch checklist;
- communicate with suppliers and record fieldwork notes;
- reconcile IDs, approve/reject completes, and produce client delivery packs.

Critical PM gaps:

1. The API can return PM scope, but tenant-wide readable data is still broadly accessible.
2. No research brief/SOW, questionnaire metadata, sample plan, feasibility, or launch checklist.
3. Age/gender/region/custom interlocked quota cells and atomic hard reservations are code-ready; hosted migration/proof, soft-close/overage tolerance, and rule version history remain.
4. No supplier allocation algorithm, daily caps, schedule, pacing forecast, or auto-pause controls.
5. No project documents, comments, tasks, approval trail, or change requests.
6. No respondent ID reconciliation workspace or accepted/rejected/billable disposition.
7. No project-level client reporting pack or scheduled status report.

### ANALYST / Quality and Reporting

**Business viewpoint:** monitors data integrity, investigates anomalies, validates delivery, and produces analysis without changing commercial setup.

Current access:

- read-only access to projects, directories, respondents, fraud, notifications, and analytics;
- CSV exports;
- cannot resolve fraud flags.

Target access:

- saved filters, segments, cohorts, trends, and anomaly views;
- transparent quality scoring with evidence and rule version;
- bulk review, notes, reviewer assignment, appeal, and second-level approval;
- weighted/qualified incidence and conversion definitions;
- device, geography, source, time, duplicate-network, and behavioral analysis;
- data-quality report and exclusion export without unnecessary direct identifiers.

Critical ANALYST gaps:

1. Analytics are aggregate tables with limited slicing and no saved report/dashboard.
2. No quality score, rule versioning, false-positive analysis, bulk decisions, or reviewer workflow.
3. No sample-source provenance/blending disclosure at respondent level.
4. No weighting, cross-tabs, statistical tests, coding, open-end review, or dataset ingestion.
5. No configurable derived metrics or client-specific IR/billability definition.
6. No privacy-aware export permissions, masking levels, or export audit trail.

### MEMBER / Coordinator / Viewer

**Business viewpoint:** needs operational visibility or performs limited coordination without commercial/security authority.

Current access:

- the same tenant-wide read capability as ANALYST;
- no mutation access.

Target access:

- project-specific viewer/coordinator assignment;
- limited non-commercial project view;
- optional task/comment/document contribution;
- no CPI, cost, client-confidential, respondent-level, fraud evidence, or organization-wide analytics unless granted.

Critical MEMBER gaps:

1. MEMBER and ANALYST are effectively identical at authorization level.
2. MEMBER can read tenant-wide commercial and respondent-level data.
3. No field-level masking or project/client scope.
4. No limited coordinator actions, task workflow, or external/client portal role.

## 4. Recommended capability matrix

`A` = approve/administer, `O` = operate, `R` = read, `S` = scoped read, `-` = no access.

| Capability | OWNER | ADMIN | PM | ANALYST | MEMBER |
|---|---:|---:|---:|---:|---:|
| Organization/security policy | A | O | R | - | - |
| Membership and roles | A | O | - | - | - |
| Client master data | A | O | R | S | - |
| Supplier master/contracts | A | O | R | S | - |
| Project creation/configuration | A | A/O | O (assigned) | R | S |
| Launch/traffic control | A | A | O (assigned) | R | - |
| Quotas/sample plan | A | A/O | O | R | S |
| Respondent-level data | A | R | R (assigned) | R/masked | -/masked |
| Fraud/quality decisions | A | A | O | recommend | - |
| Portfolio analytics | R | R | scoped | R | - |
| Commercial cost/revenue | A | A/O | scoped | masked | - |
| ID reconciliation/invoice | A | A/O | prepare | validate | - |
| Audit/compliance export | A | R | scoped | scoped | - |
| Data deletion/legal hold | A | O with approval | request | recommend | - |

Implementation recommendation: store capabilities separately from role labels and support organization, client, and project scopes. Keep secure defaults and deny unassigned access.

## 5. Market-research capability gaps

### P0 — required before dependable production use

| Gap | Why it matters | Recommended outcome |
|---|---|---|
| Hosting/deployment control | Git push is not consistently reflected on the hosted site | Deterministic CI/CD, deployment status, visible SHA, rollback, and post-deploy smoke test |
| Team and scoped access | Current read tier exposes tenant-wide data to every member | Invite/deactivate, role changes, project/client scopes, field masking, and permission tests |
| Provider certification | Adapters use test mappings rather than official contracts | Official sandbox fixtures, signature rules, retry/replay policy, and provider certification evidence |
| Respondent privacy lifecycle | Pseudonymous sessions exist but retention/rights are not managed | Data inventory, legal basis/notice references, retention, deletion/anonymization, export, and legal hold |
| Reconciliation definitions | Operational events are not sufficient for payment decisions | Accepted/rejected/billable statuses, reason codes, versioned rules, locked reconciliation batch |
| Production browser QA | Core authenticated experience lacks trusted E2E evidence | Desktop/mobile, keyboard, focus, error, auth, routing, and outcome automated evidence |

Supplier outcome redirects now use a provider-neutral baseline (`respondent_id`, `project_id`, `transaction_id`, and normalized `status`). Provider-specific codes, signatures, and reconciliation semantics still require the official provider certification item above.

### P1 — required for a strong fieldwork operations product

| Gap | Recommended capability |
|---|---|
| Research brief and SOW | Objectives, methodology, audience, sample source, questionnaire version, deliverables, assumptions, and amendments |
| Advanced quotas | Atomic hard project/supplier/interlocked-cell reservation is code-ready; add hosted proof, nested aggregate cells, soft close, overage tolerance, and versioned amendments |
| Pacing and forecasting | Daily targets, remaining completes, projected close, supplier velocity, alert thresholds, and automatic traffic action with approval |
| Supplier governance | Rate cards, capabilities, countries, SLAs, compliance documents, scorecards, contacts by role, and contract dates |
| Source transparency | Original panel/source, sub-supplier, router/blend information, recruitment method, and respondent source lineage |
| Test/UAT workflow | Test cases, expected callbacks, evidence, approver, launch checklist, and separation of test metrics from production metrics |
| Communication/work management | Comments, mentions, tasks, owners, due dates, attachments, activity feed, and escalation notes |
| Reporting | Scheduled client status reports, downloadable fieldwork summary, methodology/quality disclosures, and immutable delivery snapshot |
| Audit console | Search/filter/export of actor, action, entity, time, before/after, request ID, and reason |

### P2 — enterprise and research-suite expansion

| Gap | Recommended capability |
|---|---|
| Financial accounting | Multi-currency rate cards, FX source/date, taxes, supplier liability, revenue, adjustments, invoice lines, and approvals |
| Survey platform integrations | Questionnaire metadata/version, response reconciliation, webhook status, and direct project linking |
| Panel management | Recruitment, profiling, consent, participation history, incentives, fatigue, and panel health—only if panel ownership is in scope |
| Research analytics | Weighting, crosstabs, significance testing, coding, data cleaning, dataset versioning, and chart/report builder |
| Client/supplier portals | Narrow external roles, branded reports, file exchange, approvals, and message threads |
| Enterprise identity | SSO/SAML, SCIM, MFA enforcement, session/device management, and access review |
| Data residency/governance | Region selection, processor/subprocessor register, DPA tracking, encryption/KMS policy, and audit evidence |
| API/webhooks | Versioned public API, scoped service accounts, outbound webhooks, retries/dead letters, and usage audit |
| Localization | Timezone-consistent reporting, locale/date/number/currency formatting, translated UI, and accessibility conformance evidence |

## 6. Data-quality and respondent-experience gaps

The platform correctly starts with duplicate IP/device fingerprints, speeding, quality signals, append-only events, and manual review. A mature quality program should add:

- server-side bot and automation signals, datacenter/VPN/proxy intelligence, impossible travel, and device consistency;
- behavioral measures such as engagement, straight-lining, contradiction, open-end quality, and questionnaire attention checks;
- versioned rules and thresholds per client/project/market;
- reasoned quarantine rather than immediate irreversible rejection where false positives are possible;
- supplier/source quality benchmarks and trend alerts;
- respondent-facing privacy/contact information and understandable termination behavior;
- separation of security rejection, research qualification screen-out, quota-full, technical failure, and supplier cancellation;
- incident-safe retry and recovery when the client survey or callback destination is unavailable.

The Insights Association explicitly links participant experience with research integrity, while its data-quality program calls for measurable, comparable standards. ResearchOps should therefore treat quality decisions as governed evidence, not only fraud flags.

## 7. Metric and reporting corrections to decide

Before contractual use, stakeholders must define and version:

1. **Incidence rate denominator:** current implementation uses completes divided by completes plus terminates; many projects need qualified screen-outs, security rejects, quota-full handling, and client-specific definitions.
2. **Conversion:** clarify whether starts, reached-survey, or qualified entries form the denominator.
3. **Billable complete:** separate recorded `COMPLETE` from client-approved/billable complete.
4. **Cost:** current supplier cost is CPI × recorded completes; it does not model rejected IDs, tiered rates, minimums, taxes, currencies, or adjustments.
5. **Quota concurrency:** migration `026` serializes live project/supplier/cell reservations to prevent completion-based race overruns; hosted concurrency proof and configurable tolerance/soft-close policy remain.
6. **Abandonment:** the fixed 24-hour timeout should be configurable and versioned by project or client.
7. **Duration:** define exclusions, pause behavior, duplicate starts, and acceptable LOI bands.
8. **Test traffic:** migration `023` stores `is_test`; production metrics, costs, analytics, and quota reservation exclude UAT traffic. Hosted vertical-slice proof remains.

## 8. Recommended delivery sequence

### Phase 1 — trust the running system

- repair deterministic deployment and expose commit/build status;
- complete authenticated browser E2E and accessibility evidence;
- add hosted logs/error tracking and deployment rollback checks;
- certify official provider contracts.

### Phase 2 — correct organizational control

- membership invitation/deactivation and ownership transfer;
- capability-based permissions with project/client scope and field masking;
- member access review and audit console;
- specialized Finance and Compliance capabilities if required.

### Phase 3 — complete fieldwork planning

- research brief/SOW and change control;
- advanced quota model and pacing forecast;
- supplier governance, source lineage, launch checklist, and UAT separation;
- comments, tasks, documents, and scheduled status reports.

### Phase 4 — governed quality and reconciliation

- versioned quality policies and richer fraud/behavioral signals;
- reconciliation batches, billable decisions, appeals, and client approval;
- privacy retention/deletion/legal-hold workflow;
- metric dictionary and contractual reporting snapshots.

### Phase 5 — commercial and research expansion

- approved multi-currency financial model and invoice exports;
- survey platform and accounting integrations;
- optional panel management and advanced research analytics;
- client/supplier portals and enterprise identity.

## 9. Definition of done by role

- **OWNER:** can prove who has access, approve policy/commercial changes, see the deployed version, and recover or transfer the workspace.
- **ADMIN:** can manage people, directories, controls, provider health, SLAs, and escalations without engineering support.
- **PM:** can take a documented study from brief through reconciled delivery with controlled suppliers, quotas, tests, and approvals.
- **ANALYST:** can independently assess and report data quality with transparent definitions, evidence, masking, and reproducibility.
- **MEMBER:** can complete assigned coordination/viewing work without seeing unrelated respondent or commercial data.
- **Respondent:** receives a transparent, secure, reliable journey with appropriate privacy, support, and fair outcome handling.
- **Client:** receives traceable delivery, agreed metric definitions, quality disclosures, and reproducible reports.
- **Supplier:** receives stable links, clear outcome mappings, test evidence, traffic controls, reconciliation reasons, and payment transparency.
