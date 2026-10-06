import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiConsumes,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedRequest } from '../auth/authenticated-request';
import { AdminGuard } from '../auth/guards/admin/admin.guard';
import { AccountHydrationGuard } from '../auth/guards/account-hydration/account-hydration.guard';
import { JwtGuard } from '../auth/guards/jwt/jwt.guard';
import { CurrentAccount } from '../common/decorators/account.decorator';
import type { UploadedBufferFile } from '../storage/storage.types';
import { Account } from './entities/account.entity';
import { AccountsService } from './accounts.service';
import {
  AccountLogoResponseDto,
  SigningCertificateListResponseDto,
  SigningCertificateResponseDto,
  SigningTrustRootListResponseDto,
  SigningTrustRootResponseDto,
} from './dto/account-branding.dto';
import {
  AccountEmailIntegrationConnectResponseDto,
  AccountEmailIntegrationListResponseDto,
  AccountEmailIntegrationResponseDto,
  CompleteAccountEmailIntegrationDto,
} from './dto/account-integration.dto';
import { AccountPreferencesResponseDto } from './dto/account-preferences-response.dto';
import { AccountResponseDto } from './dto/account-response.dto';
import { UpdateAccountPreferencesDto } from './dto/update-account-preferences.dto';
import { UpdateAccountDto } from './dto/update-account.dto';

@Controller('account')
@UseGuards(JwtGuard, AccountHydrationGuard, AdminGuard)
@ApiTags('Account')
@ApiBearerAuth()
export class AccountsController {
  constructor(private readonly accountsService: AccountsService) {}

  @Get()
  @ApiOperation({
    description:
      'Returns the current tenant account profile, locale, timezone, archived status, and core settings metadata.',
    summary: 'Get account',
  })
  @ApiOkResponse({ type: AccountResponseDto })
  show(@CurrentAccount() account: Account): AccountResponseDto {
    return this.accountsService.toAccountResponse(account);
  }

  @Get('preferences')
  @ApiOperation({
    description:
      'Returns account-level signing, notification, e-signature, personalization, and compliance preferences.',
    summary: 'Get account preferences',
  })
  @ApiOkResponse({ type: AccountPreferencesResponseDto })
  preferences(
    @CurrentAccount() account: Account,
  ): Promise<AccountPreferencesResponseDto> {
    return this.accountsService.getAccountPreferences(account.id);
  }

  @Patch()
  @ApiOperation({
    description:
      'Updates account identity settings such as company name, locale, timezone, and related profile fields.',
    summary: 'Update account',
  })
  @ApiOkResponse({ type: AccountResponseDto })
  update(
    @CurrentAccount() account: Account,
    @Body() body: UpdateAccountDto,
  ): Promise<AccountResponseDto> {
    return this.accountsService.updateAccount(account.id, body);
  }

  @Patch('preferences')
  @ApiOperation({
    description:
      'Persists account-level preference flags, email templates, notification settings, document naming format, and signing policy options.',
    summary: 'Update account preferences',
  })
  @ApiOkResponse({ type: AccountPreferencesResponseDto })
  updatePreferences(
    @CurrentAccount() account: Account,
    @Body() body: UpdateAccountPreferencesDto,
  ): Promise<AccountPreferencesResponseDto> {
    return this.accountsService.updateAccountPreferences(account.id, body);
  }

  @Get('logo')
  @ApiOperation({
    description:
      'Returns the account logo attachment used on signing pages, email templates, and personalization settings.',
    summary: 'Get account logo',
  })
  @ApiOkResponse({ type: AccountLogoResponseDto })
  logo(
    @CurrentAccount() account: Account,
  ): Promise<AccountLogoResponseDto | null> {
    return this.accountsService.getAccountLogo(account.id);
  }

