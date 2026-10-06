import { Module } from '@nestjs/common';
import { BrandingService } from './branding.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Account } from '../accounts/entities/account.entity';
import { AccountConfig } from '../accounts/entities/account-config.entity';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [StorageModule, TypeOrmModule.forFeature([Account, AccountConfig])],
  providers: [BrandingService],
  exports: [BrandingService],
})
export class BrandingModule {}
