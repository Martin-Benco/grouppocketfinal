import { Module } from '@nestjs/common';
import { FirebaseModule } from '../firebase/firebase.module';
import { AuthGuard } from '../auth/auth.guard';
import { OptionalAuthGuard } from '../auth/optional-auth.guard';
import { QuicksplitsController } from './quicksplits.controller';
import { QuicksplitsService } from './quicksplits.service';

@Module({
  imports: [FirebaseModule],
  controllers: [QuicksplitsController],
  providers: [QuicksplitsService, OptionalAuthGuard, AuthGuard],
})
export class QuicksplitsModule {}
