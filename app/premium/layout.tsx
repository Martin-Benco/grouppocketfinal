import { TopNav } from "@/components/navigation/TopNav";

export default function PremiumLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <TopNav initialTab="premium" />
      {children}
    </div>
  );
}
