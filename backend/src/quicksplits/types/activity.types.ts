export type ActivityType =
  | 'split_created'
  | 'participant_joined'
  | 'amount_updated'
  | 'payer_changed'
  | 'payment_details_updated'
  | 'marked_paid'
  | 'marked_unpaid';

export type ActivityView = {
  id: string;
  type: ActivityType;
  createdAt: string;
  actorParticipantId: string | null;
  actorDisplayName: string | null;
  meta: Record<string, unknown>;
};
