import { IsIn } from 'class-validator';

export class RespondPocketInviteDto {
  @IsIn(['accepted', 'rejected'])
  status!: 'accepted' | 'rejected';
}
