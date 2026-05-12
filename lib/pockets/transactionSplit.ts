export type ResolvePocketSplitInput = {
  amount: number;
  payerUid: string;
  splitAssignedUids: string[] | undefined;
  acceptedMemberUids: string[];
};

export type ResolvedPocketSplit = {
  splitUids: string[];
  sharePerPerson: number;
  debtorUids: string[];
};

/** Rovnomerný podiel: suma / |splitAssigned|, inak suma / (počet členov − platiteľ). */
export function resolvePocketTransactionSplit(input: ResolvePocketSplitInput): ResolvedPocketSplit | null {
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const acceptedSet = new Set(input.acceptedMemberUids);
  const assignedUnique = Array.from(
    new Set((input.splitAssignedUids ?? []).filter((uid) => acceptedSet.has(uid))),
  );

  if (assignedUnique.length > 0) {
    const sharePerPerson = amount / assignedUnique.length;
    const debtorUids = assignedUnique.filter((uid) => uid !== input.payerUid);
    return { splitUids: assignedUnique, sharePerPerson, debtorUids };
  }

  const debtorUids = input.acceptedMemberUids.filter((uid) => uid !== input.payerUid);
  if (debtorUids.length <= 0) return null;
  return {
    splitUids: [],
    sharePerPerson: amount / debtorUids.length,
    debtorUids,
  };
}
