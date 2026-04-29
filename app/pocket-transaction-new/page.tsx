"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api/client";

function euroToCents(input: string) {
  const value = Number(input.replace(",", ".").trim());
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

export default function NewPocketTransactionPage() {
  const router = useRouter();
  const [pocketId, setPocketId] = useState("");
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  const [tag, setTag] = useState("");
  const [splitMethod, setSplitMethod] = useState("rovnako");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const id = new URLSearchParams(window.location.search).get("pocketId") || "";
    setPocketId(id);
  }, []);

  const submit = async () => {
    const amountCents = euroToCents(amount);
    if (!name.trim() || amountCents === null) {
      setErr("Vyplň názov a správnu sumu.");
      return;
    }
    try {
      setSaving(true);
      setErr(null);
      await api.pockets.addTransaction(pocketId, {
        name: name.trim(),
        amountCents,
        transactionDate: date || undefined,
        tag: tag || undefined,
        splitMethod,
      });
      router.replace(`/pocket-detail?pocketId=${encodeURIComponent(pocketId)}`);
    } catch (e: any) {
      setErr(e.message || "Nepodarilo sa pridať transakciu");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
    <div className="min-h-screen bg-background px-4 py-6 max-w-screen-sm mx-auto space-y-4 md:hidden">
      <button className="text-primary text-sm" onClick={() => router.push(`/pocket-detail?pocketId=${encodeURIComponent(pocketId)}`)}>← Späť do pocketu</button>
      <h1 className="text-2xl font-bold text-foreground">Pridať transakciu</h1>
      {err && <p className="text-sm text-red-400">{err}</p>}
      <div className="space-y-3 rounded-2xl border border-foreground/15 bg-card p-4">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Názov transakcie" className="w-full h-12 rounded-xl border border-foreground/20 bg-background px-4" />
        <input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Suma v EUR" className="w-full h-12 rounded-xl border border-foreground/20 bg-background px-4" />
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full h-12 rounded-xl border border-foreground/20 bg-background px-4" />
        <input value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Tag" className="w-full h-12 rounded-xl border border-foreground/20 bg-background px-4" />
        <select value={splitMethod} onChange={(e) => setSplitMethod(e.target.value)} className="w-full h-12 rounded-xl border border-foreground/20 bg-background px-4">
          <option value="rovnako">Deliť rovnako</option>
          <option value="manual">Deliť manuálne</option>
          <option value="percenta">Deliť percentami</option>
        </select>
        <Button className="w-full h-12 bg-primary" disabled={saving} onClick={submit}>
          {saving ? "Ukladám..." : "Pridať transakciu"}
        </Button>
      </div>
    </div>
    <div className="hidden h-screen bg-background md:flex items-center justify-center px-6">
      <div className="max-w-md rounded-2xl border border-foreground/15 bg-card p-8 text-center">
        <h1 className="text-2xl font-bold text-foreground">Dostupné iba na mobile</h1>
        <p className="mt-3 text-sm text-muted-foreground">GroupPocket je momentálne optimalizovaný pre mobilné zariadenia.</p>
      </div>
    </div>
    </>
  );
}
