"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api, type PocketTransactionInput } from "@/lib/api/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";

type DraftTx = {
  name: string;
  amount: string;
  tag: string;
  date: string;
  splitMethod: string;
};

function euroToCents(input: string) {
  const value = Number(input.replace(",", ".").trim());
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

export default function NewPocketPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [step, setStep] = useState(1);
  const [name, setName] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [emailsInput, setEmailsInput] = useState("");
  const [draftTx, setDraftTx] = useState<DraftTx[]>([]);
  const [quickTx, setQuickTx] = useState<DraftTx>({
    name: "",
    amount: "",
    tag: "",
    date: "",
    splitMethod: "rovnako",
  });
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const tags = useMemo(
    () => tagsInput.split(",").map((x) => x.trim()).filter(Boolean),
    [tagsInput],
  );
  const emails = useMemo(
    () => emailsInput.split(",").map((x) => x.trim()).filter(Boolean),
    [emailsInput],
  );

  const pushDraftTx = () => {
    const amountCents = euroToCents(quickTx.amount);
    if (!quickTx.name.trim() || amountCents === null) return;
    setDraftTx((prev) => [...prev, quickTx]);
    setQuickTx({ name: "", amount: "", tag: "", date: "", splitMethod: "rovnako" });
  };

  const createPocket = async () => {
    if (!name.trim()) return;
    try {
      setSaving(true);
      setErr(null);
      const initialTransactions: PocketTransactionInput[] = draftTx.reduce<PocketTransactionInput[]>(
        (acc, x) => {
          const amountCents = euroToCents(x.amount);
          if (!x.name.trim() || amountCents === null) return acc;
          acc.push({
            name: x.name.trim(),
            amountCents,
            tag: x.tag || undefined,
            transactionDate: x.date || undefined,
            splitMethod: x.splitMethod || "rovnako",
          });
          return acc;
        },
        [],
      );
      const created = (await api.pockets.create({
        name: name.trim(),
        tags,
        inviteEmails: emails,
        initialTransactions,
      })) as { pocketId: string };
      router.replace(`/pocket-detail?pocketId=${encodeURIComponent(created.pocketId)}`);
    } catch (e: any) {
      setErr(e.message || "Nepodarilo sa vytvoriť pocket");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen bg-background flex items-center justify-center text-muted-foreground">Načítavam...</div>;
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-background px-4 py-6 max-w-screen-sm mx-auto">
        <h1 className="text-xl font-bold text-foreground">Vytvoriť pocket</h1>
        <p className="mt-3 text-sm text-muted-foreground">Najprv sa prihlás, potom môžeš vytvoriť pocket.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background px-4 py-6 max-w-screen-sm mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <button className="text-sm text-primary" onClick={() => router.push("/pockety")}>← Späť</button>
        <p className="text-sm text-muted-foreground">Krok {step}/4</p>
      </div>
      {err && <p className="text-sm text-red-400">{err}</p>}

      {step === 1 && (
        <div className="space-y-3">
          <h2 className="text-xl font-bold text-foreground">Názov pocketu</h2>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Napr. Dovolenka Chorvátsko" className="w-full h-14 rounded-xl border border-foreground/20 bg-background px-4 text-foreground" />
          <Button className="w-full h-12 bg-primary" disabled={!name.trim()} onClick={() => setStep(2)}>Pokračovať</Button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <h2 className="text-xl font-bold text-foreground">Tagy transakcií</h2>
          <p className="text-sm text-muted-foreground">Oddel čiarkou, napr. ubytovanie, jedlo, doprava.</p>
          <input value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} placeholder="Tagy" className="w-full h-14 rounded-xl border border-foreground/20 bg-background px-4 text-foreground" />
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1 h-11" onClick={() => setStep(3)}>Preskočiť</Button>
            <Button className="flex-1 h-11 bg-primary" onClick={() => setStep(3)}>Pokračovať</Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-3">
          <h2 className="text-xl font-bold text-foreground">Prvé transakcie</h2>
          <input value={quickTx.name} onChange={(e) => setQuickTx((p) => ({ ...p, name: e.target.value }))} placeholder="Názov transakcie" className="w-full h-12 rounded-xl border border-foreground/20 bg-background px-4" />
          <input value={quickTx.amount} onChange={(e) => setQuickTx((p) => ({ ...p, amount: e.target.value }))} placeholder="Suma v EUR" className="w-full h-12 rounded-xl border border-foreground/20 bg-background px-4" />
          <input value={quickTx.tag} onChange={(e) => setQuickTx((p) => ({ ...p, tag: e.target.value }))} placeholder="Tag (voliteľné)" className="w-full h-12 rounded-xl border border-foreground/20 bg-background px-4" />
          <input type="date" value={quickTx.date} onChange={(e) => setQuickTx((p) => ({ ...p, date: e.target.value }))} className="w-full h-12 rounded-xl border border-foreground/20 bg-background px-4" />
          <button className="text-sm text-primary" onClick={pushDraftTx}>+ Pridať transakciu</button>
          {draftTx.length > 0 && <p className="text-xs text-muted-foreground">Pridané: {draftTx.length}</p>}
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1 h-11" onClick={() => setStep(4)}>Preskočiť</Button>
            <Button className="flex-1 h-11 bg-primary" onClick={() => setStep(4)}>Pokračovať</Button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-3">
          <h2 className="text-xl font-bold text-foreground">Pridať ľudí</h2>
          <p className="text-sm text-muted-foreground">Zadaj emaily oddelené čiarkou.</p>
          <input value={emailsInput} onChange={(e) => setEmailsInput(e.target.value)} placeholder="anna@email.com, peter@email.com" className="w-full h-14 rounded-xl border border-foreground/20 bg-background px-4" />
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1 h-11" disabled={saving} onClick={createPocket}>Preskočiť a vytvoriť</Button>
            <Button className="flex-1 h-11 bg-primary" disabled={saving} onClick={createPocket}>{saving ? "Vytváram..." : "Vytvoriť pocket"}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
