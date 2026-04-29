"use client";

import { useEffect, useState, createContext, useContext } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { MAIN_NAV_ITEMS } from "@/lib/nav-items";

const NavigationContext = createContext<{
  activeTab: string;
  setActiveTab: (tab: string) => void;
}>({
  activeTab: "quicksplit",
  setActiveTab: () => {},
});

export function useNavigation() {
  return useContext(NavigationContext);
}

const TAB_ROUTES: Record<string, string> = {
  quicksplit: "/",
  pockety: "/pockety",
  ucet: "/ucet",
};

export function TopNav({
  children,
  initialTab,
  navigationMode = "tabs",
}: {
  children?: React.ReactNode;
  initialTab?: string;
  navigationMode?: "tabs" | "routes";
}) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState(initialTab || "quicksplit");

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  return (
    <NavigationContext.Provider value={{ activeTab, setActiveTab }}>
      <nav className="relative w-full bg-background pt-6">
        <div className="mx-auto flex w-full max-w-screen-sm items-center justify-center gap-6 px-3 sm:gap-8 md:gap-20 lg:gap-32">
          {MAIN_NAV_ITEMS.map((item) => {
            const isActive = activeTab === item.id;

            return (
              <button
                key={item.id}
                onClick={() => {
                  setActiveTab(item.id);
                  if (navigationMode === "routes") {
                    router.push(TAB_ROUTES[item.id] || "/");
                  }
                }}
                className={cn(
                  "relative flex min-h-[44px] min-w-0 select-none items-center justify-center border-b-2 px-0.5 py-3 text-center text-sm font-bold touch-manipulation transition-colors",
                  isActive
                    ? "border-[rgb(124,58,237)] text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground/80"
                )}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </nav>
      {children}
    </NavigationContext.Provider>
  );
}
