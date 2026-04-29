import { TopNav } from "@/components/navigation/TopNav";

export default function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <TopNav initialTab="ucet" navigationMode="routes" />
      {children}
    </div>
  );
}
