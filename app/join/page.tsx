"use client";

import { Suspense, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { api } from "@/lib/api/client";
import { writeQsJoinSession } from "@/lib/quicksplit/session";
import { Button } from "@/components/ui/button";

function JoinForm() {
  const sp = useSearchParams();
  const router = useRouter();
  const splitId = sp.get("splitId") || "";
  const joinToken = sp.get("joinToken") || "";
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    setErr(null);
    if (!splitId || !joinToken) {
      setErr("Chýba splitId alebo joinToken v odkaze.");
      return;
    }
    if (!name.trim()) {
      setErr("Zadaj meno.");
      return;
    }
    setLoading(true);
    try {
      const res = (await api.quicksplits.join(splitId, { displayName: name.trim() }, joinToken)) as {
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
  };

  if (!splitId || !joinToken) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <p className="text-muted-foreground text-center text-sm">Neplatný odkaz na pripojenie.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-stretch max-w-screen-sm mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold text-foreground mb-2">Pripojiť sa k QuickSplit</h1>
      <p className="text-sm text-muted-foreground mb-6">Zadaj meno, pod ktorým ťa uvidia ostatní.</p>
      {err && <p className="text-sm text-red-400 mb-4">{err}</p>}
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Tvoje meno"
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
