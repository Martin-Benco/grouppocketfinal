import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

class CreatePocketTransactionDto {
  @IsString()
  @MaxLength(80)
  name!: string;

  @IsInt()
  @Min(0)
  @Max(99_999_999)
  amountCents!: number;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  tag?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  splitMethod?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  paidByUid?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  transactionDate?: string;
}

export class CreatePocketDto {
  @IsString()
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(30, { each: true })
  tags?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePocketTransactionDto)
  initialTransactions?: CreatePocketTransactionDto[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @MaxLength(120, { each: true })
  inviteEmails?: string[];
}

export type CreatePocketTransactionInput = CreatePocketTransactionDto;
