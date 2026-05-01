import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PocketsModule } from './pockets/pockets.module';
import { UsersModule } from './users/users.module';
import { QuicksplitsModule } from './quicksplits/quicksplits.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PocketsModule,
    UsersModule,
    QuicksplitsModule,
  ],
})
export class AppModule {}
