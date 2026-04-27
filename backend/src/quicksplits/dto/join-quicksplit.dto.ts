import { IsString, MinLength, MaxLength } from 'class-validator';

export class JoinQuicksplitDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  displayName!: string;
}
