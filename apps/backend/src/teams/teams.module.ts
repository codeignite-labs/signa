import { Module } from '@nestjs/common';
import { AccountMembershipsModule } from '../account-memberships/account-memberships.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { UserHydrationGuard } from '../auth/guards/user-hydration/user-hydration.guard';
import { AuthorizationModule } from '../authorization/authorization.module';
import { MailModule } from '../mail/mail.module';
import { User } from '../users/entities/user.entity';
import { UsersModule } from '../users/users.module';
import { TeamsService } from './teams.service';
import { TeamsController } from './teams.controller';
import { TeamInvitation } from './entities/team-invitation.entity';
import { TeamMember } from './entities/team-member.entity';
import { Team } from './entities/team.entity';

@Module({
  imports: [
    AccountMembershipsModule,
    AuthModule,
    UsersModule,
    AuthorizationModule,
    MailModule,
    TypeOrmModule.forFeature([Team, TeamMember, TeamInvitation, User]),
  ],
  providers: [TeamsService, UserHydrationGuard],
  exports: [TeamsService, TypeOrmModule],
  controllers: [TeamsController],
})
export class TeamsModule {}
