"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Copy, ScanLine, Users } from "lucide-react";
import { api, type QuickSplitRequestTokens } from "@/lib/api/client";
import {
  QS_ACTIVE_ID,
  readQsSession,
  writeQsCreateSession,
  clearQsSession,
} from "@/lib/quicksplit/session";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useAuth } from "@/contexts/AuthContext";

type ActivityType =
  | "split_created"
  | "participant_joined"
  | "amount_updated"
  | "payer_changed"
  | "payment_details_updated"
  | "marked_paid"
  | "marked_unpaid";

type ActivityView = {
  id: string;
  type: ActivityType;
  createdAt: string;
  actorParticipantId: string | null;
  actorDisplayName: string | null;
  meta: Record<string, unknown>;
};

type QuicksplitParticipantView = {
  id: string;
  displayName: string;
  userUid: string | null;
  iban: string | null;
  shareCents: number;
  isPayer: boolean;
  oweToPayerCents: number;
  markedPaidAt: string | null;
};

type QuicksplitView = {
  id: string;
  totalCents: number;
  currency: string;
  ownerUid: string | null;
  payerParticipantId: string;
  participants: QuicksplitParticipantView[];
  payerIban: string | null;
  payerDisplayName: string;
  createdAt: string;
  updatedAt: string;
  activities: ActivityView[];
  activitiesHasMore: boolean;
  activitiesLoadMoreAfterId: string | null;
};

function formatEur(cents: number) {
  return (cents / 100).toFixed(2).replace(".", ",") + " €";
}

