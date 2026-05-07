import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { FirebaseService } from '../firebase/firebase.service';
import { CreatePocketDto } from './dto/create-pocket.dto';
import { AddPocketTransactionDto } from './dto/add-pocket-transaction.dto';

type AuthUser = {
  uid: string;
  email?: string | null;
  name?: string | null;
};

type PocketMemberStatus = 'accepted' | 'pending' | 'rejected' | 'cancelled';

type PocketMember = {
  uid: string;
  email: string | null;
  fullName: string | null;
  profileImageUrl: string | null;
  iban: string | null;
  status: PocketMemberStatus;
};

type PocketTransaction = {
  id: string;
  name: string;
  amount: number;
  date: string;
  payerUid: string;
  tag: string | null;
  note: string | null;
  splitAssignedUids: string[];
  createdAt: string;
};

@Injectable()
export class PocketsService {
  constructor(private readonly firebase: FirebaseService) {}

  private pocketsCol() {
    return this.firebase.getFirestore().collection('pockets');
  }

  private async getUserProfile(uid: string, fallbackEmail?: string | null) {
    const doc = await this.firebase.getFirestore().collection('users').doc(uid).get();
    const data = doc.exists ? doc.data() || {} : {};
    return {
      uid,
      email: (data.email as string) || fallbackEmail || null,
      fullName: (data.fullName as string) || null,
      profileImageUrl: (data.profileImageUrl as string) || null,
      iban: (data.iban as string) || null,
    };
  }

  private normalizeTags(tags?: string[]) {
    return Array.from(new Set((tags || []).map((tag) => tag.trim()).filter(Boolean))).slice(0, 20);
  }

  private async readPocketOrThrow(pocketId: string) {
    const ref = this.pocketsCol().doc(pocketId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new NotFoundException('Pocket does not exist');
    }
    return { ref, data: snap.data() as Record<string, unknown> };
  }

  private normalizeTransactions(input: unknown): PocketTransaction[] {
    if (!Array.isArray(input)) return [];
    return input
      .map((item) => item as Partial<PocketTransaction>)
      .filter((t) => Boolean(t?.id && t?.name && typeof t?.amount === 'number'))
      .map((t) => ({
        id: String(t.id),
        name: String(t.name),
        amount: Number(t.amount) || 0,
        date: String(t.date || ''),
        payerUid: String(t.payerUid || ''),
        tag: t.tag ? String(t.tag) : null,
        note: t.note ? String(t.note) : null,
        splitAssignedUids: Array.isArray(t.splitAssignedUids)
          ? t.splitAssignedUids.map((uid) => String(uid)).filter(Boolean)
          : [],
        createdAt: String(t.createdAt || ''),
      }));
  }

  private findMemberIndex(
    members: PocketMember[],
    uid: string,
    email?: string | null,
  ) {
    const normalizedEmail = (email || '').trim().toLowerCase();
    return members.findIndex((member) => {
      if (member.uid === uid) return true;
      const memberEmail = (member.email || '').trim().toLowerCase();
      return Boolean(normalizedEmail && memberEmail && memberEmail === normalizedEmail);
    });
  }

  async create(dto: CreatePocketDto, user: AuthUser) {
    const name = dto.name.trim();
    if (!name) {
      throw new NotFoundException('Pocket name is required');
    }

    const creatorProfile = await this.getUserProfile(user.uid, user.email || null);
    const invitedProfiles = await Promise.all(
      Array.from(new Set((dto.invitedUserUids || []).filter((uid) => uid && uid !== user.uid))).map((uid) =>
        this.getUserProfile(uid),
      ),
    );

    const members: PocketMember[] = [
      {
        ...creatorProfile,
        fullName: creatorProfile.fullName || user.name || creatorProfile.email,
        status: 'accepted',
      },
      ...invitedProfiles.map((profile) => ({
        ...profile,
        status: 'pending' as const,
      })),
    ];

    const pocketId = randomUUID();
    const now = new Date().toISOString();

    await this.pocketsCol().doc(pocketId).set({
      name,
      tags: this.normalizeTags(dto.tags),
      createdAt: now,
      updatedAt: now,
      ownerUid: user.uid,
      members,
    });

    return { pocketId };
  }

