import { Type } from 'class-transformer';
import { IsArray, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';

export class QuicksplitSplitItemDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  @MinLength(1)
  name!: string;

  @IsInt()
  @Min(0)
  amountCents!: number;

  @IsArray()
  @IsString({ each: true })
  consumerParticipantIds!: string[];
}
