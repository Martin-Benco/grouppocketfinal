"use client";

import Link from "next/link";
import { FolderOpen } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";

export function PocketsEmptyState() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-background w-full flex items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background w-full">
      <div className="mx-auto flex min-h-screen max-w-screen-sm items-center px-5 py-8">
        <div className="w-full rounded-[28px] border border-white/10 bg-white/[0.03] p-6 text-center shadow-[0_20px_80px_rgba(0,0,0,0.25)]">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[rgba(124,58,237,0.14)] text-[rgb(167,139,250)]">
            <FolderOpen className="h-8 w-8" />
          </div>

          <h1 className="mt-6 text-2xl font-bold text-foreground">
            You don't have any Pockets yet
          </h1>

          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Create your first Pocket and keep shared expenses in one place,
            clear and simple.
          </p>

          <Button
            asChild
            className="mt-8 h-12 w-full rounded-xl bg-[rgb(124,58,237)] text-white text-sm font-semibold hover:bg-[rgb(109,40,217)]"
          >
            <Link href="/pockety/new">Create your first Pocket</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
