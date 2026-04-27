import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { UsersModule } from './users/users.module';
import { QuicksplitsModule } from './quicksplits/quicksplits.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    UsersModule,
    QuicksplitsModule,
  ],
})
export class AppModule {}
