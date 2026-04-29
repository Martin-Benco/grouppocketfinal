import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes, randomUUID } from 'crypto';
import { FirebaseService } from '../firebase/firebase.service';
import { AddPocketTransactionDto } from './dto/add-transaction.dto';
import { CreatePocketDto, CreatePocketTransactionInput } from './dto/create-pocket.dto';
import { UpdatePocketDto } from './dto/update-pocket.dto';

type AuthUser = {
  uid: string;
  email?: string | null;
  name?: string | null;
};

@Injectable()
export class PocketsService {
  constructor(private readonly firebase: FirebaseService) {}

  private pocketsCol() {
    return this.firebase.getFirestore().collection('pockets');
  }

  private txCol(pocketId: string) {
    return this.pocketsCol().doc(pocketId).collection('transactions');
  }

  private activitiesCol(pocketId: string) {
    return this.pocketsCol().doc(pocketId).collection('activities');
  }

  private normalizeTags(tags: string[] | undefined): string[] {
    return Array.from(
      new Set((tags || []).map((x) => x.trim()).filter(Boolean).slice(0, 20)),
    );
  }

  private async assertMember(pocketId: string, uid: string) {
    const ref = this.pocketsCol().doc(pocketId);
    const snap = await ref.get();
    if (!snap.exists) throw new NotFoundException('Pocket neexistuje');
    const data = snap.data()!;
    const memberUids = (data.memberUids as string[]) || [];
    if (!memberUids.includes(uid)) {
      throw new ForbiddenException('Do tohto pocketu nemáš prístup');
    }
    return { ref, data };
  }

  private toDateOnly(input: string | undefined) {
    if (!input) return new Date().toISOString().slice(0, 10);
    return input.slice(0, 10);
  }

  private async getUserPublic(uid: string) {
    const userDoc = await this.firebase.getFirestore().collection('users').doc(uid).get();
    if (!userDoc.exists) return null;
    const d = userDoc.data() || {};
    return {
      fullName: (d.fullName as string) || null,
      email: (d.email as string) || null,
      profileImageUrl: (d.profileImageUrl as string) || null,
    };
  }

  private async hydrateMembers(membersRaw: Array<Record<string, unknown>>) {
    const members = await Promise.all(
      membersRaw.map(async (m) => {
        const uid = (m.uid as string | null) || null;
        if (!uid) {
          return {
            uid: null,
            displayName: (m.displayName as string) || 'Používateľ',
            email: (m.email as string) || null,
            profileImageUrl: (m.profileImageUrl as string) || null,
            joinedAt: (m.joinedAt as string) || null,
          };
        }
        const u = await this.getUserPublic(uid);
        return {
          uid,
          displayName: u?.fullName || (m.displayName as string) || 'Používateľ',
          email: u?.email || (m.email as string) || null,
          profileImageUrl: u?.profileImageUrl || (m.profileImageUrl as string) || null,
          joinedAt: (m.joinedAt as string) || null,
        };
      }),
    );
    return members;
  }

  private async addActivity(
    pocketId: string,
    type:
      | 'pocket_created'
      | 'transaction_added'
      | 'member_invited_email'
      | 'settings_updated'
      | 'member_left',
    actorUid: string | null,
    meta: Record<string, unknown> = {},
  ) {
    const now = new Date().toISOString();
    let actorDisplayName: string | null = null;
    if (actorUid) {
      const u = await this.getUserPublic(actorUid);
      actorDisplayName = u?.fullName || u?.email || null;
    }
    await this.activitiesCol(pocketId).add({
      type,
      actorUid,
      actorDisplayName,
      meta,
      createdAt: now,
    });
  }

  async listActivities(pocketId: string, uid: string) {
    await this.assertMember(pocketId, uid);
    const snap = await this.activitiesCol(pocketId).orderBy('createdAt', 'desc').limit(50).get();
    return {
      activities: snap.docs.map((d) => {
        const x = d.data();
        return {
          id: d.id,
          type: (x.type as string) || 'unknown',
          actorUid: (x.actorUid as string | null) || null,
          actorDisplayName: (x.actorDisplayName as string | null) || null,
          meta: (x.meta as Record<string, unknown>) || {},
          createdAt: (x.createdAt as string) || null,
        };
      }),
    };
  }

  private async writeTransaction(
    pocketId: string,
    byUid: string,
    body: CreatePocketTransactionInput | AddPocketTransactionDto,
  ) {
    const now = new Date().toISOString();
    const txId = randomUUID();
    const txRef = this.txCol(pocketId).doc(txId);
    await txRef.set({
      name: body.name.trim(),
      amountCents: body.amountCents,
      tag: body.tag?.trim() || null,
      splitMethod: body.splitMethod?.trim() || 'rovnako',
      paidByUid: body.paidByUid?.trim() || byUid,
      transactionDate: this.toDateOnly(body.transactionDate),
      createdAt: now,
      updatedAt: now,
      createdByUid: byUid,
    });
  }

