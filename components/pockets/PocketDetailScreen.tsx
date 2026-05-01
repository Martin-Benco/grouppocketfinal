"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Plus, Receipt, Search, UserPlus } from "lucide-react";
import { api } from "@/lib/api/client";
import { auth } from "@/lib/firebase/config";
import { useAuth } from "@/contexts/AuthContext";

type PocketMember = {
  uid: string;
  email: string | null;
  fullName: string | null;
  profileImageUrl: string | null;
  iban?: string | null;
  status: "accepted" | "pending" | "rejected";
};

type PocketDetail = {
  id: string;
  name: string;
  tags: string[];
  ownerUid: string | null;
  members: PocketMember[];
  updatedAt: string;
  transactions?: PocketTransaction[];
  analytics?: {
    totalAmount: number;
    paidAmount: number;
  };
};

type PocketTransaction = {
  id: string;
  name: string;
  amount: number;
  date: string;
  payerUid: string;
  tag: string | null;
  splitAssignedUids: string[];
  createdAt: string;
};

type PocketUserResult = {
  uid: string;
  email: string | null;
  fullName: string | null;
  profileImageUrl: string | null;
};

type PendingPaymePayment = {
  uid: string;
  name: string;
  amount: number;
};

function formatCurrency(value: number) {
  return `${value.toFixed(2)} €`;
}

function buildPayMeUrl(params: {
  iban: string;
  amount: number;
  creditorName?: string | null;
  message?: string;
}) {
  const search = new URLSearchParams({
    V: "1",
    IBAN: params.iban.replace(/\s/g, "").toUpperCase(),
    AM: params.amount.toFixed(2),
    CC: "EUR",
  });
  if (params.creditorName?.trim()) search.set("CN", params.creditorName.trim());
  if (params.message?.trim()) search.set("MSG", params.message.trim());
  return `https://payme.sk/?${search.toString()}`;
}

