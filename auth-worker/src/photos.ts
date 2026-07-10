// Tee-sign photo handling (T1): validate an uploaded image (data URL) by MAGIC BYTES — never trust the
// declared MIME — and generate a safe, server-controlled R2 object key. SVG is rejected (script vector).
// Pure decode/validation here; the thin R2 wrappers take any object matching R2BucketLike.

export const MAX_PHOTO_BYTES = 3_000_000; // ~3 MB after client-side resize

export interface R2BucketLike {
  put(key: string, value: ArrayBuffer | Uint8Array, opts?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{ body: ReadableStream; arrayBuffer(): Promise<ArrayBuffer>; httpMetadata?: { contentType?: string } } | null>;
  delete(key: string): Promise<void>;
}

export interface DecodedImage {
  bytes: Uint8Array;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  ext: "jpg" | "png" | "webp";
}

function sniff(bytes: Uint8Array): DecodedImage["contentType"] | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
      && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return null;
}

const EXT: Record<DecodedImage["contentType"], DecodedImage["ext"]> = {
  "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
};

/** Decode a `data:image/...;base64,...` URL to validated bytes, or null if invalid/oversize/wrong-type.
 *  Content type is determined by MAGIC BYTES and must match the declared type. */
export function decodeDataUrl(dataUrl: unknown): DecodedImage | null {
  if (typeof dataUrl !== "string") return null;
  const m = /^data:(image\/[a-z+]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim());
  if (!m) return null;
  const declared = m[1] === "image/jpg" ? "image/jpeg" : m[1]; // accept the common jpg alias
  let bytes: Uint8Array;
  try {
    const bin = atob(m[2]!);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch {
    return null;
  }
  if (bytes.length === 0 || bytes.length > MAX_PHOTO_BYTES) return null;
  const sniffed = sniff(bytes);
  if (!sniffed || sniffed !== declared) return null; // reject SVG (no magic) + declared/actual mismatch
  return { bytes, contentType: sniffed, ext: EXT[sniffed] };
}

/** Server-controlled R2 key. courseId/hole are integers; uuid is server-generated — no user input. */
export function teeSignKey(courseId: number, hole: number, ext: string, uuid: string): string {
  return `tee-signs/${courseId}/${hole}/${uuid}.${ext}`;
}
