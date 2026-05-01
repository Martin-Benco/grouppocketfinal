"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Pencil, Receipt, Trash2 } from "lucide-react";
import { api } from "@/lib/api/client";

type PocketMember = {
  uid: string;
  email: string | null;
  fullName: string | null;
  profileImageUrl: string | null;
  status: "accepted" | "pending" | "rejected";
};

type PocketTransaction = {
  id: string;
  name: string;
  amount: number;
  payerUid: string;
  tag: string | null;
  note?: string | null;
  splitAssignedUids?: string[];
  date?: string;
  createdAt?: string;
};

type PocketDetail = {
  id: string;
  name: string;
  tags?: string[];
  members: PocketMember[];
  transactions?: PocketTransaction[];
  updatedAt?: string;
};

function formatCurrency(value: number) {
  return `${value.toFixed(2)} €`;
}

function formatSkDate(iso: string | undefined | null): string | null {
  if (!iso?.trim()) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.trim();
  return d.toLocaleDateString("sk-SK", { day: "numeric", month: "long", year: "numeric" });
}

function isPayoutTransaction(tx: PocketTransaction) {
  return (tx.tag || "").trim().toLowerCase() === "vyplatenie";
}

export function PocketTransactionsScreen({ pocketId }: { pocketId: string }) {
  const router = useRouter();
  const [pocket, setPocket] = useState<PocketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTagFilter, setActiveTagFilter] = useState<string>("");
  const [selectedTx, setSelectedTx] = useState<PocketTransaction | null>(null);
  const [detailActionError, setDetailActionError] = useState<string | null>(null);
  const [detailDeleting, setDetailDeleting] = useState(false);
  const [txDeleteConfirmOpen, setTxDeleteConfirmOpen] = useState(false);
  const [isDetailSheetOpen, setIsDetailSheetOpen] = useState(false);
  const [detailSheetDragOffset, setDetailSheetDragOffset] = useState(0);
  const [isDetailSheetDragging, setIsDetailSheetDragging] = useState(false);
  const detailSheetDragStartYRef = useRef<number | null>(null);
  const detailCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        setError(err.message || "Nepodarilo sa načítať transakcie.");
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
    setDetailActionError(null);
  }, [selectedTx?.id]);

  useEffect(() => {
    if (!selectedTx) return;
    if (detailCloseTimerRef.current) {
      clearTimeout(detailCloseTimerRef.current);
      detailCloseTimerRef.current = null;
    }
    setIsDetailSheetOpen(true);
    setIsDetailSheetDragging(false);
    setDetailSheetDragOffset(0);
    detailSheetDragStartYRef.current = null;
  }, [selectedTx?.id]);

  useEffect(
    () => () => {
      if (detailCloseTimerRef.current) {
        clearTimeout(detailCloseTimerRef.current);
      }
    },
    [],
  );

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
            {error || "Transakcie sa nepodarilo načítať."}
          </div>
        </div>
      </div>
    );
  }

  const acceptedMembers = pocket.members.filter((m) => m.status === "accepted");
  const transactions = pocket.transactions ?? [];
  const filteredTransactions = activeTagFilter
    ? transactions.filter((tx) => tx.tag === activeTagFilter)
    : transactions;
  const selectedTxPayer = selectedTx
    ? acceptedMembers.find((member) => member.uid === selectedTx.payerUid)
    : null;
  const selectedDebtors = selectedTx
    ? acceptedMembers.filter((member) => {
        if (member.uid === selectedTx.payerUid) return false;
        const assigned = selectedTx.splitAssignedUids ?? [];
        return assigned.length === 0 || assigned.includes(member.uid);
      })
    : [];
  const amountPerDebtor =
    selectedTx && selectedDebtors.length > 0 ? selectedTx.amount / selectedDebtors.length : 0;
  const payerDisplay =
    selectedTxPayer?.fullName || selectedTxPayer?.email || "Platca";
  const payoutTargetUid = selectedTx ? (selectedTx.splitAssignedUids || [])[0] || "" : "";
  const payoutTarget = payoutTargetUid ? acceptedMembers.find((member) => member.uid === payoutTargetUid) : null;
  const payoutTargetDisplay = payoutTarget?.fullName || payoutTarget?.email || "Používateľ";
  const payerToTargetLine =
    selectedTx && isPayoutTransaction(selectedTx) ? `${payerDisplay} -> ${payoutTargetDisplay}` : payerDisplay;
  const debtorGraphItems = selectedDebtors.slice(0, 4).map((debtor, idx) => {
    const count = Math.min(selectedDebtors.length, 4);
    const yByCount: Record<number, number[]> = {
      1: [50],
      2: [36, 64],
      3: [28, 50, 72],
      4: [22, 40, 60, 78],
    };
    const y = (yByCount[count] || yByCount[4])[idx];
    return { debtor, x: 12, y };
  });
  const trunkMidY =
    debtorGraphItems.length > 0
      ? (debtorGraphItems[0].y + debtorGraphItems[debtorGraphItems.length - 1].y) / 2
      : 50;
  const getInitial = (value: string) => value.trim().slice(0, 1).toUpperCase();

  const closeSelectedTxSheet = () => {
    setTxDeleteConfirmOpen(false);
    setIsDetailSheetOpen(false);
    setIsDetailSheetDragging(false);
    setDetailSheetDragOffset(0);
    detailSheetDragStartYRef.current = null;
    if (detailCloseTimerRef.current) {
      clearTimeout(detailCloseTimerRef.current);
    }
    detailCloseTimerRef.current = setTimeout(() => {
      setSelectedTx(null);
      detailCloseTimerRef.current = null;
    }, 280);
  };

  const askDeleteTx = () => {
    setTxDeleteConfirmOpen(true);
  };

  const cancelDeleteTx = () => {
    if (detailDeleting) return;
    setTxDeleteConfirmOpen(false);
  };

  const confirmDeleteTx = async () => {
    if (!selectedTx) return;
    try {
      setDetailDeleting(true);
      setDetailActionError(null);
      await api.pockets.deleteTransaction(pocket.id, selectedTx.id);
      const fresh = (await api.pockets.get(pocket.id)) as PocketDetail;
      setPocket(fresh);
      setTxDeleteConfirmOpen(false);
      closeSelectedTxSheet();
    } catch (err: any) {
      setDetailActionError(err.message || "Transakciu sa nepodarilo vymazať.");
      setTxDeleteConfirmOpen(false);
    } finally {
      setDetailDeleting(false);
    }
  };

  const handleDetailSheetTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    detailSheetDragStartYRef.current = e.touches[0]?.clientY ?? null;
    setIsDetailSheetDragging(true);
  };

  const handleDetailSheetTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (detailSheetDragStartYRef.current === null) return;
    const currentY = e.touches[0]?.clientY ?? detailSheetDragStartYRef.current;
    const delta = Math.max(0, currentY - detailSheetDragStartYRef.current);
    setDetailSheetDragOffset(delta);
  };

  const handleDetailSheetTouchEnd = () => {
    const shouldClose = detailSheetDragOffset > 90;
    setIsDetailSheetDragging(false);
    if (shouldClose) {
      closeSelectedTxSheet();
      return;
    }
    setDetailSheetDragOffset(0);
    detailSheetDragStartYRef.current = null;
  };

  return (
    <div className="min-h-screen bg-background page-slide-up-enter">
      <div className="mx-auto max-w-screen-sm px-5 py-6">
        <div className="sticky top-0 z-20 -mx-5 mb-4 flex items-center gap-3 bg-background/95 px-5 py-2 backdrop-blur">
          <button
            type="button"
            onClick={() => router.replace(`/pockety/detail?pocketId=${encodeURIComponent(pocket.id)}`)}
            className="text-foreground"
            aria-label="Späť na detail pocketu"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
          <h1 className="text-xl font-bold text-foreground">Transakcie</h1>
        </div>

        {(pocket.tags?.length ?? 0) > 0 && (
          <div className="mb-4">
            <div className="flex flex-wrap gap-2">
              {pocket.tags?.map((tag) => {
                const selected = activeTagFilter === tag;
                return (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => setActiveTagFilter((prev) => (prev === tag ? "" : tag))}
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
        )}

        {filteredTransactions.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-transparent px-6 py-10">
            <div className="flex flex-col items-center justify-center py-4 text-center">
              <Receipt className="h-11 w-11 text-[#9CA3AF]" />
              <p className="mt-4 text-base font-semibold text-foreground">
                {activeTagFilter ? "Pre tento tag tu nič nie je" : "Zatiaľ žiadne výdavky"}
              </p>
              <p className="mt-2 max-w-[240px] text-sm leading-6 text-muted-foreground">
                {activeTagFilter
                  ? "Skús vybrať iný tag alebo filter vypnúť kliknutím na označený tag."
                  : "Keď pridáš prvú transakciu, zobrazí sa práve tu."}
              </p>
            </div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-white/10 bg-transparent">
            {filteredTransactions.map((tx, index) => {
              const payer = acceptedMembers.find((member) => member.uid === tx.payerUid);
              const payerName = payer?.fullName || payer?.email || "Používateľ";
              const txTargetUid = (tx.splitAssignedUids || [])[0] || "";
              const txTarget = txTargetUid ? acceptedMembers.find((member) => member.uid === txTargetUid) : null;
              const txTargetDisplay = txTarget?.fullName || txTarget?.email || "Používateľ";
              const payerLine = isPayoutTransaction(tx) ? `${payerName} -> ${txTargetDisplay}` : payerName;
              return (
                <button
                  key={tx.id}
                  type="button"
                  onClick={() => setSelectedTx(tx)}
                  className="relative flex w-full items-center justify-between px-4 py-3.5 text-left"
                >
                  {index < filteredTransactions.length - 1 && (
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
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div
        className={`fixed inset-0 z-[140] transition-opacity duration-300 ${
          selectedTx
            ? isDetailSheetOpen
              ? "pointer-events-auto opacity-100"
              : "pointer-events-none opacity-0"
            : "pointer-events-none opacity-0"
        }`}
      >
        {selectedTx && (
          <>
          <button
            type="button"
            className="absolute inset-0 bg-black/65 backdrop-blur-[1px]"
            onClick={closeSelectedTxSheet}
            aria-label="Zavrieť prehľad transakcie"
          />
          <div
            className={`absolute bottom-0 left-0 right-0 flex max-h-[min(92vh,720px)] flex-col rounded-t-3xl border-t border-white/10 bg-[#12151d] shadow-2xl ${
              isDetailSheetDragging ? "" : "transition-transform duration-300 ease-out"
            }`}
            onTouchStart={handleDetailSheetTouchStart}
            onTouchMove={handleDetailSheetTouchMove}
            onTouchEnd={handleDetailSheetTouchEnd}
            onTouchCancel={handleDetailSheetTouchEnd}
            onClick={(e) => e.stopPropagation()}
            style={{
              transform: isDetailSheetOpen ? `translateY(${detailSheetDragOffset}px)` : "translateY(100%)",
            }}
          >
            <div className="mx-auto mt-3 h-1.5 w-12 shrink-0 rounded-full bg-white/20" />
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6 pt-7">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <h3 className="text-2xl font-bold leading-snug text-foreground">{selectedTx.name}</h3>
                <span className="mt-2 inline-block rounded-full border border-white/12 bg-white/[0.06] px-2.5 py-0.5 text-[11px] font-medium text-foreground/80">
                  {selectedTx.tag || "Bez tagu"}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-0.5 pt-0.5">
                <button
                  type="button"
                  className="rounded-xl p-2.5 text-foreground/80 transition hover:bg-white/[0.08] hover:text-foreground disabled:opacity-40"
                  aria-label="Upraviť transakciu"
                  disabled={detailDeleting}
                  onClick={() => {
                    const id = selectedTx.id;
                    setSelectedTx(null);
                    router.push(
                      `/pockety/detail/new-transaction?pocketId=${encodeURIComponent(pocket.id)}&editTransactionId=${encodeURIComponent(id)}&returnTo=transactions`,
                    );
                  }}
                >
                  <Pencil className="h-5 w-5" />
                </button>
                <button
                  type="button"
                  className="rounded-xl p-2.5 text-red-300/90 transition hover:bg-red-500/15 disabled:opacity-40"
                  aria-label="Vymazať transakciu"
                  disabled={detailDeleting}
                  onClick={askDeleteTx}
                >
                  <Trash2 className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="mt-6">
              <p className="text-2xl font-bold tracking-tight text-foreground">{formatCurrency(selectedTx.amount)}</p>
              <dl className="mt-4 space-y-2.5 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <dt className="shrink-0 text-foreground/55">
                    {selectedTx && isPayoutTransaction(selectedTx) ? "Kto platil komu" : "Platí"}
                  </dt>
                  <dd className="text-right font-medium text-foreground/95">
                    {payerToTargetLine}
                  </dd>
                </div>
                <div className="flex items-start justify-between gap-3">
                  <dt className="shrink-0 text-foreground/55">Počet dlžníkov</dt>
                  <dd className="text-right font-medium text-foreground/95">{selectedDebtors.length}</dd>
                </div>
                {formatSkDate(selectedTx.date) && (
                  <div className="flex items-start justify-between gap-3">
                    <dt className="shrink-0 text-foreground/55">Dátum</dt>
                    <dd className="text-right font-medium text-foreground/95">{formatSkDate(selectedTx.date)}</dd>
                  </div>
                )}
                {selectedTx.createdAt?.trim() && (
                  <div className="flex items-start justify-between gap-3">
                    <dt className="shrink-0 text-foreground/55">Zaznamenané</dt>
                    <dd className="text-right font-medium text-foreground/95">
                      {new Date(selectedTx.createdAt).toLocaleString("sk-SK", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </dd>
                  </div>
                )}
                {selectedTx.note?.trim() && (
                  <div className="flex items-start justify-between gap-3">
                    <dt className="shrink-0 text-foreground/55">Poznámka</dt>
                    <dd className="max-w-[65%] text-right font-medium text-foreground/95">
                      {selectedTx.note}
                    </dd>
                  </div>
                )}
              </dl>
            </div>

            <div className="mt-6 border-t border-white/10 pt-5">
              <p className="mb-3 text-sm font-semibold text-foreground/75">Ako sa to delí</p>
              <div className="relative mx-auto h-52 w-full max-w-sm">
                <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                  <defs>
                    <marker id="arrow-to-payer" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                      <path d="M0,0 L6,3 L0,6 Z" fill="rgba(196,181,253,0.9)" />
                    </marker>
                  </defs>
                  {debtorGraphItems.length > 1 && (
                    <line
                      x1={56}
                      y1={debtorGraphItems[0].y}
                      x2={56}
                      y2={debtorGraphItems[debtorGraphItems.length - 1].y}
                      stroke="rgba(196,181,253,0.45)"
                      strokeWidth="1"
                    />
                  )}
                  {debtorGraphItems.map((item) => (
                    <g key={`line-${item.debtor.uid}`}>
                      <line
                        x1={item.x + 6}
                        y1={item.y}
                        x2={56}
                        y2={item.y}
                        stroke="rgba(196,181,253,0.55)"
                        strokeWidth="0.9"
                      />
                      <line
                        x1={56}
                        y1={50}
                        x2={70}
                        y2={50}
                        stroke="rgba(196,181,253,0.65)"
                        strokeWidth="1.1"
                        markerEnd="url(#arrow-to-payer)"
                      />
                    </g>
                  ))}
                </svg>

                {debtorGraphItems.map((item) => {
                  const debtorName = item.debtor.fullName || item.debtor.email || "Používateľ";
                  const photo = item.debtor.profileImageUrl;
                  return (
                    <Fragment key={item.debtor.uid}>
                      <div
                        className="absolute z-20 h-11 w-11 -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-full border border-white/25 bg-[#1a1e28]"
                        style={{ left: `${item.x}%`, top: `${item.y}%` }}
                      >
                        {photo ? (
                          <img
                            src={photo}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-xs font-semibold text-foreground/90">
                            {getInitial(debtorName)}
                          </div>
                        )}
                      </div>
                      <div
                        className="pointer-events-none absolute z-20 max-w-[80px] -translate-x-1/2 text-center"
                        style={{
                          left: `${item.x}%`,
                          top: `${item.y}%`,
                          transform: "translate(-50%, 30px)",
                        }}
                      >
                        <span className="block truncate text-[9px] font-medium leading-tight text-foreground/80">
                          {debtorName}
                        </span>
                      </div>
                    </Fragment>
                  );
                })}
                <div
                  className="absolute z-20 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/15 bg-[#141824] px-2 py-0.5 text-[10px] font-medium text-foreground/80"
                  style={
                    debtorGraphItems.length > 1
                      ? { left: "56%", top: `${trunkMidY}%` }
                      : { left: "34%", top: `${debtorGraphItems[0]?.y ?? 50}%` }
                  }
                >
                  {amountPerDebtor.toFixed(2)} €
                </div>

                <div
                  className="absolute left-[82%] top-1/2 z-30 h-[74px] w-[74px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-full border border-[rgb(124,58,237)] bg-[radial-gradient(circle,rgba(124,58,237,0.45)_0%,rgba(124,58,237,0.16)_72%)]"
                >
                  {selectedTxPayer?.profileImageUrl ? (
                    <img
                      src={selectedTxPayer.profileImageUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-2xl font-bold text-white">
                      {getInitial(payerDisplay)}
                    </div>
                  )}
                </div>
                <div
                  className="pointer-events-none absolute left-[82%] z-30 max-w-[96px] -translate-x-1/2 text-center"
                  style={{ top: "calc(50% + 37px + 10px)" }}
                >
                  <span className="block truncate text-[10px] font-semibold leading-tight text-foreground/90">
                    {payerDisplay}
                  </span>
                </div>
              </div>
            </div>

            {detailActionError && (
              <div className="mt-4 rounded-xl border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                {detailActionError}
              </div>
            )}
            </div>
          </div>
          </>
        )}
      </div>

      {txDeleteConfirmOpen && (
        <div className="fixed inset-0 z-[160] flex items-center justify-center px-5">
          <button
            type="button"
            className="absolute inset-0 bg-black/70 backdrop-blur-[2px]"
            onClick={cancelDeleteTx}
            aria-label="Zavrieť potvrdenie mazania"
          />
          <div className="relative w-full max-w-sm rounded-2xl border border-white/15 bg-[#151922] p-5 shadow-2xl">
            <h4 className="text-lg font-bold text-foreground">Vymazať transakciu?</h4>
            <p className="mt-2 text-sm text-foreground/75">
              Túto akciu už nebude možné vrátiť späť.
            </p>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                className="h-10 flex-1 rounded-xl border border-white/15 bg-white/[0.02] text-sm font-semibold text-foreground/85 hover:bg-white/[0.06] disabled:opacity-50"
                onClick={cancelDeleteTx}
                disabled={detailDeleting}
              >
                Zrušiť
              </button>
              <button
                type="button"
                className="h-10 flex-1 rounded-xl bg-red-500/85 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50"
                onClick={confirmDeleteTx}
                disabled={detailDeleting}
              >
                {detailDeleting ? "Mažem..." : "Vymazať"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
