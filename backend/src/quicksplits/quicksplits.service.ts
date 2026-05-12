import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { DocumentData, DocumentReference, Query } from 'firebase-admin/firestore';
import { FirebaseService } from '../firebase/firebase.service';
import { CreateQuicksplitDto } from './dto/create-quicksplit.dto';
import { UpdateQuicksplitDto } from './dto/update-quicksplit.dto';
import { JoinQuicksplitDto } from './dto/join-quicksplit.dto';
import { UpdateParticipantPaymentDto } from './dto/update-participant-payment.dto';
import { UpdateParticipantClaimDto } from './dto/update-participant-claim.dto';
import { hashToken, randomToken, timingSafeEqual } from './utils/tokens';
import type { ActivityType, ActivityView } from './types/activity.types';

export type QuickSplitItemView = {
  id: string;
  name: string;
  amountCents: number;
  consumerParticipantIds: string[];
};

export type QuicksplitParticipantView = {
  id: string;
  displayName: string;
  userUid: string | null;
  iban: string | null;
  shareCents: number;
  isPayer: boolean;
  oweToPayerCents: number;
  markedPaidAt: string | null;
  claimedAmountCents: number | null;
  adjustmentCents: number;
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
  flowStep: 'waiting' | 'splitting' | 'settlement' | 'closed';
  targetParticipantCount: number;
  splitMode: 'equal' | 'custom_amounts' | 'items' | null;
  equalExcludedParticipantIds: string[];
  splitItems: QuickSplitItemView[];
  customClaimsSumCents: number;
  customRemainderCents: number;
  canJoinMore: boolean;
};

