function textValue(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function defaultCtpPayoutNote(event: Record<string, unknown>, ctp: Record<string, unknown>): string {
  const parts = [`CTP payout: ${textValue(event.name) ?? "event"}`];
  const hole = textValue(ctp.hole);
  if (hole) parts.push(`hole ${hole}`);
  const division = textValue(ctp.division);
  if (division) parts.push(division);
  const prize = textValue(ctp.prize);
  if (prize) parts.push(prize);
  return parts.join(" - ");
}
