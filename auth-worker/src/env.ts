import type { KVLike } from "./ratelimit.js";
import type { KVListLike } from "./roster.js";

type EnvBase = Omit<Cloudflare.Env, "ROSTER" | "RATELIMIT">;

export type RawEnv = EnvBase & {
  ROSTER?: KVListLike;
  RATELIMIT?: KVLike;
};
export type Env = EnvBase & {
  ROSTER: KVListLike;
  RATELIMIT: KVLike;
};