  async listForUser(uid: string) {
    let requesterEmail: string | null = null;
    try {
      const authUser = await this.firebase.getAuth().getUser(uid);
      requesterEmail = authUser.email || null;
    } catch {
      requesterEmail = null;
    }

    const snap = await this.pocketsCol().get();
    const accepted: Array<Record<string, unknown>> = [];
    const pending: Array<Record<string, unknown>> = [];

    snap.docs.forEach((doc) => {
      const data = doc.data() as Record<string, unknown>;
      const members = ((data.members as PocketMember[]) || []);
      const memberIndex = this.findMemberIndex(members, uid, requesterEmail);
      const member = memberIndex >= 0 ? members[memberIndex] : null;
      if (!member) return;

      const row = {
        id: doc.id,
        name: (data.name as string) || 'Pocket',
        tags: ((data.tags as string[]) || []).slice(0, 10),
        ownerUid: (data.ownerUid as string) || null,
        updatedAt: (data.updatedAt as string) || '',
        members,
      };

      if (member.status === 'accepted') accepted.push(row);
      if (member.status === 'pending') pending.push(row);
    });

    accepted.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    pending.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));

    return { accepted, pending };
  }

  async respondToInvite(pocketId: string, uid: string, status: 'accepted' | 'rejected') {
    const { ref, data } = await this.readPocketOrThrow(pocketId);
    const members = ((data.members as PocketMember[]) || []);

    let requesterEmail: string | null = null;
    try {
      const authUser = await this.firebase.getAuth().getUser(uid);
      requesterEmail = authUser.email || null;
    } catch {
      requesterEmail = null;
    }

    const targetIndex = this.findMemberIndex(members, uid, requesterEmail);
    if (targetIndex < 0) {
      throw new ForbiddenException('You do not have access to this invite');
    }

    const updatedMembers = members.map((member, idx) =>
      idx === targetIndex
        ? {
            ...member,
            uid, // zjednotiť člena na aktuálneho používateľa
            email: member.email || requesterEmail || null,
            status,
          }
        : member,
    );

    await ref.update({
      members: updatedMembers,
      updatedAt: new Date().toISOString(),
    });

    return { success: true };
  }

  async inviteByEmailForUser(pocketId: string, requesterUid: string, email: string) {
    const normalizedEmail = (email || '').trim().toLowerCase();
    if (!normalizedEmail) {
      throw new NotFoundException('Email is required');
    }

    const { ref, data } = await this.readPocketOrThrow(pocketId);
    const members = ((data.members as PocketMember[]) || []);
    const acceptedMembers = members.filter((member) => member.status === 'accepted');
    if (!acceptedMembers.some((member) => member.uid === requesterUid)) {
      throw new ForbiddenException('You do not have access to this Pocket');
    }

    const existingByEmail = members.find(
      (member) => (member.email || '').trim().toLowerCase() === normalizedEmail,
    );
    if (existingByEmail?.status === 'accepted') {
      throw new NotFoundException('User is already a Pocket member');
    }
    if (existingByEmail?.status === 'pending') {
      throw new NotFoundException('User already has an active invite');
    }

    const userSnap = await this.firebase
      .getFirestore()
      .collection('users')
      .where('email', '==', normalizedEmail)
      .limit(1)
      .get();
    if (userSnap.empty) {
      throw new NotFoundException('User with this email does not exist');
    }
    const target = userSnap.docs[0];
    const targetUid = target.id;
    const targetProfile = await this.getUserProfile(targetUid, normalizedEmail);

    const existingByUidIdx = members.findIndex((member) => member.uid === targetUid);
    const nextMembers =
      existingByUidIdx >= 0
        ? members.map((member, idx) =>
            idx === existingByUidIdx
              ? {
                  ...member,
                  ...targetProfile,
                  status: 'pending' as const,
                }
              : member,
          )
        : [
            ...members,
            {
              ...targetProfile,
              status: 'pending' as const,
            },
          ];

    await ref.update({
      members: nextMembers,
      updatedAt: new Date().toISOString(),
    });

    return { success: true };
  }

  async inviteByUidForUser(pocketId: string, requesterUid: string, userUid: string) {
    const targetUid = (userUid || '').trim();
    if (!targetUid) {
      throw new NotFoundException('User is required');
    }

    const { ref, data } = await this.readPocketOrThrow(pocketId);
    const members = ((data.members as PocketMember[]) || []);
    const acceptedMembers = members.filter((member) => member.status === 'accepted');
    if (!acceptedMembers.some((member) => member.uid === requesterUid)) {
      throw new ForbiddenException('You do not have access to this Pocket');
    }
    if (targetUid === requesterUid) {
      throw new NotFoundException('You cannot invite yourself');
    }

    const existingByUid = members.find((member) => member.uid === targetUid);
    if (existingByUid?.status === 'accepted') {
      throw new NotFoundException('User is already a Pocket member');
    }
    if (existingByUid?.status === 'pending') {
      throw new NotFoundException('User already has an active invite');
    }

    const targetProfile = await this.getUserProfile(targetUid);
    if (!targetProfile.uid) {
      throw new NotFoundException('User does not exist');
    }

    const existingByUidIdx = members.findIndex((member) => member.uid === targetUid);
    const nextMembers =
      existingByUidIdx >= 0
        ? members.map((member, idx) =>
            idx === existingByUidIdx
              ? {
                  ...member,
                  ...targetProfile,
                  status: 'pending' as const,
                }
              : member,
          )
        : [
            ...members,
            {
              ...targetProfile,
              status: 'pending' as const,
            },
          ];

    await ref.update({
      members: nextMembers,
      updatedAt: new Date().toISOString(),
    });

    return { success: true };
  }

  async getOneForUser(pocketId: string, uid: string) {
    const { data } = await this.readPocketOrThrow(pocketId);
    const members = ((data.members as PocketMember[]) || []);
    const hydratedProfiles = await Promise.all(
      members.map(async (member) => {
        const profile = await this.getUserProfile(member.uid, member.email);
        return [member.uid, profile] as const;
      }),
    );
    const profilesByUid = new Map(hydratedProfiles);
    const hydratedMembers = members.map((member) => {
      const profile = profilesByUid.get(member.uid);
      if (!profile) return member;
      return {
        ...member,
        email: profile.email || member.email || null,
        fullName: profile.fullName || member.fullName || null,
        profileImageUrl: profile.profileImageUrl || member.profileImageUrl || null,
        iban: profile.iban || member.iban || null,
      };
    });
    const visibleMembers = hydratedMembers.filter((member) => member.status !== 'cancelled');

    let requesterEmail: string | null = null;
    try {
      const authUser = await this.firebase.getAuth().getUser(uid);
      requesterEmail = authUser.email || null;
    } catch {
      requesterEmail = null;
    }

    const memberIndex = this.findMemberIndex(visibleMembers, uid, requesterEmail);
    const member = memberIndex >= 0 ? visibleMembers[memberIndex] : null;

    if (!member || member.status !== 'accepted') {
      throw new ForbiddenException('You do not have access to this Pocket');
    }

    const transactions = this.normalizeTransactions(data.transactions);
    const totalAmount = transactions.reduce((sum, tx) => sum + tx.amount, 0);
    const paidAmount = transactions.reduce((sum, tx) => sum + tx.amount, 0);

    return {
      id: pocketId,
      name: (data.name as string) || 'Pocket',
      tags: ((data.tags as string[]) || []).slice(0, 20),
      ownerUid: (data.ownerUid as string) || null,
      members: visibleMembers,
      updatedAt: (data.updatedAt as string) || '',
      transactions,
      analytics: {
        totalAmount,
        paidAmount,
      },
    };
  }

  async addTransactionForUser(pocketId: string, uid: string, dto: AddPocketTransactionDto) {
    const now = new Date().toISOString();
    const transaction: PocketTransaction = {
      id: randomUUID(),
      name: dto.name.trim(),
      amount: Number(dto.amount),
      date: dto.date,
      payerUid: dto.payerUid,
      tag: dto.tag?.trim() || null,
      note: dto.note?.trim() || null,
      splitAssignedUids: Array.from(new Set((dto.splitAssignedUids || []).filter(Boolean))),
      createdAt: now,
    };
    const ref = this.pocketsCol().doc(pocketId);
    await this.firebase.getFirestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        throw new NotFoundException('Pocket neexistuje');
      }
      const data = snap.data() as Record<string, unknown>;
      const members = ((data.members as PocketMember[]) || []);
      const acceptedMembers = members.filter((member) => member.status === 'accepted');
      const activeMembers = members.filter(
        (member) => member.status === 'accepted' || member.status === 'pending',
      );
      if (!acceptedMembers.some((member) => member.uid === uid)) {
        throw new ForbiddenException('You do not have access to this Pocket');
      }
      if (!Number.isFinite(transaction.amount) || transaction.amount <= 0) {
        throw new NotFoundException('Invalid transaction amount');
      }
      if (!activeMembers.some((member) => member.uid === dto.payerUid)) {
        throw new NotFoundException('Payer is not a Pocket member');
      }
      if (transaction.splitAssignedUids.length === 0) {
        throw new NotFoundException('Select at least one person for split');
      }
      const allValid = transaction.splitAssignedUids.every((assignedUid) =>
        activeMembers.some((member) => member.uid === assignedUid),
      );
      if (!allValid) {
        throw new NotFoundException('Some selected people are not Pocket members');
      }
      const transactions = this.normalizeTransactions(data.transactions);
      tx.update(ref, {
        transactions: [transaction, ...transactions],
        updatedAt: now,
      });
    });
    const fresh = await ref.get();
    const updatedTransactions = this.normalizeTransactions((fresh.data() as Record<string, unknown> | undefined)?.transactions);
    const totalAmount = updatedTransactions.reduce((sum, tx) => sum + tx.amount, 0);
    const paidAmount = updatedTransactions.reduce((sum, tx) => sum + tx.amount, 0);

    return {
      transaction,
      analytics: {
        totalAmount,
        paidAmount,
      },
    };
  }

  async updateTransactionForUser(
    pocketId: string,
    transactionId: string,
    uid: string,
    dto: {
      name: string;
      amount: number;
      date: string;
      payerUid: string;
      tag?: string;
      note?: string;
      splitAssignedUids: string[];
    },
  ) {
    const amount = Number(dto.amount);
    const splitAssignedUids = Array.from(new Set((dto.splitAssignedUids || []).filter(Boolean)));
    const now = new Date().toISOString();
    const ref = this.pocketsCol().doc(pocketId);
    await this.firebase.getFirestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        throw new NotFoundException('Pocket neexistuje');
      }
      const data = snap.data() as Record<string, unknown>;
      const members = ((data.members as PocketMember[]) || []);
      const acceptedMembers = members.filter((member) => member.status === 'accepted');
      const activeMembers = members.filter(
        (member) => member.status === 'accepted' || member.status === 'pending',
      );
      if (!acceptedMembers.some((member) => member.uid === uid)) {
        throw new ForbiddenException('You do not have access to this Pocket');
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new NotFoundException('Invalid transaction amount');
      }
      if (!activeMembers.some((member) => member.uid === dto.payerUid)) {
        throw new NotFoundException('Payer is not a Pocket member');
      }
      if (splitAssignedUids.length === 0) {
        throw new NotFoundException('Select at least one person for split');
      }
      const allValid = splitAssignedUids.every((assignedUid) =>
        activeMembers.some((member) => member.uid === assignedUid),
      );
      if (!allValid) {
        throw new NotFoundException('Some selected people are not Pocket members');
      }
      const transactions = this.normalizeTransactions(data.transactions);
      const idx = transactions.findIndex((t) => t.id === transactionId);
      if (idx < 0) {
        throw new NotFoundException('Transakcia neexistuje');
      }
      const existing = transactions[idx];
      const updatedTransactions = [...transactions];
      updatedTransactions[idx] = {
        ...existing,
        name: dto.name.trim(),
        amount,
        date: dto.date,
        payerUid: dto.payerUid,
        tag: dto.tag?.trim() || null,
        note: dto.note?.trim() || null,
        splitAssignedUids,
      };
      tx.update(ref, {
        transactions: updatedTransactions,
        updatedAt: now,
      });
    });
    const fresh = await ref.get();
    const updatedTransactions = this.normalizeTransactions((fresh.data() as Record<string, unknown> | undefined)?.transactions);
    const updatedTx = updatedTransactions.find((row) => row.id === transactionId);
    if (!updatedTx) {
      throw new NotFoundException('Transakcia neexistuje');
    }
    const totalAmount = updatedTransactions.reduce((sum, tx) => sum + tx.amount, 0);
    const paidAmount = updatedTransactions.reduce((sum, tx) => sum + tx.amount, 0);

    return {
      transaction: updatedTx,
      analytics: {
        totalAmount,
        paidAmount,
      },
    };
  }

  async deleteTransactionForUser(pocketId: string, transactionId: string, uid: string) {
    const now = new Date().toISOString();
    const ref = this.pocketsCol().doc(pocketId);
    await this.firebase.getFirestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        throw new NotFoundException('Pocket neexistuje');
      }
      const data = snap.data() as Record<string, unknown>;
      const members = ((data.members as PocketMember[]) || []);
      const acceptedMembers = members.filter((member) => member.status === 'accepted');
      if (!acceptedMembers.some((member) => member.uid === uid)) {
        throw new ForbiddenException('You do not have access to this Pocket');
      }
      const transactions = this.normalizeTransactions(data.transactions);
      const next = transactions.filter((t) => t.id !== transactionId);
      if (next.length === transactions.length) {
        throw new NotFoundException('Transakcia neexistuje');
      }
      tx.update(ref, {
        transactions: next,
        updatedAt: now,
      });
    });
    const fresh = await ref.get();
    const next = this.normalizeTransactions((fresh.data() as Record<string, unknown> | undefined)?.transactions);
    const totalAmount = next.reduce((sum, tx) => sum + tx.amount, 0);
    const paidAmount = next.reduce((sum, tx) => sum + tx.amount, 0);

    return {
      success: true,
      analytics: {
        totalAmount,
        paidAmount,
      },
    };
  }

  async removeMemberForOwner(pocketId: string, requesterUid: string, memberUid: string) {
    if (!memberUid) {
      throw new NotFoundException('This account cannot be removed');
    }
    const now = new Date().toISOString();
    const ref = this.pocketsCol().doc(pocketId);
    await this.firebase.getFirestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        throw new NotFoundException('Pocket neexistuje');
      }
      const data = snap.data() as Record<string, unknown>;
      const ownerUid = (data.ownerUid as string) || null;
      if (!ownerUid || ownerUid !== requesterUid) {
        throw new ForbiddenException('Only Pocket creator can remove a member');
      }
      if (memberUid === ownerUid) {
        throw new NotFoundException('This account cannot be removed');
      }
      const members = ((data.members as PocketMember[]) || []);
      const memberToRemove = members.find((member) => member.uid === memberUid);
      if (!memberToRemove) {
        throw new NotFoundException('User was not found in this Pocket');
      }
      if (memberToRemove.status === 'pending') {
        throw new NotFoundException('Use invite cancellation for pending invites');
      }
      const nextMembers = members.filter((member) => member.uid !== memberUid);
      const transactions = this.normalizeTransactions(data.transactions);
      const nextTransactions = transactions
        .filter((txRow) => txRow.payerUid !== memberUid)
        .map((txRow) => ({
          ...txRow,
          splitAssignedUids: (txRow.splitAssignedUids || []).filter((id) => id !== memberUid),
        }));
      tx.update(ref, {
        members: nextMembers,
        transactions: nextTransactions,
        updatedAt: now,
      });
    });

    return { success: true };
  }

  async cancelInviteForOwner(pocketId: string, requesterUid: string, memberUid: string) {
    if (!memberUid) {
      throw new NotFoundException('Invite could not be found');
    }
    const now = new Date().toISOString();
    const ref = this.pocketsCol().doc(pocketId);
    await this.firebase.getFirestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) {
        throw new NotFoundException('Pocket neexistuje');
      }
      const data = snap.data() as Record<string, unknown>;
      const ownerUid = (data.ownerUid as string) || null;
      if (!ownerUid || ownerUid !== requesterUid) {
        throw new ForbiddenException('Only Pocket creator can cancel an invite');
      }
      if (memberUid === ownerUid) {
        throw new NotFoundException('Invite could not be found');
      }
      const members = ((data.members as PocketMember[]) || []);
      const targetIndex = members.findIndex((member) => member.uid === memberUid);
      if (targetIndex < 0) {
        throw new NotFoundException('Invite could not be found');
      }
      const targetMember = members[targetIndex];
      if (targetMember.status !== 'pending') {
        throw new NotFoundException('This invite is no longer active');
      }
      const updatedMembers = members.map((member, idx) =>
        idx === targetIndex
          ? {
              ...member,
              status: 'cancelled' as const,
            }
          : member,
      );
      tx.update(ref, {
        members: updatedMembers,
        updatedAt: now,
      });
    });

    return { success: true };
  }
}
