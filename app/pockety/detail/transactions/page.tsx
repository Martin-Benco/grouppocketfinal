"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { PocketTransactionsScreen } from "@/components/pockets/PocketTransactionsScreen";

function PocketTransactionsPageContent() {
  const searchParams = useSearchParams();
  const pocketId = searchParams.get("pocketId")?.trim() || "";

  return <PocketTransactionsScreen pocketId={pocketId} />;
}

export default function PocketTransactionsPage() {
  return (
    <Suspense fallback={null}>
      <PocketTransactionsPageContent />
    </Suspense>
  );
}
