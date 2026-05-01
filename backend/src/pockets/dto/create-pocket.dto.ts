import { IsArray, IsOptional, IsString } from 'class-validator';

export class CreatePocketDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  invitedUserUids?: string[];
}
