import { IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

export class CreateQuicksplitDto {
  /** Celková suma v centoch (napr. 12000 = 120,00 €) */
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  totalCents!: number;

  /** Očakávaný počet ľudí vrátane admina (2–10). Určuje text „čaká sa na N…“ a limit joinov. */
  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(10)
  targetParticipantCount?: number;

  @IsOptional()
  @IsString()
  @MinLength(1)
  creatorDisplayName?: string;
}
