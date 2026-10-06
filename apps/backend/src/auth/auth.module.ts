import { Module } from '@nestjs/common';
import { AccountMembershipsModule } from '../account-memberships/account-memberships.module';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountLinkedAccount } from '../accounts/entities/account-linked-account.entity';
import { MailModule } from '../mail/mail.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AccessToken } from './entities/access-token.entity';
import { AdminGuard } from './guards/admin/admin.guard';
import { ApiOrJwtGuard } from './guards/api-or-jwt/api-or-jwt.guard';
import { ApiTokenGuard } from './guards/api-token/api-token.guard';
import { JwtGuard } from './guards/jwt/jwt.guard';
import { OAuthAuthService } from './oauth-auth.service';

@Module({
  imports: [
    AccountMembershipsModule,
    TypeOrmModule.forFeature([AccessToken, AccountLinkedAccount]),
    MailModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        global: true,
        secret: config.get<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: config.get<string>('JWT_EXPIRES_IN', '7d') as '7d',
        },
      }),
    }),
  ],
  providers: [
    AuthService,
    OAuthAuthService,
    ApiTokenGuard,
    ApiOrJwtGuard,
    JwtGuard,
    AdminGuard,
  ],
  exports: [
    AccountMembershipsModule,
    AuthService,
    ApiTokenGuard,
    ApiOrJwtGuard,
    JwtGuard,
    AdminGuard,
    JwtModule,
  ],
  controllers: [AuthController],
})
export class AuthModule {}
