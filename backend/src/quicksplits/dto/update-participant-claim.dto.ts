import { IsInt, Min } from 'class-validator';

export class UpdateParticipantClaimDto {
  @IsInt()
  @Min(0)
  claimedAmountCents!: number;
}
