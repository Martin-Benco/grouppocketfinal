"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { PocketTransactionCreateScreen } from "@/components/pockets/PocketTransactionCreateScreen";

function PocketNewTransactionPageContent() {
  const searchParams = useSearchParams();
  const pocketId = searchParams.get("pocketId")?.trim() || "";

  return <PocketTransactionCreateScreen pocketId={pocketId} />;
}

export default function PocketNewTransactionPage() {
  return (
    <Suspense fallback={null}>
      <PocketNewTransactionPageContent />
    </Suspense>
  );
}
