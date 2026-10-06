import { Module } from '@nestjs/common';
import { AccountMembershipsModule } from '../account-memberships/account-memberships.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from '../accounts/entities/account.entity';
import { AuthModule } from '../auth/auth.module';
import { UserHydrationGuard } from '../auth/guards/user-hydration/user-hydration.guard';
import { AuthorizationModule } from '../authorization/authorization.module';
import { MailModule } from '../mail/mail.module';
import { StorageModule } from '../storage/storage.module';
import { TeamMember } from '../teams/entities/team-member.entity';
import { Team } from '../teams/entities/team.entity';
import { UserConfig } from './entities/user-config.entity';
import { User } from './entities/user.entity';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [
    AccountMembershipsModule,
    TypeOrmModule.forFeature([Account, Team, TeamMember, User, UserConfig]),
    AuthModule,
    AuthorizationModule,
    MailModule,
    StorageModule,
  ],
  providers: [UsersService, UserHydrationGuard],
  exports: [UsersService, TypeOrmModule],
  controllers: [UsersController],
})
export class UsersModule {}
