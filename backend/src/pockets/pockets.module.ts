import { Module } from '@nestjs/common';
import { FirebaseModule } from '../firebase/firebase.module';
import { PocketsController } from './pockets.controller';
import { PocketsService } from './pockets.service';

@Module({
  imports: [FirebaseModule],
  controllers: [PocketsController],
  providers: [PocketsService],
})
export class PocketsModule {}
