"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera, Check, Copy, Minus, Plus, Users } from "lucide-react";
import { api, quicksplitStreamUrl, type QuickSplitRequestTokens } from "@/lib/api/client";
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
  | "marked_unpaid"
  | "flow_step_changed"
  | "split_mode_changed"
  | "split_items_updated"
  | "participant_claim_updated"
  | "remainder_distributed"
  | "splitting_finalized";

type ActivityView = {
  id: string;
  type: ActivityType;
  createdAt: string;
  actorParticipantId: string | null;
  actorDisplayName: string | null;
  meta: Record<string, unknown>;
};

type QuickSplitItemView = {
  id: string;
  name: string;
  amountCents: number;
  consumerParticipantIds: string[];
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
  claimedAmountCents: number | null;
  adjustmentCents: number;
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
  flowStep: "waiting" | "splitting" | "settlement" | "closed";
  targetParticipantCount: number;
  splitMode: "equal" | "custom_amounts" | "items" | null;
  equalExcludedParticipantIds: string[];
  splitItems: QuickSplitItemView[];
  customClaimsSumCents: number;
  customRemainderCents: number;
  canJoinMore: boolean;
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
    case "flow_step_changed":
      return `Krok: ${String(a.meta.from)} → ${String(a.meta.to)}`;
    case "split_mode_changed":
      return `Režim delenia: ${String(a.meta.mode)}`;
    case "split_items_updated":
      return "Položky boli upravené";
    case "participant_claim_updated":
      return `${name} upravil/a svoju sumu`;
    case "remainder_distributed":
      return `Zostatok rozdelený (${formatEur((a.meta.remainderCents as number) || 0)})`;
    case "splitting_finalized":
      return "Delenie dokončené";
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

function centsToInput(cents: number): string {
  return (Math.max(0, cents) / 100).toFixed(2).replace(".", ",");
}

function buildPayMeUrl(params: {
  iban: string;
  amountCents: number;
  creditorName?: string | null;
  message?: string;
}) {
  const search = new URLSearchParams({
    V: "1",
    IBAN: params.iban.replace(/\s/g, "").toUpperCase(),
    AM: (params.amountCents / 100).toFixed(2),
    CC: "EUR",
  });
  if (params.creditorName?.trim()) {
    search.set("CN", params.creditorName.trim());
  }
  if (params.message?.trim()) {
    search.set("MSG", params.message.trim());
  }
  return `https://payme.sk/?${search.toString()}`;
}

export function QuickSplitScreen() {
  const { user } = useAuth();
  const [split, setSplit] = useState<QuicksplitView | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [createTotal, setCreateTotal] = useState("");
  const [createCount, setCreateCount] = useState(4);
  const [qrDataUrl, setQrDataUrl] = useState("");
  const [claimDraft, setClaimDraft] = useState<Record<string, string>>({});
  const claimTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [itemsDraft, setItemsDraft] = useState<QuickSplitItemView[]>([]);
  const [newItemName, setNewItemName] = useState("");
  const [newItemAmount, setNewItemAmount] = useState("");
  const [splitTotalDraft, setSplitTotalDraft] = useState("");
  const [splitCountDraft, setSplitCountDraft] = useState(2);
  const [remainderDraft, setRemainderDraft] = useState<Record<string, string>>({});
  const [paymentStarted, setPaymentStarted] = useState(false);
  const [showPaymentSuccess, setShowPaymentSuccess] = useState(false);
  const [showStepThreeStatus, setShowStepThreeStatus] = useState(false);
  const customClaimsInitKey = useRef<string | null>(null);
  const totalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const customTotalSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const targetCountTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [scannerSupported, setScannerSupported] = useState(true);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const visibleErr =
    err && err.toLowerCase().includes("neplatná zmena kroku flowu")
      ? null
      : err;

  const loadSplit = useCallback(async (splitId: string) => {
    const s = readQsSession(splitId);
    const data = (await api.quicksplits.get(splitId, {
      joinToken: s.joinToken || undefined,
      adminToken: s.adminToken || undefined,
    })) as QuicksplitView;
    setSplit(data);
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
    if (!split || split.flowStep !== "waiting" || !joinUrl) {
      setQrDataUrl("");
      return;
    }
    let cancelled = false;
    void import("qrcode").then((QRCode) => {
      if (cancelled) return;
      void QRCode.toDataURL(joinUrl, {
        width: 240,
        margin: 2,
        color: { dark: "#000000", light: "#ffffff" },
      }).then((url) => {
        if (!cancelled) setQrDataUrl(url);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [split, joinUrl, split?.flowStep]);

  /** SSE — live stav splitu */
  useEffect(() => {
    if (!split?.id) return;
    const s = readQsSession(split.id);
    if (!s.joinToken && !s.adminToken) return;
    const url = quicksplitStreamUrl(split.id, {
      adminToken: s.adminToken || undefined,
      joinToken: s.joinToken || undefined,
    });
    let es: EventSource | null = new EventSource(url);
    const onMessage = (ev: MessageEvent) => {
      try {
        const next = JSON.parse(ev.data as string) as QuicksplitView;
        setSplit(next);
      } catch {
        /* ignore */
      }
    };
    es.addEventListener("message", onMessage as EventListener);
    es.onerror = () => {
      es?.close();
      es = null;
    };
    return () => {
      es?.removeEventListener("message", onMessage as EventListener);
      es?.close();
    };
  }, [split?.id]);

  /** Fallback polling v settle kroku, keď by SSE event vypadol. */
  useEffect(() => {
    if (!split?.id || split.flowStep !== "settlement") return;
    const s = readQsSession(split.id);
    if (!s.adminToken) return;
    const interval = setInterval(() => {
      void loadSplit(split.id).catch(() => {
        /* ticho, nech nerušíme UI pri krátkych výpadkoch */
      });
    }, 2500);
    return () => clearInterval(interval);
  }, [split?.id, split?.flowStep, loadSplit]);

  const myParticipantId = split ? readQsSession(split.id).myParticipantId : null;
  const myParticipant = useMemo(() => {
    if (!split || !myParticipantId) return null;
    return split.participants.find((p) => p.id === myParticipantId) ?? null;
  }, [split, myParticipantId]);

  const session = split ? readQsSession(split.id) : null;
  const isAdminSession = !!session?.adminToken;

  useEffect(() => {
    if (!split || split.flowStep !== "closed") return;
    clearQsSession(split.id);
    setSplit(null);
    setErr("Split bol ukončený adminom.");
    const t = setTimeout(() => setErr(null), 2500);
    return () => clearTimeout(t);
  }, [split]);

  const liveClaimCentsByParticipant = useMemo(() => {
    const out = new Map<string, number>();
    if (!split || split.splitMode !== "custom_amounts") return out;
    for (const p of split.participants) {
      const draft = claimDraft[p.id];
      const parsed = draft !== undefined ? parseEuroToCents(draft) : null;
      out.set(p.id, parsed ?? p.claimedAmountCents ?? 0);
    }
    return out;
  }, [split, claimDraft]);

  const customLiveClaimsSumCents = useMemo(() => {
    if (!split || split.splitMode !== "custom_amounts") return 0;
    return split.participants.reduce((sum, p) => sum + (liveClaimCentsByParticipant.get(p.id) ?? 0), 0);
  }, [split, liveClaimCentsByParticipant]);

  const displayedTotalCents =
    split?.splitMode === "custom_amounts" ? customLiveClaimsSumCents : (split?.totalCents ?? 0);
  const customLiveDeltaCents = split && split.splitMode === "custom_amounts" ? displayedTotalCents - customLiveClaimsSumCents : 0;
  const customLiveClaimsMatch = split?.splitMode === "custom_amounts" ? customLiveDeltaCents === 0 : false;

  const adminHeaders = useCallback((): QuickSplitRequestTokens => {
    if (!split) return {};
    const s = readQsSession(split.id);
    return { adminToken: s.adminToken || undefined };
  }, [split]);

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

  useEffect(() => {
    if (!split || split.splitMode !== "items" || split.flowStep !== "splitting") return;
    setItemsDraft(split.splitItems?.length ? split.splitItems.map((x) => ({ ...x })) : []);
  }, [split, split?.id, split?.flowStep, split?.splitMode, split?.splitItems]);

  useEffect(() => {
    if (!split || split.splitMode !== "custom_amounts" || split.flowStep !== "splitting") {
      customClaimsInitKey.current = null;
      return;
    }
    const key = `${split.id}:custom`;
    if (customClaimsInitKey.current === key) return;
    customClaimsInitKey.current = key;
    const next: Record<string, string> = {};
    for (const p of split.participants) {
      next[p.id] =
        p.claimedAmountCents != null && p.claimedAmountCents > 0
          ? (p.claimedAmountCents / 100).toFixed(2).replace(".", ",")
          : p.claimedAmountCents === 0
            ? "0"
            : "";
    }
    setClaimDraft(next);
  }, [split, split?.id, split?.flowStep, split?.splitMode]);

  useEffect(() => {
    if (!split) return;
    setSplitTotalDraft(centsToInput(displayedTotalCents));
  }, [split, split?.id, split?.totalCents, split?.splitMode, displayedTotalCents]);

  useEffect(() => {
    if (!split) return;
    setSplitCountDraft(split.targetParticipantCount);
  }, [split, split?.id, split?.targetParticipantCount]);

  useEffect(() => {
    if (!split || !isAdminSession || split.splitMode !== "custom_amounts") return;
    if (split.totalCents === customLiveClaimsSumCents) return;
    if (customTotalSyncTimerRef.current) clearTimeout(customTotalSyncTimerRef.current);
    customTotalSyncTimerRef.current = setTimeout(() => {
      void (async () => {
        try {
          const v = (await api.quicksplits.update(
            split.id,
            { totalCents: customLiveClaimsSumCents },
            adminHeaders(),
          )) as QuicksplitView;
          setSplit(v);
        } catch (e: unknown) {
          setErr(e instanceof Error ? e.message : "Chyba");
        }
      })();
    }, 300);
  }, [split, isAdminSession, customLiveClaimsSumCents, adminHeaders]);

  useEffect(() => {
    if (!split || split.splitMode !== "custom_amounts") return;
    const key = `qs:${split.id}:manual-remainder`;
    if (typeof window !== "undefined") {
      const raw = window.localStorage.getItem(key);
      if (raw) {
        try {
          setRemainderDraft(JSON.parse(raw) as Record<string, string>);
        } catch {
          setRemainderDraft({});
        }
      } else {
        setRemainderDraft({});
      }
    }
  }, [split, split?.id, split?.splitMode]);

  useEffect(() => {
    if (!split || split.splitMode !== "custom_amounts" || typeof window === "undefined") return;
    window.localStorage.setItem(`qs:${split.id}:manual-remainder`, JSON.stringify(remainderDraft));
  }, [split, split?.id, split?.splitMode, remainderDraft]);

  useEffect(() => {
    if (!split || !myParticipantId || typeof window === "undefined") {
      setPaymentStarted(false);
      return;
    }
    const raw = window.localStorage.getItem(`qs:${split.id}:payment-started:${myParticipantId}`);
    setPaymentStarted(raw === "1");
  }, [split, split?.id, myParticipantId]);

  useEffect(() => {
    if (!myParticipant || myParticipant.isPayer) {
      setShowPaymentSuccess(false);
      setShowStepThreeStatus(false);
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
      return;
    }
    if (myParticipant.markedPaidAt) {
      setShowStepThreeStatus(true);
      return;
    }
    setShowPaymentSuccess(false);
    setShowStepThreeStatus(false);
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
  }, [myParticipant]);

  const handleCreate = async () => {
    setErr(null);
    const cents = parseEuroToCents(createTotal) ?? -1;
    if (cents < 0) {
      setErr("Zadaj platnú celkovú sumu.");
      return;
    }
    setLoading(true);
    try {
      const created = (await api.quicksplits.create({
        totalCents: cents,
        targetParticipantCount: createCount,
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
      setCreateTotal("");
      setCreateCount(4);
      await loadSplit(created.splitId);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Chyba");
    } finally {
      setLoading(false);
    }
  };

  const proceedToSplitting = async () => {
    if (!split || !isAdminSession) return;
    setErr(null);
    try {
      const v = (await api.quicksplits.update(split.id, { flowStep: "splitting" }, adminHeaders())) as QuicksplitView;
      setSplit(v);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Chyba");
    }
  };

  const setSplitMode = async (mode: "equal" | "custom_amounts" | "items") => {
    if (!split || !isAdminSession) return;
    setErr(null);
    try {
      const v = (await api.quicksplits.update(split.id, { splitMode: mode }, adminHeaders())) as QuicksplitView;
      setSplit(v);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Chyba");
    }
  };

  const scheduleTotalSave = (raw: string) => {
    if (!split || !isAdminSession) return;
    if (totalTimerRef.current) clearTimeout(totalTimerRef.current);
    totalTimerRef.current = setTimeout(() => {
      void (async () => {
        const cents = parseEuroToCents(raw);
        if (cents === null || cents === split.totalCents) return;
        try {
          const v = (await api.quicksplits.update(split.id, { totalCents: cents }, adminHeaders())) as QuicksplitView;
          setSplit(v);
        } catch (e: unknown) {
          setErr(e instanceof Error ? e.message : "Chyba");
        }
      })();
    }, 350);
  };

  const setPayer = async (payerParticipantId: string) => {
    if (!split || !isAdminSession || payerParticipantId === split.payerParticipantId) return;
    try {
      const v = (await api.quicksplits.update(split.id, { payerParticipantId }, adminHeaders())) as QuicksplitView;
      setSplit(v);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Chyba");
    }
  };

  const scheduleTargetCountSave = (nextCount: number) => {
    if (!split || !isAdminSession || split.flowStep !== "waiting") return;
    if (targetCountTimerRef.current) clearTimeout(targetCountTimerRef.current);
    targetCountTimerRef.current = setTimeout(() => {
      void (async () => {
        if (!split) return;
        if (nextCount === split.targetParticipantCount) return;
        try {
          const v = (await api.quicksplits.update(
            split.id,
            { targetParticipantCount: nextCount },
            adminHeaders(),
          )) as QuicksplitView;
          setSplit(v);
        } catch (e: unknown) {
          setErr(e instanceof Error ? e.message : "Chyba");
        }
      })();
    }, 300);
  };

  const finalizeSplitting = async () => {
    if (!split || !isAdminSession) return;
    setErr(null);
    try {
      const v = (await api.quicksplits.update(split.id, { flowStep: "settlement" }, adminHeaders())) as QuicksplitView;
      setSplit(v);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Chyba");
    }
  };

  const toggleEqualExclude = async (participantId: string, excluded: boolean) => {
    if (!split || !isAdminSession) return;
    if (split.participants.length < 3 && excluded) return;
    const set = new Set(split.equalExcludedParticipantIds);
    if (excluded) set.add(participantId);
    else set.delete(participantId);
    const includedCount = split.participants.length - set.size;
    if (includedCount <= 0) return;
    setErr(null);
    try {
      const v = (await api.quicksplits.update(
        split.id,
        { equalExcludedParticipantIds: [...set] },
        adminHeaders(),
      )) as QuicksplitView;
      setSplit(v);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Chyba");
    }
  };

  const saveItems = async () => {
    if (!split || !isAdminSession) return;
    setErr(null);
    try {
      const v = (await api.quicksplits.update(
        split.id,
        {
          splitItems: itemsDraft.map((it) => ({
            id: it.id,
            name: it.name,
            amountCents: it.amountCents,
            consumerParticipantIds: it.consumerParticipantIds,
          })),
        },
        adminHeaders(),
      )) as QuicksplitView;
      setSplit(v);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Chyba");
    }
  };

  const distributeRemainder = async () => {
    if (!split || !isAdminSession) return;
    setErr(null);
    try {
      const v = (await api.quicksplits.update(
        split.id,
        { distributeRemainderEqually: true },
        adminHeaders(),
      )) as QuicksplitView;
      setSplit(v);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Chyba");
    }
  };

  const assignRemainderManually = async () => {
    if (!split || !isAdminSession) return;
    const assignments = split.participants
      .map((p) => ({
        participantId: p.id,
        adjustmentCents: parseEuroToCents(remainderDraft[p.id] ?? "") ?? 0,
      }))
      .filter((r) => r.adjustmentCents !== 0);
    setErr(null);
    try {
      const v = (await api.quicksplits.update(
        split.id,
        { remainderAssignments: assignments },
        adminHeaders(),
      )) as QuicksplitView;
      setSplit(v);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Chyba");
    }
  };

  const scheduleClaimSave = (participantId: string, raw: string) => {
    if (claimTimerRef.current) clearTimeout(claimTimerRef.current);
    claimTimerRef.current = setTimeout(() => {
      void (async () => {
        if (!split) return;
        const cents = parseEuroToCents(raw);
        if (cents === null || cents < 0) return;
        try {
          const v = (await api.quicksplits.updateParticipantClaim(
            split.id,
            participantId,
            { claimedAmountCents: cents },
            authHeadersForParticipant(),
          )) as QuicksplitView;
          setSplit(v);
        } catch (e: unknown) {
          setErr(e instanceof Error ? e.message : "Chyba");
        }
      })();
    }, 600);
  };

  const togglePaid = async (paid: boolean) => {
    if (!split || !myParticipantId) return;
    try {
      const updated = (await api.quicksplits.markParticipantPaid(
        split.id,
        myParticipantId,
        paid,
        authHeadersForParticipant(),
      )) as QuicksplitView;
      if (typeof window !== "undefined") {
        const key = `qs:${split.id}:payment-started:${myParticipantId}`;
        if (paid) window.localStorage.setItem(key, "1");
        else window.localStorage.removeItem(key);
      }
      setPaymentStarted(paid);
      if (paid) {
        setShowPaymentSuccess(true);
        setShowStepThreeStatus(false);
        if (successTimerRef.current) clearTimeout(successTimerRef.current);
        successTimerRef.current = setTimeout(() => {
          setShowPaymentSuccess(false);
          setShowStepThreeStatus(true);
        }, 5000);
      } else {
        if (successTimerRef.current) clearTimeout(successTimerRef.current);
        setShowPaymentSuccess(false);
        setShowStepThreeStatus(false);
      }
      setSplit(updated);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Chyba");
    }
  };

  const copyJoin = () => {
    if (joinUrl) void navigator.clipboard.writeText(joinUrl);
  };

  const stopScanner = useCallback(() => {
    if (scannerTimerRef.current) {
      clearTimeout(scannerTimerRef.current);
      scannerTimerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const handleQrPayload = useCallback((raw: string) => {
    try {
      const u = new URL(raw, typeof window !== "undefined" ? window.location.origin : "http://localhost");
      const splitId = u.searchParams.get("splitId");
      const joinToken = u.searchParams.get("joinToken");
      if (!splitId || !joinToken) {
        setScannerError("QR neobsahuje platné údaje pre pripojenie.");
        return;
      }
      stopScanner();
      setScannerOpen(false);
      if (typeof window !== "undefined") {
        window.location.href = `/join?splitId=${encodeURIComponent(splitId)}&joinToken=${encodeURIComponent(joinToken)}`;
      }
    } catch {
      setScannerError("Nepodarilo sa prečítať QR kód.");
    }
  }, [stopScanner]);

  useEffect(() => {
    if (!scannerOpen) {
      stopScanner();
      return;
    }
    let cancelled = false;
    const start = async () => {
      setScannerError(null);
      if (typeof window === "undefined" || !(window as Window & { BarcodeDetector?: typeof BarcodeDetector }).BarcodeDetector) {
        setScannerSupported(false);
        return;
      }
      setScannerSupported(true);
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        const detector = new BarcodeDetector({ formats: ["qr_code"] });
        const tick = async () => {
          if (cancelled || !scannerOpen || !videoRef.current) return;
          try {
            const out = await detector.detect(videoRef.current);
            if (out.length > 0 && out[0].rawValue) {
              handleQrPayload(out[0].rawValue);
              return;
            }
          } catch {
            /* ignore detect errors */
          }
          scannerTimerRef.current = setTimeout(() => void tick(), 350);
        };
        await tick();
      } catch {
        setScannerError("Nepodarilo sa otvoriť kameru. Skontroluj povolenie kamery.");
      }
    };
    void start();
    return () => {
      cancelled = true;
      stopScanner();
    };
  }, [scannerOpen, handleQrPayload, stopScanner]);

  const payMeUrl = useMemo(() => {
    if (!split || !myParticipant || myParticipant.isPayer || myParticipant.oweToPayerCents <= 0 || !split.payerIban) {
      return null;
    }
    return buildPayMeUrl({
      iban: split.payerIban,
      amountCents: myParticipant.oweToPayerCents,
      creditorName: split.payerDisplayName,
      message: `QuickSplit ${split.id.slice(0, 8)}`,
    });
  }, [split, myParticipant]);

  const openPayMe = () => {
    if (!payMeUrl || typeof window === "undefined") return;
    setPaymentStarted(true);
    if (split && myParticipantId) {
      window.localStorage.setItem(`qs:${split.id}:payment-started:${myParticipantId}`, "1");
    }
    window.location.href = payMeUrl;
  };

  const copyPaymentValue = async (value: string) => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
  };

  useEffect(
    () => () => {
      if (claimTimerRef.current) clearTimeout(claimTimerRef.current);
      if (totalTimerRef.current) clearTimeout(totalTimerRef.current);
      if (successTimerRef.current) clearTimeout(successTimerRef.current);
      if (customTotalSyncTimerRef.current) clearTimeout(customTotalSyncTimerRef.current);
      if (targetCountTimerRef.current) clearTimeout(targetCountTimerRef.current);
      stopScanner();
    },
    [stopScanner],
  );

  if (loading && !split) {
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
          {visibleErr && <p className="text-sm text-red-400">{visibleErr}</p>}
          <div className="rounded-2xl border border-foreground/15 bg-[#0e0e10] p-4 space-y-4">
            <h2 className="text-xl font-bold text-foreground">Nový QuickSplit</h2>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Celková suma účtu</label>
              <input
                value={createTotal}
                onChange={(e) => setCreateTotal(e.target.value)}
                placeholder="napr. 120,50"
                className="w-full h-14 px-4 rounded-xl bg-background border border-foreground/20 text-foreground"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-2">Počet ľudí (vrátane teba)</label>
              <div className="flex items-center justify-center gap-4">
                <Button
                  type="button"
                  variant="outline"
                  className="h-12 w-12 rounded-xl p-0 shrink-0"
                  disabled={createCount <= 2}
                  onClick={() => setCreateCount((c) => Math.max(2, c - 1))}
                >
                  <Minus className="w-5 h-5" />
                </Button>
                <span className="text-2xl font-bold text-foreground tabular-nums w-12 text-center">{createCount}</span>
                <Button
                  type="button"
                  variant="outline"
                  className="h-12 w-12 rounded-xl p-0 shrink-0"
                  disabled={createCount >= 10}
                  onClick={() => setCreateCount((c) => Math.min(10, c + 1))}
                >
                  <Plus className="w-5 h-5" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-2 text-center">Rozsah 2–10</p>
            </div>
            <Button className="w-full h-12 bg-primary" onClick={() => void handleCreate()}>
              Vytvoriť
            </Button>
          </div>
          <Button type="button" variant="outline" className="w-full h-12 rounded-xl gap-2" onClick={() => setScannerOpen(true)}>
            <Camera className="w-4 h-4" />
            Pripojiť sa (načítať QR)
          </Button>
          <Modal isOpen={scannerOpen} onClose={() => setScannerOpen(false)} title="Pripojiť sa cez QR">
            <div className="space-y-3">
              <div className="rounded-xl border border-foreground/20 overflow-hidden bg-black/40">
                <video ref={videoRef} className="w-full aspect-square object-cover" autoPlay muted playsInline />
              </div>
              {!scannerSupported && (
                <p className="text-xs text-amber-400">
                  Tvoj prehliadač nepodporuje priame QR skenovanie. Otvor join link ručne.
                </p>
              )}
              {scannerError && <p className="text-xs text-red-400">{scannerError}</p>}
              <p className="text-xs text-muted-foreground text-center">Nasmeruj kameru na QR kód pozvánky.</p>
            </div>
          </Modal>
        </div>
      </div>
    );
  }

  const n = split.participants.length;
  const target = split.targetParticipantCount;
  const waitingLeft = Math.max(0, target - n);
  const allJoined = n >= target;
  const isWaitingStep = split.flowStep === "waiting";
  const isSplittingStep = split.flowStep === "splitting";
  const canEditSplitting = isAdminSession && isSplittingStep;
  const canEditCreateSection = isAdminSession && isWaitingStep;
  const allNonPayersPaid =
    split.participants.filter((p) => !p.isPayer).length > 0 &&
    split.participants.filter((p) => !p.isPayer).every((p) => !!p.markedPaidAt);
  const closeSplit = async () => {
    if (isAdminSession) {
      try {
        const v = (await api.quicksplits.update(split.id, { flowStep: "closed" }, adminHeaders())) as QuicksplitView;
        setSplit(v);
        return;
      } catch (e: unknown) {
        setErr(e instanceof Error ? e.message : "Chyba");
        return;
      }
    }
    clearQsSession(split.id);
    setSplit(null);
    setErr(null);
  };

  return (
    <div className="min-h-screen bg-background w-full pb-28">
      <div className="max-w-screen-sm mx-auto px-4 py-6 space-y-6">
        <h1 className="text-xl font-bold text-foreground">QuickSplit</h1>
        {visibleErr && <p className="text-sm text-red-400">{visibleErr}</p>}

        <section className="space-y-3 rounded-2xl border border-foreground/15 bg-[#0e0e10] p-4 transition-all duration-300">
          <h2 className="text-base font-semibold text-foreground">Vytvorenie splitu</h2>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Celková suma</label>
            <input
              value={splitTotalDraft}
              onChange={(e) => {
                const v = e.target.value;
                setSplitTotalDraft(v);
                scheduleTotalSave(v);
              }}
              disabled={!canEditCreateSection}
              className="w-full h-12 px-3 rounded-xl bg-background border border-foreground/20 text-foreground disabled:opacity-70"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Počet ľudí</label>
            <div className="flex items-center justify-center gap-4">
              <Button
                type="button"
                variant="outline"
                className="h-11 w-11 rounded-xl p-0 shrink-0"
                disabled={!canEditCreateSection || splitCountDraft <= Math.max(2, split.participants.length)}
                onClick={() => {
                  const next = Math.max(Math.max(2, split.participants.length), splitCountDraft - 1);
                  setSplitCountDraft(next);
                  scheduleTargetCountSave(next);
                }}
              >
                <Minus className="w-4 h-4" />
              </Button>
              <span className="text-2xl font-bold text-foreground tabular-nums w-12 text-center">{splitCountDraft}</span>
              <Button
                type="button"
                variant="outline"
                className="h-11 w-11 rounded-xl p-0 shrink-0"
                disabled={!canEditCreateSection || splitCountDraft >= 10}
                onClick={() => {
                  const next = Math.min(10, splitCountDraft + 1);
                  setSplitCountDraft(next);
                  scheduleTargetCountSave(next);
                }}
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>
            {!canEditCreateSection && (
              <p className="text-xs text-muted-foreground text-center mt-2">Po pokračovaní je táto sekcia už len na čítanie.</p>
            )}
          </div>
        </section>

        <section className="space-y-4 rounded-2xl border border-foreground/15 bg-[#0e0e10] p-4 transition-all duration-300">
          <h2 className="text-base font-semibold text-foreground">Čakanie na členov</h2>
          <p className="text-sm text-muted-foreground">
            Zatiaľ <span className="text-foreground font-semibold">{n}</span> z{" "}
            <span className="text-foreground font-semibold">{target}</span> ľudí.
            {waitingLeft > 0 ? (
              <>
                {" "}
                Čaká sa ešte na <span className="text-primary font-semibold">{waitingLeft}</span>{" "}
                {waitingLeft === 1 ? "používateľa" : "používateľov"}…
              </>
            ) : (
              <span className="text-emerald-500 font-medium"> Všetci sú pripojení.</span>
            )}
          </p>

          {isAdminSession && allJoined && isWaitingStep && (
            <div className="rounded-2xl border border-primary/30 bg-primary/10 p-4 shadow-[0_0_0_1px_rgba(139,92,246,0.08)]">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">Všetci členovia sú pripravení</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Split môžeš hneď posunúť do ďalšieho kroku a vybrať spôsob delenia.
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-medium text-emerald-400">
                  Ready
                </span>
              </div>
              <Button
                type="button"
                className="w-full h-14 mt-4 rounded-2xl bg-primary text-primary-foreground text-base font-semibold shadow-lg shadow-primary/20"
                onClick={() => void proceedToSplitting()}
              >
                Pokračovať
              </Button>
            </div>
          )}

          <div className="rounded-2xl border border-foreground/15 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Users className="w-4 h-4" />
              Pripojení členovia
            </h3>
            <ul className="space-y-2">
              {Array.from({ length: target }).map((_, idx) => {
                const p = split.participants[idx];
                if (p) {
                  return (
                    <li key={p.id} className="text-sm text-foreground flex items-center gap-2">
                      <span className="text-emerald-500">✅</span>
                      <span>
                        {p.displayName}
                        {p.id === myParticipantId ? " (ty)" : ""}
                      </span>
                      <span className="text-muted-foreground text-xs">sa pripojil/a</span>
                    </li>
                  );
                }
                return (
                  <li key={`empty_${idx}`} className="text-sm text-muted-foreground flex items-center gap-2">
                    <span>⬜</span>
                    <span>Čaká sa...</span>
                  </li>
                );
              })}
            </ul>
          </div>

          {isWaitingStep && (
            <div className="rounded-2xl border border-foreground/15 p-4 flex flex-col items-center gap-3">
              <p className="text-xs text-muted-foreground text-center">Naskenuj QR alebo pošli odkaz</p>
              {qrDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qrDataUrl} alt="QR kód" className="rounded-xl border border-foreground/20" width={220} height={220} />
              ) : (
                <p className="text-sm text-muted-foreground">Generujem QR…</p>
              )}
              <Button type="button" className="w-full h-11 bg-primary gap-2" onClick={copyJoin}>
                <Copy className="w-4 h-4" />
                Kopírovať odkaz
              </Button>
            </div>
          )}

          {isAdminSession && !allJoined && isWaitingStep && (
              <div className="space-y-2">
                <Button
                  type="button"
                  className="w-full h-12 bg-primary text-primary-foreground"
                  onClick={() => void proceedToSplitting()}
                >
                  Pokračovať{!allJoined ? " (aj skôr)" : ""}
                </Button>
                {!allJoined && (
                  <p className="text-xs text-center text-muted-foreground">
                    Môžeš pokračovať aj keď ešte nie sú všetci — ďalší sa už nebudú môcť pripojiť.
                  </p>
                )}
              </div>
            )}
        </section>

        {split.flowStep !== "waiting" && split.flowStep !== "closed" && (
          <section className="space-y-5">
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground block">Celková suma (EUR)</label>
              <input
                value={splitTotalDraft}
                onChange={(e) => {
                  const v = e.target.value;
                  setSplitTotalDraft(v);
                  if (split.splitMode !== "custom_amounts") {
                    scheduleTotalSave(v);
                  }
                }}
                disabled={!canEditSplitting || split.splitMode === "custom_amounts"}
                placeholder="napr. 120,50"
                className="w-full h-12 px-3 rounded-xl bg-background border border-foreground/20 text-foreground disabled:opacity-60"
              />
              {split.splitMode === "custom_amounts" && (
                <p className="text-xs text-muted-foreground">V tomto režime sa celková suma počíta automaticky zo zadaných súm.</p>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground block">Kto platil</label>
              <select
                value={split.payerParticipantId}
                disabled={!canEditSplitting}
                onChange={(e) => void setPayer(e.target.value)}
                className="w-full h-12 px-3 rounded-xl bg-background border border-foreground/20 text-foreground disabled:opacity-60"
              >
                {split.participants.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName}
                    {p.id === myParticipantId ? " (ty)" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Spôsob delenia</p>
              <div className="grid grid-cols-3 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className={
                    split.splitMode === "equal"
                      ? "h-11 rounded-xl text-xs border-primary bg-primary text-primary-foreground hover:bg-primary/90"
                      : "h-11 rounded-xl text-xs border-foreground/20 bg-transparent text-foreground hover:bg-muted"
                  }
                  disabled={!canEditSplitting}
                  onClick={() => void setSplitMode("equal")}
                >
                  Rovnako
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className={
                    split.splitMode === "custom_amounts"
                      ? "h-11 rounded-xl text-xs border-primary bg-primary text-primary-foreground hover:bg-primary/90"
                      : "h-11 rounded-xl text-xs border-foreground/20 bg-transparent text-foreground hover:bg-muted"
                  }
                  disabled={!canEditSplitting}
                  onClick={() => void setSplitMode("custom_amounts")}
                >
                  Každý svoju sumu
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className={
                    split.splitMode === "items"
                      ? "h-11 rounded-xl text-xs border-primary bg-primary text-primary-foreground hover:bg-primary/90"
                      : "h-11 rounded-xl text-xs border-foreground/20 bg-transparent text-foreground hover:bg-muted"
                  }
                  disabled={!canEditSplitting}
                  onClick={() => void setSplitMode("items")}
                >
                  Položky
                </Button>
              </div>
            </div>

            {split.splitMode === "equal" && (
              <div className="space-y-3">
                <h2 className="text-base font-semibold text-foreground">Rovnako</h2>
                {split.participants.length >= 3 && (
                  <p className="text-xs text-muted-foreground">Vypni tých, čo neplatia alebo nič nemali.</p>
                )}
                <div className="rounded-2xl border border-foreground/10 divide-y divide-foreground/10">
                  {split.participants.map((p) => {
                    const excluded = split.equalExcludedParticipantIds.includes(p.id);
                    const includedCount = split.participants.length - split.equalExcludedParticipantIds.length;
                    const canToggleExclude = excluded || (split.participants.length >= 3 && includedCount > 1);
                    return (
                      <div key={p.id} className="flex items-center justify-between px-4 py-3 gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{p.displayName}</p>
                          <p className="text-xs text-muted-foreground">Podiel: {formatEur(p.shareCents)}</p>
                        </div>
                        {canEditSplitting && split.participants.length >= 3 ? (
                          <label className="flex items-center gap-2 shrink-0 text-xs text-foreground cursor-pointer">
                            <input
                              type="checkbox"
                              checked={excluded}
                              disabled={!canToggleExclude}
                              onChange={(e) => {
                                if (!canToggleExclude) return;
                                void toggleEqualExclude(p.id, e.target.checked);
                              }}
                              className="rounded border-foreground/30"
                            />
                            {excluded ? "Vylúčený" : "Zahrnúť"}
                          </label>
                        ) : split.participants.length >= 3 ? (
                          <span className="text-xs text-muted-foreground">{excluded ? "Vylúčený" : ""}</span>
                        ) : null
                        }
                      </div>
                    );
                  })}
                </div>
                {canEditSplitting && (
                  <Button type="button" className="w-full h-12 bg-emerald-600 text-white" onClick={() => void finalizeSplitting()}>
                    Hotovo
                  </Button>
                )}
              </div>
            )}

            {split.splitMode === "custom_amounts" && (
              <div className="space-y-3">
                <h2 className="text-base font-semibold text-foreground">Každý svoju sumu</h2>
                <p className="text-sm">
                  Zadané <span className="font-bold text-primary">{formatEur(customLiveClaimsSumCents)}</span> z celkových{" "}
                  <span className="font-bold">{formatEur(displayedTotalCents)}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  Stav: {split.participants.filter((p) => p.claimedAmountCents != null).length}/{split.participants.length} členov zadalo sumu
                </p>
                {customLiveDeltaCents < 0 && (
                  <p className="text-sm text-red-400">
                    Nad limit o <span className="font-bold">{formatEur(Math.abs(customLiveDeltaCents))}</span>
                  </p>
                )}
                {customLiveDeltaCents > 0 && (
                  <p className="text-sm text-amber-400">
                    Zostatok <span className="font-bold">{formatEur(customLiveDeltaCents)}</span> nerozdelený
                  </p>
                )}
                {customLiveClaimsMatch && (
                  <p className="text-sm text-emerald-400">Súčet sedí ✅</p>
                )}
                <div className="rounded-2xl border border-foreground/10 divide-y divide-foreground/10">
                  {split.participants.map((p) => {
                    const isMe = p.id === myParticipantId;
                    const liveClaimCents = liveClaimCentsByParticipant.get(p.id) ?? 0;
                    return (
                      <div key={p.id} className="px-4 py-3 space-y-1">
                        <p className="text-sm font-medium text-foreground">{p.displayName}{isMe ? " (ty)" : ""}</p>
                        {isMe && isSplittingStep ? (
                          <input
                            value={claimDraft[p.id] ?? ""}
                            onChange={(e) => {
                              const v = e.target.value;
                              setClaimDraft((prev) => ({ ...prev, [p.id]: v }));
                              scheduleClaimSave(p.id, v);
                            }}
                            placeholder="0,00"
                            className="w-full h-11 px-3 rounded-xl bg-background border border-foreground/20 text-foreground"
                          />
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            {p.claimedAmountCents != null ? `Zadané: ${formatEur(p.claimedAmountCents)}` : "Nezadané"}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground">Výsledný podiel: {formatEur(liveClaimCents)}</p>
                      </div>
                    );
                  })}
                </div>
                {canEditSplitting && split.customRemainderCents > 0 && (
                  <div className="space-y-2 rounded-xl border border-foreground/10 p-3">
                    <p className="text-xs text-muted-foreground">Manuálne priradenie zostatku (v EUR)</p>
                    <div className="space-y-2">
                      {split.participants.map((p) => (
                        <div key={p.id} className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground w-28 truncate">{p.displayName}</span>
                          <input
                            value={remainderDraft[p.id] ?? ""}
                            onChange={(e) => setRemainderDraft((prev) => ({ ...prev, [p.id]: e.target.value }))}
                            placeholder="0,00"
                            className="flex-1 h-10 px-3 rounded-xl bg-background border border-foreground/20 text-foreground text-sm"
                          />
                        </div>
                      ))}
                    </div>
                    <Button type="button" variant="outline" className="w-full h-10" onClick={() => void assignRemainderManually()}>
                      Priradiť manuálne
                    </Button>
                    <Button type="button" variant="outline" className="w-full h-10" onClick={() => void distributeRemainder()}>
                      Rozdeliť zostatok rovnomerne
                    </Button>
                  </div>
                )}
                {canEditSplitting && (
                  <Button
                    type="button"
                    disabled={!customLiveClaimsMatch}
                    className="w-full h-12 bg-emerald-600 text-white"
                    onClick={() => void finalizeSplitting()}
                  >
                    Hotovo
                  </Button>
                )}
              </div>
            )}

            {split.splitMode === "items" && (
              <div className="space-y-3">
                <h2 className="text-base font-semibold text-foreground">Položky</h2>
                <p className="text-sm text-muted-foreground">
                  Súčet položiek:{" "}
                  <span className="font-semibold text-primary">
                    {formatEur((split.splitItems || []).reduce((s, it) => s + (it.amountCents || 0), 0))}
                  </span>
                </p>
                {!isAdminSession && (
                  <div className="rounded-2xl border border-foreground/10 divide-y divide-foreground/10">
                    {(split.splitItems || []).length === 0 ? (
                      <p className="p-4 text-sm text-muted-foreground">Zatiaľ žiadne položky.</p>
                    ) : (
                      (split.splitItems || []).map((it) => (
                        <div key={it.id} className="px-4 py-3 space-y-1">
                          <div className="flex justify-between text-sm">
                            <span className="font-medium text-foreground">{it.name}</span>
                            <span className="text-primary font-semibold">{formatEur(it.amountCents)}</span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {it.consumerParticipantIds
                              .map((id) => split.participants.find((x) => x.id === id)?.displayName || "?")
                              .join(", ")}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                )}
                {canEditSplitting ? (
                  <>
                    <div className="flex gap-2">
                      <input
                        value={newItemName}
                        onChange={(e) => setNewItemName(e.target.value)}
                        placeholder="Názov položky"
                        className="flex-1 h-11 px-3 rounded-xl bg-background border border-foreground/20 text-foreground text-sm"
                      />
                      <input
                        value={newItemAmount}
                        onChange={(e) => setNewItemAmount(e.target.value)}
                        placeholder="Suma"
                        className="w-24 h-11 px-2 rounded-xl bg-background border border-foreground/20 text-foreground text-sm"
                      />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full h-10"
                      onClick={() => {
                        const cents = parseEuroToCents(newItemAmount);
                        if (!newItemName.trim() || cents === null || cents <= 0) return;
                        const id = crypto.randomUUID?.() ?? `it_${Date.now()}`;
                        setItemsDraft((prev) => [
                          ...prev,
                          { id, name: newItemName.trim(), amountCents: cents, consumerParticipantIds: [] },
                        ]);
                        setNewItemName("");
                        setNewItemAmount("");
                      }}
                    >
                      Pridať položku
                    </Button>
                    <div className="space-y-4">
                      {itemsDraft.map((it, idx) => (
                        <div key={it.id} className="rounded-xl border border-foreground/15 p-3 space-y-2">
                          <div className="flex justify-between gap-2">
                            <span className="text-sm font-medium text-foreground">{it.name}</span>
                            <span className="text-sm text-primary font-semibold">{formatEur(it.amountCents)}</span>
                          </div>
                          <p className="text-xs text-muted-foreground">Konzumenti</p>
                          <div className="flex flex-wrap gap-2">
                            {split.participants.map((p) => {
                              const on = it.consumerParticipantIds.includes(p.id);
                              return (
                                <label key={p.id} className="flex items-center gap-1 text-xs text-foreground cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={on}
                                    onChange={(e) => {
                                      const next = e.target.checked
                                        ? [...it.consumerParticipantIds, p.id]
                                        : it.consumerParticipantIds.filter((x) => x !== p.id);
                                      setItemsDraft((prev) =>
                                        prev.map((row, i) => (i === idx ? { ...row, consumerParticipantIds: next } : row)),
                                      );
                                    }}
                                    className="rounded border-foreground/30"
                                  />
                                  {p.displayName}
                                </label>
                              );
                            })}
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-red-400 h-8"
                            onClick={() => setItemsDraft((prev) => prev.filter((_, i) => i !== idx))}
                          >
                            Odstrániť položku
                          </Button>
                        </div>
                      ))}
                    </div>
                    <Button type="button" className="w-full h-11 bg-primary" onClick={() => void saveItems()}>
                      Uložiť položky
                    </Button>
                    <Button type="button" className="w-full h-12 bg-emerald-600 text-white" onClick={() => void finalizeSplitting()}>
                      Hotovo
                    </Button>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Admin pripravuje položky…</p>
                )}
                <div className="rounded-2xl border border-foreground/10 divide-y divide-foreground/10">
                  {split.participants.map((p) => (
                    <div key={p.id} className="px-4 py-2 flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{p.displayName}</span>
                      <span className="font-semibold text-foreground">{formatEur(p.shareCents)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {split.flowStep === "settlement" && (
          <section className="space-y-6">
            {myParticipant && !myParticipant.isPayer && myParticipant.oweToPayerCents > 0 && !showPaymentSuccess && !showStepThreeStatus && (
              <div className="rounded-2xl border border-primary/30 bg-primary/5 p-6 space-y-4 text-center">
                <p className="text-sm text-muted-foreground">Dlžíš</p>
                <p className="text-4xl font-extrabold text-primary tabular-nums">{formatEur(myParticipant.oweToPayerCents)}</p>
                <p className="text-lg text-foreground">
                  komu: <span className="font-bold">{split.payerDisplayName}</span>
                </p>
                <Button
                  type="button"
                  disabled={!payMeUrl}
                  className="w-full h-14 bg-primary text-primary-foreground"
                  onClick={openPayMe}
                >
                  Zaplatiť
                </Button>
                {payMeUrl ? (
                  <div className="space-y-3 text-left rounded-xl border border-foreground/10 bg-background/40 p-3">
                    <p className="text-xs text-muted-foreground text-center">
                      Ak sa banka neotvorí, použi údaje nižšie alebo otvor{" "}
                      <button type="button" onClick={openPayMe} className="text-primary underline underline-offset-2">
                        platbu cez banku
                      </button>
                      .
                    </p>
                    <div className="space-y-2">
                      <div className="rounded-xl border border-foreground/10 px-3 py-2">
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">IBAN</p>
                        <div className="mt-1 flex items-center justify-between gap-2">
                          <span className="text-sm font-medium text-foreground break-all">{split.payerIban}</span>
                          <button
                            type="button"
                            onClick={() => void copyPaymentValue(split.payerIban || "")}
                            className="shrink-0 text-xs text-primary underline underline-offset-2"
                          >
                            Kopírovať
                          </button>
                        </div>
                      </div>
                      <div className="rounded-xl border border-foreground/10 px-3 py-2">
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Suma</p>
                        <div className="mt-1 flex items-center justify-between gap-2">
                          <span className="text-sm font-medium text-foreground">{formatEur(myParticipant.oweToPayerCents)}</span>
                          <button
                            type="button"
                            onClick={() => void copyPaymentValue((myParticipant.oweToPayerCents / 100).toFixed(2))}
                            className="shrink-0 text-xs text-primary underline underline-offset-2"
                          >
                            Kopírovať
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Platiteľ si ešte musí doplniť IBAN, aby bolo možné otvoriť platbu.
                  </p>
                )}
                {!myParticipant.markedPaidAt ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!paymentStarted}
                    className="w-full h-11 border-foreground/20 bg-muted text-muted-foreground disabled:opacity-100 disabled:cursor-not-allowed"
                    onClick={() => void togglePaid(true)}
                  >
                    Označiť ako zaplatené
                  </Button>
                ) : (
                  <Button type="button" variant="outline" className="w-full h-12" onClick={() => void togglePaid(false)}>
                    Zrušiť označenie zaplatené
                  </Button>
                )}
              </div>
            )}

            {showPaymentSuccess && myParticipant && !myParticipant.isPayer && (
              <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-8 text-center space-y-4">
                <div className="relative mx-auto h-24 w-24">
                  <div className="absolute inset-0 rounded-full bg-emerald-500/20 animate-ping" />
                  <div className="absolute inset-2 rounded-full bg-emerald-500/20" />
                  <div className="absolute inset-4 flex items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg">
                    <Check className="h-10 w-10" />
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-2xl font-bold text-foreground">Platba potvrdená!</p>
                  <p className="text-sm text-muted-foreground">{split.payerDisplayName} bola upozornená</p>
                </div>
              </div>
            )}

            {showStepThreeStatus && myParticipant && !myParticipant.isPayer && (
              <div className="space-y-3">
                <h2 className="text-base font-semibold text-foreground">Krok 3: Spôsob delenia</h2>
                <p className="text-sm text-muted-foreground">Stav platieb v splite</p>
                <div className="rounded-2xl border border-foreground/15 bg-[#0e0e10] p-4 space-y-2">
                  {split.participants
                    .filter((p) => !p.isPayer)
                    .map((p) => {
                      const paid = !!p.markedPaidAt;
                      return (
                        <div key={p.id} className="flex items-center justify-between text-sm gap-2">
                          <span className="text-foreground truncate">{p.displayName}</span>
                          <span className={paid ? "text-emerald-400 font-medium shrink-0" : "text-muted-foreground shrink-0"}>
                            {paid ? "Zaplatené ✅" : "Čaká sa…"}
                          </span>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            {myParticipant?.isPayer && (
              <p className="text-sm text-muted-foreground text-center px-2">
                Si platiteľom účtu. Ostatní ti pošlú svoj podiel.
              </p>
            )}

            {myParticipant && !myParticipant.isPayer && myParticipant.oweToPayerCents <= 0 && (
              <p className="text-sm text-center text-muted-foreground">Nič nedlžíš.</p>
            )}

            {!allNonPayersPaid && isAdminSession && (
              <div className="rounded-2xl border border-foreground/15 bg-[#0e0e10] p-4 space-y-2">
                <h2 className="text-sm font-semibold text-foreground mb-2">Prehľad platieb (live)</h2>
                <ul className="space-y-2">
                  {split.participants
                    .filter((p) => !p.isPayer)
                    .map((p) => {
                      const paid = !!p.markedPaidAt;
                      return (
                        <li key={p.id} className="flex items-center justify-between text-sm gap-2">
                          <span className="text-foreground truncate">
                            {paid ? "✅" : "⏳"} {p.displayName}
                          </span>
                          <span className="text-muted-foreground shrink-0">
                            {paid ? `zaplatené ${formatEur(p.oweToPayerCents)}` : "čaká sa…"}
                          </span>
                        </li>
                      );
                    })}
                </ul>
              </div>
            )}

            {allNonPayersPaid && (
              <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-8 text-center space-y-5">
                <div className="relative mx-auto h-24 w-24">
                  <div className="absolute inset-0 rounded-full bg-emerald-500/20 animate-ping" />
                  <div className="absolute inset-2 rounded-full bg-emerald-500/20" />
                  <div className="absolute inset-4 flex items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg">
                    <Check className="h-10 w-10" />
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-2xl font-bold text-foreground">Všetci zaplatili! 🎉</p>
                  <p className="text-sm text-muted-foreground">Split je uzavretý.</p>
                </div>
                <Button type="button" className="w-full h-14 bg-primary text-primary-foreground" onClick={() => void closeSplit()}>
                  Zavrieť split
                </Button>
              </div>
            )}

          </section>
        )}

        {isAdminSession && !allNonPayersPaid && (
          <div className="mt-12 pt-6 border-t border-foreground/10">
            <Button
              type="button"
              variant="ghost"
              className="w-full h-9 rounded-xl text-xs text-primary bg-transparent hover:bg-background"
              onClick={() => void closeSplit()}
            >
              Ukončiť split
            </Button>
          </div>
        )}

      </div>
    </div>
  );
}
