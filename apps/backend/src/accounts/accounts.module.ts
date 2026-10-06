import { BrandingModule } from '../branding/branding.module';
import { Module } from '@nestjs/common';
import { AccountMembershipsModule } from '../account-memberships/account-memberships.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { AccountHydrationGuard } from '../auth/guards/account-hydration/account-hydration.guard';
import { MailModule } from '../mail/mail.module';
import { PdfSignaturesModule } from '../pdf-signatures/pdf-signatures.module';
import { StorageModule } from '../storage/storage.module';
import { User } from '../users/entities/user.entity';
import { AccountCustomFieldsController } from './account-custom-fields.controller';
import { AccountsController } from './accounts.controller';
import { AccountsService } from './accounts.service';
import { AccountConfig } from './entities/account-config.entity';
import { AccountLinkedAccount } from './entities/account-linked-account.entity';
import { Account } from './entities/account.entity';
import { EncryptedConfig } from './entities/encrypted-config.entity';
import { TestingAccountsController } from './testing-accounts.controller';
import { BrandingController } from './branding.controller';
import { AccountMembershipsController } from './account-memberships.controller';

@Module({
  imports: [
    AccountMembershipsModule,
    BrandingModule,
    AuthModule,
    MailModule,
    PdfSignaturesModule,
    StorageModule,
    TypeOrmModule.forFeature([
      Account,
      AccountConfig,
      AccountLinkedAccount,
      EncryptedConfig,
      User,
    ]),
  ],
  providers: [AccountsService, AccountHydrationGuard],
  exports: [AccountsService, TypeOrmModule],
  controllers: [
    AccountsController,
    AccountCustomFieldsController,
    TestingAccountsController,
    BrandingController,
    AccountMembershipsController,
  ],
})
export class AccountsModule {}
