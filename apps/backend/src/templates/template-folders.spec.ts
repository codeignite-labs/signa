import { EntityNotFoundError } from 'typeorm';
import { createTemplatesServiceFixture } from '../../test/support/templates-service.fixture';
import { TemplateFolder } from './entities/template-folder.entity';
it('lists visible folders with parent/search filters and tenant-scoped counts', async () => {
  const { service, user, folders, templates, folderRows, defaultFolder } =
    await createTemplatesServiceFixture();
  const legal: TemplateFolder = Object.assign(new TemplateFolder(), {
    id: 'legal',
    accountId: 'tenant',
    name: 'Legal',
    parentFolder: null,
    parentFolderId: null,
  });
  const contracts: TemplateFolder = Object.assign(new TemplateFolder(), {
    id: 'contracts',
    accountId: 'tenant',
    name: 'Contracts',
    parentFolder: legal,
    parentFolderId: 'legal',
  });
  folderRows.set(legal.id, legal);
  folderRows.set(contracts.id, contracts);
  folders.query.getMany.mockResolvedValue([defaultFolder, legal]);
  folders.count.mockResolvedValue(2);
  templates.count.mockResolvedValue(3);
  expect(await service.listFolders(user, {})).toMatchObject([
    {
      id: 'legal',
      full_name: 'Legal',
      templates_count: 3,
      subfolders_count: 2,
    },
  ]);
  expect(await service.listFolders(user, { q: ' LEG ' })).toHaveLength(1);
  expect(await service.listFolders(user, { q: 'missing' })).toEqual([]);
  folders.query.getMany.mockResolvedValue([contracts]);
  expect(await service.listFolders(user, { parent: 'Legal' })).toMatchObject([
    { full_name: 'Legal / Contracts', parent_folder_id: 'legal' },
  ]);
  expect(folders.query.andWhere).toHaveBeenCalledWith(
    'folder.parent_folder_id = :parentFolderId',
    { parentFolderId: 'legal' },
  );
  await expect(
    service.listFolders(user, { parent: 'Missing' }),
  ).rejects.toMatchObject({ status: 404 });
});
it('creates normalized nested folder paths once and resolves existing folders without duplicate writes', async () => {
  const { service, user, folders } = await createTemplatesServiceFixture();
  expect(
    await service.createFolder(user, {
      parent: ' Legal / ',
      name: ' Contracts ',
    }),
  ).toMatchObject({ name: 'Contracts', full_name: 'Legal / Contracts' });
  expect(folders.save).toHaveBeenCalledTimes(2);
  await service.createFolder(user, { parent: 'Legal', name: 'Contracts' });
  expect(folders.save).toHaveBeenCalledTimes(2);
  expect(await service.createFolder(user, { name: ' / ' })).toMatchObject({
    name: 'Default',
  });
});
it('renames/moves folders, supports moving back to the root and rejects blank names/self-parenting', async () => {
  const { service, user, folders, folderRows } =
    await createTemplatesServiceFixture();
  const folder: TemplateFolder = Object.assign(new TemplateFolder(), {
    id: 'folder',
    accountId: 'tenant',
    name: 'Legal',
    parentFolder: null,
    parentFolderId: null,
  });
  folderRows.set(folder.id, folder);
  expect(
    await service.updateFolder(user, 'folder', {
      name: ' Updated ',
      parent: 'Parent',
    }),
  ).toMatchObject({ name: 'Updated', full_name: 'Parent / Updated' });
  expect(
    await service.updateFolder(user, 'folder', { parent: '' }),
  ).toMatchObject({ parent_folder_id: null, full_name: 'Updated' });
  await expect(
    service.updateFolder(user, 'folder', { name: ' ' }),
  ).rejects.toMatchObject({ status: 422 });
  await expect(
    service.updateFolder(user, 'folder', { parent: 'Updated' }),
  ).rejects.toMatchObject({ status: 422 });
  folder.parentFolder = null;
  folder.parentFolderId = null;
  folders.save.mockRejectedValue(new Error('write failed'));
  await expect(
    service.updateFolder(user, 'folder', { name: 'Next' }),
  ).rejects.toThrow('write failed');
});
it.each([1, 5])(
  'refuses moving a folder beneath a descendant at depth %i before mutating its parent relation',
  async (depth) => {
    const { service, user, folders, folderRows } =
      await createTemplatesServiceFixture();
    const parent: TemplateFolder = Object.assign(new TemplateFolder(), {
      id: 'parent',
      accountId: 'tenant',
      name: 'Parent',
      parentFolder: null,
      parentFolderId: null,
    });
    folderRows.set(parent.id, parent);
    let previous = parent;
    let path = 'Parent';
    for (let index = 1; index <= depth; index++) {
      const child: TemplateFolder = Object.assign(new TemplateFolder(), {
        id: `child-${index}`,
        accountId: 'tenant',
        name: `Child ${index}`,
        parentFolder: previous,
        parentFolderId: previous.id,
      });
      folderRows.set(child.id, child);
      previous = child;
      path += ` / ${child.name}`;
    }
    await expect(
      service.updateFolder(user, 'parent', { parent: path }),
    ).rejects.toMatchObject({ status: 422 });
    expect(parent.parentFolderId).toBeNull();
    expect(folders.save).not.toHaveBeenCalled();
  },
);
it('protects the default root folder and maps missing folder lookups to not found', async () => {
  const { service, user, folders } = await createTemplatesServiceFixture();
  await expect(
    service.updateFolder(user, 'default', { name: 'Renamed' }),
  ).rejects.toMatchObject({ status: 422 });
  await expect(service.deleteFolder(user, 'default', {})).rejects.toMatchObject(
    { status: 422 },
  );
  folders.findOneOrFail.mockRejectedValue(
    new EntityNotFoundError(TemplateFolder, {}),
  );
  await expect(service.deleteFolder(user, 'missing', {})).rejects.toMatchObject(
    { status: 404 },
  );
});
it('removes only a folder by moving its templates to Default and detaching direct child folders', async () => {
  const { service, user, folders, templates, folderRows } =
    await createTemplatesServiceFixture();
  const folder = Object.assign(new TemplateFolder(), {
    id: 'legal',
    accountId: 'tenant',
    name: 'Legal',
    parentFolder: null,
    parentFolderId: null,
  });
  folderRows.set(folder.id, folder);
  expect(
    await service.deleteFolder(user, 'legal', { mode: 'folder_only' }),
  ).toBeNull();
  expect(templates.update).toHaveBeenCalledWith(
    { accountId: 'tenant', folderId: 'legal' },
    { folderId: 'default' },
  );
  expect(folders.update).toHaveBeenCalledWith(
    { accountId: 'tenant', parentFolderId: 'legal' },
    { parentFolderId: null },
  );
  expect(folders.softDelete).toHaveBeenCalledWith({
    accountId: 'tenant',
    id: 'legal',
  });
});
it('archives a folder tree and its templates with the same tenant and complete descendant set', async () => {
  const { service, user, folders, templates, folderRows } =
    await createTemplatesServiceFixture();
  const parent = Object.assign(new TemplateFolder(), {
    id: 'parent',
    accountId: 'tenant',
    name: 'Parent',
    parentFolder: null,
    parentFolderId: null,
  });
  const child = Object.assign(new TemplateFolder(), {
    id: 'child',
    accountId: 'tenant',
    name: 'Child',
    parentFolder: parent,
    parentFolderId: 'parent',
  });
  const grandchild = Object.assign(new TemplateFolder(), {
    id: 'grandchild',
    accountId: 'tenant',
    name: 'Grandchild',
    parentFolder: child,
    parentFolderId: 'child',
  });
  for (const folder of [parent, child, grandchild])
    folderRows.set(folder.id, folder);
  expect(
    await service.deleteFolder(user, 'parent', { mode: 'with_contents' }),
  ).toBeNull();
  expect(templates.query.where).toHaveBeenCalledWith(
    'account_id = :accountId',
    { accountId: 'tenant' },
  );
  expect(templates.query.andWhere).toHaveBeenCalledWith(
    'folder_id IN (:...folderIds)',
    { folderIds: ['parent', 'child', 'grandchild'] },
  );
  expect(folders.query.andWhere).toHaveBeenCalledWith('id IN (:...folderIds)', {
    folderIds: ['parent', 'child', 'grandchild'],
  });
  expect(folders.query.set).toHaveBeenCalledWith({
    archivedAt: expect.any(Date) as unknown,
  });
});
