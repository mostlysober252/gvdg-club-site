import type { Env } from "./env.js";
import * as db from "./db.js";
import { buildMessages, generateReply, MAX_HISTORY, type ChatMessage, type ChatTurn, type ReplyProvider } from "./assistant.js";
import { getClubCalendar, upcoming, type ClubFeeds, type FeedItem } from "./feeds.js";
import { clientIp, json, readJson } from "./http.js";
import { kvRateLimited } from "./kv-rate-limit.js";

const ASSISTANT_BODY_BYTES = 64_000;
const ASSISTANT_LIMIT = 20;
const ASSISTANT_WINDOW = 60;
const DEFAULT_MODEL = "@cf/meta/llama-3.1-8b-instruct";
const DEFAULT_OR_MODEL = "openai/gpt-oss-120b:free";
const DEFAULT_OR_FALLBACK_MODEL = "nvidia/nemotron-3-super-120b-a12b:free";

class OpenRouterStatusError extends Error {
  constructor(readonly status: number) {
    super("openrouter_" + status);
  }
}

function openRouterModels(env: Env): string[] {
  const primary = env.OPENROUTER_MODEL || DEFAULT_OR_MODEL;
  const fallback = env.OPENROUTER_FALLBACK_MODEL || DEFAULT_OR_FALLBACK_MODEL;
  return primary === fallback ? [primary] : [primary, fallback];
}

function shouldTryNextOpenRouterModel(error: unknown): error is OpenRouterStatusError {
  return error instanceof OpenRouterStatusError && (error.status === 404 || error.status === 408 || error.status === 429 || error.status >= 500);
}

async function openRouterCompletion(env: Env, model: string, messages: ChatMessage[]): Promise<string> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + env.OPENROUTER_API_KEY,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://greenvillediscgolf.com",
      "X-Title": "GVDG Crotts",
    },
    body: JSON.stringify({ model, messages, max_tokens: 512, reasoning: { exclude: true } }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new OpenRouterStatusError(res.status);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data?.choices?.[0]?.message?.content ?? "";
}

function openRouterProvider(env: Env): ReplyProvider {
  return {
    name: "openrouter",
    async generate(messages: ChatMessage[]): Promise<string> {
      let lastError: Error | null = null;
      for (const model of openRouterModels(env)) {
        try {
          const content = await openRouterCompletion(env, model, messages);
          if (content.trim()) return content;
        } catch (error) {
          if (!shouldTryNextOpenRouterModel(error)) throw error;
          lastError = error;
        }
      }
      if (lastError) throw lastError;
      return "";
    },
  };
}

function workersAiProvider(env: Env): ReplyProvider {
  return {
    name: "workers-ai",
    async generate(messages: ChatMessage[]): Promise<string> {
      const out = await env.AI.run(env.ASSISTANT_MODEL || DEFAULT_MODEL, { messages, max_tokens: 512 });
      return typeof out.response === "string" ? out.response : "";
    },
  };
}

export async function handleAssistant(request: Request, env: Env, origin: string | null): Promise<Response> {
  const body = await readJson(request, ASSISTANT_BODY_BYTES);
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) return json({ error: "invalid_request" }, 400, origin);
  if (message.length > 2000) return json({ error: "message_too_long" }, 413, origin);

  // Prefer the ATOMIC rate-limit binding on this unauthenticated endpoint — the KV counter is a
  // non-atomic GET-then-PUT, so a concurrent burst can all read a stale count and slip past the cap to
  // run up AI cost. Fall back to KV where the binding isn't configured (unit tests / local dev).
  const ip = clientIp(request);
  const limited = env.ASSISTANT_RL
    ? !(await env.ASSISTANT_RL.limit({ key: "asst:" + ip })).success
    : await kvRateLimited(env, "asst:" + ip, ASSISTANT_LIMIT, ASSISTANT_WINDOW);
  if (limited) return json({ error: "rate_limited" }, 429, origin);

  const history: ChatTurn[] = Array.isArray(body?.history)
    ? body.history.slice(-MAX_HISTORY).filter((t: unknown): t is ChatTurn => !!t && typeof t === "object" && typeof (t as ChatTurn).content === "string")
    : [];

  // Club calendar context, split into the club's two categories (see feeds.ts / assistant.ts):
  //   events      = tournaments + league rounds      club events = fundraisers, meetings, minutes
  const now = Date.now();
  let cal: ClubFeeds = { events: [], clubEvents: [] };
  let courses: Record<string, unknown>[] = [];
  try { cal = await getClubCalendar(env, now); } catch { /* calendar unavailable */ }
  try { courses = (await db.listCourses(env.DB)) as Record<string, unknown>[]; } catch { /* empty */ }

  const toCtx = (f: FeedItem) => ({ name: f.name, date: f.date, status: null as string | null });
  const messages = buildMessages({
    userMessage: message,
    history,
    events: upcoming(cal.events, now, 8).map(toCtx),
    clubEvents: upcoming(cal.clubEvents, now, 8).map(toCtx),
    courses: courses.map((c) => ({ name: String(c.name ?? ""), location: (c.location as string) ?? null })),
  });

  const providers: ReplyProvider[] = [];
  if (env.OPENROUTER_API_KEY) providers.push(openRouterProvider(env));
  if (env.AI) providers.push(workersAiProvider(env));

  if (!providers.length) {
    return json({ reply: "🥏 (dev stub) Hi, I'm Crotts! No AI provider is configured in this environment, so I can't think for real yet — but your message reached the worker and the club context loaded fine.", stub: true }, 200, origin);
  }
  const out = await generateReply(providers, messages);
  return out ? json({ reply: out.reply, provider: out.provider }, 200, origin) : json({ error: "assistant_unavailable" }, 502, origin);
}
