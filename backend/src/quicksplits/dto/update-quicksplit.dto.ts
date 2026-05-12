import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { QuicksplitSplitItemDto } from './quicksplit-split-item.dto';

class QuicksplitRemainderAssignmentDto {
  @IsString()
  @MinLength(8)
  participantId!: string;

  @IsInt()
  adjustmentCents!: number;
}

class QuicksplitCustomClaimDto {
  @IsString()
  @MinLength(8)
  participantId!: string;

  @IsInt()
  @Min(0)
  claimedAmountCents!: number;
}

export class UpdateQuicksplitDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  totalCents?: number;

  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(10)
  targetParticipantCount?: number;

  @IsOptional()
  @IsString()
  @MinLength(8)
  payerParticipantId?: string;

  @IsOptional()
  @IsIn(['waiting', 'splitting', 'settlement', 'closed'])
  flowStep?: 'waiting' | 'splitting' | 'settlement' | 'closed';

  @IsOptional()
  @IsIn(['equal', 'custom_amounts', 'items'])
  splitMode?: 'equal' | 'custom_amounts' | 'items';

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  equalExcludedParticipantIds?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuicksplitSplitItemDto)
  splitItems?: QuicksplitSplitItemDto[];

  @IsOptional()
  @IsBoolean()
  distributeRemainderEqually?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuicksplitRemainderAssignmentDto)
  remainderAssignments?: QuicksplitRemainderAssignmentDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuicksplitCustomClaimDto)
  customClaims?: QuicksplitCustomClaimDto[];
}