type LoadedParticipant = {
  id: string;
  displayName: string;
  userUid: string | null;
  iban: string | null;
  secretTokenHash: string;
  createdAt: string;
  markedPaidAt?: string | null;
  claimedAmountCents?: number | null;
  adjustmentCents?: number;
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

  private normalizeFlowStep(data: DocumentData): 'waiting' | 'splitting' | 'settlement' | 'closed' {
    const s = data.flowStep as string | undefined;
    if (s === 'waiting' || s === 'splitting' || s === 'settlement' || s === 'closed') return s;
    return 'settlement';
  }

  private isLegacySplit(data: DocumentData): boolean {
    return data.flowStep === undefined || data.flowStep === null;
  }

  private normalizeSplitMode(
    data: DocumentData,
    flowStep: 'waiting' | 'splitting' | 'settlement' | 'closed',
  ): 'equal' | 'custom_amounts' | 'items' | null {
    if (flowStep === 'waiting') return null;
    const m = data.splitMode as string | undefined;
    if (m === 'equal' || m === 'custom_amounts' || m === 'items') return m;
    if (flowStep === 'settlement' && this.isLegacySplit(data)) return 'equal';
    return null;
  }

  private participantOrderIds(participants: LoadedParticipant[]): string[] {
    return [...participants].sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || '')).map((p) => p.id);
  }

  private allocateItemAmongConsumers(
    amountCents: number,
    consumerIds: string[],
    participantOrder: string[],
  ): Map<string, number> {
    const out = new Map<string, number>();
    if (consumerIds.length === 0) return out;
    const unique = [...new Set(consumerIds)];
    const sorted = [...unique].sort(
      (a, b) => participantOrder.indexOf(a) - participantOrder.indexOf(b),
    );
    const n = sorted.length;
    const shares = this.splitEqualShares(amountCents, n);
    sorted.forEach((id, i) => {
      out.set(id, (out.get(id) ?? 0) + (shares[i] ?? 0));
    });
    return out;
  }

  private computeShares(
    totalCents: number,
    participants: LoadedParticipant[],
    data: DocumentData,
  ): Map<string, number> {
    const flowStep = this.normalizeFlowStep(data);
    const mode = this.normalizeSplitMode(data, flowStep);
    const order = this.participantOrderIds(participants);
    const shareMap = new Map<string, number>();
    for (const p of participants) shareMap.set(p.id, 0);

    if (flowStep === 'waiting') return shareMap;
    if ((flowStep === 'splitting' || flowStep === 'settlement') && mode === null) return shareMap;

    if (mode === 'equal') {
      const excluded = new Set((data.equalExcludedParticipantIds as string[]) || []);
      const included = order.filter((id) => !excluded.has(id));
      if (included.length === 0) return shareMap;
      const shares = this.splitEqualShares(totalCents, included.length);
      included.forEach((id, i) => shareMap.set(id, shares[i] ?? 0));
      return shareMap;
    }

    if (mode === 'custom_amounts') {
      for (const p of participants) {
        const c = p.claimedAmountCents ?? 0;
        const a = p.adjustmentCents ?? 0;
        shareMap.set(p.id, c + a);
      }
      return shareMap;
    }

    if (mode === 'items') {
      const rawItems = (data.splitItems as Array<Record<string, unknown>>) || [];
      for (const row of rawItems) {
        const amt = row.amountCents as number;
        const cons = (row.consumerParticipantIds as string[]) || [];
        const alloc = this.allocateItemAmongConsumers(amt, cons, order);
        for (const [pid, v] of alloc) {
          shareMap.set(pid, (shareMap.get(pid) ?? 0) + v);
        }
      }
      return shareMap;
    }

    return shareMap;
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
      if (!afterDoc.exists) throw new NotFoundException('Invalid activity cursor');
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

  private async loadParticipants(splitId: string): Promise<LoadedParticipant[]> {
    const snap = await this.participantsRef(splitId).get();
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as LoadedParticipant[];
    list.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
    return list;
  }

  private async getUserIban(userUid: string): Promise<string | null> {
    const doc = await this.firebase.getFirestore().collection('users').doc(userUid).get();
    if (!doc.exists) return null;
    const d = doc.data();
    return (d?.iban as string) || null;
  }

  private normalizeSplitItemsFromDoc(data: DocumentData): QuickSplitItemView[] {
    const raw = (data.splitItems as Array<Record<string, unknown>>) || [];
    return raw.map((row) => ({
      id: (row.id as string) || randomUUID(),
      name: String(row.name || ''),
      amountCents: Number(row.amountCents) || 0,
      consumerParticipantIds: Array.isArray(row.consumerParticipantIds)
        ? (row.consumerParticipantIds as string[])
        : [],
    }));
  }

  private customClaimsSum(participants: LoadedParticipant[]): number {
    return participants.reduce((s, p) => s + (p.claimedAmountCents ?? 0), 0);
  }

  private customAdjustmentsSum(participants: LoadedParticipant[]): number {
    return participants.reduce((s, p) => s + (p.adjustmentCents ?? 0), 0);
  }

  private async buildView(
    splitId: string,
    data: DocumentData,
    participants: LoadedParticipant[],
    activitiesBlock: Awaited<ReturnType<typeof this.loadActivitiesFirstPage>>,
  ): Promise<QuicksplitView> {
    const payerId = data.payerParticipantId as string;
    const totalCents = data.totalCents as number;
    const flowStep = this.normalizeFlowStep(data);
    const targetParticipantCount = Math.min(
      10,
      Math.max(2, (data.targetParticipantCount as number) || participants.length || 2),
    );
    const splitMode = this.normalizeSplitMode(data, flowStep);
    const equalExcludedParticipantIds = Array.isArray(data.equalExcludedParticipantIds)
      ? [...(data.equalExcludedParticipantIds as string[])]
      : [];
    const splitItems = this.normalizeSplitItemsFromDoc(data);
    const shareById = this.computeShares(totalCents, participants, data);

    const payer = participants.find((p) => p.id === payerId);
    let payerIban: string | null = payer?.iban || null;
    if (payer?.userUid) {
      const profileIban = await this.getUserIban(payer.userUid);
      if (profileIban) payerIban = profileIban;
    }

    const claimsSum = this.customClaimsSum(participants);
    const adjustmentsSum = this.customAdjustmentsSum(participants);
    const customRemainderCents = totalCents - claimsSum - adjustmentsSum;

    const views: QuicksplitParticipantView[] = participants.map((p) => {
      const share = shareById.get(p.id) ?? 0;
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
        claimedAmountCents: p.claimedAmountCents ?? null,
        adjustmentCents: p.adjustmentCents ?? 0,
      };
    });

    const canJoinMore =
      flowStep === 'waiting' && participants.length < targetParticipantCount;

    return {
      id: splitId,
      totalCents,
      currency: (data.currency as string) || 'EUR',
      ownerUid: data.ownerUid ?? null,
      payerParticipantId: payerId,
      participants: views,
      payerIban,
      payerDisplayName: payer?.displayName || 'Payer',
      createdAt: data.createdAt as string,
      updatedAt: data.updatedAt as string,
      activities: activitiesBlock.items,
      activitiesHasMore: activitiesBlock.hasMore,
      activitiesLoadMoreAfterId: activitiesBlock.loadMoreAfterId,
      flowStep,
      targetParticipantCount,
      splitMode,
      equalExcludedParticipantIds,
      splitItems,
      customClaimsSumCents: claimsSum,
      customRemainderCents,
      canJoinMore,
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

    const targetParticipantCount = dto.targetParticipantCount ?? 2;

    batch.set(splitRef, {
      totalCents: dto.totalCents,
      currency: 'EUR',
      ownerUid,
      payerParticipantId: creatorId,
      joinTokenHash: hashToken(joinToken),
      adminTokenHash: hashToken(adminToken),
      createdAt: now,
      updatedAt: now,
      flowStep: 'waiting',
      targetParticipantCount,
      splitMode: null,
      equalExcludedParticipantIds: [],
      splitItems: [],
    });

    batch.set(this.participantsRef(id).doc(creatorId), {
      displayName: creatorName,
      userUid: ownerUid,
      iban: null,
      secretTokenHash: hashToken(creatorSecret),
      createdAt: now,
      markedPaidAt: null,
      claimedAmountCents: null,
      adjustmentCents: 0,
    });

    await batch.commit();

    await this.addActivity(id, {
      type: 'split_created',
      actorParticipantId: creatorId,
      actorDisplayName: creatorName,
      meta: { totalCents: dto.totalCents, targetParticipantCount },
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
    if (!doc.exists) throw new NotFoundException('QuickSplit not found');
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
    throw new ForbiddenException('Insufficient permissions to view');
  }

  private async assertCanAdmin(
    data: DocumentData,
    adminToken: string | undefined,
    firebaseUid: string | null | undefined,
  ) {
    if (adminToken && this.verifyAdmin(data, adminToken)) return;
    if (firebaseUid && data.ownerUid === firebaseUid) return;
    throw new ForbiddenException('Split updates require admin token or ownership');
  }

  private async assertParticipantSecret(
    splitId: string,
    participantId: string,
    secret: string | undefined,
  ) {
    const doc = await this.participantsRef(splitId).doc(participantId).get();
    if (!doc.exists) throw new NotFoundException('Participant not found');
    const h = doc.get('secretTokenHash') as string;
    if (!secret || !timingSafeEqual(h, hashToken(secret))) {
      throw new ForbiddenException('Invalid participant token');
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

  private validateParticipantIds(participants: LoadedParticipant[], ids: string[]) {
    const set = new Set(participants.map((p) => p.id));
    for (const id of ids) {
      if (!set.has(id)) throw new BadRequestException(`Invalid participant: ${id}`);
    }
  }

  private async assertFinalizationOk(
    splitId: string,
    data: DocumentData,
    participants: LoadedParticipant[],
  ) {
    const totalCents = data.totalCents as number;
    const mode = data.splitMode as string;
    if (mode === 'custom_amounts') {
      let sum = 0;
      for (const p of participants) {
        sum += (p.claimedAmountCents ?? 0) + (p.adjustmentCents ?? 0);
      }
      if (sum !== totalCents) {
        throw new BadRequestException(
          `Entered amounts total (${sum}) must match (${totalCents}) before finalization.`,
        );
      }
    }
    if (mode === 'items') {
      const items = this.normalizeSplitItemsFromDoc(data);
      let s = 0;
      for (const it of items) {
        if (!it.name.trim()) throw new BadRequestException('Item name is required');
        if (it.consumerParticipantIds.length === 0) {
          throw new BadRequestException(`Item "${it.name}": select at least one consumer`);
        }
        this.validateParticipantIds(participants, it.consumerParticipantIds);
        s += it.amountCents;
      }
      if (s !== totalCents) {
        throw new BadRequestException(
          `Items total (${s}) must equal bill total (${totalCents}).`,
        );
      }
    }
    if (mode === 'equal') {
      const excluded = new Set((data.equalExcludedParticipantIds as string[]) || []);
      this.validateParticipantIds(participants, [...excluded]);
      if (participants.length < 3 && excluded.size > 0) {
        throw new BadRequestException('Too few participants - exclusion requires at least 3 people.');
      }
      const order = this.participantOrderIds(participants);
      const included = order.filter((id) => !excluded.has(id));
      if (included.length === 0) {
        throw new BadRequestException('At least one participant must be included in split.');
      }
    }
  }

  private normalizeIncomingItems(
    items: NonNullable<UpdateQuicksplitDto['splitItems']>,
    participants: LoadedParticipant[],
  ): QuickSplitItemView[] {
    const out: QuickSplitItemView[] = [];
    for (const row of items) {
      const id = row.id?.trim() || randomUUID();
      const name = row.name?.trim() || '';
      if (!name) continue;
      this.validateParticipantIds(participants, row.consumerParticipantIds || []);
      out.push({
        id,
        name,
        amountCents: row.amountCents,
        consumerParticipantIds: [...(row.consumerParticipantIds || [])],
      });
    }
    return out;
  }

  private async distributeRemainderEqually(splitId: string, ref: DocumentReference, data: DocumentData) {
    const totalCents = data.totalCents as number;
    const participants = await this.loadParticipants(splitId);
    const n = participants.length;
    if (n === 0) return;
    const sumClaimed = this.customClaimsSum(participants);
    const R = totalCents - sumClaimed;
    if (R < 0) {
      throw new BadRequestException('Entered amounts exceed total bill amount.');
    }
    const shares = R === 0 ? Array(n).fill(0) : this.splitEqualShares(R, n);
    const batch = this.firebase.getFirestore().batch();
    participants.forEach((p, i) => {
      batch.update(this.participantsRef(splitId).doc(p.id), { adjustmentCents: shares[i] ?? 0 });
    });
    await batch.commit();
    await ref.update({ updatedAt: new Date().toISOString() });
    await this.addActivity(splitId, {
      type: 'remainder_distributed',
      meta: { remainderCents: R },
    });
  }

  private async assignRemainderManually(
    splitId: string,
    ref: DocumentReference,
    data: DocumentData,
    assignments: NonNullable<UpdateQuicksplitDto['remainderAssignments']>,
  ) {
    const mode = data.splitMode as string;
    if (mode !== 'custom_amounts') {
      throw new BadRequestException('Manual remainder assignment is allowed only in "Everyone enters amount" mode.');
    }
    const participants = await this.loadParticipants(splitId);
    this.validateParticipantIds(
      participants,
      assignments.map((a) => a.participantId),
    );
    const byId = new Map<string, number>();
    for (const row of assignments) {
      byId.set(row.participantId, (byId.get(row.participantId) ?? 0) + row.adjustmentCents);
    }
    const totalCents = data.totalCents as number;
    const claims = this.customClaimsSum(participants);
    const targetRemainder = totalCents - claims;
    const assignedSum = [...byId.values()].reduce((s, x) => s + x, 0);
    if (assignedSum !== targetRemainder) {
      throw new BadRequestException(
        `Manual assignment must cover exact remainder (${targetRemainder}).`,
      );
    }
    const batch = this.firebase.getFirestore().batch();
    for (const p of participants) {
      batch.update(this.participantsRef(splitId).doc(p.id), {
        adjustmentCents: byId.get(p.id) ?? 0,
      });
    }
    await batch.commit();
    await ref.update({ updatedAt: new Date().toISOString() });
    await this.addActivity(splitId, {
      type: 'remainder_distributed',
      meta: { remainderCents: targetRemainder, manual: true },
    });
  }

  async updateSplit(
    splitId: string,
    dto: UpdateQuicksplitDto,
    adminToken: string | undefined,
    firebaseUid: string | null | undefined,
  ) {
    const { ref, data } = await this.getSplitDoc(splitId);
    await this.assertCanAdmin(data, adminToken, firebaseUid ?? null);

    const flowStepBefore = this.normalizeFlowStep(data);
    const now = new Date().toISOString();
    const updates: Record<string, unknown> = { updatedAt: now };

    const partsBefore = await this.loadParticipants(splitId);
    const oldPayerId = data.payerParticipantId as string;
    const oldPayerName = partsBefore.find((p) => p.id === oldPayerId)?.displayName || '';

    if (dto.totalCents !== undefined && dto.totalCents !== data.totalCents) {
      updates.totalCents = dto.totalCents;
    }
    if (dto.targetParticipantCount !== undefined) {
      const fs = this.normalizeFlowStep({ ...data, ...updates } as DocumentData);
      if (fs !== 'waiting') {
        throw new BadRequestException('People count can be changed only while waiting for members.');
      }
      if (dto.targetParticipantCount < partsBefore.length) {
        throw new BadRequestException('People count cannot be lower than currently joined members.');
      }
      updates.targetParticipantCount = dto.targetParticipantCount;
    }
    if (dto.payerParticipantId !== undefined) {
      if (!partsBefore.some((p) => p.id === dto.payerParticipantId)) {
        throw new BadRequestException('Invalid payer');
      }
      updates.payerParticipantId = dto.payerParticipantId;
    }

    if (dto.splitMode !== undefined) {
      const fs = this.normalizeFlowStep({ ...data, ...updates } as DocumentData);
      if (fs !== 'splitting') {
        throw new BadRequestException('Split mode can be changed only in split step.');
      }
      updates.splitMode = dto.splitMode;
    }

    if (dto.equalExcludedParticipantIds !== undefined) {
      const fs = this.normalizeFlowStep({ ...data, ...updates } as DocumentData);
      if (fs !== 'splitting') {
        throw new BadRequestException('Exclusions can be changed only in split step.');
      }
      if (partsBefore.length < 3 && dto.equalExcludedParticipantIds.length > 0) {
        throw new BadRequestException('Too few participants - exclusion requires at least 3 people.');
      }
      updates.equalExcludedParticipantIds = dto.equalExcludedParticipantIds;
    }

    if (dto.splitItems !== undefined) {
      const fs = this.normalizeFlowStep({ ...data, ...updates } as DocumentData);
      if (fs !== 'splitting') {
        throw new BadRequestException('Items can be changed only in split step.');
      }
      updates.splitItems = this.normalizeIncomingItems(dto.splitItems, partsBefore);
    }

    if (dto.customClaims !== undefined) {
      const merged = { ...data, ...updates } as DocumentData;
      const fs = this.normalizeFlowStep(merged);
      if (fs !== 'splitting') {
        throw new BadRequestException('Custom amounts can be changed only in split step.');
      }
      if ((merged.splitMode as string) !== 'custom_amounts') {
        throw new BadRequestException('Custom amounts can be changed only in "Everyone enters amount" mode.');
      }
      this.validateParticipantIds(
        partsBefore,
        dto.customClaims.map((row) => row.participantId),
      );
      const byId = new Map<string, number>();
      for (const row of dto.customClaims) {
        byId.set(row.participantId, row.claimedAmountCents);
      }
      const batch = this.firebase.getFirestore().batch();
      for (const p of partsBefore) {
        batch.update(this.participantsRef(splitId).doc(p.id), {
          claimedAmountCents: byId.get(p.id) ?? 0,
          adjustmentCents: 0,
        });
      }
      await batch.commit();
    }

    if (dto.flowStep !== undefined) {
      if (dto.flowStep === 'splitting' && flowStepBefore === 'waiting') {
        updates.flowStep = 'splitting';
      } else if (dto.flowStep === 'settlement' && flowStepBefore === 'splitting') {
        const mergedData = { ...data, ...updates } as DocumentData;
        const mode = (mergedData.splitMode as string) || null;
        if (!mode) throw new BadRequestException('Select split mode before finalization.');
        const participants = await this.loadParticipants(splitId);
        const payerId = (mergedData.payerParticipantId as string) || '';
        const payer = participants.find((p) => p.id === payerId);
        if (!payer) {
          throw new BadRequestException('Payer does not exist.');
        }
        let payerIban = (payer.iban || '').trim();
        if (!payerIban && payer.userUid) {
          payerIban = ((await this.getUserIban(payer.userUid)) || '').trim();
        }
        if (!payerIban) {
          throw new BadRequestException(
            'Selected payer must have IBAN filled before finalization.',
          );
        }
        await this.assertFinalizationOk(splitId, mergedData, participants);
        updates.flowStep = 'settlement';
      } else if (dto.flowStep === 'closed') {
        updates.flowStep = 'closed';
      } else {
        throw new BadRequestException('Invalid flow step change');
      }
    }

    await ref.update(updates);

    if (dto.splitItems !== undefined) {
      await this.addActivity(splitId, {
        type: 'split_items_updated',
        meta: { count: dto.splitItems!.length },
      });
    }
    let fresh = (await ref.get()).data()!;

    if (dto.distributeRemainderEqually) {
      const fs = this.normalizeFlowStep(fresh);
      if (fs !== 'splitting' && fs !== 'settlement') {
        throw new BadRequestException('Remainder cannot be distributed in this step.');
      }
      if ((fresh.splitMode as string) !== 'custom_amounts') {
        throw new BadRequestException('Equal remainder distribution is allowed only in "Everyone enters amount" mode.');
      }
      await this.distributeRemainderEqually(splitId, ref, fresh);
      fresh = (await ref.get()).data()!;
    }
    if (dto.remainderAssignments !== undefined) {
      const fs = this.normalizeFlowStep(fresh);
      if (fs !== 'splitting' && fs !== 'settlement') {
        throw new BadRequestException('Manual remainder assignment is not allowed in this step.');
      }
      await this.assignRemainderManually(splitId, ref, fresh, dto.remainderAssignments);
      fresh = (await ref.get()).data()!;
    }

    const participants = await this.loadParticipants(splitId);

    if (dto.totalCents !== undefined && dto.totalCents !== data.totalCents) {
      await this.addActivity(splitId, {
        type: 'amount_updated',
        meta: { previousCents: data.totalCents, newCents: dto.totalCents },
      });
    }
    if (dto.payerParticipantId !== undefined && dto.payerParticipantId !== oldPayerId) {
      const newName =
        participants.find((p) => p.id === dto.payerParticipantId)?.displayName || '';
      await this.addActivity(splitId, {
        type: 'payer_changed',
        meta: { previousPayerName: oldPayerName, newPayerName: newName },
      });
    }
    if (dto.flowStep !== undefined && dto.flowStep !== flowStepBefore) {
      await this.addActivity(splitId, {
        type: 'flow_step_changed',
        meta: { from: flowStepBefore, to: dto.flowStep },
      });
    }
    if (dto.splitMode !== undefined) {
      await this.addActivity(splitId, {
        type: 'split_mode_changed',
        meta: { mode: dto.splitMode },
      });
    }
    if (dto.flowStep === 'settlement' && flowStepBefore === 'splitting') {
      await this.addActivity(splitId, { type: 'splitting_finalized', meta: {} });
    }

    const activitiesBlock = await this.loadActivitiesFirstPage(splitId);
    return this.buildView(splitId, fresh, participants, activitiesBlock);
  }

  async join(
    splitId: string,
    dto: JoinQuicksplitDto,
    joinToken: string | undefined,
    firebaseUid: string | null | undefined,
  ) {
    const pid = randomUUID();
    const secret = randomToken(16);
    const now = new Date().toISOString();
    const ref = this.col().doc(splitId);
    await this.firebase.getFirestore().runTransaction(async (tx) => {
      const splitSnap = await tx.get(ref);
      if (!splitSnap.exists) {
        throw new NotFoundException('QuickSplit not found');
      }
      const data = splitSnap.data()!;
      if (!this.verifyJoin(data, joinToken)) {
        throw new ForbiddenException('Invalid invite token');
      }
      const flowStep = this.normalizeFlowStep(data);
      const legacy = this.isLegacySplit(data);
      if (!legacy && flowStep !== 'waiting') {
        throw new BadRequestException('This split can no longer be joined.');
      }
      const participantsSnap = await tx.get(this.participantsRef(splitId));
      const existing = participantsSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as LoadedParticipant[];
      if (firebaseUid && existing.some((p) => p.userUid === firebaseUid)) {
        throw new BadRequestException('This user is already joined in the split.');
      }
      if (!legacy) {
        const cap = Math.min(
          10,
          Math.max(2, (data.targetParticipantCount as number) || existing.length + 1),
        );
        if (existing.length >= cap) {
          throw new BadRequestException('Split capacity is full.');
        }
      }
      tx.set(this.participantsRef(splitId).doc(pid), {
        displayName: dto.displayName.trim(),
        userUid: firebaseUid ?? null,
        iban: null,
        secretTokenHash: hashToken(secret),
        createdAt: now,
        markedPaidAt: null,
        claimedAmountCents: null,
        adjustmentCents: 0,
      });
      tx.update(ref, { updatedAt: now });
    });

    await this.addActivity(splitId, {
      type: 'participant_joined',
      actorParticipantId: pid,
      actorDisplayName: dto.displayName.trim(),
      meta: {},
    });

    return { participantId: pid, participantSecret: secret };
  }

  async updateParticipantClaim(
    splitId: string,
    participantId: string,
    dto: UpdateParticipantClaimDto,
    joinToken: string | undefined,
    participantSecret: string | undefined,
  ) {
    const { data, ref } = await this.getSplitDoc(splitId);
    if (!this.verifyJoin(data, joinToken)) {
      throw new ForbiddenException('Invalid invite token');
    }
    await this.assertParticipantSecret(splitId, participantId, participantSecret);

    const flowStep = this.normalizeFlowStep(data);
    if (flowStep !== 'splitting' || data.splitMode !== 'custom_amounts') {
      throw new BadRequestException('Amount updates are allowed only in "Everyone enters amount" mode during split.');
    }

    const now = new Date().toISOString();
    const pRef = this.participantsRef(splitId).doc(participantId);
    const pSnap = await pRef.get();
    if (!pSnap.exists) throw new NotFoundException('Participant not found');
    const p = pSnap.data()!;

    await pRef.update({
      claimedAmountCents: dto.claimedAmountCents,
      adjustmentCents: 0,
    });

    const batch = this.firebase.getFirestore().batch();
    const all = await this.loadParticipants(splitId);
    for (const row of all) {
      if (row.id !== participantId) {
        batch.update(this.participantsRef(splitId).doc(row.id), { adjustmentCents: 0 });
      }
    }
    await batch.commit();

    await ref.update({ updatedAt: now });
    await this.addActivity(splitId, {
      type: 'participant_claim_updated',
      actorParticipantId: participantId,
      actorDisplayName: (p.displayName as string) || null,
      meta: { claimedAmountCents: dto.claimedAmountCents },
    });

    const participants = await this.loadParticipants(splitId);
    const activitiesBlock = await this.loadActivitiesFirstPage(splitId);
    const fresh = (await ref.get()).data()!;
    return this.buildView(splitId, fresh, participants, activitiesBlock);
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
    if (!pSnap.exists) throw new NotFoundException('Participant not found');
    const p = pSnap.data()!;

    const selfFirebase = !!(firebaseUid && p.userUid === firebaseUid);
    const selfSecret =
      !!joinToken &&
      this.verifyJoin(data, joinToken) &&
      (await this.verifyParticipantSecretNoThrow(splitId, participantId, participantSecret));

    if (isPayerRow) {
      if (!(selfFirebase || selfSecret)) {
        throw new ForbiddenException('Only payer can change payer IBAN');
      }
    } else {
      if (!selfFirebase) {
        if (this.verifyJoin(data, joinToken)) {
          await this.assertParticipantSecret(splitId, participantId, participantSecret);
        } else if (!adminToken || !this.verifyAdmin(data, adminToken)) {
          throw new ForbiddenException('Payment details update denied');
        }
      }
    }

    const prevIban = (p.iban as string | null) ?? null;
    const prevDisplayName = ((p.displayName as string | null) ?? '').trim();
    const iban =
      dto.iban === undefined ? prevIban : dto.iban?.replace(/\s/g, '').toUpperCase() ?? null;
    const updates: Record<string, unknown> = { iban };
    if (dto.displayName !== undefined) {
      const requestedName = (dto.displayName ?? '').trim();
      if (requestedName && !p.userUid) {
        updates.displayName = requestedName;
      }
    }
    await pRef.update(updates);

    const nextDisplayName =
      updates.displayName !== undefined ? String(updates.displayName).trim() : prevDisplayName;
    if (iban !== prevIban || nextDisplayName !== prevDisplayName) {
      await this.addActivity(splitId, {
        type: 'payment_details_updated',
        actorParticipantId: participantId,
        actorDisplayName: (p.displayName as string) || null,
        meta: {
          isPayer: isPayerRow,
          hadIban: !!prevIban,
          ibanChanged: iban !== prevIban,
          displayNameChanged: nextDisplayName !== prevDisplayName,
        },
      });
    }

    return { success: true, iban, displayName: nextDisplayName };
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
    const flowStep = this.normalizeFlowStep(data);
    if (flowStep !== 'settlement') {
      throw new BadRequestException('Payment confirmation is available only after split is finalized.');
    }

    const payerId = data.payerParticipantId as string;
    if (participantId === payerId) {
      throw new BadRequestException('Payer cannot have "paid" status toward themselves');
    }

    const pRef = this.participantsRef(splitId).doc(participantId);
    const pSnap = await pRef.get();
    if (!pSnap.exists) throw new NotFoundException('Participant not found');
    const p = pSnap.data()!;

    const selfFirebase = !!(firebaseUid && p.userUid === firebaseUid);
    const selfSecret =
      !!joinToken &&
      this.verifyJoin(data, joinToken) &&
      (await this.verifyParticipantSecretNoThrow(splitId, participantId, participantSecret));
    if (!selfFirebase && !selfSecret) {
      throw new ForbiddenException('Only that participant can change payment status');
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
    const fresh = (await ref.get()).data()!;
    return this.buildView(splitId, fresh, participants, activitiesBlock);
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
