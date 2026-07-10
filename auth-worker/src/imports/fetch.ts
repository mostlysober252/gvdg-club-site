export class ImportError extends Error {}

// Some hosts (e.g. UDisc, behind Cloudflare) reject non-browser User-Agents outright, so the import
// presents a realistic browser identity. Headers are still overridable per call via opts.headers.
const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

// Follow a few redirects (canonical slug / trailing-slash / www) instead of hard-failing on the first
// 3xx — but re-validate EVERY hop against the allowlist so the SSRF guard still holds end to end.
const MAX_REDIRECTS = 4;

function declaredLength(headers: Headers): number | null {
  const raw = headers.get("content-length");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

async function readTextCapped(res: Response, maxBytes: number): Promise<string> {
  const declared = declaredLength(res.headers);
  if (declared != null && declared > maxBytes) throw new ImportError("response_too_large");
  if (!res.body) {
    const text = await res.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) throw new ImportError("response_too_large");
    return text;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let total = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > maxBytes) throw new ImportError("response_too_large");
    text += decoder.decode(next.value, { stream: true });
  }
  return text + decoder.decode();
}

export function isAllowedUrl(raw: string, bases: string[]): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  if (u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  if (host.includes(":")) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false;
  return bases.some((b) => host === b || host.endsWith("." + b));
}

/** SSRF guard for an outbound URL to an ADMIN-CONFIGURED, arbitrary public host (e.g. a data-export
 *  webhook) — no fixed allowlist, so it can't use isAllowedUrl. Requires https, forbids credentials, and
 *  rejects anything that could target the internal network: IPv4/IPv6 literals (covers 127.*, 10.*,
 *  192.168.*, and the 169.254.169.254 cloud-metadata address), `localhost`, bare/no-dot hostnames, and
 *  internal-only TLD suffixes. Any real public FQDN passes. */
export function isPublicHttpsUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  if (u.username || u.password) return false;
  const host = u.hostname.toLowerCase();
  if (host.includes(":")) return false; // IPv6 literal
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false; // IPv4 literal (private + loopback + link-local)
  if (host === "localhost" || host.endsWith(".localhost")) return false;
  if (!host.includes(".")) return false; // bare hostname → internal
  if (/\.(local|internal|lan|home|corp|intranet)$/.test(host)) return false; // internal-only TLDs
  return true;
}

export async function safeFetch(
  url: string,
  allowHosts: string[],
  opts: { maxBytes?: number; timeoutMs?: number; headers?: Record<string, string> } = {},
): Promise<string> {
  const { maxBytes = 1_000_000, timeoutMs = 8000 } = opts;
  const headers = { ...DEFAULT_HEADERS, ...(opts.headers ?? {}) };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let current = url;
    for (let hop = 0; ; hop++) {
      // Validate the initial URL AND every redirect target — keeps the SSRF guard whole across hops.
      if (!isAllowedUrl(current, allowHosts)) throw new ImportError("url_not_allowed");
      const res = await fetch(current, { signal: ctrl.signal, redirect: "manual", headers });
      if (res.status >= 300 && res.status < 400) {
        if (hop >= MAX_REDIRECTS) throw new ImportError("too_many_redirects");
        const loc = res.headers.get("location");
        if (!loc) throw new ImportError("redirect_no_location");
        try {
          current = new URL(loc, current).toString();
        } catch {
          throw new ImportError("redirect_invalid");
        }
        continue;
      }
      if (!res.ok) throw new ImportError(`fetch_failed_${res.status}`);
      return await readTextCapped(res, maxBytes);
    }
  } catch (e) {
    if (e instanceof ImportError) throw e;
    throw new ImportError("fetch_error");
  } finally {
    clearTimeout(timer);
  }
}
