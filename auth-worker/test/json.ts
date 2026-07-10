export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

export async function jsonObject(response: Response): Promise<Record<string, unknown>> {
  const value = await response.json();
  if (isJsonObject(value)) return value;
  throw new Error("expected_json_object");
}

export function objectField(record: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = record[key];
  if (isJsonObject(value)) return value;
  throw new Error("expected_json_object_field");
}

export function arrayField(record: Record<string, unknown>, key: string): readonly unknown[] {
  const value = record[key];
  if (Array.isArray(value)) return value;
  throw new Error("expected_json_array_field");
}
