import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { AddDocumentMenu, DocumentNameEditor, TemplateDocumentsPanel } from '../../../apps/frontend/app/templates/[id]/edit/_components/documents/template-documents-panel';
import { document, editorField, templateFixture } from './fixtures';
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
beforeEach(() => { vi.stubGlobal('PointerEvent', MouseEvent); HTMLElement.prototype.scrollIntoView = vi.fn(); });
function setup(overrides: Partial<React.ComponentProps<typeof TemplateDocumentsPanel>> = {}) {
  const props: React.ComponentProps<typeof TemplateDocumentsPanel> = { editingDocumentUuid: null, isUploadingDocument: false, onAddBlankPage: vi.fn().mockResolvedValue(undefined), onAddDocument: vi.fn().mockResolvedValue(undefined), onAddGoogleDriveDocuments: vi.fn().mockResolvedValue(undefined), onEditDocument: vi.fn(), onMoveDocument: vi.fn().mockResolvedValue(undefined), onRenameDocument: vi.fn().mockResolvedValue(undefined), onRemoveDocument: vi.fn().mockResolvedValue(undefined), onReplaceDocument: vi.fn().mockResolvedValue(undefined), onReorderDocumentFields: vi.fn().mockResolvedValue(undefined), onSelectDocument: vi.fn(), onUpdateDocumentConditions: vi.fn().mockResolvedValue(undefined), selectedDocumentUuid: 'doc', template: templateFixture({ fields: [editorField()], schema: [{ attachment_uuid: 'doc', name: 'Agreement' }] }), ...overrides };
  return { props, ...render(<TemplateDocumentsPanel {...props} />) };
}
async function menu(item: string) {
  fireEvent.pointerDown(screen.getByRole('button', { name: 'More options for Agreement' }), { button: 0 });
  fireEvent.click(await screen.findByRole('menuitem', { name: item }));
}
it('selects documents and exposes edit/replace/reorder actions through the thumbnail controls', async () => {
  const { props, container } = setup();
  fireEvent.click(screen.getByRole('button', { name: 'Select document Agreement' })); expect(props.onSelectDocument).toHaveBeenCalledWith('doc');
  await menu('Edit'); expect(props.onEditDocument).toHaveBeenCalledWith('doc');
  await menu('Reorder fields'); expect(props.onReorderDocumentFields).toHaveBeenCalledWith(document);
  const input = container.querySelector('input[type=file]')!; const file = new File(['pdf'], 'replacement.pdf');
  const click = vi.spyOn(input as HTMLInputElement, 'click').mockImplementation(() => undefined);
  fireEvent.click(screen.getByRole('button', { name: 'REPLACE' })); expect(click).toHaveBeenCalledOnce();
  fireEvent.change(input, { target: { files: [file] } }); expect(props.onReplaceDocument).toHaveBeenCalledWith(document, file);
  fireEvent.change(input, { target: { files: [] } }); expect(props.onReplaceDocument).toHaveBeenCalledOnce();
});
it('moves neighboring documents and disables movement beyond list bounds', () => {
  const second = { ...document, id: 'second', uuid: 'second' };
  const { props } = setup({ template: templateFixture({ documents: [document, second], schema: [{ attachment_uuid: 'doc', name: 'Agreement' }, { attachment_uuid: 'second', name: 'Annex' }] }) });
  expect((screen.getByRole('button', { name: 'Move Agreement up' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'Move Annex down' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Move Agreement down' })); fireEvent.click(screen.getByRole('button', { name: 'Move Annex up' }));
  expect(props.onMoveDocument).toHaveBeenCalledWith(document, 1); expect(props.onMoveDocument).toHaveBeenCalledWith(second, -1);
});
it.each([0, 1, 2])('confirms document deletion with an accurate assigned field count of %i', async count => {
  const { props } = setup({ template: templateFixture({ fields: Array.from({ length: count }, (_, index) => editorField(String(index))), schema: [{ attachment_uuid: 'doc', name: 'Agreement' }] }) });
  await menu('Remove');
  if (count) expect(screen.getByText(new RegExp(`${count} field${count === 1 ? '' : 's'} placed`))).toBeTruthy();
  else expect(screen.getByText(/cannot be undone/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Remove Document' })); expect(props.onRemoveDocument).toHaveBeenCalledWith(document);
});
it('opens document conditions, excludes document fields from cycle checks, and saves rules', async () => {
  const { props } = setup(); await menu('Condition');
  fireEvent.change(screen.getByLabelText('Condition 1 field'), { target: { value: 'field' } });
  fireEvent.submit(screen.getByRole('button', { name: 'SAVE' }).closest('form')!);
  await waitFor(() => expect(props.onUpdateDocumentConditions).toHaveBeenCalledWith(document, [expect.objectContaining({ field_uuid: 'field', action: 'not_empty' })]));
});
it('renders and clears existing document conditions', async () => {
  const { props } = setup({ template: templateFixture({ fields: [editorField()], schema: [{ attachment_uuid: 'doc', name: 'Agreement', conditions: [{ field_uuid: 'field', action: 'not_empty' }] }] }) });
  await menu('Condition'); fireEvent.click(screen.getByRole('button', { name: 'Remove condition' }));
  await waitFor(() => expect(props.onUpdateDocumentConditions).toHaveBeenCalledWith(document, undefined));
});
it('opens the document name input via the panel and propagates editing state changes', async () => {
  const { props, rerender } = setup(); fireEvent.click(screen.getByRole('button', { name: /^Agreement$/ })); expect(props.onEditDocument).toHaveBeenCalledWith('doc');
  rerender(<TemplateDocumentsPanel {...props} editingDocumentUuid="doc" />);
  const input = screen.getByRole('textbox', { name: 'Document name' }); fireEvent.change(input, { target: { value: 'Updated' } }); fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect(props.onEditDocument).toHaveBeenCalledWith(null));
});
it.each(['', 'Agreement'])('ignores empty/unchanged name %s and allows escape cancellation', async value => {
  const onRename = vi.fn().mockResolvedValue(undefined); const onEditingChange = vi.fn();
  render(<DocumentNameEditor document={document} name="Agreement" isEditing onRename={onRename} onEditingChange={onEditingChange} />);
  const input = screen.getByRole('textbox'); fireEvent.change(input, { target: { value } }); fireEvent.blur(input);
  expect(onRename).not.toHaveBeenCalled(); expect(onEditingChange).toHaveBeenCalledWith(false);
  fireEvent.change(input, { target: { value: 'Discard' } }); fireEvent.keyDown(input, { key: 'Escape' }); expect((input as HTMLInputElement).value).toBe('Agreement');
});
it.each([new Error('offline'), null])('reports document rename errors and restores the original draft', async failure => {
  const onRename = vi.fn().mockRejectedValue(failure);
  render(<DocumentNameEditor document={document} name="Agreement" isEditing onRename={onRename} onEditingChange={vi.fn()} />);
  const input = screen.getByRole('textbox'); fireEvent.change(input, { target: { value: 'Updated' } }); fireEvent.blur(input);
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Document rename failed', expect.any(Object)));
  expect((input as HTMLInputElement).value).toBe('Agreement'); expect((input as HTMLInputElement).disabled).toBe(false);
});
it('adds documents from upload/blank/Drive and explicitly reports unavailable URL import', async () => {
  const props = { isUploadingDocument: false, onAddBlankPage: vi.fn(), onAddDocument: vi.fn(), onAddGoogleDriveDocuments: vi.fn() };
  const { container, rerender } = render(<AddDocumentMenu {...props} />);
  for (const label of ['Upload from computer', 'Add blank page', 'Google Drive', 'Import from URL']) {
    fireEvent.pointerDown(screen.getByRole('button', { name: /ADD DOCUMENT/ }), { button: 0 });
    fireEvent.click(await screen.findByRole('menuitem', { name: label }));
  }
  const input = container.querySelector('input')!; const file = new File(['pdf'], 'new.pdf');
  fireEvent.change(input, { target: { files: [file] } }); expect(props.onAddDocument).toHaveBeenCalledWith(file);
  fireEvent.change(input, { target: { files: [] } }); expect(props.onAddDocument).toHaveBeenCalledOnce();
  expect(props.onAddBlankPage).toHaveBeenCalledOnce(); expect(props.onAddGoogleDriveDocuments).toHaveBeenCalledOnce(); expect(toast.info).toHaveBeenCalledWith('Import from URL is not wired yet', expect.any(Object));
  rerender(<AddDocumentMenu {...props} isUploadingDocument />); expect((screen.getByRole('button', { name: /ADD DOCUMENT/ }) as HTMLButtonElement).disabled).toBe(true);
});
