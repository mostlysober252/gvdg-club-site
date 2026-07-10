import { resolveApiBase } from "../shared/api-base.js";

export const ADMIN_TOKEN_KEY = "gvdg_member_token";

export function adminAuthBase() {
  return resolveApiBase({ datasetKeys: ["authBase"] });
}

export function adminToken() {
  try {
    return sessionStorage.getItem(ADMIN_TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

export function adminRequest(path, { body, method = "GET", signal, token = adminToken() } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${adminAuthBase()}${path}`, {
    cache: "no-store",
    headers,
    method,
    signal,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export async function adminJson(path, options) {
  const response = await adminRequest(path, options);
  if (!response.ok) {
    const error = new Error(`admin request failed: ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}
