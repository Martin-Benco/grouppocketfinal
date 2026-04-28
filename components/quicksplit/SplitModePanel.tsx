"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  SPLIT_TAG_DEFS,
  type SplitMode,
  type SplitModePersisted,
  adjustSliderPercents,
  computeAmountsByMode,
  computeTipCents,
  sliderPercentSum,
  type ParticipantLike,
} from "@/lib/quicksplit/split-mode-logic";

function eur(cents: number) {
  return (cents / 100).toFixed(2).replace(".", ",") + " €";
}

const MODE_TABS: { id: SplitMode; label: string }[] = [
  { id: "equal", label: "Rovnako" },
  { id: "slider", label: "Slider" },
  { id: "tags", label: "Tagy" },
  { id: "tip", label: "Tip pre hostiteľa" },
];

const TIP_OPTIONS: (0 | 5 | 10 | 15 | 20)[] = [0, 5, 10, 15, 20];

export type SplitModePanelParticipant = ParticipantLike & { displayName: string };

export type SplitModePanelProps = {
  totalCents: number;
  payerParticipantId: string;
  participants: SplitModePanelParticipant[];
  myParticipantId: string | null;
  persisted: SplitModePersisted;
  onChange: (next: SplitModePersisted) => void;
};

export function SplitModePanel({
  totalCents,
  payerParticipantId,
  participants,
  myParticipantId,
  persisted,
  onChange,
}: SplitModePanelProps) {
  const ids = participants.map((p) => p.id);
  const sumPct = sliderPercentSum(persisted, ids);
  const sliderOk = Math.abs(sumPct - 100) < 0.51;

  const amounts = useMemo(
    () => computeAmountsByMode(totalCents, payerParticipantId, participants, persisted),
    [totalCents, payerParticipantId, participants, persisted],
  );

  const tipCents = computeTipCents(totalCents, persisted.tipPercent);
  const payerIsMe = myParticipantId === payerParticipantId;

  const setMode = (mode: SplitMode) => {
    onChange({ ...persisted, mode });
  };

  const updateSlider = (changedId: string, value: number) => {
    const next = adjustSliderPercents(persisted.sliderPercents, ids, changedId, value);
    onChange({ ...persisted, sliderPercents: next });
  };

  const toggleTag = (participantId: string, tagId: string) => {
    const cur = persisted.tagsByParticipant[participantId] ?? [];
    const has = cur.includes(tagId);
    const nextTags = { ...persisted.tagsByParticipant };
    nextTags[participantId] = has ? cur.filter((t) => t !== tagId) : [...cur, tagId];
    onChange({ ...persisted, tagsByParticipant: nextTags });
  };

  const shell = "rounded-2xl border border-[rgba(255,255,255,0.08)] bg-[#0e0e10] p-4 space-y-4";

  return (
    <div className={shell}>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Spôsob delenia">
        {MODE_TABS.map((tab) => {
          const active = persisted.mode === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setMode(tab.id)}
              className={cn(
                "min-h-[44px] touch-manipulation rounded-full px-4 text-sm font-semibold transition-colors",
                active
                  ? "bg-[#7c3aed] text-white shadow-sm"
                  : "border border-[rgba(255,255,255,0.12)] bg-transparent text-[#a3a3a3] hover:text-white hover:border-white/20"
              )}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {persisted.mode === "equal" && (
        <p className="text-xs text-[#a3a3a3] leading-relaxed">
          Každý platí rovnaký podiel z účtu. V zozname nižšie je pod menom doplnený šedý text s podielom.
        </p>
      )}

      {persisted.mode === "slider" && (
        <div className="space-y-4">
          {participants.map((row) => {
            const pct = Math.round(persisted.sliderPercents[row.id] ?? 0);
            const share = amounts[row.id]?.shareCents ?? 0;
            return (
              <div key={row.id} className="space-y-2">
                <div className="flex items-center justify-between gap-2 min-h-[44px]">
                  <span className="text-sm font-medium text-white truncate">
                    {row.displayName}
                    {row.isPayer ? " · platil" : ""}
                  </span>
                  <div className="flex shrink-0 items-baseline gap-2 text-sm">
                    <span className="text-[#7c3aed] font-semibold">{pct}%</span>
                    <span className="text-white font-medium tabular-nums">{eur(share)}</span>
                  </div>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={pct}
                  className="split-mode-range w-full"
                  style={{ ["--pct" as string]: `${pct}%` }}
                  onChange={(e) => updateSlider(row.id, Number(e.target.value))}
                  aria-valuenow={pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`Podiel pre ${row.displayName}`}
                />
              </div>
            );
          })}
          <p
            className={cn(
              "min-h-[44px] flex items-center justify-center rounded-xl px-3 text-sm font-medium",
              sliderOk ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"
            )}
          >
            {sliderOk ? "Súčet: 100% — v poriadku" : `Súčet: ${sumPct}% — uprav slidery`}
          </p>
        </div>
      )}

      {persisted.mode === "tags" && (
        <div className="space-y-4">
          {participants.map((row) => {
            const selected = persisted.tagsByParticipant[row.id] ?? [];
            return (
              <div key={row.id} className="space-y-2">
                <p className="text-sm font-medium text-white min-h-[44px] flex items-center">
                  {row.displayName}
                  {row.isPayer ? " · platil" : ""}
                </p>
                <div className="flex flex-wrap gap-2">
                  {SPLIT_TAG_DEFS.map((tag) => {
                    const on = selected.includes(tag.id);
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => toggleTag(row.id, tag.id)}
                        className={cn(
                          "min-h-[44px] touch-manipulation rounded-full border px-3 py-2 text-sm font-medium transition-colors",
                          on
                            ? "border-[#7c3aed] bg-[#7c3aed] text-white"
                            : "border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.04)] text-[#d4d4d4] active:bg-white/10"
                        )}
                      >
                        {tag.emoji} {tag.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          <div className="rounded-xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-3 py-3 space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#a3a3a3]">Vypočítané sumy</p>
            {participants.map((row) => (
              <div key={row.id} className="flex justify-between text-sm text-white">
                <span className="truncate pr-2">{row.displayName}</span>
                <span className="shrink-0 tabular-nums font-medium">{eur(amounts[row.id]?.shareCents ?? 0)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {persisted.mode === "tip" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {TIP_OPTIONS.map((pct) => {
              const active = persisted.tipPercent === pct;
              const label = pct === 0 ? "Bez tipu" : `${pct}%`;
              return (
                <button
                  key={pct}
                  type="button"
                  onClick={() => onChange({ ...persisted, tipPercent: pct })}
                  className={cn(
                    "min-h-[52px] touch-manipulation rounded-xl border text-base font-semibold transition-colors",
                    active
                      ? "border-[#7c3aed] bg-[#7c3aed] text-white"
                      : "border-[rgba(255,255,255,0.12)] bg-[rgba(255,255,255,0.05)] text-white hover:border-white/25"
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div className="space-y-1 rounded-xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] px-3 py-3 text-sm">
            <p className="text-white">
              Tip: {persisted.tipPercent}% = {eur(tipCents)}
            </p>
            {payerIsMe && tipCents > 0 && (
              <p className="text-[#a78bfa] font-medium">Ty dostaneš navyše: {eur(tipCents)}</p>
            )}
            {!payerIsMe && myParticipantId && (
              <p className="text-[#a3a3a3] text-xs">
                Tip sa rozdeľuje rovnomerne medzi ostatných účastníkov; tvoja čiastka k úhrade je v zozname nižšie.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
