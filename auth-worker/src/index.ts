import type { Env, RawEnv } from "./env.js";
import { secretOk } from "./authz.js";
import { allowedOrigin, corsHeaders, json, RequestBodyTooLargeError } from "./http.js";
import {
  handleLogin,
  handleMe,
  handleMyLiveRounds,
  handleMyRatings,
  handleMyRegistrations,
  handleMyResults,
  handleProfile,
  handleSetPin,
} from "./member-routes.js";
import { handleBoard } from "./member-board-routes.js";
import { handleAssistant } from "./assistant-route.js";
import { handleWebAuthnRoute } from "./webauthn-routes.js";
import { handleMyTeeSigns, handleTeeSignUpload } from "./tee-sign-routes.js";
import { handlePdgaStats } from "./pdga.js";
import { handleClubFeed } from "./feeds.js";
import { clubApi } from "./club-api.js";
import { D1KV } from "./d1kv.js";

export type { Env } from "./env.js";
export { LiveEventDO } from "./live.js";

import { runRatingsRecompute } from "./ratings-recompute.js";

/**
 * STOPGAP: when no Workers KV namespace is bound (deployed dev/staging while this account's KV data
 * plane is degraded), back missing ROSTER + RATELIMIT bindings with D1 instead. Tests inject KV mocks and
 * production binds real KV, so those stores are preserved when present.
 */
function withKvFallback(env: RawEnv): Env {
  return {
    ...env,
    ROSTER: env.ROSTER ?? new D1KV(env.DB, "roster"),
    RATELIMIT: env.RATELIMIT ?? new D1KV(env.DB, "ratelimit"),
  };
}

export default {
  async fetch(request: Request, rawEnv: RawEnv, ctx?: ExecutionContext): Promise<Response> {
    const env = withKvFallback(rawEnv);
    const origin = allowedOrigin(env, request);
    const { pathname } = new URL(request.url);
    const method = request.method.toUpperCase();

    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (!secretOk(env)) return json({ error: "server_misconfigured" }, 500, origin);

    try {
      if (pathname === "/login" && method === "POST") return await handleLogin(request, env, origin);
      if (pathname === "/me" && method === "GET") return await handleMe(request, env, origin);
      if (pathname === "/my-results" && method === "GET") return await handleMyResults(request, env, origin);
      if (pathname === "/my-ratings" && method === "GET") return await handleMyRatings(request, env, origin);
      if (pathname === "/my-live-rounds" && method === "GET") return await handleMyLiveRounds(request, env, origin);
      if (pathname === "/board" || pathname.startsWith("/board/")) return await handleBoard(request, env, origin);
      if (pathname === "/my-registrations" && method === "GET") return await handleMyRegistrations(request, env, origin);
      if (pathname === "/set-pin" && method === "POST") return await handleSetPin(request, env, origin);
      if (pathname === "/profile" && method === "POST") return await handleProfile(request, env, origin);
      if (pathname === "/assistant" && method === "POST") return await handleAssistant(request, env, origin);

      const webAuthn = await handleWebAuthnRoute(request, env, origin, pathname, method);
      if (webAuthn) return webAuthn;

      if (pathname === "/tee-signs" && method === "POST") return await handleTeeSignUpload(request, env, origin, ctx);
      if (pathname === "/my-tee-signs" && method === "GET") return await handleMyTeeSigns(request, env, origin);
      if (pathname === "/pdga-stats" && method === "GET") return await handlePdgaStats(request, env, origin);
      if (pathname === "/club-feed" && method === "GET") return await handleClubFeed(env, origin);

      const club = await clubApi(request, env, origin, pathname, method, ctx);
      if (club) return club;

      return json({ error: "not_found" }, 404, origin);
    } catch (e) {
      if (e instanceof RequestBodyTooLargeError) return json({ error: "request_too_large" }, 413, origin);
      console.error(JSON.stringify({ message: "worker_error", method, pathname, error: e instanceof Error ? e.stack : String(e) }));
      return json({ error: "server_error" }, 500, origin);
    }
  },
  // Daily ratings recompute: refreshes each member's PDGA anchor + re-solves every round_ratings row and
  // rolls up player_ratings. Idempotent (all upserts). Cron only — never reachable from the public fetch path.
  async scheduled(controller: ScheduledController, rawEnv: RawEnv, ctx: ExecutionContext): Promise<void> {
    const env = withKvFallback(rawEnv);
    ctx.waitUntil(
      (async () => {
        try {
          const result = await runRatingsRecompute(env);
          console.log(JSON.stringify({ message: "ratings_recompute_complete", cron: controller.cron, ...result }));
        } catch (error) {
          console.error(JSON.stringify({ message: "ratings_recompute_failed", cron: controller.cron, error: error instanceof Error ? error.stack : String(error) }));
          throw error;
        }
      })(),
    );
  },
} satisfies ExportedHandler<RawEnv>;
