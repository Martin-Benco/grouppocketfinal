import { IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

export class UpdateQuicksplitDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  totalCents?: number;

  /** ID účastníka, ktorý je platiteľom (musí patriť do splitu) */
  @IsOptional()
  @IsString()
  @MinLength(8)
  payerParticipantId?: string;
}
