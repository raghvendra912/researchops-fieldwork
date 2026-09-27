import type { ReactNode } from "react";
import Link from "./NavigationLink";

export function AuthPageFrame({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children: ReactNode }) {
  return (
    <main className="auth-workspace-page">
      <header className="auth-reference-topbar">
        <Link className="brand-lockup" href="/" aria-label="ResearchOps home"><span className="brand-mark">r</span><span>ResearchOps</span></Link>
        <nav aria-label="Account navigation"><Link href="/login">Sign in</Link><Link href="/signup">Create account</Link><Link href="/forgot-password">Recovery</Link></nav>
      </header>
      <div className="auth-workspace-content project-center-page">
        <section className="reference-filter" aria-label={`${title} scope`}>
          <div className="reference-filter-grid">
            <div className="field"><span className="field-label">Product</span><span className="control static-control">ResearchOps</span></div>
            <div className="field"><span className="field-label">Area</span><span className="control static-control">Workspace access</span></div>
            <div className="field"><span className="field-label">Security</span><span className="control static-control">Supabase authentication</span></div>
            <div className="field"><span className="field-label">Status</span><span className="control static-control">Protected</span></div>
            <div className="reference-actions"><Link className="reference-icon-button" href="/login" aria-label="Open sign in">→</Link></div>
          </div>
          <div className="reference-filter-extra"><span className="panel-note">{eyebrow} · {description}</span></div>
        </section>
        <section className="panel auth-uniform-panel">
          <div className="panel-head"><h1 className="panel-title">{title}</h1><span className="panel-note">ResearchOps workspace</span></div>
          <div className="auth-uniform-body">{children}</div>
          <div className="table-footer"><span>Secure fieldwork operations</span><Link href="/login">Return to sign in →</Link></div>
        </section>
      </div>
    </main>
  );
}
