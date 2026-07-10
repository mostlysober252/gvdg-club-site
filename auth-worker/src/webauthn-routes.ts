import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import type { Env } from "./env.js";
import {
  authenticationOptions,
  authenticationVerify,
  registrationOptions,
  registrationVerify,
} from "./webauthn.js";
import { signSession } from "./jwt.js";
import { requireAuth, ttl } from "./authz.js";
import { clientIp, json, readJson } from "./http.js";
import { kvRateLimited } from "./kv-rate-limit.js";

const WEBAUTHN_AUTH_OPTIONS_IP_LIMIT = 20;

export async function handleWebAuthnRoute(
  request: Request,
  env: Env,
  origin: string | null,
  pathname: string,
  method: string,
): Promise<Response | null> {
  if (pathname === "/webauthn/register/options" && method === "POST") {
    const claims = await requireAuth(request, env);
    if (!claims) return json({ error: "unauthorized" }, 401, origin);
    const { status, data } = await registrationOptions(env, claims.sub);
    return json(data, status, origin);
  }
  if (pathname === "/webauthn/register/verify" && method === "POST") {
    const claims = await requireAuth(request, env);
    if (!claims) return json({ error: "unauthorized" }, 401, origin);
    const body = await readJson(request);
    if (!body) return json({ error: "invalid_request" }, 400, origin);
    const { status, data } = await registrationVerify(env, claims.sub, body as unknown as RegistrationResponseJSON);
    return json(data, status, origin);
  }
  if (pathname === "/webauthn/auth/options" && method === "POST") {
    if (await kvRateLimited(env, "webauthn:auth_options:" + clientIp(request), WEBAUTHN_AUTH_OPTIONS_IP_LIMIT, 60)) {
      return json({ error: "rate_limited" }, 429, origin);
    }
    const { status, data } = await authenticationOptions(env);
    return json(data, status, origin);
  }
  if (pathname === "/webauthn/auth/verify" && method === "POST") {
    const body = await readJson(request);
    if (!body) return json({ error: "invalid_request" }, 400, origin);
    const signToken = (claims: { sub: string; mustChangePin: boolean }) =>
      signSession(claims, env.JWT_SECRET, ttl(env));
    const { status, data } = await authenticationVerify(
      env,
      body as { flowId?: unknown; response?: AuthenticationResponseJSON },
      signToken,
    );
    return json(data, status, origin);
  }
  return null;
}
