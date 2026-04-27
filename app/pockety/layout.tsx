import { TopNav } from "@/components/navigation/TopNav";

export default function PocketyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <TopNav initialTab="pockety" />
      {children}
    </div>
  );
}
