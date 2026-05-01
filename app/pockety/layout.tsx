"use client";

import { usePathname } from "next/navigation";
import { TopNav } from "@/components/navigation/TopNav";

export default function PocketyLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const hideTopNav =
    pathname === "/pockety/new" ||
    pathname === "/pockety/detail" ||
    pathname.startsWith("/pockety/detail/");

  return (
    <div className="min-h-screen bg-background">
      {!hideTopNav && <TopNav initialTab="pockety" navigationMode="routes" />}
      {children}
    </div>
  );
}
