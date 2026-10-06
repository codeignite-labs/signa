import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AdminGuard } from '../auth/guards/admin/admin.guard';
import { JwtGuard } from '../auth/guards/jwt/jwt.guard';
import { AccountHydrationGuard } from '../auth/guards/account-hydration/account-hydration.guard';
import { BrandingController } from './branding.controller';

describe('branding authorization boundary', () => {
  it('requires an authenticated account for reads and admin access for writes', () => {
    const guards: unknown = Reflect.getMetadata(
      GUARDS_METADATA,
      BrandingController,
    );
    const writeGuards: unknown = Reflect.getMetadata(
      GUARDS_METADATA,
      // Metadata inspection does not invoke the unbound handler.
      // eslint-disable-next-line @typescript-eslint/unbound-method
      BrandingController.prototype.update,
    );
    expect(guards).toEqual([JwtGuard, AccountHydrationGuard]);
    expect(writeGuards).toEqual([AdminGuard]);
  });
  it('uses the hydrated account and ignores a body account override', async () => {
    const branding = { get: jest.fn(), update: jest.fn() };
    const controller = new BrandingController(branding as never);
    await controller.get({ id: '17' } as never);
    await controller.update(
      { id: '17' } as never,
      { primary_color: '#123456', white_label: true, accountId: '99' } as never,
    );
    expect(branding.get).toHaveBeenCalledWith('17');
    expect(branding.update).toHaveBeenCalledWith('17', {
      primary_color: '#123456',
      white_label: true,
      accountId: '99',
    });
  });
});
