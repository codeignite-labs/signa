import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AccountsModule } from './accounts/accounts.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { createCacheOptions } from './cache/cache-options';
import { DatabaseModule } from './database/database.module';
import validationSchema from './env.schema';
import { HealthModule } from './health/health.module';
import { InternationalizationModule } from './internationalization/internationalization.module';
import { MailModule } from './mail/mail.module';
import { RealtimeModule } from './realtime/realtime.module';
import { RuntimeModule } from './runtime/runtime.module';
import { SigningModule } from './signing/signing.module';
import { StorageModule } from './storage/storage.module';
import { SubmissionsModule } from './submissions/submissions.module';
import { SubmittersModule } from './submitters/submitters.module';
import { TeamsModule } from './teams/teams.module';
import { TemplatesModule } from './templates/templates.module';
import { ToolsModule } from './tools/tools.module';
import { UsersModule } from './users/users.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { SmsModule } from './sms/sms.module';
import { StartFormModule } from './start-form/start-form.module';
import { BrandingModule } from './branding/branding.module';
import { AccountMembershipsModule } from './account-memberships/account-memberships.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      expandVariables: true,
      envFilePath: ['.env.local', '.env', '../../.env.local', '../../.env'],
      validationSchema,
      validationOptions: {
        abortEarly: true,
        allowUnknown: true,
      },
    }),
    CacheModule.registerAsync({
      isGlobal: true,
      inject: [ConfigService],
      useFactory: createCacheOptions,
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            ttl: config.get<number>('THROTTLE_TTL_MS', 60_000),
            limit: config.get<number>('THROTTLE_LIMIT', 120),
          },
        ],
      }),
    }),
    RuntimeModule,
    InternationalizationModule,
    RealtimeModule,
    DatabaseModule,
    HealthModule,
    AccountsModule,
    UsersModule,
    AuthModule,
    TemplatesModule,
    StorageModule,
    SubmissionsModule,
    SubmittersModule,
    SigningModule,
    MailModule,
    TeamsModule,
    ToolsModule,
    WebhooksModule,
    SmsModule,
    StartFormModule,
    BrandingModule,
    AccountMembershipsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
