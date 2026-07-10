import type { Env } from "./env.js";

const SECURITY_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

const DEFAULT_JSON_BODY_BYTES = 64_000;

export class RequestBodyTooLargeError extends Error {
  constructor() {
    super("request_too_large");
  }
}

export function allowedOrigin(env: Env, request: Request): string | null {
  const origin = request.headers.get("Origin");
  if (!origin) return null;
  const allow = env.ALLOWED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean);
  return allow.includes(origin) ? origin : null;
}

export function corsHeaders(origin: string | null): Record<string, string> {
  if (!origin) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function json(
  data: unknown,
  status: number,
  origin: string | null,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...SECURITY_HEADERS, ...corsHeaders(origin), ...extraHeaders },
  });
}

export function clientIp(request: Request): string {
  const cf = request.headers.get("CF-Connecting-IP")?.trim();
  if (cf) return cf;
  const forwarded = request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim();
  return forwarded || "unknown";
}

export function bearer(request: Request): string | null {
  const h = request.headers.get("Authorization") ?? "";
  const m = h.match(/^Bearer (.+)$/);
  return m ? m[1]! : null;
}

function declaredBodyLength(request: Request): number | null {
  const raw = request.headers.get("Content-Length");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

async function readTextLimited(request: Request, maxBytes: number): Promise<string> {
  const declared = declaredBodyLength(request);
  if (declared != null && declared > maxBytes) throw new RequestBodyTooLargeError();
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let total = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > maxBytes) throw new RequestBodyTooLargeError();
    text += decoder.decode(next.value, { stream: true });
  }
  return text + decoder.decode();
}

function isJsonRecord(v: unknown): v is Record<string, unknown> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

function jsonRecord(v: unknown): Record<string, unknown> | null {
  return isJsonRecord(v) ? v : null;
}

export async function readJson(request: Request, maxBytes = DEFAULT_JSON_BODY_BYTES): Promise<Record<string, unknown> | null> {
  try {
    const text = await readTextLimited(request, maxBytes);
    const v: unknown = JSON.parse(text);
    return jsonRecord(v);
  } catch (e) {
    if (e instanceof RequestBodyTooLargeError) throw e;
    return null;
  }
}
