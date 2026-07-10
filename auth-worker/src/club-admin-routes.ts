import type { Env } from "./env.js";
import { adminGate } from "./authz.js";
import { json } from "./http.js";
import { asInt } from "./input.js";
import { handleAdminCourses } from "./club-admin-courses.js";
import { handleAdminEvents } from "./club-admin-events.js";
import { handleAdminFundraisers, handleAdminLeagues, handleAdminMeetings } from "./club-admin-content.js";
import { handleAdminImport } from "./club-admin-imports.js";
import { handleAdminLayouts } from "./club-admin-layouts.js";
import { handleAdminMembers } from "./club-admin-members.js";
import { handleAdminExport } from "./club-admin-export.js";
import { handleAdminShop } from "./club-admin-shop.js";
import { handleAdminTeeSigns } from "./club-admin-tee-signs.js";

export async function handleClubAdmin(
  request: Request,
  env: Env,
  origin: string | null,
  method: string,
  seg: string[],
): Promise<Response | null> {
  if (seg[0] !== "admin") return null;
  const gate = await adminGate(request, env, origin);
  if (gate instanceof Response) return gate;

  const adminId = gate.adminId;
  const sub = seg[1];
  const id = seg[2] != null ? asInt(seg[2]) : null;
  let response: Response | null = null;

  if (sub === "courses") response = await handleAdminCourses(request, env, origin, method, seg, adminId, id);
  else if (sub === "events") response = await handleAdminEvents(request, env, origin, method, seg, adminId, id);
  else if (sub === "leagues") response = await handleAdminLeagues(request, env, origin, method, adminId, id);
  else if (sub === "fundraisers") response = await handleAdminFundraisers(request, env, origin, method, adminId, id);
  else if (sub === "meetings") response = await handleAdminMeetings(request, env, origin, method, adminId, id);
  else if (sub === "import" && method === "POST") response = await handleAdminImport(request, env, origin);
  else if (sub === "layouts") response = await handleAdminLayouts(request, env, origin, method, id);
  else if (sub === "members") response = await handleAdminMembers(request, env, origin, method, seg, adminId);
  else if (sub === "shop" || sub === "wallets" || sub === "orders") response = await handleAdminShop(request, env, origin, method, seg, adminId);
  else if (sub === "tee-signs") response = await handleAdminTeeSigns(request, env, origin, method, seg, adminId, id);
  else if (sub === "export") response = await handleAdminExport(request, env, origin, method, seg, adminId);

  return response ?? json({ error: "not_found" }, 404, origin);
}
