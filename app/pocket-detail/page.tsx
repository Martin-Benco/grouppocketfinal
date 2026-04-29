"use client";

import { useEffect, useMemo, useState } from "react";
import { Bell, ChevronLeft, Plus, Settings, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api/client";
import { useAuth } from "@/contexts/AuthContext";

type PocketMember = { uid: string | null; email: string | null; displayName: string | null; profileImageUrl: string | null };
type PocketTransaction = { id: string; name: string; amountCents: number; tag: string | null; splitMethod: string; paidByUid: string | null; transactionDate: string | null };
type PocketActivity = { id: string; type: string; actorDisplayName: string | null; meta: Record<string, unknown>; createdAt: string | null };
type PocketDetail = {
  id: string;
  name: string;
  tags: string[];
  inviteKey: string;
  ownerUid: string | null;
  members: PocketMember[];
  transactions: PocketTransaction[];
  activities?: PocketActivity[];
  analytics: { totalCents: number; paidCents: number; unpaidCents: number };
};

const eur = (cents: number) => `${(cents / 100).toFixed(2)} €`;

function timeLabel(iso: string | null) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleString("sk-SK", { dateStyle: "short", timeStyle: "short" }); } catch { return iso; }
}

function activityLabel(a: PocketActivity) {
  const actor = a.actorDisplayName || "Niekto";
  if (a.type === "pocket_created") return `${actor} vytvoril pocket`;
  if (a.type === "transaction_added") return `${actor} pridal transakciu`;
  if (a.type === "member_invited_email") return `${actor} pozval člena cez email`;
  if (a.type === "settings_updated") return `${actor} upravil nastavenia pocketu`;
  if (a.type === "member_left") return `${actor} opustil pocket`;
  return a.type;
}

