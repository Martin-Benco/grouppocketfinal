"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, Search, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/lib/api/client";

type PocketCreationData = {
  pocketName: string;
  tags: string[];
  invitedUsers: PocketUserResult[];
};

type PocketUserResult = {
  uid: string;
  email: string | null;
  fullName: string | null;
  profileImageUrl: string | null;
};

function Avatar({
  src,
  name,
  className,
  fallbackClassName,
}: {
  src: string | null | undefined;
  name: string;
  className: string;
  fallbackClassName: string;
}) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [src]);

  if (src && !failed) {
    return (
      <img
        src={src}
        alt={name}
        className={className}
        onError={() => setFailed(true)}
      />
    );
  }

  return (
    <div className={fallbackClassName}>
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}

const SUGGESTED_TAGS = [
  "🏠 Ubytovanie",
  "🍽️ Jedlo",
  "🚗 Cestovanie",
] as const;

export function PocketCreationFlow() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [step, setStep] = useState(1);
  const [tagInput, setTagInput] = useState("");
  const [selectedSuggestedTags, setSelectedSuggestedTags] = useState<string[]>([]);
  const [data, setData] = useState<PocketCreationData>({
    pocketName: "",
    tags: [],
    invitedUsers: [],
  });
  const [userSearchQuery, setUserSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<PocketUserResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [myProfileImageUrl, setMyProfileImageUrl] = useState<string | null>(null);

  const title = useMemo(() => {
    if (step === 1) return "Ako sa má toto vrecko volať?";
    if (step === 2) return "Aké štítky chcete pridať?";
    return "Koho chcete do vrecka pridať?";
  }, [step]);

  const description = useMemo(() => {
    if (step === 1) return "Krátky, jasný názov, aby hneď každý vedel, o čo ide.";
    if (step === 2) return "Štítky sa pridajú k transakciám, aby bolo jasné, na čo išli peniaze.";
    return "Ľudí vyhľadáte podľa e-mailu a pridáte ich do vrecka.";
  }, [step]);

  const parseTags = (value: string) => {
    return Array.from(
      new Set(
        value
          .split(/\s+/)
          .map((item) => item.trim())
          .filter(Boolean)
      )
    );
  };

  const parseTagDraft = (value: string) => {
    const normalized = value.replace(/\s+/g, " ");
    const hasOpenDraft = !normalized.endsWith(" ");
    const parts = normalized.split(" ").filter(Boolean);
    const completedTags = hasOpenDraft ? parts.slice(0, -1) : parts;
    const draft = hasOpenDraft ? (parts[parts.length - 1] ?? "") : "";
    return { completedTags, draft };
  };

  const syncTagsFromInput = (value: string) => {
    setTagInput(value);
    setData((prev) => ({
      ...prev,
      tags: Array.from(new Set([...selectedSuggestedTags, ...parseTags(value)])),
    }));
  };

  const addSuggestedTag = (tag: string) => {
    setSelectedSuggestedTags((prev) =>
      prev.includes(tag) ? prev.filter((existing) => existing !== tag) : [...prev, tag]
    );
  };

  const { completedTags, draft } = parseTagDraft(tagInput);

  const removeTag = (tagToRemove: string) => {
    if (selectedSuggestedTags.includes(tagToRemove)) {
      setSelectedSuggestedTags((prev) => prev.filter((tag) => tag !== tagToRemove));
      return;
    }
    const nextTags = completedTags.filter((tag) => tag !== tagToRemove);
    const nextPrefix = nextTags.length > 0 ? `${nextTags.join(" ")} ` : "";
    syncTagsFromInput(`${nextPrefix}${draft}`);
  };

  const rebuildTagInput = (nextDraft: string) => {
    const prefix = completedTags.length > 0 ? `${completedTags.join(" ")} ` : "";
    syncTagsFromInput(`${prefix}${nextDraft}`);
  };

  const canProceed =
    step === 1
      ? data.pocketName.trim().length > 0
      : true;

  useEffect(() => {
    if (step !== 3) {
      return;
    }

    const query = userSearchQuery.trim();
    if (query.length < 2) {
      setSearchResults([]);
      setSearchError(null);
      setSearchLoading(false);
      return;
    }

    const timeoutId = window.setTimeout(async () => {
      try {
        setSearchLoading(true);
        setSearchError(null);
        const result = (await api.users.searchByEmail(query)) as {
          users: PocketUserResult[];
        };
        setSearchResults(result.users || []);
      } catch (error: any) {
        setSearchResults([]);
        setSearchError(error.message || "Vyhľadávanie zlyhalo");
      } finally {
        setSearchLoading(false);
      }
    }, 250);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [step, userSearchQuery]);

  useEffect(() => {
    const loadMyProfile = async () => {
      if (!user?.uid) return;
      try {
        const profile = (await api.users.get(user.uid)) as { profileImageUrl?: string | null };
        setMyProfileImageUrl(profile.profileImageUrl || null);
      } catch {
        setMyProfileImageUrl(null);
      }
    };
    void loadMyProfile();
  }, [user?.uid]);

  useEffect(() => {
    setData((prev) => ({
      ...prev,
      tags: Array.from(new Set([...selectedSuggestedTags, ...parseTags(tagInput)])),
    }));
  }, [selectedSuggestedTags, tagInput]);

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

  const handleNext = () => {
    if (step < 3) {
      setStep((prev) => prev + 1);
      return;
    }
  };

  const handleBack = () => {
    if (step === 1) {
      router.push("/pockety");
      return;
    }

    setStep((prev) => prev - 1);
  };

  const addInvitedUser = (userToAdd: PocketUserResult) => {
    setData((prev) => {
      if (prev.invitedUsers.some((user) => user.uid === userToAdd.uid)) {
        return prev;
      }

      return {
        ...prev,
        invitedUsers: [...prev.invitedUsers, userToAdd],
      };
    });
    setUserSearchQuery("");
    setSearchResults([]);
  };

  const removeInvitedUser = (uid: string) => {
    setData((prev) => ({
      ...prev,
      invitedUsers: prev.invitedUsers.filter((user) => user.uid !== uid),
    }));
  };

  const handleCreatePocket = async () => {
    const result = (await api.pockets.create({
      name: data.pocketName.trim(),
      tags: data.tags,
      invitedUserUids: data.invitedUsers.map((invitedUser) => invitedUser.uid),
    })) as { pocketId: string };

    router.push(`/pockety/detail?pocketId=${encodeURIComponent(result.pocketId)}`);
  };

  return (
    <div
      className="min-h-screen overflow-y-auto"
      style={{
        background: "linear-gradient(to bottom, #5E18EA 0%, #141414 54%)",
        backgroundAttachment: "fixed",
        backgroundSize: "100% 100%",
        backgroundRepeat: "no-repeat",
      }}
    >
      <div className="mx-auto flex min-h-screen max-w-screen-sm flex-col px-5 pb-8 pt-safe">
        <div className="flex-1">
          <div className="pt-4">
            <button onClick={handleBack} className="mb-4 text-foreground">
              <ChevronLeft className="h-6 w-6" />
            </button>

            <h1 className="text-3xl font-bold text-foreground">{title}</h1>
            <p className="mt-2 text-foreground/80">{description}</p>
          </div>

          {step === 1 && (
            <div className="mt-8 space-y-4">
              <input
                type="text"
                placeholder="napr. Byt Bratislava alebo Letný výlet"
                value={data.pocketName}
                onChange={(e) =>
                  setData((prev) => ({ ...prev, pocketName: e.target.value }))
                }
                className="h-14 w-full rounded-lg border border-white/20 bg-white/10 px-4 text-foreground placeholder:text-foreground/60 backdrop-blur-md focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          )}

          {step === 2 && (
            <div className="mt-8 space-y-5">
              <div className="flex flex-wrap gap-2">
                {SUGGESTED_TAGS.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => addSuggestedTag(tag)}
                    className={`rounded-full border px-4 py-2 text-sm font-medium transition-colors ${
                      data.tags.includes(tag)
                        ? "border-[rgb(196,181,253)] bg-[rgba(124,58,237,0.28)] text-white"
                        : "border-white/15 bg-white/5 text-foreground/85"
                    }`}
                  >
                    {tag}
                  </button>
                ))}
              </div>

              <div className="rounded-lg border border-white/20 bg-white/10 px-4 py-3 backdrop-blur-md focus-within:ring-2 focus-within:ring-primary">
                <div className="flex flex-wrap items-center gap-2">
                  {[...selectedSuggestedTags, ...completedTags].map((tag) => (
                    <button
                      key={tag}
                      type="button"
                      onClick={() => removeTag(tag)}
                      className="rounded-full border border-[rgb(196,181,253)] bg-[rgba(124,58,237,0.24)] px-3 py-1 text-sm font-medium text-white"
                    >
                      {tag}
                    </button>
                  ))}

                  <input
                    type="text"
                    placeholder={selectedSuggestedTags.length + completedTags.length === 0 ? "Štítky oddeľte medzerou" : ""}
                    value={draft}
                    onChange={(e) => rebuildTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Backspace" && !draft && completedTags.length > 0) {
                        e.preventDefault();
                        const last = completedTags[completedTags.length - 1];
                        removeTag(last);
                      }
                    }}
                    className="min-h-[32px] min-w-[140px] flex-1 bg-transparent text-foreground placeholder:text-foreground/60 focus:outline-none"
                  />
                </div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="mt-8 space-y-4">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-md">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-foreground/55" />
                  <input
                    type="text"
                    inputMode="email"
                    placeholder="Hľadať podľa e-mailu"
                    value={userSearchQuery}
                    onChange={(e) => setUserSearchQuery(e.target.value)}
                    className="h-14 w-full rounded-lg border border-white/20 bg-white/10 pl-12 pr-4 text-foreground placeholder:text-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>

                {searchLoading && (
                  <p className="mt-3 text-sm text-foreground/70">Hľadám…</p>
                )}

                {searchError && (
                  <p className="mt-3 text-sm text-red-300">{searchError}</p>
                )}

                {!searchLoading && !searchError && userSearchQuery.trim().length >= 2 && searchResults.length === 0 && (
                  <p className="mt-3 text-sm text-foreground/70">Nikoho sme nenašli.</p>
                )}

                {searchResults.length > 0 && (
                  <div className="mt-4 space-y-3">
                    {searchResults.map((result) => {
                      const alreadyAdded = data.invitedUsers.some((user) => user.uid === result.uid);
                      const displayName = result.fullName || result.email || "Používateľ";

                      return (
                        <div
                          key={result.uid}
                          className="flex items-center justify-between rounded-xl border border-white/10 bg-black/15 px-4 py-3"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <Avatar
                              src={result.profileImageUrl}
                              name={displayName}
                              className="h-11 w-11 rounded-full object-cover"
                              fallbackClassName="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-sm font-semibold text-foreground"
                            />
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-foreground">
                                {displayName}
                              </p>
                              <p className="truncate text-xs text-foreground/65">
                                {result.email || "Bez e-mailu"}
                              </p>
                            </div>
                          </div>

                          <Button
                            type="button"
                            onClick={() => addInvitedUser(result)}
                            disabled={alreadyAdded}
                            className="ml-3 h-10 rounded-full px-4 text-sm font-semibold"
                          >
                            {alreadyAdded ? "Pridané" : "Pridať"}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur-md">
                <div className="flex items-center gap-2">
                  <UserPlus className="h-5 w-5 text-[rgb(196,181,253)]" />
                  <p className="text-sm font-semibold text-foreground">
                    Ľudia v tomto vrecku
                  </p>
                </div>

                <div className="mt-4 space-y-3">
                  <div className="flex items-center justify-between rounded-xl border border-[rgba(124,58,237,0.45)] bg-[rgba(124,58,237,0.16)] px-4 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar
                        src={myProfileImageUrl || user.photoURL}
                        name={user.displayName || user.email || "Vy"}
                        className="h-11 w-11 rounded-full object-cover"
                        fallbackClassName="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-sm font-semibold text-foreground"
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">
                          {user.displayName || user.email || "Vy"}
                        </p>
                        <p className="truncate text-xs text-foreground/65">
                          {user.email || "Váš účet"}
                        </p>
                      </div>
                    </div>
                    <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[rgb(196,181,253)]">
                      Vy
                    </span>
                  </div>

                  {data.invitedUsers.map((invitedUser) => {
                    const displayName = invitedUser.fullName || invitedUser.email || "Používateľ";

                    return (
                      <button
                        key={invitedUser.uid}
                        type="button"
                        onClick={() => removeInvitedUser(invitedUser.uid)}
                        className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-black/15 px-4 py-3 text-left"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <Avatar
                            src={invitedUser.profileImageUrl}
                            name={displayName}
                            className="h-11 w-11 rounded-full object-cover"
                            fallbackClassName="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-sm font-semibold text-foreground"
                          />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-foreground">
                              {displayName}
                            </p>
                            <p className="truncate text-xs text-foreground/65">
                              {invitedUser.email || "Bez e-mailu"}
                            </p>
                          </div>
                        </div>
                        <span className="text-xs font-medium text-foreground/55">
                          Odstrániť
                        </span>
                      </button>
                    );
                  })}

                  {data.invitedUsers.length === 0 && (
                    <p className="text-sm text-foreground/70">
                      Ešte ste nepridali nikoho ďalšieho.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="mt-8">
          <Button
            onClick={() => {
              if (step === 3) {
                void handleCreatePocket();
                return;
              }
              handleNext();
            }}
            disabled={!canProceed}
            className="h-14 w-full rounded-full bg-primary text-base font-bold hover:bg-primary/90"
          >
            {step === 3 ? "Vytvoriť vrecko" : "Pokračovať"}
          </Button>
        </div>
      </div>
    </div>
  );
}
