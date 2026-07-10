// "Crotts" vision (T2): read a disc-golf tee sign photo into a per-layout suggestion. Mirrors
// assistant.ts's provider-chain pattern. parseVisionJson is PURE (unit-tested); the providers do I/O.
// Output is ONLY a suggestion — an admin confirms before anything reaches scoring.

export interface VisionRow {
  label: string;
  color: string | null;
  par: number | null;
  distance_ft: number | null;
  tee: string | null;
  target: string | null;
}
export interface VisionResult {
  hole: number | null;
  layouts: VisionRow[];
  source?: string | null;
}

export const VISION_PROMPT =
  "Read this disc golf tee sign. It may list several layouts/tee positions, often color-coded. " +
  'Return ONLY JSON: {"hole":int|null,"layouts":[{"label":string,"color":string|null,"par":int|null,' +
  '"distance_ft":int|null,"tee":string|null,"target":string|null}]}. One entry per layout/tee shown. ' +
  "color = the tee color word if shown (e.g. blue, red), else null. Null any field not clearly visible. " +
  "Do not include any text outside the JSON.";

function clampInt(v: unknown, min: number, max: number): number | null {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

/** Pull the first JSON object out of model text (tolerates code fences / prose) and validate it. */
export function parseVisionJson(text: unknown): VisionResult {
  const empty: VisionResult = { hole: null, layouts: [] };
  if (typeof text !== "string" || !text.trim()) return empty;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return empty;
  let data: unknown;
  try { data = JSON.parse(text.slice(start, end + 1)); } catch { return empty; }
  if (!data || typeof data !== "object") return empty;
  const o = data as Record<string, unknown>;
  const rawLayouts = Array.isArray(o.layouts) ? o.layouts : [];
  const layouts: VisionRow[] = [];
  for (const r of rawLayouts) {
    if (!r || typeof r !== "object") continue;
    const row = r as Record<string, unknown>;
    layouts.push({
      label: row.label != null ? String(row.label) : "",
      color: row.color != null ? String(row.color) : null,
      par: clampInt(row.par, 1, 10),
      distance_ft: clampInt(row.distance_ft, 20, 2000),
      tee: row.tee != null ? String(row.tee) : null,
      target: row.target != null ? String(row.target) : null,
    });
  }
  return { hole: clampInt(o.hole, 1, 99), layouts };
}

// ---- providers (I/O; live-verified) ----
export interface VisionEnv {
  GEMINI_API_KEY?: string;
  GEMINI_VISION_MODEL?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_VISION_MODEL?: string;
  VISION_MODEL?: string;
  VISION_DEV_STUB?: string;
  AI?: { run(model: string, opts: Record<string, unknown>): Promise<{ response?: string }> };
}
const DEFAULT_GEMINI_VISION = "gemini-2.5-flash";
const DEFAULT_OR_VISION = "nvidia/nemotron-nano-12b-v2-vl:free";
const DEFAULT_WAI_VISION = "@cf/meta/llama-3.2-11b-vision-instruct";

function base64Of(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

function dataUrlOf(bytes: Uint8Array, contentType: string): string {
  return `data:${contentType};base64,${base64Of(bytes)}`;
}

function geminiResponseText(data: { candidates?: { content?: { parts?: { text?: string }[] } }[] }): string {
  return data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("\n") ?? "";
}

async function geminiVision(env: VisionEnv, bytes: Uint8Array, contentType: string): Promise<VisionResult> {
  const model = env.GEMINI_VISION_MODEL || DEFAULT_GEMINI_VISION;
  const modelId = model.replace(/^models\//, "");
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY || "" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [
        { text: VISION_PROMPT },
        { inlineData: { mimeType: contentType, data: base64Of(bytes) } },
      ] }],
      generationConfig: { responseMimeType: "application/json", maxOutputTokens: 700, temperature: 0 },
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error("gemini_" + res.status);
  const data = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const out = parseVisionJson(geminiResponseText(data));
  return { ...out, source: "gemini:" + model };
}

async function openRouterVision(env: VisionEnv, bytes: Uint8Array, contentType: string): Promise<VisionResult> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: "Bearer " + env.OPENROUTER_API_KEY, "Content-Type": "application/json", "X-Title": "GVDG Crotts Vision" },
    body: JSON.stringify({
      model: env.OPENROUTER_VISION_MODEL || DEFAULT_OR_VISION,
      messages: [{ role: "user", content: [
        { type: "text", text: VISION_PROMPT },
        { type: "image_url", image_url: { url: dataUrlOf(bytes, contentType) } },
      ] }],
      max_tokens: 700,
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error("openrouter_" + res.status);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const out = parseVisionJson(data?.choices?.[0]?.message?.content ?? "");
  return { ...out, source: "openrouter:" + (env.OPENROUTER_VISION_MODEL || DEFAULT_OR_VISION) };
}

async function workersAiVision(env: VisionEnv, bytes: Uint8Array): Promise<VisionResult> {
  const model = env.VISION_MODEL || DEFAULT_WAI_VISION;
  // env.AI.run takes no abort signal, so race it against a timeout (matches OpenRouter's 30s cap):
  // a hung model rejects and the chain falls through instead of blocking the request indefinitely.
  const out = await Promise.race([
    env.AI!.run(model, { image: Array.from(bytes), prompt: VISION_PROMPT, max_tokens: 700 }),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("workers_ai_timeout")), 30000)),
  ]);
  return { ...parseVisionJson(out?.response ?? ""), source: "workers-ai:" + model };
}

// Local-only deterministic stub so the full pipeline is live-verifiable without AI creds.
function devStub(): VisionResult {
  return { hole: 7, source: "dev-stub", layouts: [
    { label: "Long", color: "blue", par: 4, distance_ft: 420, tee: null, target: null },
    { label: "Short", color: "white", par: 3, distance_ft: 285, tee: null, target: null },
  ] };
}

export async function extractTeeSign(env: VisionEnv, bytes: Uint8Array, contentType: string): Promise<VisionResult> {
  // VISION_DEV_STUB forces the deterministic local stub (set ONLY in .dev.vars, never in deploy) so the
  // pipeline is verifiable without AI creds and without attempting — and hanging on — a real provider call.
  if (env.VISION_DEV_STUB) return devStub();
  if (env.GEMINI_API_KEY) {
    try { const r = await geminiVision(env, bytes, contentType); if (r.layouts.length || r.hole != null) return r; } catch {}
  }
  if (env.OPENROUTER_API_KEY) {
    try { const r = await openRouterVision(env, bytes, contentType); if (r.layouts.length || r.hole != null) return r; } catch {}
  }
  if (env.AI) {
    try { const r = await workersAiVision(env, bytes); if (r.layouts.length || r.hole != null) return r; } catch {}
  }
  return { hole: null, layouts: [], source: null };
}