  async create(dto: CreatePocketDto, user: AuthUser) {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Názov pocketu je povinný');

    const now = new Date().toISOString();
    const pocketId = randomUUID();
    const inviteKey = randomBytes(6).toString('hex').toUpperCase();
    const tags = this.normalizeTags(dto.tags);
    const ownerPublic = await this.getUserPublic(user.uid);
    const ownerDisplayName =
      ownerPublic?.fullName || user.name?.trim() || user.email?.split('@')[0] || 'Majiteľ';
    const ownerEmail = ownerPublic?.email || user.email?.toLowerCase() || null;
    const lowerInviteEmails = Array.from(
      new Set((dto.inviteEmails || []).map((x) => x.trim().toLowerCase()).filter(Boolean)),
    );

    await this.pocketsCol().doc(pocketId).set({
      name,
      ownerUid: user.uid,
      createdAt: now,
      updatedAt: now,
      inviteKey,
      tags,
      memberUids: [user.uid],
      members: [
        {
          uid: user.uid,
          displayName: ownerDisplayName,
          email: ownerEmail,
          profileImageUrl: ownerPublic?.profileImageUrl || null,
          joinedAt: now,
        },
      ],
      invitedEmails: lowerInviteEmails,
    });

    await this.addActivity(pocketId, 'pocket_created', user.uid, { name });

    for (const item of dto.initialTransactions || []) {
      await this.writeTransaction(pocketId, user.uid, item);
      await this.addActivity(pocketId, 'transaction_added', user.uid, {
        name: item.name.trim(),
        amountCents: item.amountCents,
      });
    }

    return {
      pocketId,
      inviteKey,
    };
  }

  async listMine(uid: string) {
    const snap = await this.pocketsCol().where('memberUids', 'array-contains', uid).limit(100).get();
    const rows = await Promise.all(
      snap.docs.map(async (doc) => {
        const d = doc.data();
        const txSnap = await this.txCol(doc.id).get();
        let totalCents = 0;
        for (const tx of txSnap.docs) {
          totalCents += (tx.get('amountCents') as number) || 0;
        }
        const paidCents = 0;
        return {
          id: doc.id,
          name: (d.name as string) || 'Pocket',
          tags: ((d.tags as string[]) || []).slice(0, 5),
          memberCount: ((d.memberUids as string[]) || []).length,
          totalCents,
          paidCents,
          updatedAt: (d.updatedAt as string) || '',
        };
      }),
    );
    rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { pockets: rows };
  }

  async getOne(pocketId: string, uid: string) {
    const { data } = await this.assertMember(pocketId, uid);
    const txSnap = await this.txCol(pocketId).orderBy('transactionDate', 'desc').limit(200).get();
    const transactions = txSnap.docs.map((d) => ({
      id: d.id,
      name: d.get('name') as string,
      amountCents: (d.get('amountCents') as number) || 0,
      tag: (d.get('tag') as string | null) || null,
      splitMethod: (d.get('splitMethod') as string | null) || 'rovnako',
      paidByUid: (d.get('paidByUid') as string | null) || null,
      transactionDate: (d.get('transactionDate') as string | null) || null,
    }));

    const totalCents = transactions.reduce((sum, t) => sum + t.amountCents, 0);
    const paidCents = 0;

    const membersRaw = (data.members as Array<Record<string, unknown>>) || [];
    const members = await this.hydrateMembers(membersRaw);
    const activitiesBlock = await this.listActivities(pocketId, uid);

    return {
      id: pocketId,
      name: (data.name as string) || 'Pocket',
      tags: (data.tags as string[]) || [],
      inviteKey: (data.inviteKey as string) || '',
      ownerUid: (data.ownerUid as string) || null,
      members,
      transactions,
      activities: activitiesBlock.activities,
      analytics: {
        totalCents,
        paidCents,
        unpaidCents: Math.max(0, totalCents - paidCents),
      },
      updatedAt: (data.updatedAt as string) || '',
    };
  }

  async update(pocketId: string, uid: string, dto: UpdatePocketDto) {
    const { ref, data } = await this.assertMember(pocketId, uid);
    if ((data.ownerUid as string) !== uid) {
      throw new ForbiddenException('Pocket môže upravovať iba majiteľ');
    }
    const updates: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
    };
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new BadRequestException('Názov pocketu je povinný');
      updates.name = name;
    }
    if (dto.tags !== undefined) {
      updates.tags = this.normalizeTags(dto.tags);
    }
    await ref.update(updates);
    await this.addActivity(pocketId, 'settings_updated', uid, {
      changedName: dto.name !== undefined,
      changedTags: dto.tags !== undefined,
    });
    return { success: true };
  }

  async addTransaction(pocketId: string, uid: string, dto: AddPocketTransactionDto) {
    const { ref } = await this.assertMember(pocketId, uid);
    await this.writeTransaction(pocketId, uid, dto);
    await ref.update({ updatedAt: new Date().toISOString() });
    await this.addActivity(pocketId, 'transaction_added', uid, {
      name: dto.name.trim(),
      amountCents: dto.amountCents,
      tag: dto.tag?.trim() || null,
    });
    return this.getOne(pocketId, uid);
  }

  async inviteByEmail(pocketId: string, uid: string, emailRaw: string) {
    const { ref, data } = await this.assertMember(pocketId, uid);
    if ((data.ownerUid as string) !== uid) {
      throw new ForbiddenException('Pozývať môže iba majiteľ pocketu');
    }

    const email = emailRaw.trim().toLowerCase();
    const invitedEmails = Array.from(
      new Set(([...((data.invitedEmails as string[]) || []), email]).filter(Boolean)),
    );

    await ref.update({
      invitedEmails,
      updatedAt: new Date().toISOString(),
    });
    await this.addActivity(pocketId, 'member_invited_email', uid, { email });
    return { success: true, invitedEmails };
  }

  async leave(pocketId: string, uid: string) {
    const { ref, data } = await this.assertMember(pocketId, uid);
    if ((data.ownerUid as string) === uid) {
      throw new BadRequestException('Majiteľ nemôže odísť z vlastného pocketu');
    }

    const memberUids = ((data.memberUids as string[]) || []).filter((x) => x !== uid);
    const members = ((data.members as Array<Record<string, unknown>>) || []).filter(
      (m) => (m.uid as string) !== uid,
    );
    await ref.update({
      memberUids,
      members,
      updatedAt: new Date().toISOString(),
    });
    await this.addActivity(pocketId, 'member_left', uid, {});
    return { success: true };
  }
}
