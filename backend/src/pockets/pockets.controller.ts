import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { AddPocketTransactionDto } from './dto/add-transaction.dto';
import { CreatePocketDto } from './dto/create-pocket.dto';
import { InvitePocketByEmailDto } from './dto/invite-email.dto';
import { UpdatePocketDto } from './dto/update-pocket.dto';
import { PocketsService } from './pockets.service';

@Controller('pockets')
@UseGuards(AuthGuard)
export class PocketsController {
  constructor(private readonly pocketsService: PocketsService) {}

  @Get('mine')
  listMine(@Req() req: { user: { uid: string; email?: string | null; name?: string | null } }) {
    return this.pocketsService.listMine(req.user.uid);
  }

  @Post()
  create(
    @Body() dto: CreatePocketDto,
    @Req() req: { user: { uid: string; email?: string | null; name?: string | null } },
  ) {
    return this.pocketsService.create(dto, req.user);
  }

  @Get(':id')
  getOne(@Param('id') id: string, @Req() req: { user: { uid: string } }) {
    return this.pocketsService.getOne(id, req.user.uid);
  }

  @Get(':id/activities')
  listActivities(@Param('id') id: string, @Req() req: { user: { uid: string } }) {
    return this.pocketsService.listActivities(id, req.user.uid);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdatePocketDto,
    @Req() req: { user: { uid: string } },
  ) {
    return this.pocketsService.update(id, req.user.uid, dto);
  }

  @Post(':id/transactions')
  addTransaction(
    @Param('id') id: string,
    @Body() dto: AddPocketTransactionDto,
    @Req() req: { user: { uid: string } },
  ) {
    return this.pocketsService.addTransaction(id, req.user.uid, dto);
  }

  @Post(':id/invite/email')
  inviteByEmail(
    @Param('id') id: string,
    @Body() dto: InvitePocketByEmailDto,
    @Req() req: { user: { uid: string } },
  ) {
    return this.pocketsService.inviteByEmail(id, req.user.uid, dto.email);
  }

  @Post(':id/leave')
  leave(@Param('id') id: string, @Req() req: { user: { uid: string } }) {
    return this.pocketsService.leave(id, req.user.uid);
  }
}
