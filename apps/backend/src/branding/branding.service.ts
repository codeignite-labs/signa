import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import type { AccountBranding } from '@repo/shared/branding';
import { Account } from '../accounts/entities/account.entity';
import { AccountConfig } from '../accounts/entities/account-config.entity';
import { StorageService } from '../storage/storage.service';
import { UpdateBrandingDto } from './branding.dto';

@Injectable()
export class BrandingService {
  constructor(
    @InjectRepository(Account) private readonly accounts: Repository<Account>,
    @InjectRepository(AccountConfig)
    private readonly configs: Repository<AccountConfig>,
    private readonly storage: StorageService,
  ) {}

  async get(accountId: string): Promise<AccountBranding> {
    const [account, config, logos] = await Promise.all([
      this.accounts.findOne({ where: { id: accountId, archivedAt: IsNull() } }),
      this.configs.findOne({ where: { accountId, key: 'branding' } }),
      this.storage.findRecordAttachments({
        recordType: 'Account',
        recordId: accountId,
        name: 'logo',
      }),
    ]);
    if (!account) throw new NotFoundException('Account not found');
    const stored = config?.value as Partial<UpdateBrandingDto> | undefined;
    const logo = logos.at(-1);
    return {
      account_name: account.name,
      primary_color:
        typeof stored?.primary_color === 'string' &&
        /^#[a-f\d]{6}$/i.test(stored.primary_color)
          ? stored.primary_color.toLowerCase()
          : null,
      white_label: stored?.white_label === true,
      show_business_name: stored?.show_business_name !== false,
      logo: logo
        ? {
            url: this.storage.createBlobProxyUrl(logo.blob, null),
            // Ignore legacy automatic backdrops without requiring a new upload.
            background: 'transparent',
          }
        : null,
    };
  }

  async update(
    accountId: string,
    input: UpdateBrandingDto,
  ): Promise<AccountBranding> {
    const current =
      input.show_business_name === undefined
        ? await this.configs.findOne({ where: { accountId, key: 'branding' } })
        : null;
    const stored = current?.value as Partial<UpdateBrandingDto> | undefined;
    await this.configs.upsert(
      {
        accountId,
        key: 'branding',
        value: {
          primary_color: input.primary_color?.toLowerCase() ?? null,
          white_label: input.white_label,
          show_business_name:
            input.show_business_name ?? stored?.show_business_name !== false,
        },
      },
      ['accountId', 'key'],
    );
    return this.get(accountId);
  }
}
