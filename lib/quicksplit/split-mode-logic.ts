export type SplitMode = "equal" | "slider" | "tags" | "tip";

export type SplitModePersisted = {
  mode: SplitMode;
  sliderPercents: Record<string, number>;
  tagsByParticipant: Record<string, string[]>;
  tipPercent: 0 | 5 | 10 | 15 | 20;
};

export const SPLIT_TAG_DEFS = [
  { id: "food", emoji: "🍕", label: "Jedlo" },
  { id: "beer", emoji: "🍺", label: "Pivo" },
  { id: "fuel", emoji: "🚗", label: "Benzín" },
  { id: "hotel", emoji: "🏨", label: "Ubytovanie" },
  { id: "coffee", emoji: "☕", label: "Káva" },
] as const;

export type ParticipantLike = {
  id: string;
  shareCents: number;
  oweToPayerCents: number;
  isPayer: boolean;
};

export function splitStorageKey(splitId: string) {
  return `gp_qs_split_mode_${splitId}`;
}

export function splitEqualShares(totalCents: number, n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(totalCents / n);
  const rem = totalCents % n;
  return Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0));
}

function distributeByWeights(totalCents: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const sumW = weights.reduce((a, b) => a + b, 0);
  if (sumW <= 0) return splitEqualShares(totalCents, n);
  const raw = weights.map((w) => (totalCents * w) / sumW);
  const floors = raw.map((x) => Math.floor(x));
  let rem = totalCents - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((x, i) => ({ i, f: x - floors[i] }))
    .sort((a, b) => b.f - a.f);
  for (let k = 0; k < rem; k++) {
    floors[order[k % n].i] += 1;
  }
  return floors;
}

/** Úprava jedného slidera; ostatné sa škálujú proporcionálne, súčet vždy 100. */
export function adjustSliderPercents(
  prev: Record<string, number>,
  participantIds: string[],
  changedId: string,
  nextVal: number,
): Record<string, number> {
  const n = participantIds.length;
  if (n === 0) return {};
  const v = Math.max(0, Math.min(100, Math.round(nextVal)));
  const others = participantIds.filter((id) => id !== changedId);
  const out: Record<string, number> = {};
  out[changedId] = v;
  if (others.length === 0) {
    out[changedId] = 100;
    return out;
  }
  const rem = 100 - v;
  const sumOthersPrev = others.reduce((s, id) => s + Math.max(0, prev[id] ?? 0), 0);
  if (sumOthersPrev < 0.01) {
    const base = Math.floor(rem / others.length);
    let left = rem - base * others.length;
    others.forEach((id, i) => {
      out[id] = base + (i < left ? 1 : 0);
    });
    return out;
  }
  const floats = others.map((id) => (rem * (prev[id] ?? 0)) / sumOthersPrev);
  const ints = floats.map((x) => Math.floor(x));
  let leftover = rem - ints.reduce((a, b) => a + b, 0);
  const ord = others
    .map((id, idx) => ({ id, f: floats[idx] - ints[idx] }))
    .sort((a, b) => b.f - a.f);
  others.forEach((id, idx) => {
    out[id] = ints[idx];
  });
  for (let k = 0; k < leftover; k++) {
    out[ord[k % ord.length].id] += 1;
  }
  let sum = participantIds.reduce((s, id) => s + (out[id] ?? 0), 0);
  let guard = 0;
  while (sum !== 100 && guard++ < 200) {
    if (sum > 100) {
      const id = others.find((oid) => (out[oid] ?? 0) > 0) ?? changedId;
      if ((out[id] ?? 0) > 0) out[id] -= 1;
      sum--;
    } else {
      const id = others[0] ?? changedId;
      out[id] = (out[id] ?? 0) + 1;
      sum++;
    }
  }
  return out;
}

function defaultSliderPercents(participantIds: string[]): Record<string, number> {
  const n = participantIds.length || 1;
  const base = Math.floor(100 / n);
  const rem = 100 - base * n;
  const out: Record<string, number> = {};
  participantIds.forEach((id, i) => {
    out[id] = base + (i < rem ? 1 : 0);
  });
  return out;
}

function defaultTags(participantIds: string[]): Record<string, string[]> {
  const o: Record<string, string[]> = {};
  participantIds.forEach((id) => {
    o[id] = [];
  });
  return o;
}

export function defaultPersisted(participantIds: string[]): SplitModePersisted {
  return {
    mode: "equal",
    sliderPercents: defaultSliderPercents(participantIds),
    tagsByParticipant: defaultTags(participantIds),
    tipPercent: 0,
  };
}

