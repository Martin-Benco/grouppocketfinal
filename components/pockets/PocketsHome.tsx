"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { FolderOpen, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api/client";
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
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (count === 1) return "1 člen";
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) {
    return `${count} členovia`;
  }
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
            const transactions = detail.transactions || [];
            const totalPaid =
              detail.analytics?.totalAmount ??
              transactions.reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0);
            const myUid = user?.uid || "";
            let myNet = 0;
            transactions.forEach((tx) => {
              const amount = Number(tx.amount) || 0;
              if (amount <= 0) return;
              const debtors =
                (tx.splitAssignedUids || []).filter((uid) => uid !== tx.payerUid).length > 0
                  ? (tx.splitAssignedUids || []).filter((uid) => uid !== tx.payerUid)
                  : acceptedMembers.filter((member) => member.uid !== tx.payerUid).map((member) => member.uid);
              const count = debtors.length;
              if (count <= 0) return;
              const share = amount / count;
              if (tx.payerUid === myUid) {
                myNet += amount;
              }
              if (debtors.includes(myUid)) {
                myNet -= share;
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
      setError(err.message || "Nepodarilo sa načítať pockety");
    } finally {
      setIsLoading(false);
    }
  }, [user?.uid]);

  useEffect(() => {
    if (!user) return;
    void loadPockets();
  }, [user, loadPockets]);

  useEffect(() => {
    router.prefetch("/pockety/new");
    accepted.slice(0, 8).forEach((pocket) => {
      router.prefetch(`/pockety/detail?pocketId=${encodeURIComponent(pocket.id)}`);
    });
  }, [accepted, router]);

  if (loading || isLoading) {
    return (
      <div className="min-h-screen bg-background w-full flex items-center justify-center">
        <div className="text-muted-foreground">Načítavam...</div>
      </div>
    );
  }

  if (!user) {
    return null;
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
              Zatiaľ nemáš žiadny pocket
            </h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Vytvor si svoj prvý pocket a maj skupinové výdavky na jednom mieste
              prehľadne a jednoducho.
            </p>
            <Button
              asChild
              className="mt-8 h-12 w-full rounded-xl bg-[rgb(124,58,237)] text-white text-sm font-semibold hover:bg-[rgb(109,40,217)]"
            >
              <Link href="/pockety/new">Vytvoriť prvý pocket</Link>
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
      setError(err.message || "Nepodarilo sa spracovať pozvánku");
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
            <h1 className="text-2xl font-bold text-foreground">Pockety</h1>
          </div>
          <Button
            asChild
            variant="ghost"
            className="h-11 w-11 p-0 text-[rgb(124,58,237)] hover:bg-transparent hover:text-[rgb(109,40,217)]"
          >
            <Link href="/pockety/new" aria-label="Vytvoriť nový pocket">
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
                  Pozvánku môžeš prijať alebo odmietnuť.
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
            Tvoje pockety
          </h2>
          {accepted.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-muted-foreground">
              Zatiaľ tu nemáš žiadny prijatý pocket.
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
                  <p>Spolu zaplatené: {formatCurrency(pocketStats[pocket.id]?.totalPaid ?? 0)}</p>
                  <p>
                    {(() => {
                      const myNet = pocketStats[pocket.id]?.myNet ?? 0;
                      if (myNet < 0) return `Dlžíš ${formatCurrency(Math.abs(myNet))}`;
                      if (myNet > 0) return `Dlžia ti ${formatCurrency(myNet)}`;
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
