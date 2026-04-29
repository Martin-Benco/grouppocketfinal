"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api/client";
import { useAuth } from "@/contexts/AuthContext";

type PocketListItem = {
  id: string;
  name: string;
  tags: string[];
  memberCount: number;
  totalCents: number;
  paidCents: number;
};

function eur(cents: number) {
  return `${(cents / 100).toFixed(2)} €`;
}

export function PocketsScreen() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [list, setList] = useState<PocketListItem[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const loadMine = useCallback(async () => {
    if (!user) return;
    try {
      setErr(null);
      const res = (await api.pockets.mine()) as { pockets: PocketListItem[] };
      setList(res.pockets || []);
    } catch (e: any) {
      setErr(e.message || "Nepodarilo sa načítať pockety");
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    void loadMine();
  }, [user, loadMine]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const openId = new URLSearchParams(window.location.search).get("open");
    if (openId) {
      router.replace(`/pocket-detail?pocketId=${encodeURIComponent(openId)}`);
    }
  }, [router]);

  if (loading) {
    return <div className="min-h-screen bg-background w-full flex items-center justify-center text-muted-foreground">Načítavam...</div>;
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-background w-full">
        <div className="max-w-screen-sm mx-auto px-4 py-6">
          <h1 className="text-xl font-bold text-foreground">Pockety</h1>
          <p className="mt-4 text-sm text-muted-foreground">
            Táto sekcia je dostupná iba pre prihlásených používateľov.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background w-full pb-20">
      <div className="max-w-screen-sm mx-auto px-4 py-6 space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-foreground">Pockety</h1>
          <button
            onClick={() => router.push("/pockety/new")}
            className="h-11 w-11 rounded-full bg-primary text-primary-foreground flex items-center justify-center"
            aria-label="Vytvoriť pocket"
          >
            <Plus className="w-5 h-5" />
          </button>
        </div>

        {err && <p className="text-sm text-red-400">{err}</p>}

        {list.map((p) => (
          <button
            key={p.id}
            onClick={() => router.push(`/pocket-detail?pocketId=${encodeURIComponent(p.id)}`)}
            className="w-full text-left rounded-2xl border border-foreground/15 bg-card p-4"
          >
            <div className="flex items-center justify-between">
              <p className="font-semibold text-foreground">{p.name}</p>
              <p className="text-sm font-bold text-primary">{eur(p.totalCents)}</p>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{p.memberCount} členov • Vyplatené {eur(p.paidCents)}</p>
            <div className="mt-2 flex flex-wrap gap-1">
              {p.tags.map((t) => (
                <span key={t} className="text-[11px] px-2 py-0.5 rounded-full border border-foreground/20 text-muted-foreground">{t}</span>
              ))}
            </div>
          </button>
        ))}
        {list.length === 0 && <p className="text-sm text-muted-foreground">Zatiaľ nemáš žiadny pocket. Vytvor ho cez +.</p>}
      </div>
    </div>
  );
}
