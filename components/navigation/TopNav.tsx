"use client";

import { useRef, useEffect, useState, createContext, useContext } from "react";
import { cn } from "@/lib/utils";

const navItems = [
  { id: "quicksplit", label: "QuickSplit" },
  { id: "pockety", label: "Pockety" },
  { id: "ucet", label: "Účet" },
  { id: "premium", label: "Premium" },
];

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

export function TopNav({ children, initialTab }: { children?: React.ReactNode; initialTab?: string }) {
  const [activeTab, setActiveTab] = useState(initialTab || "quicksplit");
  
  // Aktualizovať activeTab, ak sa zmení initialTab
  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);
  const linkRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [activeWidth, setActiveWidth] = useState(0);
  const [activeLeft, setActiveLeft] = useState(0);
  const [isInitialized, setIsInitialized] = useState(false);

  const activeIndex = navItems.findIndex((item) => item.id === activeTab);

  useEffect(() => {
    const updatePosition = () => {
      if (activeIndex >= 0 && linkRefs.current[activeIndex] && linkRefs.current[0]) {
        const activeButton = linkRefs.current[activeIndex];
        const quicksplitButton = linkRefs.current[0];
        
        if (activeButton && quicksplitButton) {
          const activeButtonRect = activeButton.getBoundingClientRect();
          const quicksplitButtonRect = quicksplitButton.getBoundingClientRect();
          const buttonsContainer = activeButton.parentElement;
          
          if (buttonsContainer) {
            const lineContainer = buttonsContainer.nextElementSibling?.querySelector('.relative');
            
            if (lineContainer) {
              const lineContainerRect = lineContainer.getBoundingClientRect();
              
              const quicksplitCenterX = quicksplitButtonRect.left + quicksplitButtonRect.width / 2;
              const lineLeftEdge = lineContainerRect.left;
              const quicksplitDistanceFromLeftToCenter = quicksplitCenterX - lineLeftEdge;
              
              const isDesktop = window.innerWidth >= 1024;
              const widthMultiplier = isDesktop ? 1.5 : 2;
              const fixedLineWidth = quicksplitDistanceFromLeftToCenter * widthMultiplier;
              
              const activeButtonCenterX = activeButtonRect.left + activeButtonRect.width / 2;
              const lineLeft = activeButtonCenterX - lineLeftEdge - fixedLineWidth / 2;
              
              setActiveWidth(fixedLineWidth);
              setActiveLeft(lineLeft);
              setIsInitialized(true);
            }
          }
        }
      }
    };

    const timeoutId = setTimeout(updatePosition, 0);
    window.addEventListener("resize", updatePosition);
    
    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener("resize", updatePosition);
    };
  }, [activeIndex, activeTab]);

  return (
    <NavigationContext.Provider value={{ activeTab, setActiveTab }}>
      <nav className="w-full bg-background relative pt-6">
        <div className="flex items-center justify-center w-full max-w-screen-sm mx-auto px-4 gap-8 md:gap-20 lg:gap-32">
          {navItems.map((item, index) => {
            const isActive = activeTab === item.id;
            
            return (
              <button
                key={item.id}
                ref={(el) => {
                  linkRefs.current[index] = el;
                }}
                onClick={() => setActiveTab(item.id)}
                className={cn(
                  "relative text-center py-3 touch-manipulation",
                  "min-h-[44px] flex items-center justify-center",
                  "select-none font-bold text-sm",
                  isActive ? "text-foreground" : "text-muted-foreground"
                )}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      <div className="relative w-full max-w-screen-sm mx-auto px-4">
        <div className="relative h-1 bg-foreground rounded-full">
          {activeIndex >= 0 && activeWidth > 0 && isInitialized && (
            <span
              className="absolute top-0 h-1 bg-primary rounded-full transition-all duration-300 ease-out"
              style={{
                left: `${activeLeft}px`,
                width: `${activeWidth}px`,
                transform: "translateZ(0)",
              }}
            />
          )}
        </div>
      </div>
    </nav>
    {children}
    </NavigationContext.Provider>
  );
}
