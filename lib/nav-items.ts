export const MAIN_NAV_ITEMS = [
  { id: "quicksplit", label: "QuickSplit" },
  { id: "pockety", label: "Pockety" },
  { id: "ucet", label: "Účet" },
] as const;

export type MainNavTabId = (typeof MAIN_NAV_ITEMS)[number]["id"];
