export type ActivityType =
  | 'split_created'
  | 'participant_joined'
  | 'amount_updated'
  | 'payer_changed'
  | 'payment_details_updated'
  | 'marked_paid'
  | 'marked_unpaid'
  | 'flow_step_changed'
  | 'split_mode_changed'
  | 'split_items_updated'
  | 'participant_claim_updated'
  | 'remainder_distributed'
  | 'splitting_finalized';

export type ActivityView = {
  id: string;
  type: ActivityType;
  createdAt: string;
  actorParticipantId: string | null;
  actorDisplayName: string | null;
  meta: Record<string, unknown>;
};
