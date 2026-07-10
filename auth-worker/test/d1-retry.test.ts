import { describe, expect, it } from "vitest";

import { isRetryableD1Error, readD1OrFallback, retryD1Read } from "../src/d1-retry.js";

describe("D1 transient retry", () => {
  it("retries a read after a transient D1 network error", async () => {
    let attempts = 0;

    const value = await retryD1Read(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("D1_ERROR: Network connection lost.");
      return "courses";
    }, [0]);

    expect(value).toBe("courses");
    expect(attempts).toBe(2);
  });

  it("does not retry non-D1 errors", async () => {
    let attempts = 0;

    await expect(retryD1Read(async () => {
      attempts += 1;
      throw new Error("SQLITE_CONSTRAINT: courses.name");
    }, [0])).rejects.toThrow("SQLITE_CONSTRAINT");

    expect(attempts).toBe(1);
  });

  it("classifies Cloudflare retryable D1 reset errors", () => {
    expect(isRetryableD1Error(new Error("D1 DB reset because its code was updated."))).toBe(true);
    expect(isRetryableD1Error(new Error("Internal error in D1 DB storage caused object to be reset."))).toBe(true);
    expect(isRetryableD1Error(new Error("Cannot resolve D1 DB due to transient issue on remote node."))).toBe(true);
  });

  it("uses fallback data when a D1 read does not settle quickly", async () => {
    const value = await readD1OrFallback(
      () => new Promise<string>(() => undefined),
      () => "fallback-course",
      1,
    );

    expect(value).toBe("fallback-course");
  });
});
