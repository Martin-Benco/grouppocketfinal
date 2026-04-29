import { IsInt, Min } from 'class-validator';

export class UpdateParticipantClaimDto {
  /** Suma v centoch, ktorú tento účastník sám zadal (režim „Každý svoju sumu“). */
  @IsInt()
  @Min(0)
  claimedAmountCents!: number;
}
