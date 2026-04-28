export const MAIN_NAV_ITEMS = [
  { id: "home", label: "GroupPocket" },
  { id: "pockety", label: "Pockety" },
  { id: "quicksplit", label: "QuickSplit" },
  { id: "ucet", label: "Účet" },
  { id: "premium", label: "Premium" },
] as const;

export type MainNavTabId = (typeof MAIN_NAV_ITEMS)[number]["id"];
