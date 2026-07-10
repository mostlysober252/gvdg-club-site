import { describe, it, expect } from "vitest";
import { decodeDataUrl, teeSignKey, MAX_PHOTO_BYTES } from "../src/photos.js";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP = new Uint8Array([0x52,0x49,0x46,0x46,0,0,0,0,0x57,0x45,0x42,0x50]);
// Base64-encode without Node's Buffer (tsconfig has no @types/node). Loop, not spread,
// so the oversize (~3 MB) fixture doesn't blow the call stack. Mirrors photos.ts's atob.
const b64 = (u: Uint8Array) => { let s = ""; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]!); return btoa(s); };

describe("decodeDataUrl", () => {
  it("accepts jpeg/png/webp by magic bytes and returns bytes + content type", () => {
    const j = decodeDataUrl(`data:image/jpeg;base64,${b64(JPEG)}`);
    expect(j && j.contentType).toBe("image/jpeg");
    expect(j && j.ext).toBe("jpg");
    expect(decodeDataUrl(`data:image/png;base64,${b64(PNG)}`)?.contentType).toBe("image/png");
    expect(decodeDataUrl(`data:image/webp;base64,${b64(WEBP)}`)?.contentType).toBe("image/webp");
  });
  it("rejects SVG and mismatched/garbage content", () => {
    const svg = btoa('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(decodeDataUrl(`data:image/svg+xml;base64,${svg}`)).toBeNull();
    expect(decodeDataUrl(`data:image/jpeg;base64,${b64(PNG)}`)).toBeNull(); // header != claimed type
    expect(decodeDataUrl("not a data url")).toBeNull();
    expect(decodeDataUrl(`data:image/jpeg;base64,$$$notbase64$$$`)).toBeNull();
  });
  it("rejects oversize payloads", () => {
    const big = new Uint8Array(MAX_PHOTO_BYTES + 4); big.set(JPEG);
    expect(decodeDataUrl(`data:image/jpeg;base64,${b64(big)}`)).toBeNull();
  });
});

describe("teeSignKey", () => {
  it("builds a sanitized, namespaced key with the given extension", () => {
    expect(teeSignKey(12, 7, "jpg", "abc-123")).toBe("tee-signs/12/7/abc-123.jpg");
  });
});