export default function PocketDetailPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [pocketId, setPocketId] = useState("");
  const [detail, setDetail] = useState<PocketDetail | null>(null);
  const [activities, setActivities] = useState<PocketActivity[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const id = new URLSearchParams(window.location.search).get("pocketId") || "";
    setPocketId(id);
  }, []);

  const load = async () => {
    if (!pocketId) return;
    try {
      setErr(null);
      const d = (await api.pockets.get(pocketId)) as PocketDetail;
      const act = (await api.pockets.activities(pocketId)) as { activities: PocketActivity[] };
      setDetail(d);
      setActivities(act.activities || d.activities || []);
      setNameInput(d.name || "");
      setTagsInput((d.tags || []).join(", "));
    } catch (e: any) {
      setErr(e.message || "Nepodarilo sa načítať pocket");
    }
  };

  useEffect(() => {
    if (!user || !pocketId) return;
    void load();
  }, [pocketId, user]);

  const isOwner = useMemo(() => !!(user && detail && detail.ownerUid === user.uid), [user, detail]);

  const saveSettings = async () => {
    if (!detail) return;
    try {
      const tags = tagsInput.split(",").map((x) => x.trim()).filter(Boolean);
      await api.pockets.update(detail.id, { name: nameInput.trim(), tags });
      setSettingsOpen(false);
      await load();
    } catch (e: any) {
      setErr(e.message || "Nepodarilo sa uložiť nastavenia");
    }
  };

  const inviteByEmail = async () => {
    if (!detail || !inviteEmail.trim()) return;
    try {
      await api.pockets.inviteByEmail(detail.id, inviteEmail.trim());
      setInviteEmail("");
      await load();
    } catch (e: any) {
      setErr(e.message || "Nepodarilo sa pozvať člena");
    }
  };

  const leavePocket = async () => {
    if (!detail) return;
    try {
      await api.pockets.leave(detail.id);
      router.replace("/pockety");
    } catch (e: any) {
      setErr(e.message || "Nepodarilo sa odísť z pocketu");
    }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Načítavam...</div>;
  if (!user) return <div className="min-h-screen px-4 py-6 text-sm text-muted-foreground">Táto sekcia je dostupná iba pre prihlásených používateľov.</div>;
  if (!detail) return <div className="min-h-screen px-4 py-6 text-sm text-muted-foreground">{err || "Načítavam pocket..."}</div>;

  return (
    <>
    <div className="min-h-screen bg-background pb-20 md:hidden">
      <div className="max-w-screen-sm mx-auto px-4 py-5 space-y-6">
        <div className="flex items-center justify-between">
          <button className="h-9 w-9 rounded-full border border-foreground/20 flex items-center justify-center" onClick={() => router.push("/pockety")}><ChevronLeft className="w-5 h-5" /></button>
          <h1 className="text-lg font-bold text-foreground">{detail.name}</h1>
          <div className="flex items-center gap-2">
            <button className="h-9 w-9 rounded-full border border-foreground/20 flex items-center justify-center" onClick={() => setNotifOpen(true)}><Bell className="w-4 h-4" /></button>
            <button className="h-9 w-9 rounded-full border border-foreground/20 flex items-center justify-center" onClick={() => setSettingsOpen(true)}><Settings className="w-4 h-4" /></button>
          </div>
        </div>
        {err && <p className="text-sm text-red-400">{err}</p>}

        <section className="rounded-2xl border border-foreground/15 bg-card p-4">
          <h2 className="font-semibold text-foreground mb-4">Analytika</h2>
          <div className="grid grid-cols-1 gap-2">
            <div className="rounded-xl border border-foreground/10 p-3"><p className="text-xs text-muted-foreground">Celkové výdavky</p><p className="text-3xl font-bold text-foreground">{eur(detail.analytics.totalCents)}</p></div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl border border-emerald-500/25 p-3"><p className="text-xs text-muted-foreground">Zaplatené</p><p className="text-lg font-bold text-emerald-400">{eur(detail.analytics.paidCents)}</p></div>
              <div className="rounded-xl border border-red-500/25 p-3"><p className="text-xs text-muted-foreground">Nezaplatené</p><p className="text-lg font-bold text-red-400">{eur(detail.analytics.unpaidCents)}</p></div>
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold text-foreground">Transakcie</h2>
            <button onClick={() => router.push(`/pocket-transaction-new?pocketId=${encodeURIComponent(detail.id)}`)} className="h-9 px-3 rounded-full bg-primary/20 text-primary font-semibold text-sm flex items-center gap-1"><Plus className="w-4 h-4" />Pridať</button>
          </div>
          <div className="rounded-2xl border border-foreground/15 bg-card p-3 space-y-2">
            {detail.transactions.length === 0 && <p className="text-sm text-muted-foreground py-8 text-center">Zatiaľ žiadne výdavky</p>}
            {detail.transactions.map((t) => <div key={t.id} className="rounded-xl border border-foreground/10 p-3"><div className="flex items-center justify-between"><p className="text-sm font-semibold text-foreground">{t.name}</p><p className="text-sm font-bold text-foreground">{eur(t.amountCents)}</p></div><p className="text-xs text-muted-foreground mt-1">{t.transactionDate || "-"} • {t.tag || "bez tagu"} • {t.splitMethod || "rovnako"}</p></div>)}
          </div>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between"><h2 className="text-2xl font-bold text-foreground">Ľudia</h2><button className="h-9 px-3 rounded-full bg-primary/20 text-primary font-semibold text-sm flex items-center gap-1"><UserPlus className="w-4 h-4" />Pridať</button></div>
          <div className="rounded-2xl border border-foreground/15 bg-card p-3 space-y-2">
            {detail.members.map((m, idx) => <div key={`${m.uid || m.email || idx}`} className="rounded-xl border border-foreground/10 px-3 py-2 flex items-center justify-between gap-2"><div className="flex items-center gap-3 min-w-0">{m.profileImageUrl ? <img src={m.profileImageUrl} alt={m.displayName || "Profil"} className="w-10 h-10 rounded-full object-cover" /> : <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-sm text-muted-foreground">{(m.displayName || m.email || "U").slice(0, 1).toUpperCase()}</div>}<div className="min-w-0"><p className="text-sm text-foreground truncate">{m.displayName || "Používateľ"}</p><p className="text-xs text-muted-foreground truncate">{m.email || "bez emailu"}</p></div></div><span className="text-sm font-semibold text-foreground">0.00 €</span></div>)}
            {isOwner && <div className="rounded-xl border border-foreground/10 p-3 space-y-2"><p className="text-xs text-muted-foreground">Pozvať cez email</p><div className="flex gap-2"><input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="meno@email.com" className="flex-1 h-10 rounded-lg border border-foreground/20 bg-background px-3 text-sm" /><Button className="h-10 bg-primary" onClick={inviteByEmail}>Pridať</Button></div></div>}
          </div>
        </section>
      </div>

      {notifOpen && <div className="fixed inset-0 z-50 bg-black/70 flex items-end" onClick={() => setNotifOpen(false)}><div className="w-full max-w-screen-sm mx-auto rounded-t-3xl bg-background p-5 space-y-3" onClick={(e) => e.stopPropagation()}><h3 className="text-lg font-bold text-foreground">Upozornenia</h3><div className="max-h-[55vh] overflow-y-auto space-y-2">{activities.length === 0 && <p className="text-sm text-muted-foreground">Zatiaľ žiadne udalosti.</p>}{activities.map((a) => <div key={a.id} className="rounded-xl border border-foreground/10 p-3"><p className="text-sm text-foreground">{activityLabel(a)}</p><p className="text-xs text-muted-foreground mt-1">{timeLabel(a.createdAt)}</p></div>)}</div></div></div>}
      {settingsOpen && <div className="fixed inset-0 z-50 bg-black/70 flex items-end" onClick={() => setSettingsOpen(false)}><div className="w-full max-w-screen-sm mx-auto rounded-t-3xl bg-background p-5 space-y-3" onClick={(e) => e.stopPropagation()}><h3 className="text-lg font-bold text-foreground">Nastavenia pocketu</h3>{isOwner ? <><input value={nameInput} onChange={(e) => setNameInput(e.target.value)} placeholder="Názov pocketu" className="w-full h-12 rounded-xl border border-foreground/20 bg-background px-4" /><input value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} placeholder="Tagy oddelené čiarkou" className="w-full h-12 rounded-xl border border-foreground/20 bg-background px-4" /><Button className="w-full h-11 bg-primary" onClick={saveSettings}>Uložiť zmeny</Button></> : <Button variant="outline" className="w-full h-11 border-foreground/30" onClick={leavePocket}>Odísť z pocketu</Button>}</div></div>}
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
