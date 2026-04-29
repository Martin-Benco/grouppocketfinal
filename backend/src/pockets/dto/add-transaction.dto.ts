import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class AddPocketTransactionDto {
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