export function loadPersistedSplitMode(
  splitId: string,
  participantIds: string[],
): SplitModePersisted {
  if (typeof window === "undefined") return defaultPersisted(participantIds);
  try {
    const raw = localStorage.getItem(splitStorageKey(splitId));
    if (!raw) return defaultPersisted(participantIds);
    const p = JSON.parse(raw) as Partial<SplitModePersisted>;
    const base = defaultPersisted(participantIds);
    const mode = (p.mode as SplitMode) || "equal";
    const slider: Record<string, number> = { ...base.sliderPercents };
    participantIds.forEach((id) => {
      if (typeof p.sliderPercents?.[id] === "number") slider[id] = Math.round(p.sliderPercents[id]);
    });
    const tags: Record<string, string[]> = { ...base.tagsByParticipant };
    participantIds.forEach((id) => {
      const arr = p.tagsByParticipant?.[id];
      tags[id] = Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
    });
    const tip = [0, 5, 10, 15, 20].includes(p.tipPercent as number) ? (p.tipPercent as 0 | 5 | 10 | 15 | 20) : 0;
    const sumS = participantIds.reduce((a, id) => a + (slider[id] ?? 0), 0);
    if (sumS !== 100) {
      Object.assign(slider, defaultSliderPercents(participantIds));
    }
    return { mode: mode === "slider" || mode === "tags" || mode === "tip" || mode === "equal" ? mode : "equal", sliderPercents: slider, tagsByParticipant: tags, tipPercent: tip };
  } catch {
    return defaultPersisted(participantIds);
  }
}

export function savePersistedSplitMode(splitId: string, state: SplitModePersisted) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(splitStorageKey(splitId), JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

export type AmountPair = { shareCents: number; oweToPayerCents: number };

/**
 * Vypočíta zobrazené podiely a dlhy voči platiteľovi podľa módu (klient-side).
 */
export function computeAmountsByMode(
  totalCents: number,
  payerParticipantId: string,
  participants: ParticipantLike[],
  persisted: SplitModePersisted,
): Record<string, AmountPair> {
  const ids = participants.map((p) => p.id);
  const n = ids.length;
  const out: Record<string, AmountPair> = {};

  if (n === 0) return out;

  const baseEqual = splitEqualShares(totalCents, n);
  const baseById: Record<string, number> = {};
  participants.forEach((p, i) => {
    baseById[p.id] = baseEqual[i] ?? 0;
  });

  const setAll = (shares: Record<string, number>) => {
    participants.forEach((p) => {
      const sc = shares[p.id] ?? 0;
      out[p.id] = {
        shareCents: sc,
        oweToPayerCents: p.id === payerParticipantId ? 0 : sc,
      };
    });
  };

  if (persisted.mode === "equal") {
    participants.forEach((p, i) => {
      const sc = p.shareCents;
      out[p.id] = {
        shareCents: sc,
        oweToPayerCents: p.oweToPayerCents,
      };
    });
    return out;
  }

  if (persisted.mode === "slider") {
    const weights = ids.map((id) => Math.max(0, persisted.sliderPercents[id] ?? 0));
    const sumW = weights.reduce((a, b) => a + b, 0);
    const wUse = sumW > 0 ? weights : ids.map(() => 1);
    const sharesArr = distributeByWeights(totalCents, wUse);
    const shares: Record<string, number> = {};
    ids.forEach((id, i) => {
      shares[id] = sharesArr[i] ?? 0;
    });
    setAll(shares);
    return out;
  }

  if (persisted.mode === "tags") {
    const weights = ids.map((id) => (persisted.tagsByParticipant[id]?.length ?? 0));
    const sumT = weights.reduce((a, b) => a + b, 0);
    const wUse = sumT > 0 ? weights : ids.map(() => 1);
    const sharesArr = distributeByWeights(totalCents, wUse);
    const shares: Record<string, number> = {};
    ids.forEach((id, i) => {
      shares[id] = sharesArr[i] ?? 0;
    });
    setAll(shares);
    return out;
  }

  /* tip */
  const tipPct = persisted.tipPercent;
  const tipCents = Math.round((totalCents * tipPct) / 100);
  const nonPayers = ids.filter((id) => id !== payerParticipantId);
  const shares: Record<string, number> = { ...baseById };
  if (nonPayers.length > 0 && tipCents > 0) {
    const each = Math.floor(tipCents / nonPayers.length);
    let rem = tipCents - each * nonPayers.length;
    nonPayers.forEach((id, i) => {
      shares[id] = (baseById[id] ?? 0) + each + (i < rem ? 1 : 0);
    });
  }
  setAll(shares);
  return out;
}

export function sliderPercentSum(persisted: SplitModePersisted, participantIds: string[]): number {
  return participantIds.reduce((s, id) => s + (persisted.sliderPercents[id] ?? 0), 0);
}

export function computeTipCents(totalCents: number, tipPercent: 0 | 5 | 10 | 15 | 20): number {
  return Math.round((totalCents * tipPercent) / 100);
}
