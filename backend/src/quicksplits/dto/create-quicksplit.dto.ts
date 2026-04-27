import { IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

export class CreateQuicksplitDto {
  /** Celková suma v centoch (napr. 12000 = 120,00 €) */
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  totalCents!: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  creatorDisplayName?: string;
}
