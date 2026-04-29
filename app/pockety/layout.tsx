import { TopNav } from "@/components/navigation/TopNav";

export default function PocketyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="min-h-screen bg-background md:hidden">
        <TopNav initialTab="pockety" navigationMode="routes" />
        {children}
      </div>
      <div className="hidden h-screen bg-background md:flex items-center justify-center px-6">
        <div className="max-w-md rounded-2xl border border-foreground/15 bg-card p-8 text-center">
          <h1 className="text-2xl font-bold text-foreground">Dostupné iba na mobile</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            GroupPocket je momentálne optimalizovaný pre mobilné zariadenia. Otvorte aplikáciu na telefóne.
          </p>
        </div>
      </div>
    </>
  );
}
