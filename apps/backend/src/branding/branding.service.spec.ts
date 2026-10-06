import { IsNull } from 'typeorm';
import { validate } from 'class-validator';
import { BrandingService } from './branding.service';
import { UpdateBrandingDto } from './branding.dto';

describe('account branding', () => {
  function setup() {
    const accounts = {
      findOne: jest.fn().mockResolvedValue({ id: '17', name: 'Acme' }),
    };
    const configs = {
      findOne: jest.fn().mockResolvedValue(null),
      upsert: jest.fn(),
    };
    const storage = {
      findRecordAttachments: jest.fn().mockResolvedValue([]),
      createBlobProxyUrl: jest.fn().mockReturnValue('/logo'),
    };
    return {
      accounts,
      configs,
      storage,
      service: new BrandingService(
        accounts as never,
        configs as never,
        storage as never,
      ),
    };
  }
  it('reads the requested tenant only, defaults safely and handles invalid stored color', async () => {
    const { service, accounts, configs, storage } = setup();
    configs.findOne.mockResolvedValue({
      value: { primary_color: 'red;}', white_label: 'true' },
    });
    expect(await service.get('17')).toEqual({
      account_name: 'Acme',
      primary_color: null,
      white_label: false,
      show_business_name: true,
      logo: null,
    });
    expect(accounts.findOne).toHaveBeenCalledWith({
      where: { id: '17', archivedAt: IsNull() },
    });
    expect(configs.findOne).toHaveBeenCalledWith({
      where: { accountId: '17', key: 'branding' },
    });
    expect(storage.findRecordAttachments).toHaveBeenCalledWith({
      recordType: 'Account',
      recordId: '17',
      name: 'logo',
    });
  });
  it('uses the latest logo with a durable public asset URL', async () => {
    const { service, storage } = setup();
    const blob = { metadata: { logo_background: '#171717' } };
    storage.findRecordAttachments.mockResolvedValue([{ blob: {} }, { blob }]);
    expect((await service.get('17')).logo).toEqual({
      url: '/logo',
      background: 'transparent',
    });
    expect(storage.createBlobProxyUrl).toHaveBeenCalledWith(blob, null);
  });
  it('upserts only account branding and allows resetting the color', async () => {
    const { service, configs } = setup();
    await service.update('17', { primary_color: null, white_label: true });
    expect(configs.upsert).toHaveBeenCalledWith(
      {
        accountId: '17',
        key: 'branding',
        value: {
          primary_color: null,
          white_label: true,
          show_business_name: true,
        },
      },
      ['accountId', 'key'],
    );
  });
  it('preserves a hidden business name for older clients and accepts explicit changes', async () => {
    const { service, configs } = setup();
    configs.findOne.mockResolvedValue({ value: { show_business_name: false } });
    expect((await service.get('17')).show_business_name).toBe(false);
    await service.update('17', { primary_color: null, white_label: false });
    expect(configs.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        accountId: '17',
        value: {
          primary_color: null,
          white_label: false,
          show_business_name: false,
        },
      }),
      ['accountId', 'key'],
    );
    await service.update('17', {
      primary_color: null,
      white_label: false,
      show_business_name: true,
    });
    expect(configs.upsert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        accountId: '17',
        value: {
          primary_color: null,
          white_label: false,
          show_business_name: true,
        },
      }),
      ['accountId', 'key'],
    );
  });
  it.each([
    { primary_color: null, white_label: false, show_business_name: 'false' },
    { primary_color: null, white_label: false, show_business_name: null },
    { primary_color: '#fff', white_label: true },
    { primary_color: 'red', white_label: true },
    { primary_color: null, white_label: 'true' },
    {},
  ])('rejects invalid mutation input', async (input) => {
    expect(
      (await validate(Object.assign(new UpdateBrandingDto(), input))).length,
    ).toBeGreaterThan(0);
  });
  it('accepts an explicit default reset', async () => {
    expect(
      await validate(
        Object.assign(new UpdateBrandingDto(), {
          primary_color: null,
          white_label: false,
        }),
      ),
    ).toEqual([]);
  });
});
