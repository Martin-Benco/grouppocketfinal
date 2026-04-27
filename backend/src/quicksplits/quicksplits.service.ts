import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { FirebaseService } from '../firebase/firebase.service';
import { CreateQuicksplitDto } from './dto/create-quicksplit.dto';
import { UpdateQuicksplitDto } from './dto/update-quicksplit.dto';
import { JoinQuicksplitDto } from './dto/join-quicksplit.dto';
import { UpdateParticipantPaymentDto } from './dto/update-participant-payment.dto';
import type { DocumentData, Query } from 'firebase-admin/firestore';
import { hashToken, randomToken, timingSafeEqual } from './utils/tokens';
import type { ActivityType, ActivityView } from './types/activity.types';

export type QuicksplitParticipantView = {
  id: string;
  displayName: string;
  userUid: string | null;
  iban: string | null;
  shareCents: number;
  isPayer: boolean;
  oweToPayerCents: number;
  markedPaidAt: string | null;
};

export type QuicksplitView = {
  id: string;
  totalCents: number;
  currency: string;
  ownerUid: string | null;
  payerParticipantId: string;
  participants: QuicksplitParticipantView[];
  payerIban: string | null;
  payerDisplayName: string;
  createdAt: string;
  updatedAt: string;
  activities: ActivityView[];
  activitiesHasMore: boolean;
  activitiesLoadMoreAfterId: string | null;
};

@Injectable()
export class QuicksplitsService {
  constructor(private readonly firebase: FirebaseService) {}

  private col() {
    return this.firebase.getFirestore().collection('quicksplits');
  }

  private participantsRef(splitId: string) {
    return this.col().doc(splitId).collection('participants');
  }

  private activitiesRef(splitId: string) {
    return this.col().doc(splitId).collection('activities');
  }

