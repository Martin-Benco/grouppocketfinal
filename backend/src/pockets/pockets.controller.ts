import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CreatePocketDto } from './dto/create-pocket.dto';
import { AddPocketTransactionDto } from './dto/add-pocket-transaction.dto';
import { RespondPocketInviteDto } from './dto/respond-pocket-invite.dto';
import { PocketsService } from './pockets.service';

@Controller('pockets')
@UseGuards(AuthGuard)
export class PocketsController {
  constructor(private readonly pocketsService: PocketsService) {}

  @Post()
  create(
    @Body() dto: CreatePocketDto,
    @Req() req: { user: { uid: string; email?: string | null; name?: string | null } },
  ) {
    return this.pocketsService.create(dto, req.user);
  }

  @Get('mine')
  listMine(@Req() req: { user: { uid: string } }) {
    return this.pocketsService.listForUser(req.user.uid);
  }

  @Patch(':id/respond')
  respond(
    @Param('id') id: string,
    @Body() dto: RespondPocketInviteDto,
    @Req() req: { user: { uid: string } },
  ) {
    return this.pocketsService.respondToInvite(id, req.user.uid, dto.status);
  }

  @Post(':id/invite/email')
  inviteByEmail(
    @Param('id') id: string,
    @Body() body: { email: string },
    @Req() req: { user: { uid: string } },
  ) {
    return this.pocketsService.inviteByEmailForUser(id, req.user.uid, body.email);
  }

  @Post(':id/invite/user/:userUid')
  inviteByUid(
    @Param('id') id: string,
    @Param('userUid') userUid: string,
    @Req() req: { user: { uid: string } },
  ) {
    return this.pocketsService.inviteByUidForUser(id, req.user.uid, userUid);
  }

  @Get(':id')
  getOne(@Param('id') id: string, @Req() req: { user: { uid: string } }) {
    return this.pocketsService.getOneForUser(id, req.user.uid);
  }

  @Post(':id/transactions')
  addTransaction(
    @Param('id') id: string,
    @Body() dto: AddPocketTransactionDto,
    @Req() req: { user: { uid: string } },
  ) {
    return this.pocketsService.addTransactionForUser(id, req.user.uid, dto);
  }

  @Patch(':id/transactions/:transactionId')
  updateTransaction(
    @Param('id') id: string,
    @Param('transactionId') transactionId: string,
    @Body() dto: AddPocketTransactionDto,
    @Req() req: { user: { uid: string } },
  ) {
    return this.pocketsService.updateTransactionForUser(id, transactionId, req.user.uid, dto);
  }

  @Delete(':id/transactions/:transactionId')
  deleteTransaction(
    @Param('id') id: string,
    @Param('transactionId') transactionId: string,
    @Req() req: { user: { uid: string } },
  ) {
    return this.pocketsService.deleteTransactionForUser(id, transactionId, req.user.uid);
  }

  @Delete(':id/members/:memberUid')
  removeMember(
    @Param('id') id: string,
    @Param('memberUid') memberUid: string,
    @Req() req: { user: { uid: string } },
  ) {
    return this.pocketsService.removeMemberForOwner(id, req.user.uid, memberUid);
  }
}