  @Post('logo')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    description:
      'Uploads or replaces the account logo. Use multipart/form-data with field name file.',
    summary: 'Upload account logo',
  })
  @ApiOkResponse({ type: AccountLogoResponseDto })
  uploadLogo(
    @CurrentAccount() account: Account,
    @UploadedFile() file: UploadedBufferFile,
  ): Promise<AccountLogoResponseDto> {
    return this.accountsService.uploadAccountLogo(account.id, file);
  }

  @Delete('logo')
  @ApiOperation({
    description: 'Removes the account logo attachment.',
    summary: 'Delete account logo',
  })
  @ApiOkResponse({ type: AccountLogoResponseDto })
  deleteLogo(
    @CurrentAccount() account: Account,
  ): Promise<AccountLogoResponseDto | null> {
    return this.accountsService.deleteAccountLogo(account.id);
  }

  @Get('signing-certificates')
  @ApiOperation({
    description:
      'Lists account PDF signing certificate metadata, default certificate, timestamp server URL, and timestamp mode.',
    summary: 'List signing certificates',
  })
  @ApiOkResponse({ type: SigningCertificateListResponseDto })
  signingCertificates(
    @CurrentAccount() account: Account,
  ): Promise<SigningCertificateListResponseDto> {
    return this.accountsService.listSigningCertificates(account.id);
  }

  @Post('signing-certificates')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 1024 * 1024 } }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    description:
      'Uploads a P12/PFX signing certificate and optional password for completed PDF signing.',
    summary: 'Upload signing certificate',
  })
  @ApiOkResponse({ type: SigningCertificateResponseDto })
  uploadSigningCertificate(
    @CurrentAccount() account: Account,
    @Body('name') name: string | undefined,
    @Body('password') password: string | undefined,
    @UploadedFile() file: UploadedBufferFile,
  ): Promise<SigningCertificateResponseDto> {
    return this.accountsService.uploadSigningCertificate(
      account.id,
      name,
      file,
      password,
    );
  }

  @Patch(['signing-certificates/default', 'signing-certificates/active'])
  @ApiOperation({
    description:
      'Activates one named signing identity for future PDFs. Validates its private key, usage, dates, and chain.',
    summary: 'Set default signing certificate',
  })
  @ApiOkResponse({ type: SigningCertificateResponseDto })
  makeDefaultSigningCertificate(
    @CurrentAccount() account: Account,
    @Body('name') name: string,
  ): Promise<SigningCertificateResponseDto> {
    return this.accountsService.makeDefaultSigningCertificate(account.id, name);
  }

  @Delete('signing-certificates')
  @ApiOperation({
    description:
      'Deletes an inactive signing certificate. The active identity cannot be deleted.',
    summary: 'Delete signing certificate',
  })
  @ApiOkResponse({ type: SigningCertificateResponseDto })
  deleteSigningCertificate(
    @CurrentAccount() account: Account,
    @Body('name') name: string,
  ): Promise<SigningCertificateResponseDto> {
    return this.accountsService.deleteSigningCertificate(account.id, name);
  }

  @Patch('signing-certificates/timestamp-server')
  @ApiOperation({
    description:
      'Sets or clears the RFC3161 timestamp server URL used for document timestamp evidence.',
    summary: 'Update timestamp server URL',
  })
  @ApiOkResponse({ type: SigningCertificateListResponseDto })
  updateTimestampServerUrl(
    @CurrentAccount() account: Account,
    @Body('timestamp_server_url') timestampServerUrl: string | null,
  ): Promise<SigningCertificateListResponseDto> {
    return this.accountsService.updateTimestampServerUrl(
      account.id,
      timestampServerUrl,
    );
  }

  @Get('signing-trust-roots')
  @ApiOperation({
    description:
      'Lists uploaded account trust anchors used when verifying PDFs signed by external customer or partner certificates.',
    summary: 'List PDF signing trust roots',
  })
  @ApiOkResponse({ type: SigningTrustRootListResponseDto })
  signingTrustRoots(
    @CurrentAccount() account: Account,
  ): Promise<SigningTrustRootListResponseDto> {
    return this.accountsService.listSigningTrustRoots(account.id);
  }

  @Post('signing-trust-roots')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    description:
      'Uploads a PEM/CRT/CER/DER CA certificate that should be trusted when verifying third-party signed PDFs for this account.',
    summary: 'Upload PDF verification trust root',
  })
  @ApiOkResponse({ type: SigningTrustRootResponseDto })
  uploadSigningTrustRoot(
    @CurrentAccount() account: Account,
    @Body('name') name: string | undefined,
    @UploadedFile() file: UploadedBufferFile,
  ): Promise<SigningTrustRootResponseDto> {
    return this.accountsService.uploadSigningTrustRoot(account.id, name, file);
  }

  @Delete('signing-trust-roots/:id')
  @ApiParam({
    description: 'Trust root identifier.',
    name: 'id',
  })
  @ApiOperation({
    description:
      'Deletes a previously uploaded account trust root. Existing signed PDFs are unchanged; future verification no longer trusts this root.',
    summary: 'Delete PDF verification trust root',
  })
  @ApiOkResponse({ type: SigningTrustRootResponseDto })
  deleteSigningTrustRoot(
    @CurrentAccount() account: Account,
    @Param('id') id: string,
  ): Promise<SigningTrustRootResponseDto> {
    return this.accountsService.deleteSigningTrustRoot(account.id, id);
  }

  @Get('integrations')
  @ApiOperation({
    description:
      'Lists connected account email integrations such as Gmail.',
    summary: 'List email integrations',
  })
  @ApiOkResponse({ type: AccountEmailIntegrationListResponseDto })
  integrations(
    @CurrentAccount() account: Account,
  ): Promise<AccountEmailIntegrationListResponseDto> {
    return this.accountsService.listEmailIntegrations(account.id);
  }

  @Post('integrations/:provider/connect')
  @ApiParam({
    description: 'Email provider key, for example gmail.',
    name: 'provider',
  })
  @ApiOperation({
    description:
      'Starts OAuth connection for an email provider and returns the authorization URL.',
    summary: 'Start email integration connection',
  })
  @ApiOkResponse({ type: AccountEmailIntegrationConnectResponseDto })
  connectIntegration(
    @CurrentAccount() account: Account,
    @Param('provider') provider: string,
  ): Promise<AccountEmailIntegrationConnectResponseDto> {
    return this.accountsService.startEmailIntegrationConnect(
      account.id,
      provider,
    );
  }

  @Post('integrations/:provider/callback')
  @ApiParam({
    description: 'Email provider key, for example gmail.',
    name: 'provider',
  })
  @ApiOperation({
    description:
      'Completes email provider OAuth connection using the provider authorization code.',
    summary: 'Complete email integration connection',
  })
  @ApiOkResponse({ type: AccountEmailIntegrationResponseDto })
  completeIntegration(
    @CurrentAccount() account: Account,
    @Param('provider') provider: string,
    @Body() body: CompleteAccountEmailIntegrationDto,
  ): Promise<AccountEmailIntegrationResponseDto> {
    return this.accountsService.completeEmailIntegrationConnect(
      account.id,
      provider,
      body.code,
    );
  }

  @Delete('integrations/:provider')
  @ApiParam({
    description: 'Email provider key, for example gmail.',
    name: 'provider',
  })
  @ApiOperation({
    description:
      'Disconnects an email provider and removes stored encrypted OAuth credentials.',
    summary: 'Disconnect email integration',
  })
  @ApiOkResponse({ type: AccountEmailIntegrationResponseDto })
  disconnectIntegration(
    @CurrentAccount() account: Account,
    @Param('provider') provider: string,
  ): Promise<AccountEmailIntegrationResponseDto> {
    return this.accountsService.disconnectEmailIntegration(
      account.id,
      provider,
    );
  }

  @Post('mail/test')
  @ApiOperation({
    description:
      'Queues or sends a test email through the configured account/global mail transport.',
    summary: 'Send mail transport test',
  })
  @ApiOkResponse({
    schema: {
      properties: {
        ok: { type: 'boolean', example: true },
      },
    },
  })
  testMailTransport(
    @CurrentAccount() account: Account,
    @Req() request: AuthenticatedRequest,
  ): Promise<{ ok: true }> {
    return this.accountsService.sendMailTransportTest({
      accountId: account.id,
      userId: request.session!.userId,
    });
  }

  @Delete()
  @ApiOperation({
    description:
      'Archives the current account. This is a destructive admin-only account lifecycle action.',
    summary: 'Archive account',
  })
  @ApiOkResponse({ type: AccountResponseDto })
  archive(
    @CurrentAccount() account: Account,
    @Req() request: AuthenticatedRequest,
  ): Promise<AccountResponseDto> {
    return this.accountsService.archiveAccount({
      accountId: account.id,
      userId: request.session!.userId,
    });
  }
}
