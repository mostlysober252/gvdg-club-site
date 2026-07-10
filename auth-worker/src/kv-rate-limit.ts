import type { Env } from "./env.js";

export async function kvRateLimited(env: Env, key: string, limit: number, windowSec: number): Promise<boolean> {
  const cur = parseInt((await env.RATELIMIT.get(key)) || "0", 10) || 0;
  if (cur >= limit) return true;
  await env.RATELIMIT.put(key, String(cur + 1), { expirationTtl: windowSec });
  return false;
}
