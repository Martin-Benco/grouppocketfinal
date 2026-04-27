import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { OptionalAuthGuard } from '../auth/optional-auth.guard';
import { QuicksplitsService } from './quicksplits.service';
import { CreateQuicksplitDto } from './dto/create-quicksplit.dto';
import { UpdateQuicksplitDto } from './dto/update-quicksplit.dto';
import { JoinQuicksplitDto } from './dto/join-quicksplit.dto';
import { UpdateParticipantPaymentDto } from './dto/update-participant-payment.dto';
import { MarkPaidDto } from './dto/mark-paid.dto';

@Controller('quicksplits')
export class QuicksplitsController {
  constructor(private readonly quicksplits: QuicksplitsService) {}

  @Post()
  @UseGuards(OptionalAuthGuard)
  async create(@Body() dto: CreateQuicksplitDto, @Req() req: { user?: { uid: string } }) {
    const ownerUid = req.user?.uid ?? null;
    return this.quicksplits.create(dto, ownerUid);
  }

  @Get('mine')
  @UseGuards(AuthGuard)
  async listMine(@Req() req: { user: { uid: string } }) {
    return this.quicksplits.listMine(req.user.uid);
  }

  /** Staršie upozornenia (pagination cez afterId = id poslednej zobrazenej aktivity) */
  @Get(':id/activities')
  @UseGuards(OptionalAuthGuard)
  async listActivities(
    @Param('id') id: string,
    @Query('afterId') afterId: string | undefined,
    @Query('limit') limitStr: string | undefined,
    @Headers('x-join-token') joinToken: string | undefined,
    @Headers('x-admin-token') adminToken: string | undefined,
    @Req() req: { user?: { uid: string } },
  ) {
    const lim = limitStr ? Math.min(50, Math.max(1, parseInt(limitStr, 10) || 10)) : 10;
    const firebaseUid = req.user?.uid ?? null;
    return this.quicksplits.loadActivitiesPage(id, { joinToken, adminToken, firebaseUid }, afterId, lim);
  }

  @Get(':id')
  @UseGuards(OptionalAuthGuard)
  async getOne(
    @Param('id') id: string,
    @Headers('x-join-token') joinToken: string | undefined,
    @Headers('x-admin-token') adminToken: string | undefined,
    @Req() req: { user?: { uid: string } },
  ) {
    const firebaseUid = req.user?.uid ?? null;
    return this.quicksplits.getOne(id, { joinToken, adminToken, firebaseUid });
  }

  @Patch(':id')
  @UseGuards(OptionalAuthGuard)
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateQuicksplitDto,
    @Headers('x-admin-token') adminToken: string | undefined,
    @Req() req: { user?: { uid: string } },
  ) {
    return this.quicksplits.updateSplit(id, dto, adminToken, req.user?.uid ?? null);
  }

  @Post(':id/join')
  @UseGuards(OptionalAuthGuard)
  async join(
    @Param('id') id: string,
    @Body() dto: JoinQuicksplitDto,
    @Headers('x-join-token') joinToken: string | undefined,
    @Req() req: { user?: { uid: string } },
  ) {
    return this.quicksplits.join(id, dto, joinToken, req.user?.uid ?? null);
  }

  @Patch(':id/participants/:participantId/payment')
  @UseGuards(OptionalAuthGuard)
  async updatePayment(
    @Param('id') id: string,
    @Param('participantId') participantId: string,
    @Body() dto: UpdateParticipantPaymentDto,
    @Headers('x-join-token') joinToken: string | undefined,
    @Headers('x-participant-secret') participantSecret: string | undefined,
    @Headers('x-admin-token') adminToken: string | undefined,
    @Req() req: { user?: { uid: string } },
  ) {
    return this.quicksplits.updateParticipantPayment(
      id,
      participantId,
      dto,
      req.user?.uid ?? null,
      joinToken,
      participantSecret,
      adminToken,
    );
  }

  @Patch(':id/participants/:participantId/paid')
  @UseGuards(OptionalAuthGuard)
  async markPaid(
    @Param('id') id: string,
    @Param('participantId') participantId: string,
    @Body() dto: MarkPaidDto,
    @Headers('x-join-token') joinToken: string | undefined,
    @Headers('x-participant-secret') participantSecret: string | undefined,
    @Req() req: { user?: { uid: string } },
  ) {
    return this.quicksplits.markParticipantPaid(
      id,
      participantId,
      dto.paid,
      req.user?.uid ?? null,
      joinToken,
      participantSecret,
    );
  }
}
