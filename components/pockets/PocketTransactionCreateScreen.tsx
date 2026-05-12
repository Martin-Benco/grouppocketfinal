"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "@/lib/api/client";
import { Button } from "@/components/ui/button";

type PocketMember = {
  uid: string;
  email: string | null;
  fullName: string | null;
  profileImageUrl: string | null;
  status: "accepted" | "pending" | "rejected" | "cancelled";
};

type PocketTransactionRow = {
  id: string;
  name: string;
  amount: number;
  date: string;
  payerUid: string;
  tag: string | null;
  note?: string | null;
  splitAssignedUids: string[];
  createdAt?: string;
};

type PocketDetail = {
  id: string;
  name: string;
  tags?: string[];
  members: PocketMember[];
  transactions?: PocketTransactionRow[];
};

function amountToInputString(n: number) {
  if (!Number.isFinite(n)) return "";
  return n.toFixed(2).replace(".", ",");
}

export function PocketTransactionCreateScreen({ pocketId }: { pocketId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editTransactionId = searchParams.get("editTransactionId")?.trim() || "";
  const returnTo = searchParams.get("returnTo")?.trim() || "";
  const detailHref = pocketId
    ? `/pockety/detail?pocketId=${encodeURIComponent(pocketId)}`
    : "/pockety";
  const [pocket, setPocket] = useState<PocketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [transactionName, setTransactionName] = useState("");
  const [amount, setAmount] = useState("");
  const [transactionDate, setTransactionDate] = useState(new Date().toISOString().slice(0, 10));
  const [transactionNote, setTransactionNote] = useState("");
  const [payerUid, setPayerUid] = useState("");
  const [splitMode, setSplitMode] = useState<"equal" | "amount" | "percent">("equal");
  const [selectedSplitUids, setSelectedSplitUids] = useState<string[]>([]);
  const [splitAmounts, setSplitAmounts] = useState<Record<string, string>>({});
  const [splitPercents, setSplitPercents] = useState<Record<string, string>>({});
  const [transactionTag, setTransactionTag] = useState("");
  const [isSavingTransaction, setIsSavingTransaction] = useState(false);
  const [transactionError, setTransactionError] = useState<string | null>(null);
  const [isPayerSheetOpen, setIsPayerSheetOpen] = useState(false);
  const [isSplitSheetOpen, setIsSplitSheetOpen] = useState(false);
  const [isDateSheetOpen, setIsDateSheetOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [sheetDragOffset, setSheetDragOffset] = useState(0);
  const [isSheetDragging, setIsSheetDragging] = useState(false);
  const dragStartYRef = useRef<number | null>(null);
  const [splitSheetDragOffset, setSplitSheetDragOffset] = useState(0);
  const [isSplitSheetDragging, setIsSplitSheetDragging] = useState(false);
  const splitDragStartYRef = useRef<number | null>(null);
  const lastEditApplyKeyRef = useRef("");

  const sanitizeDecimalInput = (value: string) => {
    const cleaned = value.replace(/[^\d.,]/g, "");
    const match = cleaned.match(/^(\d*)([.,]?)(\d*)/);
    if (!match) return "";
    const [, intPart = "", sep = "", fracPart = ""] = match;
    return `${intPart}${sep}${fracPart}`;
  };
  const parseDecimal = (value: string) => Number(value.replace(",", "."));

  const acceptedMembers = useMemo(
    () =>
      pocket?.members.filter(
        (member) => member.status === "accepted" || member.status === "pending",
      ) ?? [],
    [pocket?.members],
  );
  const acceptedMemberUids = useMemo(
    () => acceptedMembers.map((member) => member.uid),
    [acceptedMembers],
  );

  useEffect(() => {
    const load = async () => {
      if (!pocketId) {
        setError("Chýba ID vrecka.");
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);
        const result = (await api.pockets.get(pocketId)) as PocketDetail;
        setPocket(result);
      } catch (err: any) {
        setError(err.message || "Vrecko sa nepodarilo načítať.");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [pocketId]);

  useEffect(() => {
    if (!pocketId) return;
    router.prefetch(`/pockety/detail?pocketId=${encodeURIComponent(pocketId)}`);
    if (returnTo === "transactions") {
      router.prefetch(`/pockety/detail/transactions?pocketId=${encodeURIComponent(pocketId)}`);
    }
  }, [pocketId, returnTo, router]);

  useEffect(() => {
    if (acceptedMembers.length > 0 && !payerUid) {
      setPayerUid(acceptedMembers[0].uid);
    }
  }, [acceptedMembers, payerUid]);

  useEffect(() => {
    if (editTransactionId) return;
    setSelectedSplitUids((prev) => {
      if (prev.length === acceptedMemberUids.length && prev.every((uid, i) => uid === acceptedMemberUids[i])) {
        return prev;
      }
      return acceptedMemberUids;
    });
    setSplitAmounts((prev) => {
      const next: Record<string, string> = {};
      acceptedMemberUids.forEach((uid) => {
        next[uid] = prev[uid] ?? "";
      });
      return next;
    });
    setSplitPercents((prev) => {
      const next: Record<string, string> = {};
      acceptedMemberUids.forEach((uid) => {
        next[uid] = prev[uid] ?? "";
      });
      return next;
    });
  }, [acceptedMemberUids, editTransactionId]);

  useEffect(() => {
    lastEditApplyKeyRef.current = "";
  }, [pocketId, editTransactionId]);

  useEffect(() => {
    const key = `${pocketId}:${editTransactionId}`;
    if (!editTransactionId || !pocket?.transactions?.length || acceptedMemberUids.length === 0) {
      return;
    }
    if (lastEditApplyKeyRef.current === key) return;
    const tx = pocket.transactions.find((t) => t.id === editTransactionId);
    if (!tx) return;
    lastEditApplyKeyRef.current = key;
    setTransactionName(tx.name);
    setAmount(amountToInputString(tx.amount));
    const d = tx.date?.trim();
    setTransactionDate(d && d.length >= 10 ? d.slice(0, 10) : new Date().toISOString().slice(0, 10));
    setPayerUid(tx.payerUid);
    setTransactionTag(tx.tag?.trim() || "");
    setTransactionNote(tx.note?.trim() || "");
    const assigned = (tx.splitAssignedUids || []).filter((uid) => acceptedMemberUids.includes(uid));
    setSelectedSplitUids(assigned.length > 0 ? assigned : acceptedMemberUids);
    setSplitMode("equal");
    const emptyAmounts: Record<string, string> = {};
    const emptyPercents: Record<string, string> = {};
    acceptedMemberUids.forEach((uid) => {
      emptyAmounts[uid] = "";
      emptyPercents[uid] = "";
    });
    setSplitAmounts(emptyAmounts);
    setSplitPercents(emptyPercents);
  }, [acceptedMemberUids, editTransactionId, pocket?.transactions, pocketId]);

  const openDatePicker = () => setIsDateSheetOpen(true);

  const handleSaveTransaction = async () => {
    if (!pocket) return;
    const parsedAmount = Number(amount.replace(",", "."));
    const trimmedName = transactionName.trim();
    const assignedUids =
      splitMode === "equal"
        ? selectedSplitUids
        : acceptedMembers
            .filter((member) => {
              const raw = splitMode === "amount" ? splitAmounts[member.uid] : splitPercents[member.uid];
              const value = parseDecimal(raw || "");
              const hasDirectValue = Number.isFinite(value) && value > 0;
              const hasAutoRemainder =
                splitMode === "amount"
                  ? amountAutoFill?.uid === member.uid && amountAutoFill.value > 0
                  : percentAutoFill?.uid === member.uid && percentAutoFill.value > 0;
              return hasDirectValue || hasAutoRemainder;
            })
            .map((member) => member.uid);

    if (!trimmedName) {
      setTransactionError("Zadajte názov platby.");
      return;
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setTransactionError("Zadajte platnú sumu.");
      return;
    }
    if (!payerUid) {
      setTransactionError("Vyberte, kto platí.");
      return;
    }
    if (assignedUids.length === 0) {
      setTransactionError("Vyberte aspoň jednu osobu na rozdelenie.");
      return;
    }

    try {
      setIsSavingTransaction(true);
      setTransactionError(null);
      const payload = {
        name: trimmedName,
        amount: parsedAmount,
        date: transactionDate,
        payerUid,
        tag: transactionTag.trim() || undefined,
        note: transactionNote.trim() || undefined,
        splitAssignedUids: assignedUids,
      };
      if (editTransactionId) {
        await api.pockets.updateTransaction(pocket.id, editTransactionId, payload);
      } else {
        await api.pockets.addTransaction(pocket.id, payload);
      }
      if (returnTo === "transactions") {
        router.replace(`/pockety/detail/transactions?pocketId=${encodeURIComponent(pocket.id)}`);
      } else {
        router.replace(`/pockety/detail?pocketId=${encodeURIComponent(pocket.id)}`);
      }
    } catch (err: any) {
      setTransactionError(err.message || "Transakciu sa nepodarilo uložiť.");
    } finally {
      setIsSavingTransaction(false);
    }
  };

  const splitInputLabel = useMemo(() => {
    if (splitMode === "equal") {
      const allChecked =
        acceptedMemberUids.length > 0 &&
        acceptedMemberUids.every((uid) => selectedSplitUids.includes(uid));
      return allChecked ? "Rovnomerne" : "Vlastné";
    }

    if (splitMode === "amount") {
      const values = acceptedMemberUids.map((uid) =>
        Number((splitAmounts[uid] || "").replace(",", ".")),
      );
      const allValid = values.length > 0 && values.every((v) => Number.isFinite(v) && v > 0);
      if (!allValid) return "Vlastné";
      const first = values[0];
      const allSame = values.every((v) => Math.abs(v - first) < 0.00001);
      return allSame ? "Podľa súm" : "Vlastné";
    }

    const values = acceptedMemberUids.map((uid) =>
      Number((splitPercents[uid] || "").replace(",", ".")),
    );
    const allValid = values.length > 0 && values.every((v) => Number.isFinite(v) && v >= 0);
    if (!allValid) return "Vlastné";
    const first = values[0];
    const allSame = values.every((v) => Math.abs(v - first) < 0.00001);
    return allSame ? "Podľa percent" : "Vlastné";
  }, [acceptedMemberUids, selectedSplitUids, splitAmounts, splitMode, splitPercents]);
  const totalAmountValue = Number(amount.replace(",", "."));
  const hasValidAmount = Number.isFinite(totalAmountValue) && totalAmountValue > 0;
  const amountAutoFill = useMemo(() => {
    if (!hasValidAmount) return null;
    const emptyUids: string[] = [];
    let sum = 0;
    for (const uid of acceptedMemberUids) {
      const raw = (splitAmounts[uid] || "").trim();
      if (!raw) {
        emptyUids.push(uid);
        continue;
      }
      const v = parseDecimal(raw);
      if (!Number.isFinite(v) || v < 0) return null;
      sum += v;
    }
    if (emptyUids.length !== 1) return null;
    const remainder = totalAmountValue - sum;
    if (!Number.isFinite(remainder) || remainder < 0) return null;
    return { uid: emptyUids[0], value: remainder };
  }, [acceptedMemberUids, hasValidAmount, splitAmounts, totalAmountValue]);
  const percentAutoFill = useMemo(() => {
    const emptyUids: string[] = [];
    let sum = 0;
    for (const uid of acceptedMemberUids) {
      const raw = (splitPercents[uid] || "").trim();
      if (!raw) {
        emptyUids.push(uid);
        continue;
      }
      const v = parseDecimal(raw);
      if (!Number.isFinite(v) || v < 0) return null;
      sum += v;
    }
    if (emptyUids.length !== 1) return null;
    const remainder = 100 - sum;
    if (!Number.isFinite(remainder) || remainder < 0) return null;
    return { uid: emptyUids[0], value: remainder };
  }, [acceptedMemberUids, splitPercents]);
  const distributedAmountValue = acceptedMemberUids.reduce((sum, uid) => {
    const raw = (splitAmounts[uid] || "").trim();
    if (!raw && amountAutoFill?.uid === uid) return sum + amountAutoFill.value;
    const value = parseDecimal(raw);
    return Number.isFinite(value) && value > 0 ? sum + value : sum;
  }, 0);
  const distributedPercentValue = acceptedMemberUids.reduce((sum, uid) => {
    const raw = (splitPercents[uid] || "").trim();
    if (!raw && percentAutoFill?.uid === uid) return sum + percentAutoFill.value;
    const value = parseDecimal(raw);
    return Number.isFinite(value) && value > 0 ? sum + value : sum;
  }, 0);
  const amountDifference =
    Number.isFinite(totalAmountValue) && totalAmountValue > 0
      ? totalAmountValue - distributedAmountValue
      : null;
  const percentDifference = 100 - distributedPercentValue;
  const canCloseSplitSheet =
    splitMode === "amount"
      ? amountDifference !== null && Math.abs(amountDifference) < 0.005
      : splitMode === "percent"
        ? Math.abs(percentDifference) < 0.005
        : true;
  const selectedDateObj = useMemo(() => {
    const [y, m, d] = transactionDate.split("-").map(Number);
    if (!y || !m || !d) return new Date();
    return new Date(y, m - 1, d);
  }, [transactionDate]);
  const selectedDateLabel = useMemo(
    () =>
      selectedDateObj.toLocaleDateString("sk-SK", {
        day: "2-digit",
        month: "long",
        year: "numeric",
      }),
    [selectedDateObj],
  );
  const monthLabel = useMemo(
    () => calendarMonth.toLocaleDateString("sk-SK", { month: "long", year: "numeric" }),
    [calendarMonth],
  );
  const daysInMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0).getDate();
  const monthStartWeekday = (new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1).getDay() + 6) % 7;
  const calendarCells = Array.from({ length: monthStartWeekday + daysInMonth }, (_, i) => {
    const day = i - monthStartWeekday + 1;
    return day > 0 ? day : null;
  });

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Načítavam…</div>
      </div>
    );
  }

  if (error || !pocket) {
    return (
      <div className="min-h-screen bg-background">
        <div className="mx-auto max-w-screen-sm px-5 py-8">
          <div className="rounded-[28px] border border-red-500/20 bg-red-500/10 p-6 text-sm text-red-300">
            {error || "Vrecko sa nepodarilo načítať."}
          </div>
        </div>
      </div>
    );
  }

  const selectedPayerName =
    acceptedMembers.find((member) => member.uid === payerUid)?.fullName ||
    acceptedMembers.find((member) => member.uid === payerUid)?.email ||
    "Vyberte používateľa";

  const handleSheetTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    dragStartYRef.current = e.touches[0]?.clientY ?? null;
    setIsSheetDragging(true);
  };

  const handleSheetTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (dragStartYRef.current === null) return;
    const currentY = e.touches[0]?.clientY ?? dragStartYRef.current;
    const delta = Math.max(0, currentY - dragStartYRef.current);
    setSheetDragOffset(delta);
  };

  const closePayerSheet = () => {
    setIsPayerSheetOpen(false);
    setIsSheetDragging(false);
    setSheetDragOffset(0);
    dragStartYRef.current = null;
  };

  const handleSheetTouchEnd = () => {
    const shouldClose = sheetDragOffset > 90;
    setIsSheetDragging(false);
    if (shouldClose) {
      closePayerSheet();
      return;
    }
    setSheetDragOffset(0);
    dragStartYRef.current = null;
  };

  const handleSplitSheetTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    splitDragStartYRef.current = e.touches[0]?.clientY ?? null;
    setIsSplitSheetDragging(true);
  };

  const handleSplitSheetTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (splitDragStartYRef.current === null) return;
    const currentY = e.touches[0]?.clientY ?? splitDragStartYRef.current;
    const delta = Math.max(0, currentY - splitDragStartYRef.current);
    setSplitSheetDragOffset(delta);
  };

  const closeSplitSheet = () => {
    if (!canCloseSplitSheet) {
      setSplitSheetDragOffset(0);
      setIsSplitSheetDragging(false);
      splitDragStartYRef.current = null;
      return;
    }

    if (splitMode === "amount") {
      setSelectedSplitUids(acceptedMemberUids);
      setSplitPercents(() => {
        const next: Record<string, string> = {};
        acceptedMemberUids.forEach((uid) => {
          next[uid] = "";
        });
        return next;
      });
    } else if (splitMode === "percent") {
      setSelectedSplitUids(acceptedMemberUids);
      setSplitAmounts(() => {
        const next: Record<string, string> = {};
        acceptedMemberUids.forEach((uid) => {
          next[uid] = "";
        });
        return next;
      });
    } else {
      setSplitAmounts(() => {
        const next: Record<string, string> = {};
        acceptedMemberUids.forEach((uid) => {
          next[uid] = "";
        });
        return next;
      });
      setSplitPercents(() => {
        const next: Record<string, string> = {};
        acceptedMemberUids.forEach((uid) => {
          next[uid] = "";
        });
        return next;
      });
    }

    setIsSplitSheetOpen(false);
    setIsSplitSheetDragging(false);
    setSplitSheetDragOffset(0);
    splitDragStartYRef.current = null;
  };

  const handleSplitSheetTouchEnd = () => {
    const shouldClose = splitSheetDragOffset > 90;
    setIsSplitSheetDragging(false);
    if (shouldClose) {
      closeSplitSheet();
      return;
    }
    setSplitSheetDragOffset(0);
    splitDragStartYRef.current = null;
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-screen-sm px-5 py-6">
        <div className="sticky top-0 z-[80] -mx-5 mb-2 flex items-center gap-3 bg-background/95 px-5 py-2 backdrop-blur">
          <Link
            href={detailHref}
            replace
            className="inline-flex items-center justify-center text-foreground touch-manipulation"
            aria-label="Späť na detail vrecka"
          >
            <ChevronLeft className="h-6 w-6" />
          </Link>
          <h1 className="text-xl font-bold text-foreground">
            {editTransactionId ? "Upraviť transakciu" : "Pridať transakciu"}
          </h1>
        </div>

        <div className="mt-6 space-y-4 pb-8">
          <div>
            <label className="mb-2 block text-sm text-foreground/80">Názov platby *</label>
            <input
              type="text"
              value={transactionName}
              onChange={(e) => setTransactionName(e.target.value)}
              placeholder="Zadajte názov platby"
              className="h-12 w-full rounded-lg border border-foreground/15 bg-background px-4 text-foreground placeholder:text-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div>
              <label className="mb-2 block text-sm text-foreground/80">Štítok transakcie</label>
            <div className="flex flex-wrap gap-2">
              {(pocket.tags ?? []).map((tag) => {
                const selected = transactionTag === tag;
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => setTransactionTag((prev) => (prev === tag ? "" : tag))}
                    className={`rounded-lg border px-4 py-2 text-sm transition ${
                      selected
                        ? "border-[rgb(124,58,237)] bg-[rgba(124,58,237,0.18)] text-[rgb(196,181,253)]"
                        : "border-white/15 bg-white/[0.03] text-foreground/85 hover:bg-white/[0.08]"
                    }`}
                  >
                    {tag}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm text-foreground/80">Suma *</label>
            <div className="flex h-12 items-center rounded-lg border border-foreground/15 bg-background px-4">
              <span className="mr-2 text-foreground/80">€</span>
              <input
                type="text"
                inputMode="decimal"
                enterKeyHint="done"
                value={amount}
                onChange={(e) => setAmount(sanitizeDecimalInput(e.target.value))}
                placeholder="0.00"
                className="w-full bg-transparent text-foreground placeholder:text-foreground/50 focus:outline-none"
              />
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <label className="mb-2 block text-sm text-foreground/80">Zaplatil *</label>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    if (!hasValidAmount) return;
                    setIsPayerSheetOpen(true);
                  }}
                  disabled={!hasValidAmount}
                  className={`h-12 w-full rounded-lg border border-foreground/15 bg-background px-4 pr-10 text-left text-foreground focus:outline-none focus:ring-2 focus:ring-primary ${
                    hasValidAmount ? "" : "cursor-not-allowed opacity-45"
                  }`}
                >
                  {selectedPayerName}
                </button>
                <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground/70" />
              </div>
            </div>
            <div>
              <label className="mb-2 block text-sm text-foreground/80">Rozdelenie *</label>
              <button
                type="button"
                onClick={() => {
                  if (!hasValidAmount) return;
                  setIsSplitSheetOpen(true);
                }}
                disabled={!hasValidAmount}
                className={`flex h-12 w-full items-center justify-between rounded-lg border border-foreground/15 bg-background px-4 text-sm text-foreground/85 ${
                  hasValidAmount ? "" : "cursor-not-allowed opacity-45"
                }`}
              >
                <span>{splitInputLabel}</span>
                <ChevronDown className="h-4 w-4 text-foreground/70" />
              </button>
            </div>
          </div>

          <div className="relative py-2">
            <div className="relative h-6">
              <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 bg-white/10" />
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <label className="mb-2 block text-sm text-foreground/80">Dátum</label>
              <div className="relative">
                <button
                  type="button"
                  onClick={openDatePicker}
                  className="flex h-12 w-full items-center justify-between rounded-lg border border-foreground/15 bg-background px-4 text-left text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  aria-label="Vybrať dátum"
                >
                  <span className="text-sm">{selectedDateLabel}</span>
                  <CalendarDays className="h-4 w-4 text-foreground/75" />
                </button>
              </div>
            </div>
            <div>
              <label className="mb-2 block text-sm text-foreground/80">Poznámka</label>
              <input
                type="text"
                value={transactionNote}
                onChange={(e) => setTransactionNote(e.target.value)}
                placeholder="Pridajte poznámku"
                className="h-12 w-full rounded-lg border border-foreground/15 bg-background px-4 text-foreground placeholder:text-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>

          {transactionError && <p className="text-sm text-red-300">{transactionError}</p>}

          <Button
            className="h-11 w-full bg-primary hover:bg-primary/90"
            onClick={handleSaveTransaction}
            disabled={isSavingTransaction}
          >
            {isSavingTransaction
              ? "Ukladám…"
              : editTransactionId
                ? "Uložiť zmeny"
                : "Uložiť"}
          </Button>
        </div>
      </div>

      <div
        className={`fixed inset-0 z-[122] transition-opacity duration-300 ${
          isDateSheetOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <button
          type="button"
          aria-label="Zavrieť kalendár"
          className="absolute inset-0 bg-black/60 backdrop-blur-[1px]"
          onClick={() => setIsDateSheetOpen(false)}
        />
        <div
          className={`absolute bottom-0 left-0 right-0 rounded-t-3xl border-t border-white/10 bg-gradient-to-b from-[#181a20] to-[#111318] px-5 pb-6 pt-4 shadow-2xl transition-transform duration-300 ease-out ${
            isDateSheetOpen ? "translate-y-0" : "translate-y-full"
          }`}
          onClick={(e) => e.stopPropagation()}
          style={{ height: "56vh" }}
        >
          <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-white/20" />
          <div className="mb-4 flex items-center justify-between">
            <button
              type="button"
              onClick={() =>
                setCalendarMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))
              }
              className="inline-flex h-9 w-9 items-center justify-center text-foreground/90"
              aria-label="Predchádzajúci mesiac"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <p className="text-sm font-semibold capitalize text-foreground">{monthLabel}</p>
            <button
              type="button"
              onClick={() =>
                setCalendarMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))
              }
              className="inline-flex h-9 w-9 items-center justify-center text-foreground/90"
              aria-label="Ďalší mesiac"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="mb-2 grid grid-cols-7 text-center text-[11px] uppercase tracking-wide text-foreground/45">
            {["Po", "Ut", "St", "Št", "Pi", "So", "Ne"].map((d) => (
              <span key={d}>{d}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1.5">
            {calendarCells.map((day, idx) => {
              if (!day) {
                return <div key={`empty-${idx}`} className="h-9" />;
              }
              const iso = `${calendarMonth.getFullYear()}-${String(calendarMonth.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
              const isSelected = iso === transactionDate;
              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => {
                    setTransactionDate(iso);
                    setIsDateSheetOpen(false);
                  }}
                  className={`h-9 rounded-lg text-sm transition ${
                    isSelected
                      ? "bg-[rgb(124,58,237)] font-semibold text-white"
                      : "text-foreground/90 hover:bg-white/10"
                  }`}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div
        className={`fixed inset-0 z-[120] transition-opacity duration-300 ${
          isPayerSheetOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <button
          type="button"
          aria-label="Zavrieť výber platiteľa"
          className="absolute inset-0 bg-black/60 backdrop-blur-[1px]"
          onClick={closePayerSheet}
        />
        <div
          className={`absolute bottom-0 left-0 right-0 rounded-t-3xl border-t border-white/10 bg-gradient-to-b from-[#181a20] to-[#111318] px-5 pb-6 pt-4 shadow-2xl ${
            isSheetDragging ? "" : "transition-transform duration-300 ease-out"
          }`}
          onTouchStart={handleSheetTouchStart}
          onTouchMove={handleSheetTouchMove}
          onTouchEnd={handleSheetTouchEnd}
          onTouchCancel={handleSheetTouchEnd}
          onClick={(e) => e.stopPropagation()}
          style={{
            height: "50vh",
            transform: isPayerSheetOpen ? `translateY(${sheetDragOffset}px)` : "translateY(100%)",
          }}
        >
          <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-white/20" />
          <div className="mb-3 flex items-center">
            <h2 className="text-base font-semibold text-foreground">Kto platil</h2>
          </div>
          <div className="h-[calc(50vh-70px)] space-y-2 overflow-y-auto pr-1">
            {acceptedMembers.map((member) => {
              const displayName = member.fullName || member.email || "Používateľ";
              const isSelected = member.uid === payerUid;
              return (
                <button
                  key={member.uid}
                  type="button"
                  onClick={() => {
                    setPayerUid(member.uid);
                    setIsPayerSheetOpen(false);
                  }}
                  className={`flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left transition ${
                    isSelected
                      ? "border-[rgb(124,58,237)] bg-[rgba(124,58,237,0.18)]"
                      : "border-white/10 bg-white/[0.02] hover:bg-white/[0.06]"
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    {member.profileImageUrl ? (
                      <img
                        src={member.profileImageUrl}
                        alt={displayName}
                        className="h-9 w-9 rounded-full object-cover"
                      />
                    ) : (
                      <div className="flex h-9 w-9 items-center justify-center rounded-full border border-[rgb(124,58,237)] bg-[rgba(124,58,237,0.06)] text-xs font-semibold text-[rgb(167,139,250)]">
                        {displayName.slice(0, 1).toUpperCase()}
                      </div>
                    )}
                    <span className="truncate text-sm text-foreground">{displayName}</span>
                  </div>
                  <span className="text-xs font-semibold text-[rgb(196,181,253)]">
                    {isSelected ? "Vybrané" : member.status === "pending" ? "Pozvaný" : ""}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div
        className={`fixed inset-0 z-[121] transition-opacity duration-300 ${
          isSplitSheetOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <button
          type="button"
          aria-label="Zavrieť rozdelenie"
          className="absolute inset-0 bg-black/60 backdrop-blur-[1px]"
          onClick={closeSplitSheet}
        />
        <div
          className={`absolute bottom-0 left-0 right-0 rounded-t-3xl border-t border-white/10 bg-gradient-to-b from-[#181a20] to-[#111318] px-5 pb-6 pt-4 shadow-2xl ${
            isSplitSheetDragging ? "" : "transition-transform duration-300 ease-out"
          }`}
          onTouchStart={handleSplitSheetTouchStart}
          onTouchMove={handleSplitSheetTouchMove}
          onTouchEnd={handleSplitSheetTouchEnd}
          onTouchCancel={handleSplitSheetTouchEnd}
          onClick={(e) => e.stopPropagation()}
          style={{
            height: "66vh",
            transform: isSplitSheetOpen ? `translateY(${splitSheetDragOffset}px)` : "translateY(100%)",
          }}
        >
          <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-white/20" />
          <h2 className="mb-3 text-base font-semibold text-foreground">Rozdelenie</h2>

          <div className="mb-3 grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setSplitMode("equal")}
              className={`rounded-lg border px-2 py-2 text-xs ${
                splitMode === "equal"
                  ? "border-[rgb(124,58,237)] bg-[rgba(124,58,237,0.18)] text-[rgb(196,181,253)]"
                  : "border-white/10 bg-white/[0.02] text-foreground/80"
              }`}
            >
              Rovnomerne
            </button>
            <button
              type="button"
              onClick={() => setSplitMode("amount")}
              className={`rounded-lg border px-2 py-2 text-xs ${
                splitMode === "amount"
                  ? "border-[rgb(124,58,237)] bg-[rgba(124,58,237,0.18)] text-[rgb(196,181,253)]"
                  : "border-white/10 bg-white/[0.02] text-foreground/80"
              }`}
            >
              Podľa súm
            </button>
            <button
              type="button"
              onClick={() => setSplitMode("percent")}
              className={`rounded-lg border px-2 py-2 text-xs ${
                splitMode === "percent"
                  ? "border-[rgb(124,58,237)] bg-[rgba(124,58,237,0.18)] text-[rgb(196,181,253)]"
                  : "border-white/10 bg-white/[0.02] text-foreground/80"
              }`}
            >
              Podľa percent
            </button>
          </div>

          <p className="mb-3 text-xs leading-5 text-foreground/65">
            {splitMode === "equal"
              ? "Rovnomerne: vyberte, kto sa započíta. Každý označený člen má rovnaký podiel."
              : splitMode === "amount"
                ? "Podľa súm: zadajte presnú sumu v eurách pre každého."
                : "Podľa percent: zadajte podiel každého z celkovej sumy."}
          </p>

          <div
            className={`space-y-2 overflow-y-auto pr-1 ${
              splitMode === "amount" || splitMode === "percent"
                ? "max-h-[calc(66vh-250px)]"
                : "h-[calc(66vh-130px)]"
            }`}
          >
            {acceptedMembers.map((member) => {
              const displayName = member.fullName || member.email || "Používateľ";
              const isChecked = selectedSplitUids.includes(member.uid);
              const toggleChecked = () =>
                setSelectedSplitUids((prev) =>
                  prev.includes(member.uid) ? prev.filter((uid) => uid !== member.uid) : [...prev, member.uid],
                );
              return (
                <div key={member.uid}>
                  {splitMode === "equal" ? (
                    <button
                      type="button"
                      onClick={toggleChecked}
                      className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5 text-left"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        {member.profileImageUrl ? (
                          <img src={member.profileImageUrl} alt={displayName} className="h-9 w-9 rounded-full object-cover" />
                        ) : (
                          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-[rgb(124,58,237)] bg-[rgba(124,58,237,0.06)] text-xs font-semibold text-[rgb(167,139,250)]">
                            {displayName.slice(0, 1).toUpperCase()}
                          </div>
                        )}
                        <span className="truncate text-sm text-foreground">{displayName}</span>
                      </div>
                      <span className={`flex h-7 w-7 items-center justify-center rounded-full border transition ${isChecked ? "border-[rgb(124,58,237)] bg-[rgb(124,58,237)] text-white" : "border-white/20 text-transparent"}`}>
                        <Check className="h-4 w-4" />
                      </span>
                    </button>
                  ) : (
                    <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5">
                      <div className="flex min-w-0 items-center gap-3">
                        {member.profileImageUrl ? (
                          <img src={member.profileImageUrl} alt={displayName} className="h-9 w-9 rounded-full object-cover" />
                        ) : (
                          <div className="flex h-9 w-9 items-center justify-center rounded-full border border-[rgb(124,58,237)] bg-[rgba(124,58,237,0.06)] text-xs font-semibold text-[rgb(167,139,250)]">
                            {displayName.slice(0, 1).toUpperCase()}
                          </div>
                        )}
                        <span className="truncate text-sm text-foreground">{displayName}</span>
                      </div>
                      {splitMode === "amount" ? (
                        <div className="flex h-11 w-32 items-end justify-end gap-3">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={splitAmounts[member.uid] ?? ""}
                            onChange={(e) =>
                              setSplitAmounts((prev) => ({
                                ...prev,
                                [member.uid]: sanitizeDecimalInput(e.target.value),
                              }))
                            }
                            className="w-full border-b-2 border-white/25 bg-transparent pb-0.5 text-right text-lg font-semibold text-foreground placeholder:text-foreground/35 focus:border-[rgb(124,58,237)] focus:outline-none"
                            placeholder={
                              amountAutoFill?.uid === member.uid ? amountAutoFill.value.toFixed(2) : "0"
                            }
                          />
                          <span className="pb-0.5 text-lg font-semibold text-foreground/85">€</span>
                        </div>
                      ) : (
                        <div className="flex h-11 w-32 items-end justify-end gap-3">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={splitPercents[member.uid] ?? ""}
                            onChange={(e) =>
                              setSplitPercents((prev) => ({
                                ...prev,
                                [member.uid]: sanitizeDecimalInput(e.target.value),
                              }))
                            }
                            className="w-full border-b-2 border-white/25 bg-transparent pb-0.5 text-right text-lg font-semibold text-foreground placeholder:text-foreground/35 focus:border-[rgb(124,58,237)] focus:outline-none"
                            placeholder={
                              percentAutoFill?.uid === member.uid ? percentAutoFill.value.toFixed(2) : "0"
                            }
                          />
                          <span className="pb-0.5 text-lg font-semibold text-foreground/85">%</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {splitMode === "amount" && (
            <div className="mt-3 px-0.5 py-1">
              <div className="flex items-center justify-between text-xs text-foreground/70">
                <span>Celková suma</span>
                <span className="font-semibold text-foreground">
                  {Number.isFinite(totalAmountValue) && totalAmountValue > 0
                    ? `${totalAmountValue.toFixed(2)} €`
                    : "0.00 €"}
                </span>
              </div>
              <div className="mt-1.5 flex items-center justify-between text-xs text-foreground/70">
                <span>Rozdelené</span>
                <span className="font-semibold text-foreground">{distributedAmountValue.toFixed(2)} €</span>
              </div>
              {amountDifference !== null && (
                <div className="mt-2 text-xs">
                  {Math.abs(amountDifference) < 0.005 ? (
                    <span className="font-medium text-emerald-400">Súčet súm sedí.</span>
                  ) : amountDifference > 0 ? (
                    <span className="font-medium text-amber-300">
                      Ešte rozdeliť: {amountDifference.toFixed(2)} €
                    </span>
                  ) : (
                    <span className="font-medium text-red-300">
                      Prepočítané o {Math.abs(amountDifference).toFixed(2)} €
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
          {splitMode === "percent" && (
            <div className="mt-3 px-0.5 py-1">
              <div className="flex items-center justify-between text-xs text-foreground/70">
                <span>Celkom</span>
                <span className="font-semibold text-foreground">100 %</span>
              </div>
              <div className="mt-1.5 flex items-center justify-between text-xs text-foreground/70">
                <span>Rozdelené</span>
                <span className="font-semibold text-foreground">{distributedPercentValue.toFixed(2)} %</span>
              </div>
              <div className="mt-2 text-xs">
                {Math.abs(percentDifference) < 0.005 ? (
                  <span className="font-medium text-emerald-400">Percentá sedia.</span>
                ) : percentDifference > 0 ? (
                  <span className="font-medium text-amber-300">
                    Ešte rozdeliť: {percentDifference.toFixed(2)} %
                  </span>
                ) : (
                  <span className="font-medium text-red-300">
                    Prepočítané o {Math.abs(percentDifference).toFixed(2)} %
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
