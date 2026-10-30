import { BullBoardModule } from '@bull-board/nestjs';
import { MailerModule } from '@nestjs-modules/mailer';
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { createBullBoardOptions } from './bull-board-options';
import { createMailerOptions } from './mailer-options';
import { createQueueOptions } from './queue-options';
import { QueueRegistrationService } from './queue-registration/queue-registration.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
    BullModule.forRootAsync({
      extraOptions: { manualRegistration: true },
      inject: [ConfigService],
      useFactory: createQueueOptions,
    }),
    BullBoardModule.forRootAsync({
      inject: [ConfigService],
      useFactory: createBullBoardOptions,
    }),
    MailerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: createMailerOptions,
    }),
  ],
  providers: [QueueRegistrationService],
})
export class RuntimeModule {}
