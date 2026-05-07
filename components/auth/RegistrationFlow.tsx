"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronDown } from "lucide-react";

interface Country {
  code: string;
  flag: string;
  name: string;
}

const countries: Country[] = [
  { code: "+421", flag: "🇸🇰", name: "Slovakia" },
  { code: "+420", flag: "🇨🇿", name: "Czechia" },
  { code: "+48", flag: "🇵🇱", name: "Poland" },
  { code: "+44", flag: "🇬🇧", name: "England" },
];

interface RegistrationData {
  phoneNumber: string;
  countryCode: string;
  countryFlag: string;
  residence: string;
  fullName: string;
  iban: string;
}

interface RegistrationFlowProps {
  initialName?: string;
  onComplete: (data: RegistrationData) => void | Promise<void>;
  onSkip?: (data?: RegistrationData) => void | Promise<void>;
  onNavigateToAccount?: (data?: RegistrationData) => void | Promise<void>;
  onSaveStep?: (step: number, data: Partial<RegistrationData>) => void | Promise<void>;
}

export function RegistrationFlow({ initialName = "", onComplete, onSkip, onNavigateToAccount, onSaveStep }: RegistrationFlowProps) {
  const [step, setStep] = useState(1);
  const [selectedCountry, setSelectedCountry] = useState<Country>(countries[0]);
  const [data, setData] = useState<RegistrationData>({
    phoneNumber: "",
    countryCode: "+421",
    countryFlag: "🇸🇰",
    residence: "Slovakia",
    fullName: initialName,
    iban: "",
  });

  const countryIndex = countries.findIndex(c => c.code === selectedCountry.code);
  const safeCountryIndex = countryIndex >= 0 ? countryIndex : 0;

  const handleNext = async () => {
    if (step === 1 && data.phoneNumber) {
      onSaveStep?.(1, { phoneNumber: data.phoneNumber, countryCode: data.countryCode, countryFlag: data.countryFlag });
    } else if (step === 2 && data.residence) {
      onSaveStep?.(2, { residence: data.residence });
    } else if (step === 3 && data.fullName) {
      onSaveStep?.(3, { fullName: data.fullName });
    } else if (step === 4 && data.iban) {
      onSaveStep?.(4, { iban: data.iban });
    }
    
    if (step < 4) {
      setStep(step + 1);
    } else {
      await onComplete(data);
    }
  };

  const handleSkip = async () => {
    if (step < 4) {
      setStep(step + 1);
    } else {
      await onSkip?.(data);
    }
  };

  const handleBack = () => {
    if (step > 1) {
      setStep(step - 1);
    }
  };

  const canProceed = () => {
    switch (step) {
      case 1:
        return data.phoneNumber.length > 0;
      case 2:
        return data.residence.length > 0;
      case 3:
        return data.fullName.length > 0;
      case 4:
        return data.iban.length > 0;
      default:
        return false;
    }
  };

  return (
    <div className="fixed inset-0 overflow-y-auto" style={{
      background: "linear-gradient(to bottom, #5E18EA 0%, #141414 54%)",
      backgroundAttachment: "fixed",
      backgroundSize: "100% 100%",
      backgroundRepeat: "no-repeat"
    }}>
      <div className="max-w-screen-sm mx-auto w-full px-5 pt-safe pb-8 min-h-full flex flex-col box-border">
        {step === 1 && (
          <div className="space-y-6 flex-1">
            <div className="pt-4">
              <button
                onClick={handleBack}
                className="text-foreground mb-4"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
              <h1 className="text-3xl font-bold text-foreground mb-2">
                Phone number
              </h1>
              <p className="text-foreground/80 mb-8">
                Enter the phone number you want to register with.
              </p>
            </div>
            <div className="flex gap-3 w-full">
              <div className="relative flex-shrink-0">
                <select
                  value={safeCountryIndex}
                  onChange={(e) => {
                    const index = parseInt(e.target.value);
                    const country = countries[index];
                    if (country) {
                      setSelectedCountry(country);
                      setData({ ...data, countryCode: country.code, countryFlag: country.flag });
                    }
                  }}
                  className="w-20 h-14 pl-3 pr-3 bg-white/10 border border-white/20 rounded-lg text-foreground text-sm appearance-none backdrop-blur-md cursor-pointer opacity-0 absolute inset-0 z-20"
                >
                  {countries.map((country, index) => (
                    <option key={index} value={index} className="bg-background">
                      {country.flag} {country.code}
                    </option>
                  ))}
                </select>
                <div className="w-20 h-14 pl-3 pr-3 bg-white/10 border border-white/20 rounded-lg backdrop-blur-md flex items-center justify-center gap-1.5 pointer-events-none">
                  <span className="text-lg">{selectedCountry.flag}</span>
                  <span className="text-foreground text-xs font-medium">{selectedCountry.code}</span>
                </div>
              </div>
              <input
                type="tel"
                placeholder="Enter phone number"
                value={data.phoneNumber}
                onChange={(e) => {
                  const value = e.target.value.replace(/\D/g, "");
                  setData({ ...data, phoneNumber: value });
                }}
                inputMode="numeric"
                className="flex-1 min-w-0 h-14 px-4 bg-white/10 border border-white/20 rounded-lg text-foreground placeholder:text-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary backdrop-blur-md box-border"
              />
            </div>
            <div className="text-center">
              <button
                onClick={handleSkip}
                className="text-foreground text-sm font-medium"
              >
                Skip
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6 flex-1">
            <div className="pt-4">
              <button
                onClick={handleBack}
                className="text-foreground mb-4"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
              <h1 className="text-3xl font-bold text-foreground mb-2">
                Residence
              </h1>
              <p className="text-foreground/80 mb-8">
                Which country is your permanent residence?
              </p>
            </div>
            <div className="relative">
              <select
                value={data.residence}
                onChange={(e) => setData({ ...data, residence: e.target.value })}
                className="w-full h-14 px-4 bg-white/10 border border-white/20 rounded-lg text-foreground focus:outline-none focus:ring-2 focus:ring-primary appearance-none pr-10 backdrop-blur-md"
              >
                <option value="Slovensko">Slovakia</option>
                <option value="Česko">Czechia</option>
                <option value="Poľsko">Poland</option>
                <option value="Anglicko">England</option>
                <option value="Rakúsko">Austria</option>
                <option value="Maďarsko">Hungary</option>
              </select>
              <ChevronLeft className="absolute right-4 top-1/2 -translate-y-1/2 w-5 h-5 text-foreground/60 rotate-[-90deg] pointer-events-none" />
            </div>
            <div className="text-center">
              <button
                onClick={handleSkip}
                className="text-foreground text-sm font-medium"
              >
                Skip
              </button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6 flex-1">
            <div className="pt-4">
              <button
                onClick={handleBack}
                className="text-foreground mb-4"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
              <h1 className="text-3xl font-bold text-foreground mb-2">
                Full name
              </h1>
              <p className="text-foreground/80 mb-8">
                Enter your name as shown on official documents.
              </p>
            </div>
            <input
              type="text"
              placeholder="Full name"
              value={data.fullName}
              onChange={(e) => setData({ ...data, fullName: e.target.value })}
              className="w-full h-14 px-4 bg-white/10 border border-white/20 rounded-lg text-foreground placeholder:text-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary backdrop-blur-md"
            />
            <div className="text-center">
              <button
                onClick={handleSkip}
                className="text-foreground text-sm font-medium"
              >
                Skip
              </button>
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-6 flex-1">
            <div className="pt-4">
              <button
                onClick={handleBack}
                className="text-foreground mb-4"
              >
                <ChevronLeft className="w-6 h-6" />
              </button>
              <h1 className="text-3xl font-bold text-foreground mb-2">
                IBAN
              </h1>
              <p className="text-foreground/80 mb-8">
                Enter your international bank account number.
              </p>
            </div>
            <input
              type="text"
              placeholder="SK12 3456 7890 1234 5678 9012"
              value={data.iban}
              onChange={(e) => setData({ ...data, iban: e.target.value })}
              className="w-full h-14 px-4 bg-white/10 border border-white/20 rounded-lg text-foreground placeholder:text-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary backdrop-blur-md"
            />
            <div className="text-center">
              <button
                onClick={handleSkip}
                className="text-foreground text-sm font-medium"
              >
                Skip
              </button>
            </div>
          </div>
        )}

        <div className="mt-8">
          <Button
            onClick={handleNext}
            disabled={!canProceed()}
            className="w-full h-14 text-base font-bold bg-primary hover:bg-primary/90 rounded-full"
          >
            {step === 4 ? "Register" : "Continue"}
          </Button>
        </div>
      </div>
    </div>
  );
}
