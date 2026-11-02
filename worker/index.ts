import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { handleProjectsApi } from "./routes/projects";
import { handleOrganizationsApi } from "./routes/organizations";
import { handleDirectoriesApi } from "./routes/directories";
import { handleEventsApi } from "./routes/events";
import { handleRespondentsApi } from "./routes/respondents";
import { handleCallbacksApi } from "./routes/callbacks";
import { handleFraudApi } from "./routes/fraud";
import { handleAnalyticsApi } from "./routes/analytics";
import { handleNotificationsApi } from "./routes/notifications";
import { requestId, safeLog } from "./lib/observability";
import { handleSupabaseProxy } from "./routes/supabase-proxy";
import { handleDevAuthApi } from "./routes/dev-auth";
import { handleRedirectApi } from "./routes/redirects";
import { handleEligibilityApi } from "./routes/eligibility";
import { handleQuotaCellsApi } from "./routes/quota-cells";
import { handleProjectAccessApi } from "./routes/project-access";
import { handleProjectOwnershipApi } from "./routes/project-ownership";
import { handleSurveySetupApi } from "./routes/survey-setup";
import { handleResponseVariablesApi } from "./routes/response-variables";
import { handleAssistantApi } from "./routes/assistant";
import { handleMembersApi } from "./routes/members";
import { handleScreeningQuestionsApi } from "./routes/screening-questions";
import { handleMarketplaceApi } from "./routes/marketplace";
import { handleMaintenanceCronApi } from "./routes/maintenance";
import { handleAuditLogsApi } from "./routes/audit-logs";
import { securityHeaders, validateCSRF, csrfError, requestSizeError } from "./lib/security.ts";
import { trackError } from "./lib/observability";
import { handleClientPostbackApi } from "./routes/postbacks";
import { handleClientSigningApi } from "./routes/client-signing";
import { handleRoutingReportsApi } from "./routes/routing-reports";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  EVENT_INGESTION_SECRET?: string;
  CPX_CALLBACK_SECRET?: string;
  BITLABS_CALLBACK_SECRET?: string;
  PURESPECTRUM_CALLBACK_SECRET?: string;
  FRAUD_HASH_SECRET?: string;
  DEV_AUTO_LOGIN?: string;
  DEV_AUTO_LOGIN_TOKEN?: string;
  OPENAI_API_KEY?: string;
  CRON_SECRET?: string;
  OUTCOME_SIGNING_SECRET?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Marketplace entry-link/callback secrets are named per marketplace
// (MARKETPLACE_<NAME>_SECRET); only names matching that pattern are forwarded.
function marketplaceSecrets(env: Env | undefined, nodeEnvironment: Record<string, string | undefined> | undefined) {
  const pattern = /^MARKETPLACE_[A-Z0-9_]{1,40}_SECRET$/;
  const bindings = (env ?? {}) as unknown as Record<string, string | undefined>;
  const names = new Set([...Object.keys(bindings), ...Object.keys(nodeEnvironment ?? {})].filter((name) => pattern.test(name)));
  return Object.fromEntries([...names].map((name) => [name, bindings[name] ?? nodeEnvironment?.[name]]));
}

