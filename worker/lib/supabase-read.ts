type ServiceReadEnv = {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
};

function serviceHeaders(env: ServiceReadEnv) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY!,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "content-type": "application/json",
  };
}

export function isRetryableRoutingStatus(status: number) {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

function retryDelay(attempt: number) {
  return new Promise((resolve) => setTimeout(resolve, attempt * 200));
}

export async function serviceRows<T>(env: ServiceReadEnv, path: string): Promise<T[]> {
  const maximumAttempts = 3;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(`${env.SUPABASE_URL}${path}`, { headers: serviceHeaders(env) });
    } catch (error) {
      lastError = error;
      if (attempt === maximumAttempts) throw error;
      await retryDelay(attempt);
      continue;
    }

    if (response.ok) return response.json() as Promise<T[]>;
    lastError = new Error(`Redirect lookup failed with upstream status ${response.status}`);
    if (!isRetryableRoutingStatus(response.status) || attempt === maximumAttempts) throw lastError;
    await retryDelay(attempt);
  }

  throw lastError instanceof Error ? lastError : new Error("Redirect lookup failed");
}
