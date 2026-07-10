import { resolveApiBase } from "../shared/api-base.js";

export function publicApiBase() {
  return resolveApiBase({ datasetKeys: ["apiBase"] });
}

export async function fetchPublicJson(base, path) {
  const response = await fetch(`${base}${path}`, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json();
}
