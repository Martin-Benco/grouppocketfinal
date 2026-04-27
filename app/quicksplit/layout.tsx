import { TopNav } from "@/components/navigation/TopNav";

export default function QuickSplitLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background">
      <TopNav initialTab="quicksplit" />
      {children}
    </div>
  );
}
