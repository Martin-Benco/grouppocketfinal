import { IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';

export class UpdateParticipantPaymentDto {
  @IsOptional()
  @ValidateIf((o) => o.iban !== null && o.iban !== undefined && o.iban !== '')
  @IsString()
  @MinLength(15)
  @MaxLength(34)
  iban?: string | null;

  @IsOptional()
  @ValidateIf((o) => o.displayName !== null && o.displayName !== undefined && o.displayName !== '')
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  displayName?: string | null;
}
