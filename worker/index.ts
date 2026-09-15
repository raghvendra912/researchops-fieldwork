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
import { handleSurveySetupApi } from "./routes/survey-setup";
import { handleResponseVariablesApi } from "./routes/response-variables";
import { securityHeaders, validateCSRF, csrfError } from "./lib/security.ts";

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

function projectEnvironment(env: Env | undefined) {
  const nodeEnvironment = typeof process !== "undefined" ? process.env : undefined;
  return {
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
      return secured;
    };

    // CSRF protection for state-changing API requests
    if (url.pathname.startsWith("/api/") && !validateCSRF(request)) {
      // Exempt health/readiness checks and callbacks from CSRF
      const exemptPaths = ["/api/health", "/api/readiness", "/api/events", "/api/callbacks/"];
      const isExempt = exemptPaths.some(path => url.pathname === path || url.pathname.startsWith(path));
      if (!isExempt) {
        return observed(csrfError());
      }
    }

    if(url.pathname.startsWith("/supabase/")){const proxyResponse=await handleSupabaseProxy(request,url.pathname,projectEnv);if(proxyResponse)return observed(proxyResponse);}

    if (url.pathname.startsWith("/r/")) {
      const redirectResponse = await handleRedirectApi(request, url.pathname, projectEnv);
      if (redirectResponse) return observed(redirectResponse);
    }

    if (url.pathname === "/api/health") {
      return observed(Response.json({ status: "healthy", service: "research-ops", timestamp: new Date().toISOString() }));
    }

    if (url.pathname === "/api/readiness") {
      const supabaseConfigured = Boolean(projectEnv.SUPABASE_URL && projectEnv.SUPABASE_ANON_KEY);
      return observed(Response.json({
        status: "ready",
        application: "healthy",
        api: "healthy",
        database: {
          provider: "supabase",
          status: supabaseConfigured ? "configured" : "not-configured",
          dataSource: supabaseConfigured ? "supabase-ready" : "mock",
        },
      }));
    }

    if (url.pathname === "/api/testing/auto-login" || url.pathname === "/api/testing/enter") {
      const apiResponse = await handleDevAuthApi(request, url.pathname, projectEnv);
      if (apiResponse) return observed(apiResponse);
    }

    if (url.pathname.startsWith("/api/projects")) {
      const responseVariablesResponse = await handleResponseVariablesApi(request, url.pathname, projectEnv);
      if (responseVariablesResponse) return observed(responseVariablesResponse);
      const surveySetupResponse = await handleSurveySetupApi(request, url.pathname, projectEnv);
      if (surveySetupResponse) return observed(surveySetupResponse);
      const projectAccessResponse = await handleProjectAccessApi(request, url.pathname, projectEnv);
      if (projectAccessResponse) return observed(projectAccessResponse);
      const quotaCellsResponse = await handleQuotaCellsApi(request, url.pathname, projectEnv);
      if (quotaCellsResponse) return observed(quotaCellsResponse);
      const eligibilityResponse = await handleEligibilityApi(request, url.pathname, projectEnv);
      if (eligibilityResponse) return observed(eligibilityResponse);
      const apiResponse = await handleProjectsApi(request, url.pathname, projectEnv);
      if (apiResponse) return observed(apiResponse);
    }

    if (url.pathname === "/api/events") {
      const apiResponse = await handleEventsApi(request, url.pathname, projectEnv);
      if (apiResponse) return observed(apiResponse);
    }

    if (url.pathname.startsWith("/api/callbacks/")) {
      const apiResponse = await handleCallbacksApi(request, url.pathname, projectEnv);
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
