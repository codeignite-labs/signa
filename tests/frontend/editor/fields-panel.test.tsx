import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { TooltipProvider } from '../../../apps/frontend/components/ui/tooltip';
import { RoleSelector, SidebarFieldItem, TemplateFieldsPanel } from '../../../apps/frontend/app/templates/[id]/edit/_components/fields/template-fields-panel';
import { editorField, signer, secondSigner } from './fixtures';
type Props = React.ComponentProps<typeof TemplateFieldsPanel>;
beforeEach(() => { vi.stubGlobal('PointerEvent', MouseEvent); vi.stubGlobal('DragEvent', MouseEvent); HTMLElement.prototype.scrollIntoView = vi.fn(); });
function props(overrides: Partial<Props> = {}): Props {
  return { activeFieldType: 'text', fields: [editorField(), editorField('other', { submitter_uuid: secondSigner.uuid })], customFields: [], isSavingFields: false, onAddSubmitter: vi.fn().mockResolvedValue(undefined), onAddFieldWithoutDrawing: vi.fn().mockResolvedValue(undefined), onCancelFieldPlacement: vi.fn(), onCustomFieldSelect: vi.fn().mockResolvedValue(undefined), onCopyFieldToAllPages: vi.fn().mockResolvedValue(undefined), onDeleteField: vi.fn().mockResolvedValue(undefined), onFieldTypeSelect: vi.fn(), onGoToFieldArea: vi.fn(), onGoToFieldPage: vi.fn(), onMoveField: vi.fn().mockResolvedValue(undefined), onMoveFieldToIndex: vi.fn().mockResolvedValue(undefined), onRemoveSubmitter: vi.fn().mockResolvedValue(undefined), onRenameSubmitter: vi.fn().mockResolvedValue(undefined), onSelectSubmitter: vi.fn(), onSaveCustomField: vi.fn().mockResolvedValue(undefined), onSelectField: vi.fn(), onStartDrawNewArea: vi.fn(), onUpdateField: vi.fn().mockResolvedValue(undefined), selectedFieldUuid: 'field', selectedSubmitterUuid: signer.uuid, submitters: [signer, secondSigner], ...overrides };
}
it('filters fields by active role and supports field placement/cancel/palette drag', () => {
  const callbacks = props(); const view = render(<TemplateFieldsPanel {...callbacks} />);
  expect(screen.getByRole('button', { name: 'Select field' })).toBeTruthy(); expect(screen.queryByRole('button', { name: 'Select other' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'CANCEL' })); expect(callbacks.onCancelFieldPlacement).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Or add field without drawing' })); expect(callbacks.onAddFieldWithoutDrawing).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: /^Date$/ })); expect(callbacks.onFieldTypeSelect).toHaveBeenCalledWith('date');
  const setData = vi.fn(); fireEvent.dragStart(screen.getByRole('button', { name: /^Date$/ }), { dataTransfer: { setData } }); expect(setData).toHaveBeenCalledWith('application/x-signa-template-field', JSON.stringify({ kind: 'new', type: 'date' }));
  view.rerender(<TemplateFieldsPanel {...callbacks} activeFieldType={null} submitters={[]} />); expect(screen.getByText(/Draw a text field on the page/)).toBeTruthy(); expect(screen.getByRole('button', { name: 'Select other' })).toBeTruthy();
});
it('selects and exports reusable custom fields and renders fallback names', () => {
  const custom = { uuid: 'custom', type: 'text' as const, name: '' };
  const callbacks = props({ customFields: [custom], fields: [], selectedSubmitterUuid: 'missing' }); render(<TemplateFieldsPanel {...callbacks} />);
  const button = screen.getByRole('button', { name: 'Text Field 1' }); fireEvent.click(button); expect(callbacks.onCustomFieldSelect).toHaveBeenCalledWith(custom);
  const setData = vi.fn(); fireEvent.dragStart(button, { dataTransfer: { setData } }); expect(setData).toHaveBeenCalledWith('application/x-signa-template-field', JSON.stringify({ customFieldUuid: 'custom', kind: 'custom', type: 'text' }));
});
function roles(overrides: Partial<React.ComponentProps<typeof RoleSelector>> = {}) {
  const callbacks = props(); const roleProps = { fields: callbacks.fields, isSaving: false, onAddSubmitter: callbacks.onAddSubmitter, onRemoveSubmitter: callbacks.onRemoveSubmitter, onRenameSubmitter: callbacks.onRenameSubmitter, onSelectSubmitter: callbacks.onSelectSubmitter, selectedSubmitterUuid: signer.uuid, submitters: callbacks.submitters, ...overrides };
  return { roleProps, ...render(<RoleSelector {...roleProps} />) };
}
it('selects/renames/adds roles through the role selector', async () => {
  const { roleProps } = roles(); fireEvent.pointerDown(screen.getByRole('button', { name: 'First Party' }), { button: 0 });
  fireEvent.click(screen.getByRole('button', { name: 'Select Second Party' })); expect(roleProps.onSelectSubmitter).toHaveBeenCalledWith('second');
  const input = screen.getByRole('textbox', { name: 'Role 1 name' }); fireEvent.click(input); input.focus(); fireEvent.change(input, { target: { value: 'Owner' } }); fireEvent.keyDown(input, { key: 'Enter' });
  expect(roleProps.onRenameSubmitter).toHaveBeenCalledWith('signer', 'Owner');
  fireEvent.click(screen.getByRole('menuitem', { name: 'Add Third Party' })); expect(roleProps.onAddSubmitter).toHaveBeenCalledOnce();
});
it.each([['Delete Role, Keep Fields', 'keep_fields'], ['Delete Role And Fields', 'remove_fields']] as const)('confirms assigned role deletion with %s', async (label, mode) => {
  const { roleProps } = roles(); fireEvent.pointerDown(screen.getByRole('button', { name: 'First Party' }), { button: 0 });
  fireEvent.click(screen.getByRole('button', { name: 'Remove First Party' })); fireEvent.click(await screen.findByRole('button', { name: label }));
  expect(roleProps.onRemoveSubmitter).toHaveBeenCalledWith('signer', mode);
});
it('removes roles without fields directly, hides deletion for the final role, and tolerates no roles', () => {
  const role = roles({ fields: [] }); fireEvent.pointerDown(screen.getByRole('button', { name: 'First Party' }), { button: 0 }); fireEvent.click(screen.getByRole('button', { name: 'Remove Second Party' })); expect(role.roleProps.onRemoveSubmitter).toHaveBeenCalledWith('second'); role.unmount();
  const single = roles({ submitters: [{ ...signer, name: '' }], selectedSubmitterUuid: 'unknown' }); fireEvent.pointerDown(screen.getByRole('button', { name: 'First Party' }), { button: 0 }); expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull(); single.unmount();
  const empty = roles({ submitters: [] }); expect(empty.container.textContent).toBe('');
});
function sidebar(overrides: Partial<React.ComponentProps<typeof SidebarFieldItem>> = {}) {
  const field = editorField();
  const item: React.ComponentProps<typeof SidebarFieldItem> = { field, fields: [field, editorField('other')], index: 0, isSelected: true, onCopyToAllPages: vi.fn(), onDelete: vi.fn(), onGoToArea: vi.fn(), onGoToPage: vi.fn(), onMoveDown: vi.fn(), onMoveFieldToIndex: vi.fn(), onMoveUp: vi.fn(), onSaveCustomField: vi.fn(), onSelect: vi.fn(), onStartDrawNewArea: vi.fn(), onUpdateField: vi.fn().mockResolvedValue(undefined), submitters: [signer], ...overrides };
  return { item, ...render(<TooltipProvider><SidebarFieldItem {...item} /></TooltipProvider>) };
}
it('selects, renames, deletes and changes a sidebar field type', async () => {
  const { item } = sidebar(); fireEvent.click(screen.getByRole('button', { name: 'Select field' })); expect(item.onSelect).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Rename field' })); const input = screen.getByRole('textbox', { name: 'Rename field' }); fireEvent.click(input); fireEvent.change(input, { target: { value: 'Updated' } }); fireEvent.keyDown(input, { key: 'Enter' }); expect(item.onUpdateField).toHaveBeenCalledWith('field', { name: 'Updated' });
  fireEvent.click(screen.getByRole('button', { name: 'Rename field' })); fireEvent.keyDown(screen.getByRole('textbox', { name: 'Rename field' }), { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: 'Delete field' })); expect(item.onDelete).toHaveBeenCalledOnce();
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Change type for field' }), { button: 0 }); fireEvent.click(await screen.findByRole('menuitem', { name: 'Date' })); expect(item.onUpdateField).toHaveBeenCalledWith('field', expect.objectContaining({ type: 'date' }));
});
it.each([['before', 10, 0], ['after', 90, 1]] as const)('reorders dragged fields %s the target row', (_position, clientY, target) => {
  const { item, container } = sidebar(); const row = container.querySelector('[draggable=true]')!;
  vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({ top: 0, left: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
  const transfer = { getData: () => JSON.stringify({ kind: 'existing', fieldUuid: 'other' }), setData: vi.fn(), dropEffect: '' };
  fireEvent.dragStart(row, { dataTransfer: transfer }); expect(transfer.setData).toHaveBeenCalled();
  fireEvent.dragOver(row, { dataTransfer: transfer, clientY }); expect(transfer.dropEffect).toBe('move'); fireEvent.drop(row, { dataTransfer: transfer }); expect(item.onMoveFieldToIndex).toHaveBeenCalledWith('other', target);
  fireEvent.dragLeave(row); fireEvent.drop(row, { dataTransfer: { getData: () => JSON.stringify({ kind: 'existing', fieldUuid: 'field' }) } }); expect(item.onMoveFieldToIndex).toHaveBeenCalledOnce();
});
it('opens and saves sidebar field settings/description/conditions and exposes choice options', async () => {
  const { item } = sidebar({ field: editorField('field', { type: 'select', options: [{ uuid: 'option', value: 'Yes' }], conditions: [{ field_uuid: 'other', action: 'not_empty' }] }) });
  expect(screen.getByRole('textbox', { name: 'Option 1' })).toBeTruthy();
  for (const label of ['More format options', 'Description', 'Condition']) {
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Open settings for field' }), { button: 0 }); fireEvent.click(await screen.findByRole('menuitem', { name: label }));
    fireEvent.submit(screen.getByRole('button', { name: 'SAVE' }).closest('form')!); await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  }
  expect(item.onUpdateField).toHaveBeenCalledTimes(3);
});
