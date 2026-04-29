"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { api } from "@/lib/api/client";
import { writeQsJoinSession } from "@/lib/quicksplit/session";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";

function JoinForm() {
  const { user, loading: authLoading } = useAuth();
  const sp = useSearchParams();
  const router = useRouter();
  const splitId = sp.get("splitId") || "";
  const joinToken = sp.get("joinToken") || "";
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoJoined, setAutoJoined] = useState(false);

  const preferredName = useMemo(() => {
    if (!user) return "";
    return user.displayName?.trim() || user.email?.split("@")[0]?.trim() || "Používateľ";
  }, [user]);

  const submit = useCallback(async (overrideName?: string) => {
    setErr(null);
    if (!splitId || !joinToken) {
      setErr("Chýba splitId alebo joinToken v odkaze.");
      return;
    }
    const finalName = (overrideName ?? name).trim();
    if (!finalName) {
      setErr("Zadaj prezývku.");
      return;
    }
    setLoading(true);
    try {
      const res = (await api.quicksplits.join(splitId, { displayName: finalName }, joinToken)) as {
        participantId: string;
        participantSecret: string;
      };
      writeQsJoinSession(splitId, joinToken, {
        participantId: res.participantId,
        participantSecret: res.participantSecret,
      });
      router.replace("/");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Chyba");
    } finally {
      setLoading(false);
    }
  }, [splitId, joinToken, name, router]);

  useEffect(() => {
    if (authLoading || !user || autoJoined || loading || !splitId || !joinToken) return;
    setAutoJoined(true);
    void submit(preferredName);
  }, [authLoading, user, autoJoined, loading, splitId, joinToken, preferredName, submit]);

  if (!splitId || !joinToken) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <p className="text-muted-foreground text-center text-sm">Neplatný odkaz na pripojenie.</p>
      </div>
    );
  }

  if (authLoading || (user && loading)) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <p className="text-muted-foreground text-center text-sm">Pripájam ťa do QuickSplitu…</p>
      </div>
    );
  }

  if (user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="w-full max-w-screen-sm rounded-2xl border border-foreground/15 p-5 space-y-3">
          <p className="text-sm text-muted-foreground text-center">Pripájam ťa ako</p>
          <p className="text-center text-lg font-semibold text-foreground">{preferredName}</p>
          {err && <p className="text-sm text-red-400 text-center">{err}</p>}
          <Button className="w-full h-12 bg-primary" disabled={loading} onClick={() => void submit(preferredName)}>
            {loading ? "Pripájam…" : "Skúsiť znova"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-stretch max-w-screen-sm mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold text-foreground mb-2">Pripojiť sa k QuickSplit</h1>
      <p className="text-sm text-muted-foreground mb-6">Zadaj prezývku, pod ktorou ťa uvidia ostatní.</p>
      {err && <p className="text-sm text-red-400 mb-4">{err}</p>}
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Tvoja prezývka"
        className="w-full h-14 px-4 rounded-xl bg-background border border-foreground/20 text-foreground mb-4"
      />
      <Button className="w-full h-12 bg-primary" disabled={loading} onClick={() => void submit()}>
        {loading ? "Pripájam…" : "Pripojiť sa"}
      </Button>
    </div>
  );
}

export default function JoinPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex items-center justify-center">
          <p className="text-muted-foreground text-sm">Načítavam…</p>
        </div>
      }
    >
      <JoinForm />
    </Suspense>
  );
}
