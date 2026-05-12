import { IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

export class CreateQuicksplitDto {
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  totalCents!: number;

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
