import { IsEmail, MaxLength } from 'class-validator';

export class InvitePocketByEmailDto {
  @IsEmail()
  @MaxLength(120)
  email!: string;
}
