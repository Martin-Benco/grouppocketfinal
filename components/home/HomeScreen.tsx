"use client";

import { useRef } from "react";
import { ChevronDown } from "lucide-react";
import { useNavigation } from "@/components/navigation/TopNav";

const STEPS = [
  {
    n: 1,
    title: "Vytvor pocket",
    description: "Skupina pre výlet, byt alebo večeru",
  },
  {
    n: 2,
    title: "Pridaj výdavky",
    description: "Skenuj bloček alebo zadaj ručne",
  },
  {
    n: 3,
    title: "Vyrovnaj sa",
    description: "Appka ti povie kto platí komu",
  },
] as const;

export function HomeScreen() {
  const { setActiveTab } = useNavigation();
  const howSectionRef = useRef<HTMLElement>(null);

  const scrollToHow = () => {
    howSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="min-h-full w-full bg-background text-foreground">
      <section className="relative w-full overflow-x-hidden">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 z-0 h-[400px]"
          style={{
            background:
              "radial-gradient(ellipse 120% 85% at 50% 0%, rgba(124, 58, 237, 0.35) 0%, transparent 68%)",
          }}
          aria-hidden
        />

        <div className="relative z-[1] flex flex-col items-center px-4 pt-10 pb-8 md:pt-14">
          <div
            className="mb-8 inline-flex items-center gap-2 px-4 py-2"
            style={{
              background: "rgba(124, 58, 237, 0.15)",
              border: "0.5px solid rgba(124, 58, 237, 0.35)",
              borderRadius: 20,
            }}
          >
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: "rgb(124, 58, 237)" }}
              aria-hidden
            />
            <span className="text-sm font-semibold text-foreground">GroupPocket</span>
          </div>

          <h1 className="max-w-[min(100%,520px)] text-center text-[32px] font-bold leading-tight tracking-tight text-white sm:text-[38px] md:text-[44px]">
            Jednoduché & férové - GroupPocket
          </h1>

          <p className="mx-auto mt-5 max-w-[480px] text-center text-base text-[#A3A3A3] md:text-[17px]">
            Pridaj výdavok, pozvi kamarátov a zistite kto komu koľko dlhuje — za 30 sekúnd.
          </p>

          <div className="mt-10 flex w-full max-w-md flex-col gap-3 sm:flex-row sm:justify-center sm:gap-4">
            <button
              type="button"
              onClick={() => setActiveTab("pockety")}
              className="min-h-[48px] flex-1 rounded-[12px] bg-white px-6 text-center text-sm font-semibold text-black transition-opacity hover:opacity-90 active:opacity-80 sm:flex-initial sm:min-w-[160px]"
            >
              Vytvoriť pocket
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("ucet")}
              className="min-h-[48px] flex-1 rounded-[12px] border border-white/80 bg-transparent px-6 text-center text-sm font-semibold text-white transition-colors hover:bg-white/5 active:bg-white/10 sm:flex-initial sm:min-w-[160px]"
            >
              Prihlásiť sa
            </button>
          </div>

          <button
            type="button"
            onClick={scrollToHow}
            className="mt-14 flex h-12 w-12 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white/80 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Posunúť k sekcii Ako to funguje"
          >
            <ChevronDown className="h-6 w-6" strokeWidth={2} />
          </button>
        </div>
      </section>

      <section
        id="ako-to-funguje"
        ref={howSectionRef}
        className="relative z-[1] px-4 pb-16 pt-4 md:pb-24"
      >
        <h2 className="mb-10 text-center text-[11px] font-semibold uppercase tracking-[0.22em] text-[#A3A3A3]">
          AKO TO FUNGUJE
        </h2>

        <div className="mx-auto grid max-w-5xl grid-cols-3 gap-2 sm:gap-4 md:gap-5">
          {STEPS.map((step) => (
            <article
              key={step.n}
              className="flex flex-col items-center rounded-2xl px-2 py-6 text-center sm:px-4 sm:py-10"
              style={{
                background: "rgba(255, 255, 255, 0.05)",
                border: "0.5px solid rgba(255, 255, 255, 0.1)",
                borderRadius: 16,
              }}
            >
              <div
                className="mb-5 flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold"
                style={{
                  background: "rgba(124, 58, 237, 0.25)",
                  border: "0.5px solid rgba(124, 58, 237, 0.5)",
                  color: "#a78bfa",
                }}
              >
                {step.n}
              </div>
              <h3 className="text-sm font-bold leading-snug text-white sm:text-lg">{step.title}</h3>
              <p className="mt-2 text-[11px] leading-relaxed text-[#A3A3A3] sm:text-sm">{step.description}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
