"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera, Check, ChevronDown, Copy, Minus, Plus, Users } from "lucide-react";
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

type BarcodeDetectorResult = {
  rawValue?: string;
};

type BarcodeDetectorLike = {
  detect: (source: HTMLVideoElement) => Promise<BarcodeDetectorResult[]>;
};

type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

function formatEur(cents: number) {
  return (cents / 100).toFixed(2).replace(".", ",") + " €";
}

function formatTime(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

function formatActivity(a: ActivityView): string {
  const name = a.actorDisplayName || "Someone";
  switch (a.type) {
    case "split_created":
      return `Split created (${formatEur((a.meta.totalCents as number) || 0)})`;
    case "participant_joined":
      return `${name} joined`;
    case "amount_updated":
      return `Amount changed to ${formatEur((a.meta.newCents as number) || 0)}`;
    case "payer_changed":
      return `Payer: ${String(a.meta.previousPayerName || "?")} -> ${String(a.meta.newPayerName || "?")}`;
    case "payment_details_updated":
      return a.meta.isPayer ? `${name} updated payer IBAN` : `${name} updated payment details`;
    case "marked_paid":
      return `${name} marked payment as paid`;
    case "marked_unpaid":
      return `${name} unmarked payment`;
    case "flow_step_changed":
      return `Step: ${String(a.meta.from)} -> ${String(a.meta.to)}`;
    case "split_mode_changed":
      return `Split mode: ${String(a.meta.mode)}`;
    case "split_items_updated":
      return "Items were updated";
    case "participant_claim_updated":
      return `${name} updated their amount`;
    case "remainder_distributed":
      return `Remainder distributed (${formatEur((a.meta.remainderCents as number) || 0)})`;
    case "splitting_finalized":
      return "Split finalized";
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

function sanitizeMoneyInput(raw: string): string {
  const cleaned = raw.replace(/[^\d.,]/g, "").replace(/\./g, ",");
  const [whole = "", ...rest] = cleaned.split(",");
  if (rest.length === 0) return whole;
  const decimals = rest.join("").replace(/[^\d]/g, "").slice(0, 2);
  return `${whole},${decimals}`;
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
  const [percentDraft, setPercentDraft] = useState<Record<string, string>>({});
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
  const [customSplitEntryMode, setCustomSplitEntryMode] = useState<"amount" | "percent">("amount");
  const totalTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const customTotalSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const targetCountTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerError, setScannerError] = useState<string | null>(null);
  const [scannerSupported, setScannerSupported] = useState(true);
  const [isPayerSheetOpen, setIsPayerSheetOpen] = useState(false);
  const [payerSheetDragOffset, setPayerSheetDragOffset] = useState(0);
  const [isPayerSheetDragging, setIsPayerSheetDragging] = useState(false);
  const payerSheetDragStartYRef = useRef<number | null>(null);
  const [isSplitModeSheetOpen, setIsSplitModeSheetOpen] = useState(false);
  const [splitModeSheetDragOffset, setSplitModeSheetDragOffset] = useState(0);
  const [isSplitModeSheetDragging, setIsSplitModeSheetDragging] = useState(false);
  const splitModeSheetDragStartYRef = useRef<number | null>(null);
  const [payerIbanDraft, setPayerIbanDraft] = useState("");
  const [payerNameDraft, setPayerNameDraft] = useState("");
  const [payerMetaSaveState, setPayerMetaSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const payerMetaSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const visibleErr =
    err && err.toLowerCase().includes("invalid flow step change")
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
    const existingSession = readQsSession(id);
    if (!existingSession.joinToken && !existingSession.adminToken) {
      if (typeof sessionStorage !== "undefined") {
        sessionStorage.removeItem(QS_ACTIVE_ID);
      }
      setSplit(null);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      await loadSplit(id);
    } catch (e: unknown) {
      setSplit(null);
      setErr(e instanceof Error ? e.message : "Loading error");
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

  /** Fallback polling in settlement step if SSE drops. */
  useEffect(() => {
    if (!split?.id || split.flowStep !== "settlement") return;
    const s = readQsSession(split.id);
    if (!s.adminToken) return;
    const interval = setInterval(() => {
      void loadSplit(split.id).catch(() => {
        /* stay silent to avoid UI noise on brief outages */
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
    setErr("Split was closed by the admin.");
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

  const displayedTotalCents = split?.totalCents ?? 0;
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
    if (!split || split.splitMode !== "custom_amounts" || customSplitEntryMode !== "percent") return;
    const next: Record<string, string> = {};
    for (const p of split.participants) {
      const cents = liveClaimCentsByParticipant.get(p.id) ?? 0;
      const pct = displayedTotalCents > 0 ? (cents / displayedTotalCents) * 100 : 0;
      next[p.id] = pct > 0 ? pct.toFixed(2).replace(".", ",") : "";
    }
    setPercentDraft(next);
  }, [split, split?.id, split?.splitMode, customSplitEntryMode, displayedTotalCents, liveClaimCentsByParticipant]);

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
      setErr("Enter a valid total amount.");
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
      setErr(e instanceof Error ? e.message : "Error");
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
      setErr(e instanceof Error ? e.message : "Error");
    }
  };

  const setSplitMode = async (mode: "equal" | "custom_amounts" | "items") => {
    if (!split || !isAdminSession) return;
    setErr(null);
    try {
      const v = (await api.quicksplits.update(split.id, { splitMode: mode }, adminHeaders())) as QuicksplitView;
      setSplit(v);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Error");
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
          setErr(e instanceof Error ? e.message : "Error");
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
      setErr(e instanceof Error ? e.message : "Error");
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
          setErr(e instanceof Error ? e.message : "Error");
        }
      })();
    }, 300);
  };

  const finalizeSplitting = async () => {
    if (!split || !isAdminSession) return;
    const selectedPayer =
      split.participants.find((p) => p.id === split.payerParticipantId) || null;
    const fallbackIban = split.payerIban?.trim() || "";
    const selectedPayerIban = selectedPayer?.iban?.trim() || "";
    const hasPayerIban = Boolean(selectedPayerIban || fallbackIban);
    if (!hasPayerIban) {
      setErr("The selected payer must have IBAN filled before continuing.");
      return;
    }
    setErr(null);
    try {
      const v = (await api.quicksplits.update(split.id, { flowStep: "settlement" }, adminHeaders())) as QuicksplitView;
      setSplit(v);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Error");
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
      setErr(e instanceof Error ? e.message : "Error");
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
      setErr(e instanceof Error ? e.message : "Error");
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
      setErr(e instanceof Error ? e.message : "Error");
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
      setErr(e instanceof Error ? e.message : "Error");
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
          setErr(e instanceof Error ? e.message : "Error");
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
      setErr(e instanceof Error ? e.message : "Error");
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
        setScannerError("QR code does not contain valid join data.");
        return;
      }
      stopScanner();
      setScannerOpen(false);
      if (typeof window !== "undefined") {
        window.location.href = `/join?splitId=${encodeURIComponent(splitId)}&joinToken=${encodeURIComponent(joinToken)}`;
      }
    } catch {
      setScannerError("Failed to read QR code.");
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
      const detectorCtor =
        typeof window === "undefined"
          ? undefined
          : (window as Window & { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
      if (!detectorCtor) {
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
        const detector = new detectorCtor({ formats: ["qr_code"] });
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
        setScannerError("Failed to open camera. Check camera permissions.");
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
      if (payerMetaSaveTimerRef.current) clearTimeout(payerMetaSaveTimerRef.current);
      stopScanner();
    },
    [stopScanner],
  );

  useEffect(() => {
    if (!isPayerSheetOpen && !isSplitModeSheetOpen) return;
    const previousOverflow = document.body.style.overflow;
    const previousTouchAction = document.body.style.touchAction;
    document.body.style.overflow = "hidden";
    document.body.style.touchAction = "none";
    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.touchAction = previousTouchAction;
    };
  }, [isPayerSheetOpen, isSplitModeSheetOpen]);

  useEffect(() => {
    if (!split) {
      setPayerIbanDraft("");
      setPayerNameDraft("");
      return;
    }
    const payer = split.participants.find((p) => p.id === split.payerParticipantId) || null;
    setPayerIbanDraft((payer?.iban || "").trim());
    setPayerNameDraft((payer?.displayName || "").trim());
  }, [split]);

  const selectedPayer =
    split?.participants.find((p) => p.id === split.payerParticipantId) || null;
  const selectedPayerName = selectedPayer?.displayName || "Select payer";
  const selectedPayerLocalIban = selectedPayer?.iban?.trim() || "";
  const selectedPayerResolvedIban = split?.payerIban?.trim() || selectedPayerLocalIban;
  const selectedPayerHasIban = Boolean(selectedPayerResolvedIban);
  const selectedPayerIsGuest = Boolean(selectedPayer && !selectedPayer.userUid);
  const canEditSelectedPayerIban = Boolean(
    selectedPayer && myParticipantId && selectedPayer.id === myParticipantId,
  );
  const normalizedPayerIbanDraft = payerIbanDraft.replace(/\s/g, "").toUpperCase();
  const payerIbanLooksValid =
    normalizedPayerIbanDraft.length === 0 || normalizedPayerIbanDraft.length >= 15;

  useEffect(() => {
    if (!split || !selectedPayer || !selectedPayerIsGuest || !canEditSelectedPayerIban) return;
    if (payerMetaSaveTimerRef.current) {
      clearTimeout(payerMetaSaveTimerRef.current);
    }
    if (!payerIbanLooksValid) {
      setPayerMetaSaveState("error");
      return;
    }
    const currentIban = (selectedPayer.iban || "").replace(/\s/g, "").toUpperCase();
    const currentName = (selectedPayer.displayName || "").trim();
    const nextName = payerNameDraft.trim();
    const ibanChanged = normalizedPayerIbanDraft !== currentIban;
    const nameChanged = nextName.length > 0 && nextName !== currentName;
    if (!ibanChanged && !nameChanged) {
      setPayerMetaSaveState("idle");
      return;
    }
    payerMetaSaveTimerRef.current = setTimeout(() => {
      void (async () => {
        try {
          setPayerMetaSaveState("saving");
          await api.quicksplits.updateParticipantPayment(
            split.id,
            selectedPayer.id,
            {
              iban: normalizedPayerIbanDraft || null,
              displayName: nextName || undefined,
            },
            authHeadersForParticipant(),
          );
          setPayerMetaSaveState("saved");
          await loadSplit(split.id);
        } catch (e: unknown) {
          setPayerMetaSaveState("error");
          setErr(e instanceof Error ? e.message : "Failed to save payer details.");
        }
      })();
    }, 500);
    return () => {
      if (payerMetaSaveTimerRef.current) {
        clearTimeout(payerMetaSaveTimerRef.current);
      }
    };
  }, [
    split,
    selectedPayer,
    selectedPayerIsGuest,
    canEditSelectedPayerIban,
    payerIbanLooksValid,
    normalizedPayerIbanDraft,
    payerNameDraft,
    authHeadersForParticipant,
    loadSplit,
  ]);

  if (loading && !split) {
    return (
      <div className="min-h-screen bg-background w-full flex items-center justify-center">
        <p className="text-muted-foreground">Loading QuickSplit...</p>
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
            <h2 className="text-xl font-bold text-foreground">New QuickSplit</h2>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Total bill amount</label>
              <input
                value={createTotal}
                onChange={(e) => setCreateTotal(sanitizeMoneyInput(e.target.value))}
                inputMode="decimal"
                placeholder="napr. 120,50"
                className="w-full h-14 px-4 rounded-xl bg-background border border-foreground/20 text-foreground"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-2">People count (including you)</label>
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
              Create
            </Button>
          </div>
          <Button type="button" variant="outline" className="w-full h-12 rounded-xl gap-2" onClick={() => setScannerOpen(true)}>
            <Camera className="w-4 h-4" />
            Join (scan QR)
          </Button>
          <Modal isOpen={scannerOpen} onClose={() => setScannerOpen(false)} title="Join via QR">
            <div className="space-y-3">
              <div className="rounded-xl border border-foreground/20 overflow-hidden bg-black/40">
                <video ref={videoRef} className="w-full aspect-square object-cover" autoPlay muted playsInline />
              </div>
              {!scannerSupported && (
                <p className="text-xs text-amber-400">
                  Your browser doesn&apos;t support direct QR scanning. Open the join link manually.
                </p>
              )}
              {scannerError && <p className="text-xs text-red-400">{scannerError}</p>}
              <p className="text-xs text-muted-foreground text-center">Point your camera at the invite QR code.</p>
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
        setErr(e instanceof Error ? e.message : "Error");
        return;
      }
    }
    clearQsSession(split.id);
    setSplit(null);
    setErr(null);
  };

  const closePayerSheet = () => {
    setIsPayerSheetOpen(false);
    setIsPayerSheetDragging(false);
    setPayerSheetDragOffset(0);
    payerSheetDragStartYRef.current = null;
  };

  const handlePayerSheetTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    payerSheetDragStartYRef.current = e.touches[0]?.clientY ?? null;
    setIsPayerSheetDragging(true);
  };

  const handlePayerSheetTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (payerSheetDragStartYRef.current === null) return;
    const currentY = e.touches[0]?.clientY ?? payerSheetDragStartYRef.current;
    const delta = Math.max(0, currentY - payerSheetDragStartYRef.current);
    setPayerSheetDragOffset(delta);
  };

  const handlePayerSheetTouchEnd = () => {
    const shouldClose = payerSheetDragOffset > 90;
    setIsPayerSheetDragging(false);
    if (shouldClose) {
      closePayerSheet();
      return;
    }
    setPayerSheetDragOffset(0);
    payerSheetDragStartYRef.current = null;
  };

  const canCloseSplitModeSheet = split.splitMode === "custom_amounts" ? customLiveClaimsMatch : true;

  const closeSplitModeSheet = async () => {
    if (!canCloseSplitModeSheet) {
      setSplitModeSheetDragOffset(0);
      setIsSplitModeSheetDragging(false);
      splitModeSheetDragStartYRef.current = null;
      return;
    }
    if (split.splitMode === "custom_amounts" && canEditSplitting) {
      const payload = split.participants.map((p) => ({
        participantId: p.id,
        claimedAmountCents: liveClaimCentsByParticipant.get(p.id) ?? 0,
      }));
      try {
        const v = (await api.quicksplits.update(
          split.id,
          { customClaims: payload },
          adminHeaders(),
        )) as QuicksplitView;
        setSplit(v);
      } catch (e: unknown) {
        setErr(e instanceof Error ? e.message : "Error");
        return;
      }
    }
    setIsSplitModeSheetOpen(false);
    setIsSplitModeSheetDragging(false);
    setSplitModeSheetDragOffset(0);
    splitModeSheetDragStartYRef.current = null;
  };

  const handleSplitModeSheetTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    splitModeSheetDragStartYRef.current = e.touches[0]?.clientY ?? null;
    setIsSplitModeSheetDragging(true);
  };

  const handleSplitModeSheetTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (splitModeSheetDragStartYRef.current === null) return;
    const currentY = e.touches[0]?.clientY ?? splitModeSheetDragStartYRef.current;
    const delta = Math.max(0, currentY - splitModeSheetDragStartYRef.current);
    setSplitModeSheetDragOffset(delta);
  };

  const handleSplitModeSheetTouchEnd = () => {
    const shouldClose = splitModeSheetDragOffset > 90;
    setIsSplitModeSheetDragging(false);
    if (shouldClose) {
      void closeSplitModeSheet();
      return;
    }
    setSplitModeSheetDragOffset(0);
    splitModeSheetDragStartYRef.current = null;
  };

  const applySplitModeChoice = async (mode: "equal" | "amount" | "percent") => {
    if (!split) return;
    if (mode === "equal") {
      setCustomSplitEntryMode("amount");
      await setSplitMode("equal");
      return;
    }
    setCustomSplitEntryMode(mode === "amount" ? "amount" : "percent");
    await setSplitMode("custom_amounts");
  };

  return (
    <div className="min-h-screen bg-background w-full pb-28">
      <div className="max-w-screen-sm mx-auto px-4 py-6 space-y-6">
        <h1 className="text-xl font-bold text-foreground">QuickSplit</h1>
        {visibleErr && <p className="text-sm text-red-400">{visibleErr}</p>}

        <section className="space-y-3 rounded-2xl border border-foreground/15 bg-[#0e0e10] p-4 transition-all duration-300">
          <h2 className="text-base font-semibold text-foreground">Split setup</h2>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Total amount</label>
            <input
              value={splitTotalDraft}
              onChange={(e) => {
                const v = sanitizeMoneyInput(e.target.value);
                setSplitTotalDraft(v);
                scheduleTotalSave(v);
              }}
              inputMode="decimal"
              disabled={!canEditCreateSection}
              className="w-full h-12 px-3 rounded-xl bg-background border border-foreground/20 text-foreground disabled:opacity-70"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">People count</label>
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
              <p className="text-xs text-muted-foreground text-center mt-2">After you continue, this section becomes read-only.</p>
            )}
          </div>
        </section>

        <section className="space-y-4 rounded-2xl border border-foreground/15 bg-[#0e0e10] p-4 transition-all duration-300">
          <h2 className="text-base font-semibold text-foreground">Waiting for members</h2>
          <p className="text-sm text-muted-foreground">
            Currently <span className="text-foreground font-semibold">{n}</span> of{" "}
            <span className="text-foreground font-semibold">{target}</span> people.
            {waitingLeft > 0 ? (
              <>
                {" "}
                Still waiting for <span className="text-primary font-semibold">{waitingLeft}</span>{" "}
                {waitingLeft === 1 ? "user" : "users"}...
              </>
            ) : (
              <span className="text-emerald-500 font-medium"> Everyone is connected.</span>
            )}
          </p>

          {isAdminSession && allJoined && isWaitingStep && (
            <div className="rounded-2xl border border-primary/30 bg-primary/10 p-4 shadow-[0_0_0_1px_rgba(139,92,246,0.08)]">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">All members are ready</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    You can move the split to the next step and choose split mode.
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
                Continue
              </Button>
            </div>
          )}

          <div className="rounded-2xl border border-foreground/15 p-4 space-y-3">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Users className="w-4 h-4" />
              Connected members
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
                      <span className="text-muted-foreground text-xs">joined</span>
                    </li>
                  );
                }
                return (
                  <li key={`empty_${idx}`} className="text-sm text-muted-foreground flex items-center gap-2">
                    <span>⬜</span>
                    <span>Waiting...</span>
                  </li>
                );
              })}
            </ul>
          </div>

          {isWaitingStep && (
            <div className="rounded-2xl border border-foreground/15 p-4 flex flex-col items-center gap-3">
              <p className="text-xs text-muted-foreground text-center">Scan QR or send link</p>
              {qrDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qrDataUrl} alt="QR code" className="rounded-xl border border-foreground/20" width={220} height={220} />
              ) : (
                <p className="text-sm text-muted-foreground">Generujem QR…</p>
              )}
              <Button type="button" className="w-full h-11 bg-primary gap-2" onClick={copyJoin}>
                <Copy className="w-4 h-4" />
                Copy link
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
                  Continue{!allJoined ? " (early)" : ""}
                </Button>
                {!allJoined && (
                  <p className="text-xs text-center text-muted-foreground">
                    You can continue even if not everyone joined yet - others won&apos;t be able to join later.
                  </p>
                )}
              </div>
            )}
        </section>

        {split.flowStep !== "waiting" && split.flowStep !== "closed" && (
          <section className="space-y-5">
            {selectedPayerIsGuest && (
              <div className="space-y-2">
                <label className="text-xs text-muted-foreground block">Payer name (optional)</label>
                <input
                  value={payerNameDraft}
                  onChange={(e) => setPayerNameDraft(e.target.value)}
                  placeholder="How the name should appear"
                  disabled={!canEditSelectedPayerIban}
                  className="w-full h-12 px-3 rounded-xl bg-background border border-foreground/20 text-foreground disabled:opacity-60"
                />
              </div>
            )}
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground block">Kto platil</label>
              <div className="relative">
                <button
                  type="button"
                  disabled={!canEditSplitting}
                  onClick={() => setIsPayerSheetOpen(true)}
                  className="w-full h-12 px-3 pr-10 rounded-xl bg-background border border-foreground/20 text-left text-foreground disabled:opacity-60"
                >
                  {selectedPayerName}
                </button>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground/70" />
              </div>
              <div
                className={`rounded-xl border px-3 py-2 text-xs ${
                  selectedPayerHasIban
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                    : "border-amber-500/35 bg-amber-500/10 text-amber-200"
                }`}
              >
                {selectedPayerHasIban
                  ? `Payer IBAN: ${selectedPayerResolvedIban}`
                  : "Payer has no IBAN set. Payment cannot continue without it."}
              </div>
              {selectedPayerIsGuest && (
                <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 space-y-2">
                  <p className="text-xs text-foreground/75">
                    The payer is a guest (not signed in).
                    {canEditSelectedPayerIban
                      ? " Add your IBAN so others can pay. It saves automatically."
                      : " Only the payer can add this IBAN in their own session."}
                  </p>
                  <label className="text-xs text-muted-foreground block">Payer IBAN</label>
                  <input
                    value={payerIbanDraft}
                    onChange={(e) => setPayerIbanDraft(e.target.value.toUpperCase())}
                    placeholder="SK12 3456 7890 1234 5678 9012"
                    disabled={!canEditSelectedPayerIban}
                    className="w-full h-11 px-3 rounded-xl bg-background border border-foreground/20 text-foreground disabled:opacity-60"
                  />
                  {!payerIbanLooksValid && payerIbanDraft.trim().length > 0 && (
                    <p className="text-xs text-amber-300">IBAN must have at least 15 characters.</p>
                  )}
                  {canEditSelectedPayerIban && payerIbanLooksValid && (
                    <p className="text-xs text-foreground/65">
                      {payerMetaSaveState === "saving"
                        ? "Saving changes..."
                        : payerMetaSaveState === "saved"
                          ? "Changes saved."
                          : payerMetaSaveState === "error"
                            ? "Failed to save changes."
                            : "Changes are saved automatically."}
                    </p>
                  )}
                </div>
              )}
            </div>
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Split mode</p>
              <div className="relative">
                <button
                  type="button"
                  disabled={!canEditSplitting}
                  onClick={() => setIsSplitModeSheetOpen(true)}
                  className="w-full h-12 px-3 pr-10 rounded-xl bg-background border border-foreground/20 text-left text-foreground disabled:opacity-60"
                >
                  {split.splitMode === "equal"
                    ? "Equal"
                    : split.splitMode === "custom_amounts"
                      ? customSplitEntryMode === "percent"
                        ? "Percent"
                        : "By amount"
                      : "Select mode"}
                </button>
                <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground/70" />
              </div>
            </div>
            <p className="text-xs text-foreground/60">
              Configure split in the "Split mode" popup.
            </p>
          </section>
        )}

        {split.flowStep === "settlement" && (
          <section className="space-y-6">
            {myParticipant && !myParticipant.isPayer && myParticipant.oweToPayerCents > 0 && !showPaymentSuccess && !showStepThreeStatus && (
              <div className="rounded-2xl border border-primary/30 bg-primary/5 p-6 space-y-4 text-center">
                <p className="text-sm text-muted-foreground">You owe</p>
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
                  Pay
                </Button>
                {payMeUrl ? (
                  <div className="space-y-3 text-left rounded-xl border border-foreground/10 bg-background/40 p-3">
                    <p className="text-xs text-muted-foreground text-center">
                      If the banking app doesn&apos;t open, use the details below or open{" "}
                      <button type="button" onClick={openPayMe} className="text-primary underline underline-offset-2">
                        payment in banking app
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
                            Copy
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
                            Copy
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    The payer still needs to add IBAN before payment can be opened.
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
                    Mark as paid
                  </Button>
                ) : (
                  <Button type="button" variant="outline" className="w-full h-12" onClick={() => void togglePaid(false)}>
                    Unmark as paid
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
                  <p className="text-2xl font-bold text-foreground">Payment confirmed!</p>
                  <p className="text-sm text-muted-foreground">{split.payerDisplayName} was notified</p>
                </div>
              </div>
            )}

            {showStepThreeStatus && myParticipant && !myParticipant.isPayer && (
              <div className="space-y-3">
                <h2 className="text-base font-semibold text-foreground">Step 3: Split mode</h2>
                <p className="text-sm text-muted-foreground">Payment status in this split</p>
                <div className="rounded-2xl border border-foreground/15 bg-[#0e0e10] p-4 space-y-2">
                  {split.participants
                    .filter((p) => !p.isPayer)
                    .map((p) => {
                      const paid = !!p.markedPaidAt;
                      return (
                        <div key={p.id} className="flex items-center justify-between text-sm gap-2">
                          <span className="text-foreground truncate">{p.displayName}</span>
                          <span className={paid ? "text-emerald-400 font-medium shrink-0" : "text-muted-foreground shrink-0"}>
                            {paid ? "Paid ✅" : "Waiting..."}
                          </span>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            {myParticipant?.isPayer && (
              <p className="text-sm text-muted-foreground text-center px-2">
                You are the bill payer. Others will send you their share.
              </p>
            )}

            {myParticipant && !myParticipant.isPayer && myParticipant.oweToPayerCents <= 0 && (
              <p className="text-sm text-center text-muted-foreground">You owe nothing.</p>
            )}

            {!allNonPayersPaid && isAdminSession && (
              <div className="rounded-2xl border border-foreground/15 bg-[#0e0e10] p-4 space-y-2">
                <h2 className="text-sm font-semibold text-foreground mb-2">Payment overview (live)</h2>
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
                            {paid ? `paid ${formatEur(p.oweToPayerCents)}` : "waiting..."}
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
                  <p className="text-2xl font-bold text-foreground">Everyone paid! 🎉</p>
                  <p className="text-sm text-muted-foreground">Split is closed.</p>
                </div>
                <Button type="button" className="w-full h-14 bg-primary text-primary-foreground" onClick={() => void closeSplit()}>
                  Close split
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
              End split
            </Button>
          </div>
        )}

      </div>

      <div
        className={`fixed inset-0 z-[145] transition-opacity duration-300 ${
          isPayerSheetOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <button
          type="button"
          className="absolute inset-0 bg-black/60 backdrop-blur-[1px]"
          onClick={closePayerSheet}
          aria-label="Close payer selection"
        />
        <div
          className={`absolute bottom-0 left-0 right-0 rounded-t-3xl border-t border-white/10 bg-gradient-to-b from-[#181a20] to-[#111318] px-5 pb-6 pt-4 shadow-2xl ${
            isPayerSheetDragging ? "" : "transition-transform duration-300 ease-out"
          }`}
          onTouchStart={handlePayerSheetTouchStart}
          onTouchMove={handlePayerSheetTouchMove}
          onTouchEnd={handlePayerSheetTouchEnd}
          onTouchCancel={handlePayerSheetTouchEnd}
          onClick={(e) => e.stopPropagation()}
          style={{
            height: "50vh",
            transform: isPayerSheetOpen ? `translateY(${payerSheetDragOffset}px)` : "translateY(100%)",
          }}
        >
          <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-white/20" />
          <h2 className="mb-3 text-base font-semibold text-foreground">Kto platil</h2>
          <div className="h-[calc(50vh-70px)] space-y-2 overflow-y-auto pr-1">
            {split.participants.map((p) => {
              const isSelected = p.id === split.payerParticipantId;
              const displayName = `${p.displayName}${p.id === myParticipantId ? " (ty)" : ""}`;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    void setPayer(p.id);
                    closePayerSheet();
                  }}
                  className={`flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left transition ${
                    isSelected
                      ? "border-[rgb(124,58,237)] bg-[rgba(124,58,237,0.18)]"
                      : "border-white/10 bg-white/[0.02] hover:bg-white/[0.06]"
                  }`}
                >
                  <span className="truncate text-sm text-foreground">{displayName}</span>
                  {isSelected && (
                    <span className="text-xs font-semibold text-[rgb(196,181,253)]">Selected</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div
        className={`fixed inset-0 z-[146] transition-opacity duration-300 ${
          isSplitModeSheetOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <button
          type="button"
          className="absolute inset-0 bg-black/60 backdrop-blur-[1px]"
          onClick={() => void closeSplitModeSheet()}
          aria-label="Close split mode selection"
        />
        <div
          className={`absolute bottom-0 left-0 right-0 rounded-t-3xl border-t border-white/10 bg-gradient-to-b from-[#181a20] to-[#111318] px-5 pb-6 pt-4 shadow-2xl ${
            isSplitModeSheetDragging ? "" : "transition-transform duration-300 ease-out"
          }`}
          onTouchStart={handleSplitModeSheetTouchStart}
          onTouchMove={handleSplitModeSheetTouchMove}
          onTouchEnd={handleSplitModeSheetTouchEnd}
          onTouchCancel={handleSplitModeSheetTouchEnd}
          onClick={(e) => e.stopPropagation()}
          style={{
            height: "50vh",
            transform: isSplitModeSheetOpen ? `translateY(${splitModeSheetDragOffset}px)` : "translateY(100%)",
          }}
        >
          <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-white/20" />
          <h2 className="mb-3 text-base font-semibold text-foreground">Split mode</h2>
          <div className="mb-3 grid grid-cols-3 gap-2">
            {[
              { id: "equal", label: "Equal" },
              { id: "amount", label: "By amount" },
              { id: "percent", label: "Percent" },
            ].map((mode) => {
              const selected =
                (mode.id === "equal" && split.splitMode === "equal") ||
                (mode.id === "amount" && split.splitMode === "custom_amounts" && customSplitEntryMode === "amount") ||
                (mode.id === "percent" && split.splitMode === "custom_amounts" && customSplitEntryMode === "percent");
              return (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => {
                    void applySplitModeChoice(mode.id as "equal" | "amount" | "percent");
                  }}
                  className={`rounded-lg border px-2 py-2 text-xs transition ${
                    selected
                      ? "border-[rgb(124,58,237)] bg-[rgba(124,58,237,0.18)] text-[rgb(196,181,253)]"
                      : "border-white/10 bg-white/[0.02] text-foreground/80"
                  }`}
                >
                  {mode.label}
                </button>
              );
            })}
          </div>

          <p className="mb-3 text-xs leading-5 text-foreground/65">
            {split.splitMode === "equal"
              ? "Equal: choose which members are included in the split. Every selected member gets the same share."
              : customSplitEntryMode === "amount"
                ? "By amount: enter the exact euro amount for each member."
                : "Percent: enter each member's percentage of the total amount."}
          </p>

          <div
            className={`space-y-2 overflow-y-auto pr-1 ${
              split.splitMode === "custom_amounts" ? "max-h-[calc(50vh-220px)]" : "max-h-[calc(50vh-190px)]"
            }`}
          >
            {split.participants.map((p) => {
              const excluded = split.equalExcludedParticipantIds.includes(p.id);
              const includedCount = split.participants.length - split.equalExcludedParticipantIds.length;
              const canToggleExclude = excluded || (split.participants.length >= 3 && includedCount > 1);
              const liveClaimCents = liveClaimCentsByParticipant.get(p.id) ?? 0;
              if (split.splitMode === "equal") {
                return (
                  <button
                    key={p.id}
                    type="button"
                    disabled={!canEditSplitting || !canToggleExclude}
                    onClick={() => {
                      if (!canToggleExclude) return;
                      void toggleEqualExclude(p.id, !excluded);
                    }}
                    className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5 text-left disabled:opacity-70"
                  >
                    <span className="truncate text-sm text-foreground">
                      {p.displayName}
                      {p.id === myParticipantId ? " (ty)" : ""}
                    </span>
                    <span
                      className={`flex h-7 w-7 items-center justify-center rounded-full border transition ${
                        !excluded ? "border-[rgb(124,58,237)] bg-[rgb(124,58,237)] text-white" : "border-white/20 text-transparent"
                      }`}
                    >
                      <Check className="h-4 w-4" />
                    </span>
                  </button>
                );
              }

              return (
                <div key={p.id} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5">
                  <span className="truncate text-sm text-foreground">
                    {p.displayName}
                    {p.id === myParticipantId ? " (ty)" : ""}
                  </span>
                  <div className="flex h-11 w-32 items-end justify-end gap-3">
                    <input
                      value={customSplitEntryMode === "percent" ? percentDraft[p.id] ?? "" : claimDraft[p.id] ?? ""}
                      onChange={(e) => {
                        const v = sanitizeMoneyInput(e.target.value);
                        if (customSplitEntryMode === "percent") {
                          setPercentDraft((prev) => ({ ...prev, [p.id]: v }));
                          const parsed = Number(v.replace(",", "."));
                          const nextCents =
                            Number.isFinite(parsed) && parsed >= 0 && displayedTotalCents > 0
                              ? Math.round((displayedTotalCents * parsed) / 100)
                              : 0;
                          const euroRaw = (nextCents / 100).toFixed(2).replace(".", ",");
                          setClaimDraft((prev) => ({ ...prev, [p.id]: euroRaw }));
                          return;
                        }
                        setClaimDraft((prev) => ({ ...prev, [p.id]: v }));
                      }}
                      inputMode="decimal"
                      placeholder="0"
                      disabled={!canEditSplitting}
                      className="w-full border-b-2 border-white/25 bg-transparent pb-0.5 text-right text-lg font-semibold text-foreground placeholder:text-foreground/35 focus:border-[rgb(124,58,237)] focus:outline-none disabled:opacity-70"
                    />
                    <span className="pb-0.5 text-lg font-semibold text-foreground/85">
                      {customSplitEntryMode === "percent" ? "%" : "€"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          {split.splitMode === "custom_amounts" && (
            <div className="mt-3 px-0.5 py-1 text-xs">
              <div className="flex items-center justify-between text-foreground/70">
                <span>Celkovo</span>
                <span className="font-semibold text-foreground">{formatEur(displayedTotalCents)}</span>
              </div>
              <div className="mt-1.5 flex items-center justify-between text-foreground/70">
                <span>Split</span>
                <span className="font-semibold text-foreground">{formatEur(customLiveClaimsSumCents)}</span>
              </div>
              <div className="mt-2">
                {customLiveDeltaCents < 0 ? (
                  <span className="font-medium text-red-300">
                    Nad limit o {formatEur(Math.abs(customLiveDeltaCents))}
                  </span>
                ) : customLiveDeltaCents > 0 ? (
                  <span className="font-medium text-amber-300">
                    Remaining to split {formatEur(customLiveDeltaCents)}
                  </span>
                ) : (
                  <span className="font-medium text-emerald-400">Total matches ✅</span>
                )}
              </div>
            </div>
          )}

          {split.splitMode === "custom_amounts" && !canCloseSplitModeSheet && (
            <p className="text-[11px] text-amber-300">To close this popup, the total must be exactly {formatEur(displayedTotalCents)}.</p>
          )}

          {canEditSplitting && (
            <Button
              type="button"
              disabled={
                (split.splitMode === "custom_amounts" ? !customLiveClaimsMatch : false) ||
                !selectedPayerHasIban
              }
              className="mt-3 w-full h-11 bg-emerald-600 text-white"
              onClick={() => void finalizeSplitting()}
            >
              Done
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
