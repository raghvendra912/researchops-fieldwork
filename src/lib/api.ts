export class ApiRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers({
    "content-type": "application/json",
    ...init?.headers,
  });

  // Add CSRF protection header for state-changing requests
  if (init?.method && ["POST", "PUT", "PATCH", "DELETE"].includes(init.method)) {
    headers.set("X-Requested-With", "XMLHttpRequest");
  }

  const response = await fetch(path, { ...init, headers });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: "Request failed" }));
    throw new ApiRequestError(body.error ?? "Request failed", response.status);
  }
  return response.json() as Promise<T>;
}
