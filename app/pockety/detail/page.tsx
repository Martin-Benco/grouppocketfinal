"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { PocketDetailScreen } from "@/components/pockets/PocketDetailScreen";

function PocketDetailPageContent() {
  const searchParams = useSearchParams();
  const pocketId = searchParams.get("pocketId")?.trim() || "";
  return <PocketDetailScreen pocketId={pocketId} />;
}

export default function PocketDetailPage() {
  return (
    <Suspense fallback={null}>
      <PocketDetailPageContent />
    </Suspense>
  );
}
