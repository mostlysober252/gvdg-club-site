// Passkeys / WebAuthn for the GVDG member auth Worker (opt-in second login method).
// The relying-party crypto lives in @simplewebauthn/server (vetted, WebCrypto-based,
// edge-compatible). This module adds: KV storage for credentials + one-time challenges,
// and the four endpoint handlers. Credentials persist in the ROSTER KV; challenges are
// ephemeral in the RATELIMIT KV (single-use, short TTL — replay protection).

import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import type { KVLike } from "./ratelimit.js";
import { getMember } from "./roster.js";
import type { SessionClaims } from "./jwt.js";

export interface StoredCredential {
  id: string; // base64url credential ID
  publicKey: string; // base64url COSE public key
  counter: number;
  transports?: string[];
}

export interface WebAuthnEnv {
  ROSTER: KVLike;
  RATELIMIT: KVLike;
  RP_ID?: string;
  RP_NAME?: string;
  EXPECTED_ORIGIN?: string;
}

const CREDS = (m: string) => `wa:creds:${m}`;
const CHAL = (k: string) => `wa:chal:${k}`;

// --- storage helpers (pure KV logic, unit-tested) -----------------------------
export async function getCredentials(kv: KVLike, memberId: string): Promise<StoredCredential[]> {
  const raw = await kv.get(CREDS(memberId));
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as StoredCredential[]) : [];
  } catch {
    return [];
  }
}

export async function addCredential(kv: KVLike, memberId: string, cred: StoredCredential): Promise<void> {
  const list = await getCredentials(kv, memberId);
  if (list.some((c) => c.id === cred.id)) return; // never duplicate a credential id
  list.push(cred);
  await kv.put(CREDS(memberId), JSON.stringify(list));
}

export async function updateCredentialCounter(kv: KVLike, memberId: string, id: string, counter: number): Promise<void> {
  const list = await getCredentials(kv, memberId);
  const c = list.find((x) => x.id === id);
  if (!c) return;
  c.counter = counter;
  await kv.put(CREDS(memberId), JSON.stringify(list));
}

export async function putChallenge(kv: KVLike, key: string, challenge: string, ttlSec = 300): Promise<void> {
  await kv.put(CHAL(key), challenge, { expirationTtl: ttlSec });
}

/** Read and immediately delete a challenge — single use, to prevent replay. */
export async function takeChallenge(kv: KVLike, key: string): Promise<string | null> {
  const v = await kv.get(CHAL(key));
  if (v != null) await kv.delete(CHAL(key));
  return v;
}

// --- config -------------------------------------------------------------------
function cfg(env: WebAuthnEnv) {
  return {
    rpID: env.RP_ID || "greenvillediscgolf.com",
    rpName: env.RP_NAME || "Greenville Disc Golf Club",
    origin: env.EXPECTED_ORIGIN || "https://www.greenvillediscgolf.com",
  };
}

export interface HandlerResult {
  status: number;
  data: unknown;
}

// --- endpoint handlers --------------------------------------------------------
/** Options for registering a NEW passkey (member must already be logged in). */
export async function registrationOptions(env: WebAuthnEnv, memberId: string): Promise<HandlerResult> {
  const member = await getMember(env.ROSTER, memberId);
  if (!member) return { status: 401, data: { error: "unauthorized" } };
  const { rpID, rpName } = cfg(env);
  const existing = await getCredentials(env.ROSTER, memberId);
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userID: new TextEncoder().encode(memberId),
    userName: member.pdgaNo || member.udisc || member.name,
    userDisplayName: member.name,
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({ id: c.id, transports: c.transports as never })),
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
  });
  await putChallenge(env.RATELIMIT, `reg:${memberId}`, options.challenge);
  return { status: 200, data: options };
}

export async function registrationVerify(
  env: WebAuthnEnv,
  memberId: string,
  body: RegistrationResponseJSON,
): Promise<HandlerResult> {
  const member = await getMember(env.ROSTER, memberId);
  if (!member) return { status: 401, data: { error: "unauthorized" } };
  const expectedChallenge = await takeChallenge(env.RATELIMIT, `reg:${memberId}`);
  if (!expectedChallenge) return { status: 400, data: { error: "no_challenge" } };
  const { rpID, origin } = cfg(env);

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    });
  } catch {
    return { status: 400, data: { error: "verification_failed" } };
  }
  if (!verification.verified || !verification.registrationInfo) {
    return { status: 400, data: { verified: false } };
  }
  const { credential } = verification.registrationInfo;
  await addCredential(env.ROSTER, memberId, {
    id: credential.id,
    publicKey: isoBase64URL.fromBuffer(credential.publicKey),
    counter: credential.counter,
    transports: body.response.transports,
  });
  return { status: 200, data: { verified: true } };
}

/** Options for a usernameless passkey login. Returns a flowId tying the challenge. */
export async function authenticationOptions(env: WebAuthnEnv): Promise<HandlerResult> {
  const { rpID } = cfg(env);
  const options = await generateAuthenticationOptions({ rpID, userVerification: "preferred" });
  const flowId = isoBase64URL.fromBuffer(crypto.getRandomValues(new Uint8Array(16)));
  await putChallenge(env.RATELIMIT, `auth:${flowId}`, options.challenge);
  return { status: 200, data: { options, flowId } };
}

export async function authenticationVerify(
  env: WebAuthnEnv,
  body: { flowId?: unknown; response?: AuthenticationResponseJSON },
  signToken: (claims: SessionClaims) => Promise<string>,
): Promise<HandlerResult> {
  const flowId = typeof body?.flowId === "string" ? body.flowId : "";
  const response = body?.response;
  if (!flowId || !response) return { status: 400, data: { error: "invalid_request" } };

  const expectedChallenge = await takeChallenge(env.RATELIMIT, `auth:${flowId}`);
  if (!expectedChallenge) return { status: 400, data: { error: "no_challenge" } };

  const userHandle = response.response?.userHandle;
  if (!userHandle) return { status: 400, data: { error: "no_user_handle" } };
  const memberId = isoBase64URL.toUTF8String(userHandle);

  const member = await getMember(env.ROSTER, memberId);
  if (!member) return { status: 401, data: { error: "unknown_credential" } };
  const stored = (await getCredentials(env.ROSTER, memberId)).find((c) => c.id === response.id);
  if (!stored) return { status: 401, data: { error: "unknown_credential" } };

  const { rpID, origin } = cfg(env);
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
      credential: {
        id: stored.id,
        publicKey: isoBase64URL.toBuffer(stored.publicKey),
        counter: stored.counter,
        transports: stored.transports as never,
      },
    });
  } catch {
    return { status: 400, data: { error: "verification_failed" } };
  }
  if (!verification.verified) return { status: 401, data: { verified: false } };

  await updateCredentialCounter(env.ROSTER, memberId, stored.id, verification.authenticationInfo.newCounter);
  const token = await signToken({ sub: member.memberId, mustChangePin: member.mustChangePin });
  return {
    status: 200,
    data: {
      token,
      mustChangePin: member.mustChangePin,
      name: member.name,
      pdgaNo: member.pdgaNo ?? null,
      udisc: member.udisc ?? null,
      photo: member.photo ?? null,
      isAdmin: member.isAdmin === true, // so the admin portal link shows immediately after a passkey login
    },
  };
}
