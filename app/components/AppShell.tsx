"use client";

import Link from "./NavigationLink";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "../../src/features/auth/AuthProvider";
import { useState } from "react";
import { apiRequest } from "../../src/lib/api";

const primaryNavigation = [
  { href: "/dashboard", label: "Overview", glyph: "OV" },
  { href: "/projects", label: "Project Center", glyph: "PR" },
  { href: "/suppliers", label: "Suppliers", glyph: "SU" },
  { href: "/clients", label: "Clients", glyph: "CL" },
  { href: "/respondents", label: "Respondents", glyph: "RE" },
  { href: "/fraud", label: "Fraud review", glyph: "FR" },
  { href: "/notifications", label: "Notifications", glyph: "NO" },
  { href: "/analytics", label: "Analytics", glyph: "AN" },
];

const secondaryNavigation = [
  { href: "/settings", label: "Settings", glyph: "SE" },
];

function titleForPath(pathname: string) {
  if (pathname === "/onboarding") return "Workspace setup";
  if (pathname === "/projects/new") return "New project";
  if (pathname.startsWith("/projects/")) return "Project details";
  return [...primaryNavigation, ...secondaryNavigation].find((item) => pathname.startsWith(item.href))?.label ?? "Workspace";
}

function formatBuildStamp(value?: string) {
  if (!value) return "local";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "local";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "numeric", minute: "2-digit", hour12: true,
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("day")}-${part("month")}-${part("year")},${part("hour")}:${part("minute")}${part("dayPeriod").toLowerCase()}`;
}

function formatBuildTitle(value?: string) {
  if (!value) return "Local development build";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Local development build";
  return `Built ${new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "medium",
  }).format(date)}`;
}

function NavLink({ href, label, glyph, secondary = false }: { href: string; label: string; glyph: string; secondary?: boolean }) {
  const pathname = usePathname();
  const active = pathname === href || (href !== "/dashboard" && pathname.startsWith(href + "/"));
  return (
    <Link className={["nav-link", active ? "active" : "", secondary ? "secondary-mobile" : ""].filter(Boolean).join(" ")} href={href} aria-current={active ? "page" : undefined}>
      <span className="nav-glyph" aria-hidden="true">{glyph}</span>
      <span>{label}</span>
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { configured, loading, user, session, signOut } = useAuth();
  const [organizationStatus, setOrganizationStatus] = useState<"checking" | "ready" | "missing" | "error">(configured ? "checking" : "ready");
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarReady, setSidebarReady] = useState(false);
  const title = titleForPath(pathname);
  const email = user?.email ?? "Demo workspace";
  const initials = user?.email?.slice(0, 2).toUpperCase() ?? "DM";
  const appVersion = import.meta.env.VITE_APP_VERSION ?? "dev";
  const buildTime = import.meta.env.VITE_BUILD_TIME;
  const buildStamp = formatBuildStamp(buildTime);

  useEffect(() => {
    const initial = window.setTimeout(() => {
      setSidebarCollapsed(window.localStorage.getItem("researchops-sidebar-collapsed") === "true");
      setSidebarReady(true);
    }, 0);
    return () => window.clearTimeout(initial);
  }, []);

  function toggleSidebar() {
    setSidebarCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem("researchops-sidebar-collapsed", String(next));
      return next;
    });
  }

  useEffect(() => {
    if (configured && !loading && !user) {
      router.replace(`/login?returnTo=${encodeURIComponent(pathname)}`);
    }
  }, [configured, loading, pathname, router, user]);

  useEffect(() => {
    const accessToken = session?.access_token;
    if (!configured || !user || !accessToken) return;
    let active = true;
    void apiRequest<{ data: { id: string } | null }>("/api/organizations/current", { headers: { authorization: `Bearer ${accessToken}` } }).then((response) => {
      if (active) setOrganizationStatus(response.data ? "ready" : "missing");
    }).catch(() => {
      if (active) setOrganizationStatus("error");
    });
    return () => { active = false; };
  }, [configured, session?.access_token, user]);

  useEffect(() => {
    if (organizationStatus === "missing" && pathname !== "/onboarding") router.replace("/onboarding");
    if (organizationStatus === "ready" && pathname === "/onboarding") router.replace("/dashboard");
  }, [organizationStatus, pathname, router]);

  useEffect(() => {
    const accessToken = session?.access_token;
    if (organizationStatus !== "ready" || (configured && !accessToken)) return;
    let active = true;
    void apiRequest<{ data: Array<{ readAt: string | null }> }>("/api/notifications", {
      headers: accessToken ? { authorization: `Bearer ${accessToken}` } : undefined,
    }).then((response) => {
      if (active) setUnreadNotifications(response.data.filter((item) => !item.readAt).length);
    }).catch(() => {
      if (active) setUnreadNotifications(0);
    });
    return () => { active = false; };
  }, [configured, organizationStatus, session?.access_token]);

  if (configured && (loading || !user)) {
    return <main className="auth-loading">Checking your workspace session…</main>;
  }

  if (configured && organizationStatus === "error") {
    return <main className="auth-loading">Workspace membership could not be verified. Check the Supabase migrations and try again.</main>;
  }

  if (configured && organizationStatus === "checking") {
    return <main className="auth-loading">Checking your organization…</main>;
  }

  if (configured && organizationStatus === "missing" && pathname !== "/onboarding") {
    return <main className="auth-loading">Opening workspace setup…</main>;
  }

  if (configured && organizationStatus === "ready" && pathname === "/onboarding") {
    return <main className="auth-loading">Opening your workspace…</main>;
  }

  async function handleSignOut() {
    await signOut();
    router.replace("/login");
  }

  return (
    <div className={`app-frame${sidebarCollapsed ? " sidebar-collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar-header"><div className="brand-stack"><Link className="brand-lockup" href="/dashboard" aria-label="ResearchOps home"><span className="brand-mark">r</span><span>ResearchOps</span></Link><div className="build-version" title={formatBuildTitle(buildTime)}>v.{appVersion} ({buildStamp})</div></div><button className="sidebar-toggle" type="button" disabled={!sidebarReady} onClick={toggleSidebar} aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"} title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}>{sidebarCollapsed ? "›" : "‹"}</button></div>
        <div className="nav-caption">Workspace</div>
        <nav className="nav-list" aria-label="Primary navigation">
          {primaryNavigation.map((item) => <NavLink key={item.href} {...item} />)}
        </nav>
        <div className="nav-caption" style={{ marginTop: 22 }}>Manage</div>
        <nav className="nav-list" aria-label="Workspace settings">
          {secondaryNavigation.map((item) => <NavLink key={item.href} {...item} secondary />)}
        </nav>
        <div className="sidebar-foot">
          <div className="avatar">{initials}</div>
          <div className="user-meta">
            <strong>{configured ? email : "Demo user"}</strong>
            <span>{configured ? "Signed in" : "Mock data mode"}</span>
          </div>
          {configured ? <button className="button ghost small" type="button" onClick={handleSignOut} aria-label="Sign out">Exit</button> : null}
        </div>
      </aside>
      <main className="app-main">
        <header className="topbar">
          <div className="breadcrumb"><span>ResearchOps</span><span>/</span><strong>{title}</strong></div>
          <div className="top-actions">
            <span className="workspace-status"><span className="live-dot" /> All systems normal</span>
            <Link className="icon-button" href="/notifications" aria-label={`${unreadNotifications} unread notifications`}>{unreadNotifications > 99 ? "99+" : unreadNotifications}</Link>
            <Link className="icon-button" href="/settings" aria-label="Workspace settings">•••</Link>
          </div>
        </header>
        <div className="content">{children}</div>
      </main>
    </div>
  );
}
