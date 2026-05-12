"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { FolderOpen, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api/client";
import { resolvePocketTransactionSplit } from "@/lib/pockets/transactionSplit";
import { Button } from "@/components/ui/button";

type PocketMember = {
  uid: string;
  email: string | null;
  fullName: string | null;
  profileImageUrl: string | null;
  status: "accepted" | "pending" | "rejected";
};

type PocketListItem = {
  id: string;
  name: string;
  tags: string[];
  ownerUid: string | null;
  updatedAt: string;
  members: PocketMember[];
};

type PocketTransaction = {
  amount: number;
  payerUid: string;
  splitAssignedUids?: string[];
};

type PocketDetailStats = {
  analytics?: {
    totalAmount?: number;
  };
  transactions?: PocketTransaction[];
};

function formatCurrency(value: number) {
  return `${value.toFixed(2)} €`;
}

function formatMembersCount(count: number) {
  if (count === 1) return "1 člen";
  if (count >= 2 && count <= 4) return `${count} členovia`;
  return `${count} členov`;
}

export function PocketsHome() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [accepted, setAccepted] = useState<PocketListItem[]>([]);
  const [pending, setPending] = useState<PocketListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyPocketId, setBusyPocketId] = useState<string | null>(null);
  const [pocketStats, setPocketStats] = useState<
    Record<string, { totalPaid: number; myNet: number }>
  >({});

  const loadPockets = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const result = (await api.pockets.mine()) as {
        accepted: PocketListItem[];
        pending: PocketListItem[];
      };
      const acceptedPockets = result.accepted || [];
      setAccepted(acceptedPockets);
      setPending(result.pending || []);
      const details = await Promise.all(
        acceptedPockets.map(async (pocket) => {
          try {
            const detail = (await api.pockets.getFresh(pocket.id)) as PocketDetailStats;
            const acceptedMembers = pocket.members.filter((member) => member.status === "accepted");
            const acceptedMemberUids = acceptedMembers.map((member) => member.uid);
            const transactions = detail.transactions || [];
            const totalPaid =
              detail.analytics?.totalAmount ??
              transactions.reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0);
            const myUid = user?.uid || "";
            let myNet = 0;
            transactions.forEach((tx) => {
              const amount = Number(tx.amount) || 0;
              if (amount <= 0) return;
              const resolved = resolvePocketTransactionSplit({
                amount,
                payerUid: tx.payerUid,
                splitAssignedUids: tx.splitAssignedUids,
                acceptedMemberUids,
              });
              if (!resolved) return;
              if (tx.payerUid === myUid) {
                myNet += amount;
              }
              if (resolved.splitUids.length > 0) {
                if (resolved.splitUids.includes(myUid)) {
                  myNet -= resolved.sharePerPerson;
                }
              } else if (resolved.debtorUids.includes(myUid)) {
                myNet -= resolved.sharePerPerson;
              }
            });
            return [pocket.id, { totalPaid, myNet }] as const;
          } catch {
            return [pocket.id, { totalPaid: 0, myNet: 0 }] as const;
          }
        }),
      );
      setPocketStats(Object.fromEntries(details));
    } catch (err: any) {
      setError(err.message || "Vrecká sa nepodarilo načítať");
    } finally {
      setIsLoading(false);
    }
  }, [user?.uid]);

  useEffect(() => {
    if (!user) {
      setIsLoading(false);
      setAccepted([]);
      setPending([]);
      setPocketStats({});
      return;
    }
    void loadPockets();
  }, [user, loadPockets]);

  useEffect(() => {
    router.prefetch("/pockety/new");
    accepted.slice(0, 8).forEach((pocket) => {
      router.prefetch(`/pockety/detail?pocketId=${encodeURIComponent(pocket.id)}`);
    });
  }, [accepted, router]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background w-full flex items-center justify-center">
        <div className="text-muted-foreground">Načítavam…</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-background w-full">
        <div className="mx-auto flex min-h-screen max-w-screen-sm items-center px-5 py-8">
          <div className="w-full rounded-[28px] border border-white/10 bg-white/[0.03] p-6 text-center shadow-[0_20px_80px_rgba(0,0,0,0.25)]">
            <h1 className="text-2xl font-bold text-foreground">Najprv sa prihláste</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Na zobrazenie vriek potrebujete byť prihlásený.
            </p>
            <Button asChild className="mt-8 h-12 w-full rounded-xl bg-[rgb(124,58,237)] text-white text-sm font-semibold hover:bg-[rgb(109,40,217)]">
              <Link href="/ucet">Prejsť na prihlásenie</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background w-full flex items-center justify-center">
        <div className="text-muted-foreground">Načítavam…</div>
      </div>
    );
  }

  if (accepted.length === 0 && pending.length === 0) {
    return (
      <div className="min-h-screen bg-background w-full">
        <div className="mx-auto flex min-h-screen max-w-screen-sm items-center px-5 py-8">
          <div className="w-full rounded-[28px] border border-white/10 bg-white/[0.03] p-6 text-center shadow-[0_20px_80px_rgba(0,0,0,0.25)]">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[rgba(124,58,237,0.14)] text-[rgb(167,139,250)]">
              <FolderOpen className="h-8 w-8" />
            </div>
            <h1 className="mt-6 text-2xl font-bold text-foreground">
              Zatiaľ nemáte žiadne vrecká
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Vytvorte prvé vrecko a majte spoločné výdavky na jednom mieste — prehľadne a bez stresu.
            </p>
            <Button
              asChild
              className="mt-8 h-12 w-full rounded-xl bg-[rgb(124,58,237)] text-white text-sm font-semibold hover:bg-[rgb(109,40,217)]"
            >
              <Link href="/pockety/new">Vytvoriť prvé vrecko</Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const handleRespond = async (pocketId: string, status: "accepted" | "rejected") => {
    try {
      setBusyPocketId(pocketId);
      await api.pockets.respondToInvite(pocketId, status);
      await loadPockets();
      if (status === "accepted") {
        router.push(`/pockety/detail?pocketId=${encodeURIComponent(pocketId)}`);
      }
    } catch (err: any) {
      setError(err.message || "Pozvánku sa nepodarilo spracovať");
    } finally {
      setBusyPocketId(null);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-screen-sm px-5 py-6 space-y-6">
        {error && (
          <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">Vrecká</h1>
          </div>
          <Button
            asChild
            variant="ghost"
            className="h-11 w-11 p-0 text-[rgb(124,58,237)] hover:bg-transparent hover:text-[rgb(109,40,217)]"
          >
            <Link href="/pockety/new" aria-label="Vytvoriť nové vrecko">
              <Plus className="h-6 w-6" />
            </Link>
          </Button>
        </div>

        {pending.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-[rgb(196,181,253)]">
              Čakajúce pozvánky
            </h2>
            {pending.map((pocket) => (
              <div
                key={pocket.id}
                className="rounded-2xl border border-[rgba(124,58,237,0.35)] bg-[rgba(124,58,237,0.12)] p-4"
              >
                <p className="text-lg font-semibold text-foreground">{pocket.name}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {pocket.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs text-foreground"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
                <p className="mt-3 text-sm text-foreground/70">
                  Pozvánku môžete prijať alebo odmietnuť.
                </p>
                <div className="mt-4 flex gap-3">
                  <Button
                    className="h-11 flex-1 rounded-xl bg-[rgb(124,58,237)] text-white hover:bg-[rgb(109,40,217)]"
                    disabled={busyPocketId === pocket.id}
                    onClick={() => handleRespond(pocket.id, "accepted")}
                  >
                    Prijať
                  </Button>
                  <Button
                    variant="outline"
                    className="h-11 flex-1 rounded-xl border-white/15 bg-transparent"
                    disabled={busyPocketId === pocket.id}
                    onClick={() => handleRespond(pocket.id, "rejected")}
                  >
                    Odmietnuť
                  </Button>
                </div>
              </div>
            ))}
          </section>
        )}

        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Vaše vrecká
          </h2>
          {accepted.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-muted-foreground">
              Zatiaľ nemáte žiadne prijaté vrecká.
            </div>
          ) : (
            accepted.map((pocket) => (
              <Link
                key={pocket.id}
                href={`/pockety/detail?pocketId=${encodeURIComponent(pocket.id)}`}
                prefetch
                className="block w-full rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-left"
              >
                <p className="text-lg font-semibold text-foreground">{pocket.name}</p>
                <div className="mt-3 space-y-1 text-sm text-muted-foreground">
                  <p>{formatMembersCount(pocket.members.filter((member) => member.status === "accepted").length)}</p>
                  <p>Celkom zaplatené: {formatCurrency(pocketStats[pocket.id]?.totalPaid ?? 0)}</p>
                  <p>
                    {(() => {
                      const myNet = pocketStats[pocket.id]?.myNet ?? 0;
                      if (myNet < 0) return `Dlžíte ${formatCurrency(Math.abs(myNet))}`;
                      if (myNet > 0) return `Majú vám dlhovať ${formatCurrency(myNet)}`;
                      return "Vyrovnané 0,00 €";
                    })()}
                  </p>
                </div>
              </Link>
            ))
          )}
        </section>
      </div>
    </div>
  );
}