function projectEnvironment(env: Env | undefined) {
  const nodeEnvironment = typeof process !== "undefined" ? process.env : undefined;
  return {
    ...marketplaceSecrets(env, nodeEnvironment),
    SUPABASE_URL: env?.SUPABASE_URL ?? nodeEnvironment?.SUPABASE_URL,
    SUPABASE_ANON_KEY: env?.SUPABASE_ANON_KEY ?? nodeEnvironment?.SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: env?.SUPABASE_SERVICE_ROLE_KEY ?? nodeEnvironment?.SUPABASE_SERVICE_ROLE_KEY,
    EVENT_INGESTION_SECRET: env?.EVENT_INGESTION_SECRET ?? nodeEnvironment?.EVENT_INGESTION_SECRET,
    CPX_CALLBACK_SECRET: env?.CPX_CALLBACK_SECRET ?? nodeEnvironment?.CPX_CALLBACK_SECRET,
    BITLABS_CALLBACK_SECRET: env?.BITLABS_CALLBACK_SECRET ?? nodeEnvironment?.BITLABS_CALLBACK_SECRET,
    PURESPECTRUM_CALLBACK_SECRET: env?.PURESPECTRUM_CALLBACK_SECRET ?? nodeEnvironment?.PURESPECTRUM_CALLBACK_SECRET,
    FRAUD_HASH_SECRET: env?.FRAUD_HASH_SECRET ?? nodeEnvironment?.FRAUD_HASH_SECRET,
    DEV_AUTO_LOGIN: env?.DEV_AUTO_LOGIN ?? nodeEnvironment?.DEV_AUTO_LOGIN,
    DEV_AUTO_LOGIN_TOKEN: env?.DEV_AUTO_LOGIN_TOKEN ?? nodeEnvironment?.DEV_AUTO_LOGIN_TOKEN,
    OPENAI_API_KEY: env?.OPENAI_API_KEY ?? nodeEnvironment?.OPENAI_API_KEY,
    CRON_SECRET: env?.CRON_SECRET ?? nodeEnvironment?.CRON_SECRET,
    OUTCOME_SIGNING_SECRET: env?.OUTCOME_SIGNING_SECRET ?? nodeEnvironment?.OUTCOME_SIGNING_SECRET,
  };
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env | undefined, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const projectEnv = projectEnvironment(env);
    const apiRequestId=requestId(request);const apiStarted=Date.now();
    const observed=(response:Response)=>{
      // Add security headers to all responses
      const secured = securityHeaders(response);
      secured.headers.set("x-request-id",apiRequestId);
      safeLog(response.status>=500?"error":response.status>=400?"warn":"info","api_request",{requestId:apiRequestId,method:request.method,path:url.pathname,status:response.status,latencyMs:Date.now()-apiStarted});
      if (response.status >= 500) {
        trackError(new Error(`HTTP ${response.status} on ${url.pathname}`), {
          requestId: apiRequestId,
          path: url.pathname,
          method: request.method,
          statusCode: response.status,
        }, projectEnv);
      }
      return secured;
    };

    // Request body size limit (1MB) to prevent DoS
    if (["POST", "PUT", "PATCH"].includes(request.method) && url.pathname.startsWith("/api/")) {
      const contentLength = request.headers.get("content-length");
      if (contentLength && parseInt(contentLength, 10) > 1048576) {
        return observed(requestSizeError());
      }
    }

    // CSRF protection for state-changing API requests
    if (url.pathname.startsWith("/api/") && !validateCSRF(request)) {
      // Exempt health/readiness checks and callbacks from CSRF
      const exemptPaths = ["/api/health", "/api/readiness", "/api/events", "/api/callbacks/", "/api/postbacks/", "/api/marketplace-callbacks/", "/api/cron/"];
      const isExempt = exemptPaths.some(path => url.pathname === path || url.pathname.startsWith(path));
      if (!isExempt) {
        return observed(csrfError());
      }
    }

    if(url.pathname.startsWith("/supabase/")){const proxyResponse=await handleSupabaseProxy(request,url.pathname,projectEnv);if(proxyResponse)return observed(proxyResponse);}

    if (url.pathname.startsWith("/r/") || url.pathname.startsWith("/s/") || url.pathname.startsWith("/l/")) {
      const redirectResponse = await handleRedirectApi(request, url.pathname, projectEnv, ctx);
      if (redirectResponse) return observed(redirectResponse);
    }

    if (url.pathname === "/api/health") {
      return observed(Response.json({ status: "healthy", service: "research-ops", timestamp: new Date().toISOString() }));
    }

    if (url.pathname === "/api/readiness") {
      const supabaseConfigured = Boolean(projectEnv.SUPABASE_URL && projectEnv.SUPABASE_ANON_KEY);
      let dbConnected = false;
      let latencyMs = 0;
      if (supabaseConfigured) {
        const start = Date.now();
        try {
          const res = await fetch(`${projectEnv.SUPABASE_URL}/rest/v1/`, {
            headers: { apikey: projectEnv.SUPABASE_ANON_KEY!, authorization: `Bearer ${projectEnv.SUPABASE_ANON_KEY}` },
            signal: AbortSignal.timeout(3000),
          });
          latencyMs = Date.now() - start;
          dbConnected = res.status < 500;
        } catch {
          dbConnected = false;
        }
      }
      const isReady = !supabaseConfigured || dbConnected;
      return observed(Response.json({
        status: isReady ? "ready" : "degraded",
        application: "healthy",
        api: "healthy",
        database: {
          provider: "supabase",
          status: !supabaseConfigured ? "not-configured" : dbConnected ? "connected" : "unreachable",
          dataSource: supabaseConfigured ? "supabase-ready" : "mock",
          latencyMs: dbConnected ? latencyMs : undefined,
        },
      }, { status: isReady ? 200 : 503 }));
    }

    if (url.pathname === "/api/testing/auto-login" || url.pathname === "/api/testing/enter") {
      const apiResponse = await handleDevAuthApi(request, url.pathname, projectEnv);
      if (apiResponse) return observed(apiResponse);
    }

    if (url.pathname.startsWith("/api/projects")) {
      const screeningQuestionsResponse = await handleScreeningQuestionsApi(request, url.pathname, projectEnv);
      if (screeningQuestionsResponse) return observed(screeningQuestionsResponse);
      const responseVariablesResponse = await handleResponseVariablesApi(request, url.pathname, projectEnv);
      if (responseVariablesResponse) return observed(responseVariablesResponse);
      const surveySetupResponse = await handleSurveySetupApi(request, url.pathname, projectEnv);
      if (surveySetupResponse) return observed(surveySetupResponse);
      const projectAccessResponse = await handleProjectAccessApi(request, url.pathname, projectEnv);
      if (projectAccessResponse) return observed(projectAccessResponse);
      const ownershipResponse = await handleProjectOwnershipApi(request, url.pathname, projectEnv);
      if (ownershipResponse) return observed(ownershipResponse);
      const quotaCellsResponse = await handleQuotaCellsApi(request, url.pathname, projectEnv);
      if (quotaCellsResponse) return observed(quotaCellsResponse);
      const eligibilityResponse = await handleEligibilityApi(request, url.pathname, projectEnv);
      if (eligibilityResponse) return observed(eligibilityResponse);
      const apiResponse = await handleProjectsApi(request, url.pathname, projectEnv);
      if (apiResponse) return observed(apiResponse);
    }

    if (url.pathname === "/api/audit-logs") {
      const apiResponse = await handleAuditLogsApi(request, url.pathname, projectEnv);
      if (apiResponse) return observed(apiResponse);
    }

    if (url.pathname === "/api/cron/maintenance") {
      const cronResponse = await handleMaintenanceCronApi(request, url.pathname, projectEnv);
      if (cronResponse) return observed(cronResponse);
    }

    if (url.pathname.startsWith("/api/marketplaces") || url.pathname.startsWith("/api/marketplace-") || url.pathname.startsWith("/api/finance/") || url.pathname === "/api/cron/marketplace") {
      const apiResponse = await handleMarketplaceApi(request, url.pathname, projectEnv);
      if (apiResponse) return observed(apiResponse);
    }

    if (url.pathname === "/api/assistant") {
      const apiResponse = await handleAssistantApi(request, url.pathname, projectEnv);
      if (apiResponse) return observed(apiResponse);
    }

    if (url.pathname.startsWith("/api/organization-members")) {
      const apiResponse = await handleMembersApi(request, url.pathname, projectEnv);
      if (apiResponse) return observed(apiResponse);
    }

    if (url.pathname === "/api/events") {
      const apiResponse = await handleEventsApi(request, url.pathname, projectEnv);
      if (apiResponse) return observed(apiResponse);
    }

    if (url.pathname.startsWith("/api/postbacks/")) {
      const apiResponse = await handleClientPostbackApi(request, url.pathname, projectEnv);
      if (apiResponse) return observed(apiResponse);
    }

    if (url.pathname.startsWith("/api/callbacks/")) {
      const apiResponse = await handleCallbacksApi(request, url.pathname, projectEnv);
      if (apiResponse) return observed(apiResponse);
    }

    if (url.pathname === "/api/routing/funnel" || /^\/api\/respondents\/[^/]+\/timeline$/.test(url.pathname)) {
      const apiResponse = await handleRoutingReportsApi(request, url.pathname, projectEnv);
      if (apiResponse) return observed(apiResponse);
    }

    if (url.pathname.startsWith("/api/respondents")) {
      const apiResponse = await handleRespondentsApi(request, url.pathname, projectEnv);
      if (apiResponse) return observed(apiResponse);
    }

    if (url.pathname.startsWith("/api/fraud-flags")) {
      const apiResponse = await handleFraudApi(request, url.pathname, projectEnv);
      if (apiResponse) return observed(apiResponse);
    }
    if (url.pathname === "/api/analytics") { const apiResponse=await handleAnalyticsApi(request,url.pathname,projectEnv); if(apiResponse)return observed(apiResponse); }
    if (url.pathname.startsWith("/api/notifications")||url.pathname==="/api/notification-rules") { const apiResponse=await handleNotificationsApi(request,url.pathname,projectEnv); if(apiResponse)return observed(apiResponse); }

    if (url.pathname.startsWith("/api/organizations")) {
      const apiResponse = await handleOrganizationsApi(request, url.pathname, projectEnv);
      if (apiResponse) return observed(apiResponse);
    }

    if (url.pathname.startsWith("/api/clients/")) {
      const apiResponse = await handleClientSigningApi(request, url.pathname, projectEnv);
      if (apiResponse) return observed(apiResponse);
    }

    if (url.pathname.startsWith("/api/clients") || url.pathname.startsWith("/api/suppliers")) {
      const apiResponse = await handleDirectoriesApi(request, url.pathname, projectEnv);
      if (apiResponse) return observed(apiResponse);
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env!.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env!.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