function formatTime(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString("sk-SK", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function formatActivity(a: ActivityView): string {
  const name = a.actorDisplayName || "Niekto";
  switch (a.type) {
    case "split_created":
      return `Split bol vytvorený (${formatEur((a.meta.totalCents as number) || 0)})`;
    case "participant_joined":
      return `${name} sa pripojil/a`;
    case "amount_updated":
      return `Suma zmenená na ${formatEur((a.meta.newCents as number) || 0)}`;
    case "payer_changed":
      return `Platiteľ: ${String(a.meta.previousPayerName || "?")} → ${String(a.meta.newPayerName || "?")}`;
    case "payment_details_updated":
      return a.meta.isPayer ? `${name} doplnil/a IBAN platiteľa` : `${name} doplnil/a platobné údaje`;
    case "marked_paid":
      return `${name} označil/a platbu ako zaplatenú`;
    case "marked_unpaid":
      return `${name} zrušil/a označenie platby`;
    default:
      return a.type;
  }
}

function parseEuroToCents(raw: string): number | null {
  const s = raw.trim().replace(/\s/g, "").replace(",", ".");
  const n = parseFloat(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function buildPayMeText(split: QuicksplitView, oweCents: number) {
  if (!split.payerIban) {
    return "Platiteľ zatiaľ nemá doplnený IBAN.";
  }
  const note = `QuickSplit ${split.id.slice(0, 8)}`;
  return `IBAN: ${split.payerIban}\nSuma: ${(oweCents / 100).toFixed(2)} EUR\nSpráva: ${note}`;
}

/** Dátum splatnosti vo formáte YYYYMMDD (PayMe / Payment Link Standard). */
function payMeDtYYYYMMDD(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

/** 10-miestny VS odvodený od split ID (číselné znaky). */
function payMeVariableSymbol(splitId: string) {
  const hex = splitId.replace(/-/g, "").slice(0, 10);
  const n = parseInt(hex, 16) % 10_000_000_000;
  return String(Number.isFinite(n) ? n : 0).padStart(10, "0").slice(-10);
}

/** 10-miestny SS odvodený od split ID (stabilný medzi reláciami). */
function payMeSpecificSymbol(splitId: string) {
  const hex = splitId.replace(/-/g, "").slice(-10);
  const n = parseInt(hex, 16) % 10_000_000_000;
  return String(Number.isFinite(n) ? n : 0).padStart(10, "0").slice(-10);
}

function payMeCreditorName(name: string) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, " ")
    .trim()
    .slice(0, 70);
}

/**
 * PayMe odkaz podľa oficiálneho tvaru (SBA / payme.sk).
 * @see https://www.payme.sk/en/developers
 * Príklad: https://www.payme.sk?V=1&IBAN=...&AM=...&CC=EUR&DT=...&PI=...&MSG=...&CN=...
 */
function buildPayMeUrl(split: QuicksplitView, oweCents: number) {
  if (!split.payerIban) return "";
  const iban = split.payerIban.replace(/\s/g, "").toUpperCase();
  const params = new URLSearchParams();
  params.set("V", "1");
  params.set("IBAN", iban);
  params.set("AM", (oweCents / 100).toFixed(2));
  params.set("CC", "EUR");
  params.set("DT", payMeDtYYYYMMDD());
  const vs = payMeVariableSymbol(split.id);
  const ss = payMeSpecificSymbol(split.id);
  const pi = `/VS${vs}/SS${ss}/KS1118`;
  params.set("PI", pi);
  params.set("MSG", `QuickSplit ${split.id.slice(0, 8)}`);
  params.set("CN", payMeCreditorName(split.payerDisplayName || "Platitel"));
  return `https://www.payme.sk?${params.toString()}`;
}

export function QuickSplitScreen() {
  const { user } = useAuth();
  const [split, setSplit] = useState<QuicksplitView | null>(null);
  const [extraActivities, setExtraActivities] = useState<ActivityView[]>([]);
  const [activitiesCursor, setActivitiesCursor] = useState<string | null>(null);
  const [activitiesHasMore, setActivitiesHasMore] = useState(false);
  const [loadingActivitiesMore, setLoadingActivitiesMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [manualInput, setManualInput] = useState("");
  const [ibanModal, setIbanModal] = useState<{ participantId: string; label: string } | null>(null);
  const [ibanInput, setIbanInput] = useState("");
  const [payerModal, setPayerModal] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [payFlowOpen, setPayFlowOpen] = useState(false);
  const [payFlowDeadlineTs, setPayFlowDeadlineTs] = useState<number | null>(null);
  const [payFlowSeconds, setPayFlowSeconds] = useState(60);
  const payFlowFinalizedRef = useRef(false);

  const loadSplit = useCallback(async (splitId: string) => {
    const s = readQsSession(splitId);
    const data = (await api.quicksplits.get(splitId, {
      joinToken: s.joinToken || undefined,
      adminToken: s.adminToken || undefined,
    })) as QuicksplitView;
    setSplit(data);
    setExtraActivities([]);
    setActivitiesCursor(data.activitiesLoadMoreAfterId);
    setActivitiesHasMore(data.activitiesHasMore);
  }, []);

  const refresh = useCallback(async () => {
    setErr(null);
    const id = typeof sessionStorage !== "undefined" ? sessionStorage.getItem(QS_ACTIVE_ID) : null;
    if (!id) {
      setSplit(null);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      await loadSplit(id);
    } catch (e: unknown) {
      setSplit(null);
      setErr(e instanceof Error ? e.message : "Chyba načítania");
    } finally {
      setLoading(false);
    }
  }, [loadSplit]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const joinUrl = useMemo(() => {
    if (!split || typeof window === "undefined") return "";
    const s = readQsSession(split.id);
    if (!s.joinToken) return "";
    const u = new URL("/join", window.location.origin);
    u.searchParams.set("splitId", split.id);
    u.searchParams.set("joinToken", s.joinToken);
    return u.toString();
  }, [split]);

  useEffect(() => {
    if (!inviteOpen || !joinUrl) {
      setQrDataUrl("");
      return;
    }
    let cancelled = false;
    void import("qrcode").then((QRCode) => {
      if (cancelled) return;
      void QRCode.toDataURL(joinUrl, {
        width: 220,
        margin: 2,
        color: { dark: "#000000", light: "#ffffff" },
      }).then((url) => {
        if (!cancelled) setQrDataUrl(url);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [inviteOpen, joinUrl]);

  const myParticipantId = split ? readQsSession(split.id).myParticipantId : null;
  const myParticipant = useMemo(() => {
    if (!split || !myParticipantId) return null;
    return split.participants.find((p) => p.id === myParticipantId) ?? null;
  }, [split, myParticipantId]);

  const allActivities = useMemo(() => {
    if (!split) return [];
    return [...split.activities, ...extraActivities];
  }, [split, extraActivities]);

  const loadOlderActivities = async () => {
    if (!split || !activitiesCursor) return;
    const s = readQsSession(split.id);
    setLoadingActivitiesMore(true);
    try {
      const res = (await api.quicksplits.activities(split.id, {
        afterId: activitiesCursor,
        limit: 10,
        joinToken: s.joinToken || undefined,
        adminToken: s.adminToken || undefined,
      })) as { activities: ActivityView[]; hasMore: boolean; nextAfterId: string | null };
      setExtraActivities((prev) => [...prev, ...res.activities]);
      setActivitiesHasMore(res.hasMore);
      setActivitiesCursor(res.nextAfterId);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Chyba načítania upozornení");
    } finally {
      setLoadingActivitiesMore(false);
    }
  };

  const handleCreate = async () => {
    setErr(null);
    setLoading(true);
    try {
      const cents = parseEuroToCents(manualInput) ?? 0;
      const created = (await api.quicksplits.create({
        totalCents: cents,
        creatorDisplayName: user?.displayName || user?.email?.split("@")[0] || undefined,
      })) as {
        splitId: string;
        joinToken: string;
        adminToken: string;
        creatorParticipantId: string;
        creatorParticipantSecret: string;
      };
      writeQsCreateSession(created.splitId, {
        joinToken: created.joinToken,
        adminToken: created.adminToken,
        creatorParticipantId: created.creatorParticipantId,
        creatorParticipantSecret: created.creatorParticipantSecret,
      });
      setManualOpen(false);
      setManualInput("");
      await loadSplit(created.splitId);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Chyba");
    } finally {
      setLoading(false);
    }
  };

  const saveTotal = async () => {
    if (!split) return;
    const cents = parseEuroToCents(manualInput);
    if (cents === null) {
      setErr("Neplatná suma");
      return;
    }
    const s = readQsSession(split.id);
    try {
      await api.quicksplits.update(
        split.id,
        { totalCents: cents },
        { adminToken: s.adminToken || undefined },
      );
      setManualOpen(false);
      await loadSplit(split.id);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Chyba");
    }
  };

  const setPayer = async (participantId: string) => {
    if (!split) return;
    const s = readQsSession(split.id);
    try {
      await api.quicksplits.update(
        split.id,
        { payerParticipantId: participantId },
        { adminToken: s.adminToken || undefined },
      );
      setPayerModal(false);
      await loadSplit(split.id);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Chyba");
    }
  };

  const authHeadersForParticipant = useCallback((): QuickSplitRequestTokens => {
    if (!split) return {};
    const s = readQsSession(split.id);
    const secret =
      s.myParticipantId && s.creatorParticipantId && s.myParticipantId === s.creatorParticipantId
        ? s.creatorParticipantSecret || undefined
        : s.myParticipantSecret || undefined;
    return {
      joinToken: s.joinToken || undefined,
      participantSecret: secret,
    };
  }, [split]);

  const saveIban = async () => {
    if (!split || !ibanModal) return;
    const s = readQsSession(split.id);
    const normalized = ibanInput.replace(/\s/g, "").toUpperCase();
    const ibanPayload = normalized.length >= 15 ? normalized : null;
    const isPayerTarget = ibanModal.participantId === split.payerParticipantId;

    const h: QuickSplitRequestTokens = {};
    if (isPayerTarget) {
      h.joinToken = s.joinToken || undefined;
      h.participantSecret =
        ibanModal.participantId === s.creatorParticipantId
          ? s.creatorParticipantSecret || undefined
          : s.myParticipantSecret || undefined;
    } else if (s.adminToken) {
      h.adminToken = s.adminToken;
    } else {
      h.joinToken = s.joinToken || undefined;
      h.participantSecret =
        ibanModal.participantId === s.creatorParticipantId
          ? s.creatorParticipantSecret || undefined
          : s.myParticipantSecret || undefined;
    }

    try {
      await api.quicksplits.updateParticipantPayment(
        split.id,
        ibanModal.participantId,
        { iban: ibanPayload },
        h,
      );
      setIbanModal(null);
      setIbanInput("");
      await loadSplit(split.id);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Chyba");
    }
  };

  const togglePaid = useCallback(async (paid: boolean) => {
    if (!split || !myParticipantId) return;
    try {
      const updated = (await api.quicksplits.markParticipantPaid(
        split.id,
        myParticipantId,
        paid,
        authHeadersForParticipant(),
      )) as QuicksplitView;
      setSplit(updated);
      setExtraActivities([]);
      setActivitiesCursor(updated.activitiesLoadMoreAfterId);
      setActivitiesHasMore(updated.activitiesHasMore);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Chyba");
    }
  }, [authHeadersForParticipant, myParticipantId, split]);

  const finalizePayFlow = useCallback(async (markPaid: boolean) => {
    if (payFlowFinalizedRef.current) return;
    payFlowFinalizedRef.current = true;
    if (markPaid) {
      await togglePaid(true);
    }
    setPayFlowOpen(false);
    setPayFlowDeadlineTs(null);
    setPayFlowSeconds(60);
  }, [togglePaid]);

  useEffect(() => {
    if (!payFlowOpen || !payFlowDeadlineTs) return;
    const tick = () => {
      const left = Math.max(0, Math.ceil((payFlowDeadlineTs - Date.now()) / 1000));
      setPayFlowSeconds(left);
      if (left <= 0) {
        void finalizePayFlow(true);
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [finalizePayFlow, payFlowOpen, payFlowDeadlineTs]);

  const copyJoin = () => {
    if (joinUrl) void navigator.clipboard.writeText(joinUrl);
  };

  const copyPay = (text: string) => {
    void navigator.clipboard.writeText(text);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background w-full flex items-center justify-center">
        <p className="text-muted-foreground">Načítavam QuickSplit…</p>
      </div>
    );
  }

  if (!split) {
    return (
      <div className="min-h-screen bg-background w-full">
        <div className="max-w-screen-sm mx-auto px-4 py-6 space-y-6">
          <h1 className="text-xl font-bold text-foreground">QuickSplit</h1>
          {err && <p className="text-sm text-red-400">{err}</p>}
          <p className="text-muted-foreground text-sm">
            Rozdeľte účet rovnomerne. Po vytvorení získaš QR a odkaz pre pripojenie ďalších.
          </p>
          <Button className="w-full h-14 bg-primary text-primary-foreground rounded-xl" onClick={() => setManualOpen(true)}>
            Nový QuickSplit
          </Button>
          <Modal isOpen={manualOpen} onClose={() => setManualOpen(false)} title="Suma účtu">
            <div className="space-y-4">
              <input
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                placeholder="napr. 120,50"
                className="w-full h-14 px-4 rounded-xl bg-background border border-foreground/20 text-foreground"
              />
              <Button className="w-full h-12 bg-primary" onClick={handleCreate}>
                Vytvoriť
              </Button>
            </div>
          </Modal>
        </div>
      </div>
    );
  }

  const payMeText =
    myParticipant && !myParticipant.isPayer && myParticipant.oweToPayerCents > 0
      ? buildPayMeText(split, myParticipant.oweToPayerCents)
      : "";
  const payMeUrl =
    myParticipant && !myParticipant.isPayer && myParticipant.oweToPayerCents > 0
      ? buildPayMeUrl(split, myParticipant.oweToPayerCents)
      : "";

  const session = readQsSession(split.id);
  const isAdminSession = !!session.adminToken;

  return (
    <div className="min-h-screen bg-background w-full pb-24">
      <div className="max-w-screen-sm mx-auto px-4 py-6 space-y-6">
        <h1 className="text-xl font-bold text-foreground">QuickSplit</h1>
        {err && <p className="text-sm text-red-400">{err}</p>}

        <section className="space-y-3">
          <h2 className="text-base font-semibold text-foreground">Pridať platbu</h2>
          <button
            type="button"
            disabled
            className="w-full rounded-2xl border border-foreground/25 py-10 px-4 flex flex-col items-center gap-3 opacity-50 cursor-not-allowed"
          >
            <ScanLine className="w-12 h-12 text-foreground" />
            <span className="text-foreground text-sm font-medium">Naskenovať bloček</span>
            <span className="text-xs text-muted-foreground">OCR čoskoro (Document AI)</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setManualInput((split.totalCents / 100).toFixed(2).replace(".", ","));
              setManualOpen(true);
            }}
            className="w-full flex items-center justify-between rounded-2xl border border-foreground/25 py-4 px-4"
          >
            <span className="text-foreground text-sm font-medium">Zadať manuálne</span>
            <ChevronRight className="w-5 h-5 text-primary" />
          </button>
        </section>

        <section className="space-y-3">
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 className="text-base font-semibold text-foreground">Rozdeliť medzi · suma</h2>
            <span className="text-lg font-bold text-primary">{formatEur(split.totalCents)}</span>
          </div>
          <div className="rounded-2xl border border-foreground/25 divide-y divide-foreground/10">
            {split.participants.map((p) => {
              const isMe = p.id === myParticipantId;
              const paid = !!p.markedPaidAt;
              return (
                <div key={p.id} className="flex flex-col gap-1 px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      {p.isPayer && <span className="text-primary text-xs shrink-0">●</span>}
                      <span className="text-foreground text-sm truncate">
                        {p.displayName}
                        {isMe ? " (ty)" : ""}
                      </span>
                      {p.isPayer && <span className="text-xs text-muted-foreground shrink-0">platil</span>}
                    </div>
                    <span className="text-foreground text-sm font-medium shrink-0">{formatEur(p.shareCents)}</span>
                  </div>
                  {!p.isPayer && p.oweToPayerCents > 0 && (
                    <div className="flex items-center justify-between pl-1">
                      <span
                        className={`text-xs font-medium ${paid ? "text-emerald-400" : "text-amber-400"}`}
                      >
                        {paid ? "Zaplatené" : "Nezaplatené"}
                      </span>
                    </div>
                  )}
                  {isMe && !p.isPayer && p.oweToPayerCents > 0 && !split.payerIban && (
                    <p className="text-xs text-muted-foreground mt-1">Čaká na IBAN platiteľa</p>
                  )}
                  {!p.isPayer && !isMe && p.oweToPayerCents > 0 && isAdminSession && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="self-start h-8 text-xs mt-1"
                      onClick={() => {
                        setIbanModal({ participantId: p.id, label: `IBAN · ${p.displayName}` });
                        setIbanInput(p.iban || "");
                      }}
                    >
                      Pomôcť doplniť IBAN
                    </Button>
                  )}
                </div>
              );
            })}
            <button
              type="button"
              onClick={() => setInviteOpen(true)}
              className="w-full flex items-center justify-between px-4 py-3 text-primary text-sm font-medium"
            >
              <span className="flex items-center gap-2">
                <Users className="w-4 h-4" />
                Pridať / pozvať ľudí
              </span>
              <ChevronRight className="w-5 h-5" />
            </button>
            {split.participants.length > 1 && isAdminSession && (
              <button
                type="button"
                onClick={() => setPayerModal(true)}
                className="w-full flex items-center justify-between px-4 py-3 text-primary text-sm font-medium"
              >
                <span>Zmeniť platiteľa</span>
                <ChevronRight className="w-5 h-5" />
              </button>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-foreground/20 overflow-hidden">
          <button
            type="button"
            onClick={() => setNotifOpen((o) => !o)}
            className="w-full flex items-center justify-between px-4 py-3 bg-muted/30 text-left"
          >
            <span className="text-sm font-semibold text-foreground">Upozornenia</span>
            <ChevronDown className={`w-5 h-5 text-muted-foreground transition-transform ${notifOpen ? "rotate-180" : ""}`} />
          </button>
          {notifOpen && (
            <div className="px-4 py-3 space-y-3 border-t border-foreground/10">
              {allActivities.length === 0 && (
                <p className="text-xs text-muted-foreground">Zatiaľ žiadne udalosti.</p>
              )}
              <ul className="space-y-2">
                {allActivities.map((a) => (
                  <li key={a.id} className="text-xs text-foreground/90 border-b border-foreground/5 pb-2 last:border-0">
                    <span className="text-muted-foreground">{formatTime(a.createdAt)}</span>
                    <br />
                    {formatActivity(a)}
                  </li>
                ))}
              </ul>
              {activitiesHasMore && activitiesCursor && (
                <button
                  type="button"
                  className="text-xs text-primary font-medium underline-offset-2 hover:underline"
                  disabled={loadingActivitiesMore}
                  onClick={() => void loadOlderActivities()}
                >
                  {loadingActivitiesMore ? "Načítavam…" : "Načítať staršie…"}
                </button>
              )}
            </div>
          )}
        </section>

        <Button
          variant="outline"
          className="w-full h-11 border-foreground/25"
          onClick={() => {
            clearQsSession(split.id);
            setSplit(null);
            setErr(null);
          }}
        >
          Nový split (zmazať lokálny odkaz)
        </Button>
        {!user && myParticipant?.isPayer && (
          <Button
            variant="outline"
            className="w-full h-10 text-sm border-foreground/20"
            onClick={() => {
              setIbanModal({ participantId: myParticipant.id, label: "Upraviť môj IBAN" });
              setIbanInput(myParticipant.iban || split.payerIban || "");
            }}
          >
            Upraviť môj IBAN
          </Button>
        )}
      </div>

      <Modal isOpen={manualOpen} onClose={() => setManualOpen(false)} title="Manuálna suma">
        <div className="space-y-4">
          <input
            value={manualInput}
            onChange={(e) => setManualInput(e.target.value)}
            className="w-full h-14 px-4 rounded-xl bg-background border border-foreground/20 text-foreground"
            placeholder="Suma v EUR"
          />
          <Button className="w-full h-12 bg-primary" onClick={saveTotal}>
            Uložiť
          </Button>
        </div>
      </Modal>

      <Modal isOpen={inviteOpen} onClose={() => setInviteOpen(false)} title="Pozvať ľudí">
        <div className="space-y-4 flex flex-col items-center">
          {qrDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qrDataUrl} alt="QR kód" className="rounded-lg border border-foreground/20" width={220} height={220} />
          ) : (
            <p className="text-sm text-muted-foreground">Generujem QR…</p>
          )}
          <p className="text-xs text-muted-foreground break-all text-center">{joinUrl}</p>
          <Button className="w-full h-12 bg-primary gap-2" onClick={copyJoin}>
            <Copy className="w-4 h-4" />
            Kopírovať odkaz
          </Button>
        </div>
      </Modal>

      <Modal isOpen={payerModal} onClose={() => setPayerModal(false)} title="Kto platil?">
        <ul className="space-y-2">
          {split.participants.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="w-full text-left px-4 py-3 rounded-xl border border-foreground/15 hover:bg-muted/40 text-foreground text-sm"
                onClick={() => void setPayer(p.id)}
              >
                {p.displayName}
                {p.id === split.payerParticipantId ? " · aktuálne platil" : ""}
              </button>
            </li>
          ))}
        </ul>
      </Modal>

      <Modal
        isOpen={!!ibanModal}
        onClose={() => {
          setIbanModal(null);
          setIbanInput("");
        }}
        title={ibanModal?.label || "IBAN"}
      >
        <div className="space-y-4">
          <input
            value={ibanInput}
            onChange={(e) => setIbanInput(e.target.value)}
            placeholder="SK00…"
            className="w-full h-14 px-4 rounded-xl bg-background border border-foreground/20 text-foreground uppercase"
          />
          <Button className="w-full h-12 bg-primary" onClick={() => void saveIban()}>
            Uložiť
          </Button>
        </div>
      </Modal>
      <Modal
        isOpen={payFlowOpen}
        onClose={() => {
          setPayFlowOpen(false);
          setPayFlowDeadlineTs(null);
          setPayFlowSeconds(60);
        }}
        title="Čakám na potvrdenie platby"
      >
        <div className="space-y-4">
          <p className="text-sm text-foreground">
            Po otvorení bankovej appky máš čas <span className="text-primary font-bold">{payFlowSeconds}s</span>.
          </p>
          <p className="text-xs text-muted-foreground whitespace-pre-wrap">{payMeText}</p>
          <Button variant="outline" className="w-full h-10 gap-2" onClick={() => copyPay(payMeText)}>
            <Copy className="w-4 h-4" />
            Manuálne platobné údaje
          </Button>
          <Button className="w-full h-11 bg-primary" onClick={() => void finalizePayFlow(true)}>
            Potvrdiť platbu
          </Button>
          <Button variant="outline" className="w-full h-11" onClick={() => void finalizePayFlow(false)}>
            Zaplatiť neskôr
          </Button>
        </div>
      </Modal>
      {myParticipant && !myParticipant.isPayer && myParticipant.oweToPayerCents > 0 && split.payerIban && (
        <div className="fixed bottom-20 left-0 right-0 max-w-screen-sm mx-auto px-4 pointer-events-none">
          <div className="pointer-events-auto">
            <Button
              className="w-full h-12 bg-primary shadow-lg"
              onClick={() => {
                if (!payMeUrl) return;
                payFlowFinalizedRef.current = false;
                setPayFlowOpen(true);
                setPayFlowDeadlineTs(Date.now() + 60_000);
                setPayFlowSeconds(60);
                window.open(payMeUrl, "_blank", "noopener,noreferrer");
              }}
            >
              Pay me link · {formatEur(myParticipant.oweToPayerCents)}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
