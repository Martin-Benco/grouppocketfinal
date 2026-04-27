import { IsBoolean } from 'class-validator';

export class MarkPaidDto {
  @IsBoolean()
  paid!: boolean;
}