  private splitEqualShares(totalCents: number, n: number): number[] {
    if (n <= 0) return [];
    const base = Math.floor(totalCents / n);
    const rem = totalCents % n;
    return Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0));
  }

  private async addActivity(
    splitId: string,
    partial: {
      type: ActivityType;
      actorParticipantId?: string | null;
      actorDisplayName?: string | null;
      meta?: Record<string, unknown>;
    },
  ) {
    const now = new Date().toISOString();
    await this.activitiesRef(splitId).add({
      type: partial.type,
      createdAt: now,
      actorParticipantId: partial.actorParticipantId ?? null,
      actorDisplayName: partial.actorDisplayName ?? null,
      meta: partial.meta ?? {},
    });
  }

  private async loadActivitiesFirstPage(splitId: string): Promise<{
    items: ActivityView[];
    hasMore: boolean;
    loadMoreAfterId: string | null;
  }> {
    const snap = await this.activitiesRef(splitId).orderBy('createdAt', 'desc').limit(5).get();
    const hasMore = snap.docs.length > 4;
    const slice = hasMore ? snap.docs.slice(0, 4) : snap.docs;
    const items: ActivityView[] = slice.map((d) => {
      const x = d.data();
      return {
        id: d.id,
        type: x.type as ActivityType,
        createdAt: x.createdAt as string,
        actorParticipantId: (x.actorParticipantId as string) ?? null,
        actorDisplayName: (x.actorDisplayName as string) ?? null,
        meta: (x.meta as Record<string, unknown>) || {},
      };
    });
    const loadMoreAfterId = hasMore && items.length > 0 ? items[items.length - 1].id : null;
    return { items, hasMore, loadMoreAfterId };
  }

  async loadActivitiesPage(
    splitId: string,
    readOpts: { joinToken?: string; adminToken?: string; firebaseUid?: string | null },
    afterActivityId: string | undefined,
    limit = 10,
  ): Promise<{ activities: ActivityView[]; hasMore: boolean; nextAfterId: string | null }> {
    const { data } = await this.getSplitDoc(splitId);
    await this.assertCanRead(splitId, data, readOpts);

    const colRef = this.activitiesRef(splitId);
    let q: Query = colRef.orderBy('createdAt', 'desc').limit(limit + 1);
    if (afterActivityId) {
      const afterDoc = await colRef.doc(afterActivityId).get();
      if (!afterDoc.exists) throw new NotFoundException('Neplatný kurzor aktivít');
      q = colRef.orderBy('createdAt', 'desc').startAfter(afterDoc).limit(limit + 1);
    }
    const snap = await q.get();
    const hasMore = snap.docs.length > limit;
    const docs = hasMore ? snap.docs.slice(0, limit) : snap.docs;
    const activities: ActivityView[] = docs.map((d) => {
      const x = d.data();
      return {
        id: d.id,
        type: x.type as ActivityType,
        createdAt: x.createdAt as string,
        actorParticipantId: (x.actorParticipantId as string) ?? null,
        actorDisplayName: (x.actorDisplayName as string) ?? null,
        meta: (x.meta as Record<string, unknown>) || {},
      };
    });
    const nextAfterId =
      hasMore && activities.length > 0 ? activities[activities.length - 1].id : null;
    return { activities, hasMore, nextAfterId };
  }

  private async loadParticipants(splitId: string) {
    const snap = await this.participantsRef(splitId).get();
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Array<{
      id: string;
      displayName: string;
      userUid: string | null;
      iban: string | null;
      secretTokenHash: string;
      createdAt: string;
      markedPaidAt?: string | null;
    }>;
    list.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    return list;
  }

  private async getUserIban(userUid: string): Promise<string | null> {
    const doc = await this.firebase.getFirestore().collection('users').doc(userUid).get();
    if (!doc.exists) return null;
    const data = doc.data();
    return (data?.iban as string) || null;
  }

  private async buildView(
    splitId: string,
    data: DocumentData,
    participants: Awaited<ReturnType<typeof this.loadParticipants>>,
    activitiesBlock: Awaited<ReturnType<typeof this.loadActivitiesFirstPage>>,
  ): Promise<QuicksplitView> {
    const payerId = data.payerParticipantId as string;
    const n = participants.length;
    const shares = this.splitEqualShares(data.totalCents as number, n);

    const payer = participants.find((p) => p.id === payerId);
    let payerIban: string | null = payer?.iban || null;
    if (payer?.userUid) {
      const profileIban = await this.getUserIban(payer.userUid);
      if (profileIban) payerIban = profileIban;
    }

    const views: QuicksplitParticipantView[] = participants.map((p, i) => {
      const share = shares[i] ?? 0;
      const isPayer = p.id === payerId;
      const oweToPayerCents = isPayer ? 0 : Math.max(0, share);
      return {
        id: p.id,
        displayName: p.displayName,
        userUid: p.userUid,
        iban: p.iban,
        shareCents: share,
        isPayer,
        oweToPayerCents,
        markedPaidAt: p.markedPaidAt ?? null,
      };
    });

    return {
      id: splitId,
      totalCents: data.totalCents,
      currency: (data.currency as string) || 'EUR',
      ownerUid: data.ownerUid ?? null,
      payerParticipantId: payerId,
      participants: views,
      payerIban,
      payerDisplayName: payer?.displayName || 'Platiteľ',
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
      activities: activitiesBlock.items,
      activitiesHasMore: activitiesBlock.hasMore,
      activitiesLoadMoreAfterId: activitiesBlock.loadMoreAfterId,
    };
  }

  async create(dto: CreateQuicksplitDto, ownerUid: string | null) {
    const id = randomUUID();
    const joinToken = randomToken(24);
    const adminToken = randomToken(24);
    const creatorId = randomUUID();
    const creatorSecret = randomToken(16);

    const now = new Date().toISOString();
    const splitRef = this.col().doc(id);
    const batch = this.firebase.getFirestore().batch();

    const creatorName =
      dto.creatorDisplayName?.trim() ||
      (ownerUid ? 'Ja' : 'Host');

    batch.set(splitRef, {
      totalCents: dto.totalCents,
      currency: 'EUR',
      ownerUid,
      payerParticipantId: creatorId,
      joinTokenHash: hashToken(joinToken),
      adminTokenHash: hashToken(adminToken),
      createdAt: now,
      updatedAt: now,
    });

    batch.set(this.participantsRef(id).doc(creatorId), {
      displayName: creatorName,
      userUid: ownerUid,
      iban: null,
      secretTokenHash: hashToken(creatorSecret),
      createdAt: now,
      markedPaidAt: null,
    });

    await batch.commit();

    await this.addActivity(id, {
      type: 'split_created',
      actorParticipantId: creatorId,
      actorDisplayName: creatorName,
      meta: { totalCents: dto.totalCents },
    });

    return {
      splitId: id,
      joinToken,
      adminToken,
      creatorParticipantId: creatorId,
      creatorParticipantSecret: creatorSecret,
    };
  }

  private async getSplitDoc(splitId: string) {
    const ref = this.col().doc(splitId);
    const doc = await ref.get();
    if (!doc.exists) throw new NotFoundException('QuickSplit nenájdený');
    return { ref, data: doc.data()!, snap: doc };
  }

  private verifyJoin(data: DocumentData, token: string | undefined) {
    if (!token) return false;
    const h = data.joinTokenHash as string;
    return timingSafeEqual(h, hashToken(token));
  }

  private verifyAdmin(data: DocumentData, token: string | undefined) {
    if (!token) return false;
    const h = data.adminTokenHash as string;
    return timingSafeEqual(h, hashToken(token));
  }

  private async assertCanRead(
    splitId: string,
    data: DocumentData,
    opts: { joinToken?: string; adminToken?: string; firebaseUid?: string | null },
  ) {
    if (opts.adminToken && this.verifyAdmin(data, opts.adminToken)) return;
    if (opts.joinToken && this.verifyJoin(data, opts.joinToken)) return;
    if (opts.firebaseUid) {
      if (data.ownerUid === opts.firebaseUid) return;
      const parts = await this.loadParticipants(splitId);
      if (parts.some((p) => p.userUid === opts.firebaseUid)) return;
    }
    throw new ForbiddenException('Nedostatočné oprávnenie na zobrazenie');
  }

  private async assertCanAdmin(
    data: DocumentData,
    adminToken: string | undefined,
    firebaseUid: string | null | undefined,
  ) {
    if (adminToken && this.verifyAdmin(data, adminToken)) return;
    if (firebaseUid && data.ownerUid === firebaseUid) return;
    throw new ForbiddenException('Úpravy splitu: chýba admin token alebo vlastníctvo');
  }

  private async assertParticipantSecret(
    splitId: string,
    participantId: string,
    secret: string | undefined,
  ) {
    const doc = await this.participantsRef(splitId).doc(participantId).get();
    if (!doc.exists) throw new NotFoundException('Účastník nenájdený');
    const h = doc.get('secretTokenHash') as string;
    if (!secret || !timingSafeEqual(h, hashToken(secret))) {
      throw new ForbiddenException('Neplatný účastnícky token');
    }
  }

  async getOne(
    splitId: string,
    opts: { joinToken?: string; adminToken?: string; firebaseUid?: string | null },
  ): Promise<QuicksplitView> {
    const { data } = await this.getSplitDoc(splitId);
    await this.assertCanRead(splitId, data, opts);
    const participants = await this.loadParticipants(splitId);
    const activitiesBlock = await this.loadActivitiesFirstPage(splitId);
    return this.buildView(splitId, data, participants, activitiesBlock);
  }

  async updateSplit(
    splitId: string,
    dto: UpdateQuicksplitDto,
    adminToken: string | undefined,
    firebaseUid: string | null | undefined,
  ) {
    const { ref, data } = await this.getSplitDoc(splitId);
    await this.assertCanAdmin(data, adminToken, firebaseUid ?? null);

    const partsBefore = await this.loadParticipants(splitId);
    const oldPayerId = data.payerParticipantId as string;
    const oldPayerName = partsBefore.find((p) => p.id === oldPayerId)?.displayName || '';

    const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
    if (dto.totalCents !== undefined && dto.totalCents !== data.totalCents) {
      updates.totalCents = dto.totalCents;
    }

    if (dto.payerParticipantId !== undefined) {
      const parts = await this.loadParticipants(splitId);
      if (!parts.some((p) => p.id === dto.payerParticipantId)) {
        throw new BadRequestException('Neplatný platiteľ');
      }
      updates.payerParticipantId = dto.payerParticipantId;
    }

    await ref.update(updates);
    const fresh = await ref.get();
    const participants = await this.loadParticipants(splitId);

    if (dto.totalCents !== undefined && dto.totalCents !== data.totalCents) {
      await this.addActivity(splitId, {
        type: 'amount_updated',
        meta: { previousCents: data.totalCents, newCents: dto.totalCents },
      });
    }
    if (dto.payerParticipantId !== undefined && dto.payerParticipantId !== oldPayerId) {
      const newName = participants.find((p) => p.id === dto.payerParticipantId)?.displayName || '';
      await this.addActivity(splitId, {
        type: 'payer_changed',
        meta: { previousPayerName: oldPayerName, newPayerName: newName },
      });
    }

    const activitiesBlock = await this.loadActivitiesFirstPage(splitId);
    return this.buildView(splitId, fresh.data()!, participants, activitiesBlock);
  }

  async join(
    splitId: string,
    dto: JoinQuicksplitDto,
    joinToken: string | undefined,
    firebaseUid: string | null | undefined,
  ) {
    const { ref, data } = await this.getSplitDoc(splitId);
    if (!this.verifyJoin(data, joinToken)) {
      throw new ForbiddenException('Neplatný invite token');
    }

    const pid = randomUUID();
    const secret = randomToken(16);
    const now = new Date().toISOString();

    await this.participantsRef(splitId).doc(pid).set({
      displayName: dto.displayName.trim(),
      userUid: firebaseUid ?? null,
      iban: null,
      secretTokenHash: hashToken(secret),
      createdAt: now,
      markedPaidAt: null,
    });

    await ref.update({ updatedAt: now });

    await this.addActivity(splitId, {
      type: 'participant_joined',
      actorParticipantId: pid,
      actorDisplayName: dto.displayName.trim(),
      meta: {},
    });

    return { participantId: pid, participantSecret: secret };
  }

  async updateParticipantPayment(
    splitId: string,
    participantId: string,
    dto: UpdateParticipantPaymentDto,
    firebaseUid: string | null | undefined,
    joinToken: string | undefined,
    participantSecret: string | undefined,
    adminToken: string | undefined,
  ) {
    const { data } = await this.getSplitDoc(splitId);
    const payerId = data.payerParticipantId as string;
    const isPayerRow = participantId === payerId;

    const pRef = this.participantsRef(splitId).doc(participantId);
    const pSnap = await pRef.get();
    if (!pSnap.exists) throw new NotFoundException('Účastník nenájdený');
    const p = pSnap.data()!;

    const selfFirebase = !!(firebaseUid && p.userUid === firebaseUid);
    const selfSecret =
      !!joinToken &&
      this.verifyJoin(data, joinToken) &&
      (await this.verifyParticipantSecretNoThrow(splitId, participantId, participantSecret));

    if (isPayerRow) {
      if (!(selfFirebase || selfSecret)) {
        throw new ForbiddenException('IBAN platiteľa môže meniť len platiteľ');
      }
    } else {
      if (selfFirebase) {
        // ok
      } else if (this.verifyJoin(data, joinToken)) {
        await this.assertParticipantSecret(splitId, participantId, participantSecret);
      } else if (adminToken && this.verifyAdmin(data, adminToken)) {
        // tvorca môže pomôcť ostatným (nie platiteľovi)
      } else {
        throw new ForbiddenException('Úprava platobných údajov zamietnutá');
      }
    }

    const prevIban = (p.iban as string | null) ?? null;
    const iban =
      dto.iban === undefined ? prevIban : dto.iban?.replace(/\s/g, '').toUpperCase() ?? null;
    await pRef.update({ iban });

    if (iban !== prevIban) {
      await this.addActivity(splitId, {
        type: 'payment_details_updated',
        actorParticipantId: participantId,
        actorDisplayName: (p.displayName as string) || null,
        meta: { isPayer: isPayerRow, hadIban: !!prevIban },
      });
    }

    return { success: true, iban };
  }

  private async verifyParticipantSecretNoThrow(
    splitId: string,
    participantId: string,
    secret: string | undefined,
  ): Promise<boolean> {
    try {
      await this.assertParticipantSecret(splitId, participantId, secret);
      return true;
    } catch {
      return false;
    }
  }

  async markParticipantPaid(
    splitId: string,
    participantId: string,
    paid: boolean,
    firebaseUid: string | null | undefined,
    joinToken: string | undefined,
    participantSecret: string | undefined,
  ) {
    const { data, ref } = await this.getSplitDoc(splitId);
    const payerId = data.payerParticipantId as string;
    if (participantId === payerId) {
      throw new BadRequestException('Platiteľ nemá stav „zaplatil“ voči sám sebe');
    }

    const pRef = this.participantsRef(splitId).doc(participantId);
    const pSnap = await pRef.get();
    if (!pSnap.exists) throw new NotFoundException('Účastník nenájdený');
    const p = pSnap.data()!;

    const selfFirebase = !!(firebaseUid && p.userUid === firebaseUid);
    const selfSecret =
      !!joinToken &&
      this.verifyJoin(data, joinToken) &&
      (await this.verifyParticipantSecretNoThrow(splitId, participantId, participantSecret));
    if (!selfFirebase && !selfSecret) {
      throw new ForbiddenException('Stav platby môže meniť len daný účastník');
    }

    const now = new Date().toISOString();
    await pRef.update({ markedPaidAt: paid ? now : null });
    await ref.update({ updatedAt: now });

    await this.addActivity(splitId, {
      type: paid ? 'marked_paid' : 'marked_unpaid',
      actorParticipantId: participantId,
      actorDisplayName: (p.displayName as string) || null,
      meta: {},
    });

    const participants = await this.loadParticipants(splitId);
    const activitiesBlock = await this.loadActivitiesFirstPage(splitId);
    const fresh = await ref.get();
    return this.buildView(splitId, fresh.data()!, participants, activitiesBlock);
  }

  async listMine(uid: string) {
    const snap = await this.col().where('ownerUid', '==', uid).limit(50).get();
    const rows = snap.docs.map((d) => ({
      id: d.id,
      totalCents: d.get('totalCents') as number,
      updatedAt: d.get('updatedAt') as string,
    }));
    rows.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    return { splits: rows };
  }

  async linkParticipantUser(
    splitId: string,
    participantId: string,
    participantSecret: string | undefined,
    firebaseUid: string,
  ) {
    await this.getSplitDoc(splitId);
    await this.assertParticipantSecret(splitId, participantId, participantSecret);
    const pRef = this.participantsRef(splitId).doc(participantId);
    await pRef.update({ userUid: firebaseUid });
    return { success: true };
  }
}
