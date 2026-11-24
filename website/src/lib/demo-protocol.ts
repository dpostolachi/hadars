export const DATA_CARD_KINDS = [
  "release",
  "branch",
  "commit",
  "message",
] as const;
export type DataCardKind = (typeof DATA_CARD_KINDS)[number];
export interface DataCard {
  kind: DataCardKind;
  value: string | null;
  detail: string | null;
}
export type DataCards = Record<DataCardKind, DataCard>;
export interface RenderSnapshot {
  renderId: string;
  renderedAt: number;
}

export function decodeDataCards(payload: unknown): DataCards {
  const data = (payload as { serverData?: Record<string, unknown> })
    ?.serverData;
  if (!data || typeof data !== "object")
    throw new Error("Server data was not returned.");
  const cards = Object.values(data).filter((value): value is DataCard => {
    if (!value || typeof value !== "object") return false;
    const card = value as DataCard;
    return (
      DATA_CARD_KINDS.includes(card.kind) &&
      (card.value === null || typeof card.value === "string") &&
      (card.detail === null || typeof card.detail === "string")
    );
  });
  if (
    DATA_CARD_KINDS.some(
      (kind) => cards.filter((card) => card.kind === kind).length !== 1,
    )
  )
    throw new Error("The response did not contain all four cards.");
  return Object.fromEntries(
    cards.map((card) => [card.kind, card]),
  ) as DataCards;
}

export function decodeRenderSnapshot(html: string): RenderSnapshot {
  const script = html.match(
    /<script id="hadars" type="application\/json"[^>]*>([\s\S]*?)<\/script>/,
  );
  if (!script) throw new Error("No server-rendered page data was returned.");
  const data = JSON.parse(script[1]).hadars?.props?.__serverData;
  const snapshot = Object.values(data ?? {}).find(
    (value: unknown) =>
      !!value &&
      typeof value === "object" &&
      (value as { kind?: unknown }).kind === "cache-render",
  ) as RenderSnapshot | undefined;
  if (
    !snapshot ||
    typeof snapshot.renderId !== "string" ||
    !snapshot.renderId ||
    !Number.isFinite(snapshot.renderedAt)
  )
    throw new Error("The server render identity was missing.");
  return { renderId: snapshot.renderId, renderedAt: snapshot.renderedAt };
}
