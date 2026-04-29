import { ArrayMaxSize, ArrayUnique, IsArray, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdatePocketDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(30, { each: true })
  tags?: string[];
}
