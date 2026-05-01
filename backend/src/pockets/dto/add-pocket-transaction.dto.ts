import { IsArray, IsDateString, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class AddPocketTransactionDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsDateString()
  date!: string;

  @IsString()
  @MaxLength(128)
  payerUid!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  tag?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsArray()
  @IsString({ each: true })
  splitAssignedUids!: string[];
}