export function PocketDetailScreen({ pocketId }: { pocketId: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const [pocket, setPocket] = useState<PocketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const currentUid = user?.uid || auth?.currentUser?.uid || null;
  const [selectedMember, setSelectedMember] = useState<PocketMember | null>(null);
  const [memberModalOpen, setMemberModalOpen] = useState(false);
  const [memberActionLoading, setMemberActionLoading] = useState(false);
  const [memberActionError, setMemberActionError] = useState<string | null>(null);
  const [isAddPeopleSheetOpen, setIsAddPeopleSheetOpen] = useState(false);
  const [addPeopleSheetDragOffset, setAddPeopleSheetDragOffset] = useState(0);
  const [isAddPeopleSheetDragging, setIsAddPeopleSheetDragging] = useState(false);
  const addPeopleSheetDragStartYRef = useRef<number | null>(null);
  const [userSearchQuery, setUserSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<PocketUserResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [inviteLoadingUid, setInviteLoadingUid] = useState<string | null>(null);
  const [isPayoutModalOpen, setIsPayoutModalOpen] = useState(false);
  const [isPayoutSheetOpen, setIsPayoutSheetOpen] = useState(false);
  const [payoutSheetDragOffset, setPayoutSheetDragOffset] = useState(0);
  const [isPayoutSheetDragging, setIsPayoutSheetDragging] = useState(false);
  const payoutSheetDragStartYRef = useRef<number | null>(null);
  const payoutCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [payoutError, setPayoutError] = useState<string | null>(null);
  const [pendingPaymePayment, setPendingPaymePayment] = useState<PendingPaymePayment | null>(null);
  const [awaitingPaymeReturn, setAwaitingPaymeReturn] = useState(false);
  const [paymeConfirmOpen, setPaymeConfirmOpen] = useState(false);
  const [confirmingPaymePayment, setConfirmingPaymePayment] = useState(false);
  const [paymeConfirmError, setPaymeConfirmError] = useState<string | null>(null);
  const paymeWindowRef = useRef<Window | null>(null);
  const paymeWindowWatchRef = useRef<number | null>(null);
  const paymeConfirmFallbackRef = useRef<number | null>(null);
  const acceptedMembers = pocket?.members.filter((member) => member.status === "accepted") ?? [];
  const transactions = pocket?.transactions ?? [];
  const hasMoreTransactions = transactions.length > 4;
  const visibleTransactions = hasMoreTransactions ? transactions.slice(0, 5) : transactions;
  const totalAmount = pocket?.analytics?.totalAmount ?? transactions.reduce((sum, tx) => sum + tx.amount, 0);
  const paidAmount = pocket?.analytics?.paidAmount ?? transactions.reduce((sum, tx) => sum + tx.amount, 0);

  const getDebtorUids = (tx: PocketTransaction) => {
    const explicit = (tx.splitAssignedUids || []).filter((uid) => uid !== tx.payerUid);
    if (explicit.length > 0) return explicit;
    return acceptedMembers.filter((m) => m.uid !== tx.payerUid).map((m) => m.uid);
  };

  const pocketNetByMember = acceptedMembers.reduce<Record<string, number>>((acc, member) => {
    acc[member.uid] = 0;
    return acc;
  }, {});

  const bilateralVsCurrent = acceptedMembers.reduce<Record<string, number>>((acc, member) => {
    acc[member.uid] = 0;
    return acc;
  }, {});

  transactions.forEach((tx) => {
    const debtors = getDebtorUids(tx);
    const count = debtors.length;
    if (count <= 0) return;
    const share = tx.amount / count;

    pocketNetByMember[tx.payerUid] = (pocketNetByMember[tx.payerUid] ?? 0) + tx.amount;
    debtors.forEach((uid) => {
      pocketNetByMember[uid] = (pocketNetByMember[uid] ?? 0) - share;
    });

    if (!currentUid) return;
    if (tx.payerUid === currentUid) {
      debtors.forEach((uid) => {
        if (uid !== currentUid) {
          bilateralVsCurrent[uid] = (bilateralVsCurrent[uid] ?? 0) + share;
        }
      });
      return;
    }
    if (debtors.includes(currentUid)) {
      bilateralVsCurrent[tx.payerUid] = (bilateralVsCurrent[tx.payerUid] ?? 0) - share;
    }
  });

  useEffect(() => {
    const load = async () => {
      if (!pocketId) {
        setError("Chýba ID pocketu.");
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);
        const result = (await api.pockets.get(pocketId)) as PocketDetail;
        setPocket(result);
      } catch (err: any) {
        setError(err.message || "Nepodarilo sa načítať pocket");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [pocketId]);

  useEffect(() => {
    if (!pocketId) return;
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void (async () => {
        try {
          const result = (await api.pockets.getFresh(pocketId)) as PocketDetail;
          setPocket((prev) => {
            if (!prev) return result;
            if (
              prev.updatedAt === result.updatedAt &&
              (prev.transactions?.length ?? 0) === (result.transactions?.length ?? 0) &&
              prev.members.length === result.members.length
            ) {
              return prev;
            }
            return result;
          });
        } catch {
          // ticho ignoruj - nech polling nerozbíja UX pri krátkom výpadku
        }
      })();
    }, 3000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [pocketId]);

  useEffect(() => {
    if (!pocketId) return;
    router.prefetch("/pockety");
    router.prefetch(`/pockety/detail/new-transaction?pocketId=${encodeURIComponent(pocketId)}`);
  }, [pocketId, router]);

  useEffect(() => {
    if (!isAddPeopleSheetOpen) {
      setSearchResults([]);
      setSearchError(null);
      setSearchLoading(false);
      return;
    }
    const query = userSearchQuery.trim();
    if (query.length < 2) {
      setSearchResults([]);
      setSearchError(null);
      setSearchLoading(false);
      return;
    }
    const timeoutId = window.setTimeout(async () => {
      try {
        setSearchLoading(true);
        setSearchError(null);
        const result = (await api.users.searchByEmail(query)) as { users: PocketUserResult[] };
        setSearchResults(result.users || []);
      } catch (err: any) {
        setSearchResults([]);
        setSearchError(err.message || "Nepodarilo sa vyhľadať používateľov");
      } finally {
        setSearchLoading(false);
      }
    }, 250);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [isAddPeopleSheetOpen, userSearchQuery]);

  useEffect(() => {
    if (!isPayoutModalOpen) return;
    const raf = window.requestAnimationFrame(() => {
      setIsPayoutSheetOpen(true);
    });
    return () => window.cancelAnimationFrame(raf);
  }, [isPayoutModalOpen]);

  useEffect(() => {
    const shouldLockScroll = isAddPeopleSheetOpen || isPayoutModalOpen || memberModalOpen || paymeConfirmOpen;
    const previousOverflow = document.body.style.overflow;
    const previousTouchAction = document.body.style.touchAction;
    if (shouldLockScroll) {
      document.body.style.overflow = "hidden";
      document.body.style.touchAction = "none";
    }
    return () => {
      document.body.style.overflow = previousOverflow;
      document.body.style.touchAction = previousTouchAction;
    };
  }, [isAddPeopleSheetOpen, isPayoutModalOpen, memberModalOpen, paymeConfirmOpen]);

  useEffect(() => {
    const handleReturnFromPayme = () => {
      if (!awaitingPaymeReturn || !pendingPaymePayment) return;
      setAwaitingPaymeReturn(false);
      setPaymeConfirmOpen(true);
      setPaymeConfirmError(null);
      if (paymeWindowWatchRef.current) {
        window.clearInterval(paymeWindowWatchRef.current);
        paymeWindowWatchRef.current = null;
      }
      if (paymeConfirmFallbackRef.current) {
        window.clearTimeout(paymeConfirmFallbackRef.current);
        paymeConfirmFallbackRef.current = null;
      }
      paymeWindowRef.current = null;
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      handleReturnFromPayme();
    };
    window.addEventListener("focus", handleReturnFromPayme);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("focus", handleReturnFromPayme);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [awaitingPaymeReturn, pendingPaymePayment]);

  useEffect(() => {
    return () => {
      if (paymeWindowWatchRef.current) {
        window.clearInterval(paymeWindowWatchRef.current);
      }
      if (paymeConfirmFallbackRef.current) {
        window.clearTimeout(paymeConfirmFallbackRef.current);
      }
    };
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-muted-foreground">Načítavam...</div>
      </div>
    );
  }

  if (error || !pocket) {
    return (
      <div className="min-h-screen bg-background">
        <div className="mx-auto max-w-screen-sm px-5 py-8">
          <div className="rounded-[28px] border border-red-500/20 bg-red-500/10 p-6 text-sm text-red-300">
            {error || "Pocket sa nepodarilo načítať."}
          </div>
        </div>
      </div>
    );
  }

  const isOwner = pocket.ownerUid === currentUid;
  const myNetTotal = currentUid ? pocketNetByMember[currentUid] ?? 0 : 0;
  const groupDebtTotal = acceptedMembers.reduce((sum, member) => {
    const value = pocketNetByMember[member.uid] ?? 0;
    return value > 0 ? sum + value : sum;
  }, 0);
  const groupSettledTotal = Math.max(0, totalAmount - groupDebtTotal);
  const debtRatio = totalAmount > 0 ? Math.min(1, Math.max(0, groupDebtTotal / totalAmount)) : 0;
  const myDebts = acceptedMembers
    .filter((member) => member.uid !== currentUid)
    .map((member) => ({
      uid: member.uid,
      name: member.fullName || member.email || "Používateľ",
      amount: bilateralVsCurrent[member.uid] ?? 0,
    }))
    .filter((item) => item.amount < 0)
    .map((item) => ({ ...item, amount: Math.abs(item.amount) }));
  const whoOwesMe = acceptedMembers
    .filter((member) => member.uid !== currentUid)
    .map((member) => ({
      uid: member.uid,
      name: member.fullName || member.email || "Používateľ",
      amount: bilateralVsCurrent[member.uid] ?? 0,
    }))
    .filter((item) => item.amount > 0);
  const closeAddPeopleSheet = () => {
    setIsAddPeopleSheetOpen(false);
    setAddPeopleSheetDragOffset(0);
    setIsAddPeopleSheetDragging(false);
    addPeopleSheetDragStartYRef.current = null;
    setUserSearchQuery("");
    setSearchResults([]);
    setSearchError(null);
  };
  const handleAddPeopleSheetTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    addPeopleSheetDragStartYRef.current = e.touches[0]?.clientY ?? null;
    setIsAddPeopleSheetDragging(true);
  };
  const handleAddPeopleSheetTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (addPeopleSheetDragStartYRef.current === null) return;
    const currentY = e.touches[0]?.clientY ?? addPeopleSheetDragStartYRef.current;
    const delta = Math.max(0, currentY - addPeopleSheetDragStartYRef.current);
    setAddPeopleSheetDragOffset(delta);
  };
  const handleAddPeopleSheetTouchEnd = () => {
    const shouldClose = addPeopleSheetDragOffset > 90;
    setIsAddPeopleSheetDragging(false);
    if (shouldClose) {
      closeAddPeopleSheet();
      return;
    }
    setAddPeopleSheetDragOffset(0);
    addPeopleSheetDragStartYRef.current = null;
  };

  const openPayoutModal = async () => {
    setIsPayoutModalOpen(true);
    setPayoutError(null);
    setIsPayoutSheetOpen(false);
    setPayoutSheetDragOffset(0);
    setIsPayoutSheetDragging(false);
    payoutSheetDragStartYRef.current = null;
    if (payoutCloseTimerRef.current) {
      clearTimeout(payoutCloseTimerRef.current);
      payoutCloseTimerRef.current = null;
    }
  };

  const closePayoutModal = () => {
    setPayoutError(null);
    setIsPayoutSheetOpen(false);
    setIsPayoutSheetDragging(false);
    setPayoutSheetDragOffset(0);
    payoutSheetDragStartYRef.current = null;
    if (payoutCloseTimerRef.current) {
      clearTimeout(payoutCloseTimerRef.current);
    }
    payoutCloseTimerRef.current = setTimeout(() => {
      setIsPayoutModalOpen(false);
      payoutCloseTimerRef.current = null;
    }, 280);
  };

  const handlePayoutSheetTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    payoutSheetDragStartYRef.current = e.touches[0]?.clientY ?? null;
    setIsPayoutSheetDragging(true);
  };

  const handlePayoutSheetTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (payoutSheetDragStartYRef.current === null) return;
    const currentY = e.touches[0]?.clientY ?? payoutSheetDragStartYRef.current;
    const delta = Math.max(0, currentY - payoutSheetDragStartYRef.current);
    setPayoutSheetDragOffset(delta);
  };

  const handlePayoutSheetTouchEnd = () => {
    const shouldClose = payoutSheetDragOffset > 90;
    setIsPayoutSheetDragging(false);
    if (shouldClose) {
      closePayoutModal();
      return;
    }
    setPayoutSheetDragOffset(0);
    payoutSheetDragStartYRef.current = null;
  };

  const buildTodayIsoDate = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  const isPayoutTransaction = (tx: PocketTransaction) =>
    (tx.tag || "").trim().toLowerCase() === "vyplatenie";

  const getMemberDisplayNameByUid = (uid: string) => {
    const member = acceptedMembers.find((m) => m.uid === uid);
    return member?.fullName || member?.email || "Používateľ";
  };

  const confirmPaymePaid = async () => {
    if (!pendingPaymePayment || !currentUid) return;
    try {
      setConfirmingPaymePayment(true);
      setPaymeConfirmError(null);
      await api.pockets.addTransaction(pocket.id, {
        name: "Vyplatenie",
        amount: pendingPaymePayment.amount,
        date: buildTodayIsoDate(),
        payerUid: currentUid,
        splitAssignedUids: [pendingPaymePayment.uid],
        tag: "Vyplatenie",
        note: "Platba potvrdená cez Payme.",
      });
      const refreshed = (await api.pockets.getFresh(pocket.id)) as PocketDetail;
      setPocket(refreshed);
      setPaymeConfirmOpen(false);
      setPendingPaymePayment(null);
      setIsPayoutModalOpen(false);
      if (paymeConfirmFallbackRef.current) {
        window.clearTimeout(paymeConfirmFallbackRef.current);
        paymeConfirmFallbackRef.current = null;
      }
    } catch (err: any) {
      setPaymeConfirmError(err.message || "Nepodarilo sa uložiť vyplatenie.");
    } finally {
      setConfirmingPaymePayment(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-screen-sm px-5 py-6">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => router.replace("/pockety")}
            className="text-foreground"
            aria-label="Späť na pockety"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>

          <div />
        </div>

        <div className="mt-6">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">{pocket.name}</h1>
        </div>

        <section className="mt-6">
          <div className="relative p-1 pr-8">
            <div className="flex items-end gap-4">
              <div className="flex-1 border-b border-white/10 pb-3.5 pr-6">
                <p className="text-xs text-foreground/55">Suma ktorú ste všetci spolu zaplatili</p>
                <p className="mt-2 text-3xl font-bold text-foreground">{formatCurrency(totalAmount || paidAmount)}</p>
              </div>
            </div>
            <div className="pt-3.5">
              <div className="mt-1">
                <p className="text-xl font-bold text-foreground">
                  {myNetTotal < 0
                    ? `Dlžíš ${formatCurrency(Math.abs(myNetTotal))}`
                    : myNetTotal > 0
                      ? `Dlžia ti ${formatCurrency(myNetTotal)}`
                      : "Vyrovnané 0,00 €"}
                </p>
                {myDebts.length > 0 ? (
                  <div className="mt-1.5 text-xs text-foreground/65">
                    <p>Komu dlžíš:</p>
                    <p className="mt-0.5">
                      {myDebts.map((item) => `${item.name} ${formatCurrency(item.amount)}`).join(" • ")}
                    </p>
                  </div>
                ) : whoOwesMe.length > 0 ? (
                  <div className="mt-1.5 text-xs text-foreground/65">
                    <p>Kto dlží tebe:</p>
                    <p className="mt-0.5">
                      {whoOwesMe.map((item) => `${item.name} ${formatCurrency(item.amount)}`).join(" • ")}
                    </p>
                  </div>
                ) : (
                  <p className="mt-1.5 text-xs text-foreground/65">Nikto nikomu nedlží.</p>
                )}
              </div>
            </div>
            <div className="absolute right-1 top-1 bottom-1 flex w-4 flex-col overflow-hidden rounded-full border border-white/15 bg-white/[0.04]">
              <div
                className="w-full bg-emerald-300/80"
                style={{ height: `${(1 - debtRatio) * 100}%` }}
                title={`Vyplatené ${formatCurrency(groupSettledTotal)}`}
              />
              <div
                className="w-full bg-amber-300/80"
                style={{ height: `${debtRatio * 100}%` }}
                title={`Skupina dlží ${formatCurrency(groupDebtTotal)}`}
              />
            </div>
          </div>
        </section>

        <section className="mt-7">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-bold text-foreground">Transakcie</h2>
            <button
              type="button"
              onClick={() =>
                router.push(`/pockety/detail/new-transaction?pocketId=${encodeURIComponent(pocket.id)}`)
              }
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-[rgb(124,58,237)]"
            >
              <Plus className="h-3.5 w-3.5" />
              Pridať
            </button>
          </div>

          <button
            type="button"
            onClick={() =>
              router.push(`/pockety/detail/transactions?pocketId=${encodeURIComponent(pocket.id)}`)
            }
            className="w-full text-left"
          >
          {transactions.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-transparent px-6 py-10">
              <div className="flex flex-col items-center justify-center py-4 text-center">
                <Receipt className="h-11 w-11 text-[#9CA3AF]" />
                <p className="mt-4 text-base font-semibold text-foreground">Zatiaľ žiadne výdavky</p>
                <p className="mt-2 max-w-[240px] text-sm leading-6 text-muted-foreground">
                  Keď pridáš prvú transakciu, zobrazí sa práve tu.
                </p>
              </div>
            </div>
          ) : (
            <div
              className="relative overflow-hidden rounded-2xl border border-white/10 bg-transparent"
              style={
                hasMoreTransactions
                  ? {
                      WebkitMaskImage: "linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 58%, rgba(0,0,0,0) 100%)",
                      maskImage: "linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,1) 58%, rgba(0,0,0,0) 100%)",
                    }
                  : undefined
              }
            >
              {visibleTransactions.map((tx, index) => {
                const payer = acceptedMembers.find((member) => member.uid === tx.payerUid);
                const payerName = payer?.fullName || payer?.email || "Používateľ";
                const payoutTargetUid = (tx.splitAssignedUids || [])[0] || "";
                const payoutTargetName = payoutTargetUid ? getMemberDisplayNameByUid(payoutTargetUid) : "Používateľ";
                const payerLine = isPayoutTransaction(tx)
                  ? `${payerName} -> ${payoutTargetName}`
                  : payerName;
                const fadeLevel =
                  hasMoreTransactions && index >= 3
                    ? index === 3
                      ? "light"
                      : "strong"
                    : null;
                return (
                  <div
                    key={tx.id}
                    className={`relative flex items-center justify-between px-4 py-3.5 ${
                      fadeLevel === "light" ? "opacity-70" : fadeLevel === "strong" ? "opacity-45" : ""
                    }`}
                    style={
                      fadeLevel === "strong"
                        ? {
                            WebkitMaskImage: "linear-gradient(to bottom, rgba(0,0,0,1) 8%, rgba(0,0,0,0) 100%)",
                            maskImage: "linear-gradient(to bottom, rgba(0,0,0,1) 8%, rgba(0,0,0,0) 100%)",
                          }
                        : undefined
                    }
                  >
                    {index < visibleTransactions.length - 1 && (
                      <div className="absolute bottom-0 left-4 right-4 h-px bg-white/10" />
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-base font-semibold text-foreground">{tx.name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {payerLine}
                        {tx.tag ? ` • ${tx.tag}` : ""}
                      </p>
                    </div>
                    <p className="ml-4 text-base font-semibold text-foreground">{formatCurrency(tx.amount)}</p>
                  </div>
                );
              })}
              {hasMoreTransactions && (
                <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-b from-transparent via-background/85 to-background" />
              )}
            </div>
          )}
          {hasMoreTransactions && (
            <div className="mt-1.5 flex justify-center">
              <button
                type="button"
                onClick={() =>
                  router.push(`/pockety/detail/transactions?pocketId=${encodeURIComponent(pocket.id)}`)
                }
                className="text-xs font-medium text-foreground/65 hover:text-foreground"
              >
                Zobraziť všetko
              </button>
            </div>
          )}
          </button>
        </section>

        <section className="mt-7 pb-8">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-bold text-foreground">Ľudia</h2>
            <button
              type="button"
              onClick={() => {
                setIsAddPeopleSheetOpen(true);
              }}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-[rgb(124,58,237)]"
            >
              <Plus className="h-3.5 w-3.5" />
              Pridať
            </button>
          </div>

          <div className="overflow-hidden rounded-2xl border border-white/10 bg-transparent">
            {pocket.members.map((member, index, arr) => {
                const displayName = member.fullName || member.email || "Používateľ";
                const isSelf = currentUid === member.uid;
                const relative = bilateralVsCurrent[member.uid] ?? 0;
                const isPending = member.status === "pending";
                const canManageMember = isOwner && !isSelf && member.uid !== pocket.ownerUid;

                return (
                  <div
                    key={member.uid}
                    className={`relative flex items-center justify-between px-4 py-3.5 ${
                      canManageMember ? "cursor-pointer hover:bg-white/[0.03]" : ""
                    } ${
                      isPending ? "opacity-55" : ""
                    }`}
                    onClick={() => {
                      if (!canManageMember) return;
                      setSelectedMember(member);
                      setMemberActionError(null);
                      setMemberModalOpen(true);
                    }}
                  >
                    {index < arr.length - 1 && (
                      <div className="absolute bottom-0 left-4 right-4 h-px bg-white/10" />
                    )}
                    <div className="flex min-w-0 items-center gap-3">
                      {member.profileImageUrl ? (
                        <img
                          src={member.profileImageUrl}
                          alt={displayName}
                          className="h-11 w-11 rounded-full object-cover"
                        />
                      ) : (
                        <div className="flex h-11 w-11 items-center justify-center rounded-full border border-[rgb(124,58,237)] bg-[rgba(124,58,237,0.06)] text-sm font-semibold text-[rgb(167,139,250)]">
                          {displayName.slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-base font-semibold text-foreground">
                          {displayName}
                          {member.uid === pocket.ownerUid && (
                            <span className="ml-1 inline-flex align-middle" aria-label="Tvorca pocketu">
                              <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" fill="none">
                                <path
                                  d="M10 1.8l2.25 4.56 5.03.73-3.64 3.55.86 5.01L10 13.29l-4.5 2.36.86-5.01L2.72 7.09l5.03-.73L10 1.8z"
                                  fill="url(#owner-star-gradient)"
                                />
                                <defs>
                                  <linearGradient id="owner-star-gradient" x1="2.7" y1="1.8" x2="17.3" y2="15.7" gradientUnits="userSpaceOnUse">
                                    <stop stopColor="#C4B5FD" />
                                    <stop offset="1" stopColor="#7C3AED" />
                                  </linearGradient>
                                </defs>
                              </svg>
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {isPending
                            ? "Pozvaný"
                            : (pocketNetByMember[member.uid] ?? 0) > 0
                              ? `+${formatCurrency(pocketNetByMember[member.uid] ?? 0)}`
                              : (pocketNetByMember[member.uid] ?? 0) < 0
                                ? `-${formatCurrency(Math.abs(pocketNetByMember[member.uid] ?? 0))}`
                                : "0,00 €"}
                        </p>
                      </div>
                    </div>

                    {isPending ? (
                      <span className="ml-4 text-xs font-semibold text-foreground/65">Pozvaný</span>
                    ) : isSelf ? (
                      <span className="ml-4 text-xs font-semibold text-foreground/70">Ty</span>
                    ) : relative > 0 ? (
                      <span className="ml-4 text-xs font-semibold text-foreground/80">
                        {`Dlží ti ${formatCurrency(relative)}`}
                      </span>
                    ) : (
                      <button
                        type="button"
                        disabled={relative >= 0}
                        className={`ml-4 rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                          relative < 0
                            ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
                            : "border-white/15 bg-white/[0.03] text-foreground/70"
                        }`}
                      >
                        {relative < 0 ? `dlžíš ${formatCurrency(Math.abs(relative))}` : "vyrovnané"}
                      </button>
                    )}
                  </div>
                );
              })}
          </div>
          {myDebts.length > 0 && (
            <button
              type="button"
              onClick={() => void openPayoutModal()}
              className="mt-4 h-12 w-full rounded-xl bg-[rgb(124,58,237)] text-sm font-semibold text-white hover:bg-[rgb(109,40,217)]"
            >
              Vyplatiť
            </button>
          )}
        </section>
      </div>

      {memberModalOpen && selectedMember && (
        <div className="fixed inset-0 z-[170] flex items-center justify-center px-5">
          <button
            type="button"
            className="absolute inset-0 bg-black/70 backdrop-blur-[2px]"
            onClick={() => {
              if (memberActionLoading) return;
              setMemberModalOpen(false);
              setSelectedMember(null);
              setMemberActionError(null);
            }}
            aria-label="Zavrieť možnosti používateľa"
          />
          <div className="relative w-full max-w-sm rounded-2xl border border-white/15 bg-[#151922] p-5 shadow-2xl">
            <h4 className="text-lg font-bold text-foreground">Možnosti používateľa</h4>
            <p className="mt-1 text-sm text-foreground/75">
              {selectedMember.fullName || selectedMember.email || "Používateľ"}
            </p>
            {memberActionError && (
              <p className="mt-3 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                {memberActionError}
              </p>
            )}
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                className="h-10 flex-1 rounded-xl border border-white/15 bg-white/[0.02] text-sm font-semibold text-foreground/85 hover:bg-white/[0.06] disabled:opacity-50"
                onClick={() => {
                  if (memberActionLoading) return;
                  setMemberModalOpen(false);
                  setSelectedMember(null);
                  setMemberActionError(null);
                }}
                disabled={memberActionLoading}
              >
                Zrušiť
              </button>
              <button
                type="button"
                className="h-10 flex-1 rounded-xl bg-red-500/85 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
                disabled={memberActionLoading}
                onClick={async () => {
                  try {
                    setMemberActionLoading(true);
                    setMemberActionError(null);
                    await api.pockets.removeMember(pocket.id, selectedMember.uid);
                    const result = (await api.pockets.get(pocketId)) as PocketDetail;
                    setPocket(result);
                    setMemberModalOpen(false);
                    setSelectedMember(null);
                  } catch (err: any) {
                    setMemberActionError(err.message || "Používateľa sa nepodarilo odstrániť.");
                  } finally {
                    setMemberActionLoading(false);
                  }
                }}
              >
                {memberActionLoading ? "Mažem..." : "Vymazať"}
              </button>
            </div>
          </div>
        </div>
      )}

      {isPayoutModalOpen && (
        <div
          className={`fixed inset-0 z-[175] transition-opacity duration-300 ${
            isPayoutSheetOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
          }`}
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/70 backdrop-blur-[2px]"
            onClick={closePayoutModal}
            aria-label="Zavrieť vyplatenie"
          />
          <div
            className={`absolute bottom-0 left-0 right-0 rounded-t-3xl border-t border-white/15 bg-gradient-to-b from-[#181a20] to-[#111318] px-5 pb-6 pt-4 shadow-2xl ${
              isPayoutSheetDragging ? "" : "transition-transform duration-300 ease-out"
            }`}
            onTouchStart={handlePayoutSheetTouchStart}
            onTouchMove={handlePayoutSheetTouchMove}
            onTouchEnd={handlePayoutSheetTouchEnd}
            onTouchCancel={handlePayoutSheetTouchEnd}
            onClick={(e) => e.stopPropagation()}
            style={{
              height: "56vh",
              transform: isPayoutSheetOpen ? `translateY(${payoutSheetDragOffset}px)` : "translateY(100%)",
            }}
          >
            <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-white/20" />
            <h4 className="text-lg font-bold text-foreground">Vyplatiť dlhy</h4>
            <p className="mt-1 text-sm text-foreground/70">Vyber komu chceš poslať platbu cez Payme.</p>
            <div className="mt-4 h-[calc(56vh-120px)] space-y-2 overflow-y-auto pr-1">
              {payoutError && (
                <p className="rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                  {payoutError}
                </p>
              )}
              {myDebts.map((item) => {
                const pocketMember = pocket.members.find((member) => member.uid === item.uid) || null;
                const avatarUrl = pocketMember?.profileImageUrl || null;
                const iban = pocketMember?.iban?.trim() || "";
                const paymeUrl = iban
                  ? buildPayMeUrl({
                      iban,
                      amount: item.amount,
                      creditorName: pocketMember?.fullName || item.name,
                      message: `${pocket.name} - vyplatenie`,
                    })
                  : "";
                return (
                  <div key={`pay-${item.uid}`} className="flex items-center justify-between py-2.5">
                    <div className="flex min-w-0 items-center gap-3">
                      {avatarUrl ? (
                        <img
                          src={avatarUrl}
                          alt={item.name}
                          className="h-10 w-10 rounded-full object-cover"
                        />
                      ) : (
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-sm font-semibold text-foreground">
                          {item.name.slice(0, 1).toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">{item.name}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (!paymeUrl) {
                          setPayoutError(`Používateľ ${item.name} nemá vyplnený IBAN.`);
                          return;
                        }
                        setPayoutError(null);
                        setPendingPaymePayment({
                          uid: item.uid,
                          name: item.name,
                          amount: item.amount,
                        });
                        const paymeWindow = window.open(paymeUrl, "_blank", "noopener,noreferrer");
                        // Niektoré prehliadače vracajú null aj keď nové okno skutočne otvorili.
                        // Preto to neberieme ako spoľahlivý signál blokovaného popupu.
                        paymeWindowRef.current = paymeWindow ?? null;
                        setAwaitingPaymeReturn(true);
                        if (paymeWindowWatchRef.current) {
                          window.clearInterval(paymeWindowWatchRef.current);
                        }
                        if (paymeConfirmFallbackRef.current) {
                          window.clearTimeout(paymeConfirmFallbackRef.current);
                        }
                        paymeWindowWatchRef.current = window.setInterval(() => {
                          const opened = paymeWindowRef.current;
                          if (opened && opened.closed) {
                            if (paymeWindowWatchRef.current) {
                              window.clearInterval(paymeWindowWatchRef.current);
                              paymeWindowWatchRef.current = null;
                            }
                            setAwaitingPaymeReturn(false);
                            setPaymeConfirmOpen(true);
                            setPaymeConfirmError(null);
                            paymeWindowRef.current = null;
                          }
                        }, 500);
                        paymeConfirmFallbackRef.current = window.setTimeout(() => {
                          setAwaitingPaymeReturn(false);
                          setPaymeConfirmOpen(true);
                          setPaymeConfirmError(null);
                        }, 12000);
                      }}
                      className="ml-3 rounded-md border border-amber-300/40 bg-amber-400/90 px-3 py-1.5 text-xs font-semibold text-black"
                    >
                      {`Vyplatiť ${formatCurrency(item.amount)}`}
                    </button>
                  </div>
                );
              })}
              {myDebts.length === 0 && (
                <p className="text-sm text-foreground/70">Nemáš žiadne dlhy na vyplatenie.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {paymeConfirmOpen && pendingPaymePayment && (
        <div className="fixed inset-0 z-[185] flex items-center justify-center px-5">
          <button
            type="button"
            className="absolute inset-0 bg-black/70 backdrop-blur-[2px]"
            onClick={() => {
              if (confirmingPaymePayment) return;
              setPaymeConfirmOpen(false);
              setPaymeConfirmError(null);
              if (paymeConfirmFallbackRef.current) {
                window.clearTimeout(paymeConfirmFallbackRef.current);
                paymeConfirmFallbackRef.current = null;
              }
            }}
            aria-label="Zavrieť potvrdenie Payme"
          />
          <div className="relative w-full max-w-sm rounded-2xl border border-white/15 bg-[#151922] p-5 shadow-2xl">
            <h4 className="text-lg font-bold text-foreground">Prebehla platba?</h4>
            <p className="mt-2 text-sm text-foreground/75">
              Potvrď, či si zaplatil(a) <span className="font-semibold text-foreground">{pendingPaymePayment.name}</span>{" "}
              sumu <span className="font-semibold text-foreground">{formatCurrency(pendingPaymePayment.amount)}</span>.
            </p>
            {paymeConfirmError && (
              <p className="mt-3 rounded-lg border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                {paymeConfirmError}
              </p>
            )}
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                className="h-10 flex-1 rounded-xl border border-white/15 bg-white/[0.02] text-sm font-semibold text-foreground/85 hover:bg-white/[0.06] disabled:opacity-50"
                onClick={() => {
                  if (confirmingPaymePayment) return;
                  setPaymeConfirmOpen(false);
                  setPendingPaymePayment(null);
                  setPaymeConfirmError(null);
                  if (paymeConfirmFallbackRef.current) {
                    window.clearTimeout(paymeConfirmFallbackRef.current);
                    paymeConfirmFallbackRef.current = null;
                  }
                }}
                disabled={confirmingPaymePayment}
              >
                Nie
              </button>
              <button
                type="button"
                className="h-10 flex-1 rounded-xl bg-[rgb(124,58,237)] text-sm font-semibold text-white hover:bg-[rgb(109,40,217)] disabled:opacity-50"
                onClick={() => void confirmPaymePaid()}
                disabled={confirmingPaymePayment}
              >
                {confirmingPaymePayment ? "Ukladám..." : "Áno, zaplatil(a) som"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div
        className={`fixed inset-0 z-[165] transition-opacity duration-300 ${
          isAddPeopleSheetOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <button
          type="button"
          className="absolute inset-0 bg-black/60 backdrop-blur-[1px]"
          onClick={closeAddPeopleSheet}
          aria-label="Zavrieť pridanie ľudí"
        />
        <div
          className={`absolute bottom-0 left-0 right-0 rounded-t-3xl border-t border-white/10 bg-gradient-to-b from-[#181a20] to-[#111318] px-5 pb-6 pt-4 shadow-2xl ${
            isAddPeopleSheetDragging ? "" : "transition-transform duration-300 ease-out"
          }`}
          onTouchStart={handleAddPeopleSheetTouchStart}
          onTouchMove={handleAddPeopleSheetTouchMove}
          onTouchEnd={handleAddPeopleSheetTouchEnd}
          onTouchCancel={handleAddPeopleSheetTouchEnd}
          onClick={(e) => e.stopPropagation()}
          style={{
            height: "76vh",
            transform: isAddPeopleSheetOpen ? `translateY(${addPeopleSheetDragOffset}px)` : "translateY(100%)",
          }}
        >
          <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-white/20" />
          <h3 className="text-2xl font-bold text-foreground">Koho chceš pridať do pocketu?</h3>
          <p className="mt-1 text-sm text-foreground/75">Vyhľadaj ľudí podľa e-mailu a pridaj ich do zoznamu členov pocketu.</p>

          <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-foreground/55" />
              <input
                type="text"
                inputMode="email"
                placeholder="Vyhľadaj podľa e-mailu"
                value={userSearchQuery}
                onChange={(e) => setUserSearchQuery(e.target.value)}
                className="h-12 w-full rounded-lg border border-white/20 bg-white/10 pl-12 pr-4 text-foreground placeholder:text-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            {searchLoading && <p className="mt-3 text-sm text-foreground/70">Vyhľadávam používateľov...</p>}
            {searchError && <p className="mt-3 text-sm text-red-300">{searchError}</p>}
            {!searchLoading && !searchError && userSearchQuery.trim().length >= 2 && searchResults.length === 0 && (
              <p className="mt-3 text-sm text-foreground/70">Nikoho sa nepodarilo nájsť.</p>
            )}
            {searchResults.length > 0 && (
              <div className="mt-3 space-y-2">
                {searchResults.map((result) => {
                  const displayName = result.fullName || result.email || "Používateľ";
                  const normalizedEmail = (result.email || "").trim().toLowerCase();
                  const alreadyInPocket = pocket.members.some(
                    (member) =>
                      member.uid === result.uid ||
                      ((member.email || "").trim().toLowerCase() === normalizedEmail && normalizedEmail.length > 0),
                  );
                  return (
                    <div
                      key={result.uid}
                      className="flex items-center justify-between rounded-xl border border-white/10 bg-black/15 px-4 py-3"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        {result.profileImageUrl ? (
                          <img src={result.profileImageUrl} alt={displayName} className="h-10 w-10 rounded-full object-cover" />
                        ) : (
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-sm font-semibold text-foreground">
                            {displayName.slice(0, 1).toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-foreground">{displayName}</p>
                          <p className="truncate text-xs text-foreground/65">{result.email || "Bez e-mailu"}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        disabled={alreadyInPocket || inviteLoadingUid === result.uid}
                        onClick={async () => {
                          try {
                            setInviteLoadingUid(result.uid);
                            setSearchError(null);
                            await api.pockets.inviteByUid(pocket.id, result.uid);
                            const refreshed = (await api.pockets.get(pocket.id)) as PocketDetail;
                            setPocket(refreshed);
                          } catch (err: any) {
                            setSearchError(err.message || "Pozvánku sa nepodarilo odoslať.");
                          } finally {
                            setInviteLoadingUid(null);
                          }
                        }}
                        className="ml-3 inline-flex h-9 items-center rounded-full border border-white/20 px-3 text-sm font-semibold text-foreground/85 disabled:opacity-50"
                      >
                        {alreadyInPocket ? "Pridaný" : inviteLoadingUid === result.uid ? "Posielam..." : "Pridať"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center gap-2">
              <UserPlus className="h-5 w-5 text-[rgb(196,181,253)]" />
              <p className="text-sm font-semibold text-foreground">Ľudia v tomto pockete</p>
            </div>
            <div className="mt-3 space-y-2">
              {pocket.members
                .map((member) => {
                  const displayName = member.fullName || member.email || "Používateľ";
                  const isPending = member.status === "pending";
                  return (
                    <div
                      key={`sheet-member-${member.uid}`}
                      className={`flex items-center justify-between rounded-xl border border-white/10 bg-black/15 px-4 py-3 ${
                        isPending ? "opacity-55" : ""
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        {member.profileImageUrl ? (
                          <img src={member.profileImageUrl} alt={displayName} className="h-10 w-10 rounded-full object-cover" />
                        ) : (
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-sm font-semibold text-foreground">
                            {displayName.slice(0, 1).toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-foreground">{displayName}</p>
                          <p className="truncate text-xs text-foreground/65">{member.email || "Bez e-mailu"}</p>
                        </div>
                      </div>
                      <span className="text-xs font-semibold uppercase tracking-[0.12em] text-foreground/65">
                        {member.uid === currentUid ? "Ty" : isPending ? "Pozvaný" : "Člen"}
                      </span>
                    </div>
                  );
                })}
              {pocket.members.length === 0 && (
                <p className="text-sm text-foreground/70">Zatiaľ tu nikto nie je.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
