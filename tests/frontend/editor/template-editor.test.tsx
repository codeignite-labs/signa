import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import * as api from '../../../apps/frontend/lib/api/templates';
import { TemplateEditor } from '../../../apps/frontend/app/templates/[id]/edit/template-editor';
import { editorField, signer, secondSigner, templateFixture } from './fixtures';
const { router } = vi.hoisted(() => ({ router: { push: vi.fn() } }));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'template' }), useRouter: () => router }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn() } }));
vi.mock('../../../apps/frontend/lib/api/templates', async original => ({ ...await original<typeof api>(), getTemplate: vi.fn(), getAccountCustomFields: vi.fn(), updateTemplate: vi.fn(), getTemplateDocumentDownloads: vi.fn() }));
beforeEach(() => {
  sessionStorage.clear(); vi.stubGlobal('PointerEvent', MouseEvent); HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.mocked(api.getTemplate).mockResolvedValue(templateFixture({ fields: [editorField()], submitters: [signer, secondSigner] }));
  vi.mocked(api.getAccountCustomFields).mockResolvedValue({ value: [] });
  vi.mocked(api.updateTemplate).mockResolvedValue({ id: 'template', updated_at: '' });
  vi.mocked(api.getTemplateDocumentDownloads).mockResolvedValue([]);
});
async function openEditor() { const view = render(<TemplateEditor />); await screen.findByRole('button', { name: 'Save template' }); return view; }
it('renders a loading state then a working editor with accessible back navigation', async () => {
  const view = render(<TemplateEditor />); expect(screen.getByText('Loading template editor')).toBeTruthy();
  await screen.findByRole('button', { name: 'Save template' }); expect(screen.getByRole('link', { name: 'Back to templates' }).getAttribute('href')).toBe('/templates');
  expect(view.container.querySelector('#main-content')).toBeTruthy();
});
it('renders loading errors and routes the recovery action to templates', async () => {
  vi.mocked(api.getTemplate).mockRejectedValue(new Error('Unavailable'));
  render(<TemplateEditor />); await screen.findByText('Unavailable'); fireEvent.click(screen.getByRole('button', { name: 'Back to templates' })); expect(router.push).toHaveBeenCalledWith('/templates');
});
it('saves a title once across enter/blur and cancels unchanged/escaped edits', async () => {
  await openEditor(); fireEvent.click(screen.getByRole('button', { name: /^Agreement$/ }));
  let input = screen.getByRole('textbox', { name: 'Template name' }); fireEvent.change(input, { target: { value: '  Updated  ' } }); fireEvent.keyDown(input, { key: 'Enter' });
  await screen.findByRole('button', { name: /^Updated$/ }); expect(api.updateTemplate).toHaveBeenCalledTimes(1); expect(api.updateTemplate).toHaveBeenCalledWith('template', { name: 'Updated' });
  fireEvent.click(screen.getByRole('button', { name: /^Updated$/ })); input = screen.getByRole('textbox', { name: 'Template name' }); fireEvent.keyDown(input, { key: 'Escape' });
  fireEvent.click(screen.getByRole('button', { name: /^Updated$/ })); input = screen.getByRole('textbox', { name: 'Template name' }); fireEvent.change(input, { target: { value: '' } }); fireEvent.blur(input);
  expect(api.updateTemplate).toHaveBeenCalledTimes(1);
});
it('restores the title when its persistence fails and always releases the save control', async () => {
  vi.mocked(api.updateTemplate).mockRejectedValue(new Error('offline'));
  await openEditor(); fireEvent.click(screen.getByRole('button', { name: /^Agreement$/ })); const input = screen.getByRole('textbox', { name: 'Template name' }); fireEvent.change(input, { target: { value: 'Failed name' } }); fireEvent.keyDown(input, { key: 'Enter' });
  await waitFor(() => expect((screen.getByRole('button', { name: /^Agreement$/ }) as HTMLButtonElement).disabled).toBe(false));
  expect(toast.error).toHaveBeenCalledWith('Template rename failed', expect.any(Object));
});
it('adds a field through the real palette and supports undo/redo plus draft saving', async () => {
  await openEditor(); fireEvent.click(screen.getByRole('button', { name: /^Text$/ })); fireEvent.click(screen.getByRole('button', { name: 'Or add field without drawing' }));
  await waitFor(() => expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Undo' })); await waitFor(() => expect((screen.getByRole('button', { name: 'Redo' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: 'Redo' }));
  await waitFor(() => expect(api.updateTemplate).toHaveBeenCalledTimes(3));
  fireEvent.click(screen.getByRole('button', { name: 'Save template' })); await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Template saved'));
  fireEvent.click(screen.getByRole('button', { name: /^Text$/ })); fireEvent.click(screen.getByRole('button', { name: 'CANCEL' })); expect(screen.queryByRole('button', { name: 'CANCEL' })).toBeNull();
});
it('offers download/preview/preferences from save options and prevents sending with only the self-signing role', async () => {
  vi.mocked(api.getTemplate).mockResolvedValue(templateFixture()); await openEditor();
  fireEvent.click(screen.getByRole('button', { name: 'Send' })); expect(toast.error).toHaveBeenCalledWith('Add another party before sending', expect.any(Object));
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Save options' }), { button: 0 }); expect(screen.getByRole('menuitem', { name: 'Save and Preview' }).getAttribute('href')).toBe('/templates/template/form');
  fireEvent.click(screen.getByRole('menuitem', { name: 'Download' })); await waitFor(() => expect(api.getTemplateDocumentDownloads).toHaveBeenCalledWith('template'));
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Save options' }), { button: 0 }); fireEvent.click(screen.getByRole('menuitem', { name: 'Preferences' })); await screen.findByRole('dialog');
});
it('shows imported-field decision controls and removes them after keeping the imported fields', async () => {
  vi.mocked(api.getTemplate).mockResolvedValue(templateFixture({ schema: [{ attachment_uuid: 'doc', pending_fields: true }] })); await openEditor();
  fireEvent.click(screen.getByRole('button', { name: 'KEEP' })); await waitFor(() => expect(screen.queryByRole('button', { name: 'KEEP' })).toBeNull());
  expect(api.updateTemplate).toHaveBeenCalledWith('template', expect.objectContaining({ schema: [{ attachment_uuid: 'doc' }] }));
});
