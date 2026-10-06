import { Module } from '@nestjs/common';
import { AccountMembershipsService } from './account-memberships.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AccountMembership } from './entities/account-membership.entity';
import { MailModule } from '../mail/mail.module';

@Module({
  imports: [TypeOrmModule.forFeature([AccountMembership]), MailModule],
  providers: [AccountMembershipsService],
  exports: [AccountMembershipsService, TypeOrmModule],
})
export class AccountMembershipsModule {}
