import { describe, it, expect, vi, afterEach } from "vitest";
import { notifyNewOrder } from "../src/order-notify.js";
import type { Env } from "../src/index.js";

afterEach(() => vi.unstubAllGlobals());

const order = { id: 7, member_name: "Jane", total_cents: 2500, payment_method: "store_credit" };
const lines = [{ name_snapshot: "Champion Destroyer", quantity: 1, price_cents: 2000 }];

describe("notifyNewOrder (pro-shop order email)", () => {
  it("does nothing (no network) when email is not configured", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    await notifyNewOrder({} as Env, order, lines);
    expect(f).not.toHaveBeenCalled();
  });

  it("posts to Resend once both the API key and recipient are set", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", f);
    await notifyNewOrder({ RESEND_API_KEY: "re_test", ORDER_NOTIFY_EMAIL: "club@example.com" } as unknown as Env, order, lines);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    const payload = JSON.parse(init.body as string) as { to: string[]; subject: string };
    expect(payload.to).toEqual(["club@example.com"]);
    expect(payload.subject).toContain("#7");
  });

  it("never throws even if the email send fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    await expect(
      notifyNewOrder({ RESEND_API_KEY: "re_test", ORDER_NOTIFY_EMAIL: "club@example.com" } as unknown as Env, order, lines),
    ).resolves.toBeUndefined();
  });
});
