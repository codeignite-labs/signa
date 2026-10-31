import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { FieldAdvancedSettingsModal, FieldConditionsModal, FieldDescriptionModal } from '../../../apps/frontend/app/templates/[id]/edit/_components/modals/field-modals';
import { editorField, pageArea } from './fixtures';
import type { TemplateEditorField } from '../../../apps/frontend/app/templates/[id]/edit/_lib/template-editor-model';
const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label, { selector: 'input,textarea,select' }), { target: { value } });
function save() { fireEvent.submit(screen.getByRole('button', { name: 'SAVE' }).closest('form')!); }
function advanced(field: TemplateEditorField) {
  const onSave = vi.fn().mockResolvedValue(undefined); const onOpenChange = vi.fn(); const onGoToArea = vi.fn();
  const view = render(<FieldAdvancedSettingsModal field={field} title={field.name ?? 'Field'} onSave={onSave} onOpenChange={onOpenChange} onGoToArea={onGoToArea} />);
  return { onSave, onOpenChange, onGoToArea, ...view };
}
it('edits trimmed field descriptions and display titles and closes only after saving', async () => {
  const onSave = vi.fn().mockResolvedValue(undefined); const onOpenChange = vi.fn();
  const props = { field: editorField('field', { description: 'Existing', title: 'Existing title' }), title: 'Description', onSave, onOpenChange };
  const view = render(<FieldDescriptionModal {...props} open={false} />); expect(screen.queryByRole('dialog')).toBeNull();
  view.rerender(<FieldDescriptionModal {...props} open />);
  change('Description', '  Updated  '); change('Display title (optional)', '  Title  '); save();
  expect(onSave).toHaveBeenCalledWith({ description: 'Updated', title: 'Title' }); await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  change('Description', ' '); change('Display title (optional)', ' '); save(); expect(onSave).toHaveBeenLastCalledWith({ description: undefined, title: undefined });
});
it('saves text defaults, required/read-only/prefill flags and manages field areas', async () => {
  const { onSave, onGoToArea, onOpenChange } = advanced(editorField('field', { areas: [pageArea, { ...pageArea, page: 1 }] }));
  change('Default value', 'Initial');
  for (const label of ['Required', 'Read only', 'Prefillable']) fireEvent.click(screen.getByRole('button', { name: label }));
  fireEvent.click(screen.getByRole('button', { name: 'Page 2' })); expect(onGoToArea).toHaveBeenCalledWith({ ...pageArea, page: 1 });
  fireEvent.click(screen.getByRole('button', { name: 'Remove area 2' })); save();
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ required: false, readonly: true, prefillable: true, default_value: 'Initial', areas: [pageArea] }));
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
});
it.each([true, false])('saves checkbox defaults from %s as booleans', checked => {
  const { onSave } = advanced(editorField('check', { type: 'checkbox', default_value: checked, preferences: null, validation: null, areas: [] }));
  change('Checked by default', checked ? 'false' : 'true'); save(); expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ default_value: !checked }));
});
it.each(['length', 'email', 'custom'])('stores %s text validation settings', kind => {
  const { onSave } = advanced(editorField('field', { validation: { pattern: '.{2,8}', message: 'Original' } }));
  change('Validation', kind);
  if (kind === 'length') { change('Minimum length', '3'); change('Maximum length', '12'); }
  if (kind === 'custom') { change('Validation pattern', '^ok$'); change('Validation error message', 'Use ok'); }
  save();
  const patch = onSave.mock.calls[0][0] as Partial<TemplateEditorField>;
  expect(patch.validation).toEqual(kind === 'length' ? { pattern: '.{3,12}' } : kind === 'custom' ? { pattern: '^ok$', message: 'Use ok' } : expect.objectContaining({ pattern: expect.stringContaining('@') }));
});
it('uses zero as the minimum for an open-ended length rule', () => {
  const { onSave } = advanced(editorField()); change('Validation', 'length'); save();
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ validation: { pattern: '.{0,}' } }));
});
it('clears existing text validation when None is selected', () => {
  const { onSave } = advanced(editorField('field', { validation: { pattern: '^old$' } })); change('Validation', ''); save();
  expect(onSave.mock.calls[0][0]).toHaveProperty('validation', undefined);
});
it('saves number format/ranges while preserving unrelated validation preferences', () => {
  const { onSave } = advanced(editorField('number', { type: 'number', preferences: { format: 'num', retained: true }, validation: { min: 0, max: 99, custom: 'retained' } }));
  change('Minimum', '2'); change('Maximum', '10'); save();
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ preferences: { format: 'num', retained: true }, validation: { min: 2, max: 10, custom: 'retained' } }));
  change('Minimum', ''); change('Maximum', ''); save(); expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ validation: { custom: 'retained' } }));
});
it('removes empty number ranges and supports date format selection', () => {
  const number = advanced(editorField('number', { type: 'number', validation: { min: 1, max: 2 } }));
  change('Minimum', ''); change('Maximum', ''); save(); expect(number.onSave).toHaveBeenCalledWith(expect.objectContaining({ validation: undefined })); number.unmount();
  const date = advanced(editorField('date', { type: 'date' }));
  const select = screen.getByLabelText('Format') as HTMLSelectElement; const next = select.options[1].value; change('Format', next); save(); expect(date.onSave).toHaveBeenCalledWith(expect.objectContaining({ preferences: { format: next } }));
});
it('sets/clears phone country without dropping unrelated validation', () => {
  const { onSave } = advanced(editorField('phone', { type: 'phone', validation: {} })); change('Phone country', 'KE'); save();
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ validation: { phone_country: 'KE' } }));
  change('Phone country', ''); save(); expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ validation: undefined }));
});
it.each(['file', 'image'] as const)('sets and clears %s upload constraints', type => {
  const { onSave } = advanced(editorField('attachment', { type, preferences: { retained: true } }));
  const label = type === 'image' ? 'Accepted image types' : 'Accepted file types';
  change(label, ' image/png '); change('Maximum size in MB', '3'); save();
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ preferences: { retained: true, accept: 'image/png', max_size_mb: '3' } }));
  change(label, ''); change('Maximum size in MB', ''); save(); expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ preferences: { retained: true } }));
});
it('removes empty upload preferences and generates fallback options for choice fields', () => {
  const file = advanced(editorField('file', { type: 'file' })); save(); expect(file.onSave).toHaveBeenCalledWith(expect.objectContaining({ preferences: undefined })); file.unmount();
  const choices = advanced(editorField('choices', { type: 'select', options: [] })); save(); expect(choices.onSave).toHaveBeenCalledWith(expect.objectContaining({ options: [expect.objectContaining({ value: '' }), expect.objectContaining({ value: '' })] }));
});
it('adds, edits and removes options while retaining at least one option', () => {
  const { onSave } = advanced(editorField('choices', { type: 'multiple', options: [{ uuid: 'one', value: 'Yes' }, { uuid: 'two', value: 'No' }] }));
  change('Option 1', 'Updated'); fireEvent.click(screen.getByRole('button', { name: /^Add$/ }));
  expect(screen.getByRole('textbox', { name: 'Option 3' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Remove option 2' })); save();
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ options: [{ uuid: 'one', value: 'Updated' }, expect.objectContaining({ value: '' })] }));
});
function conditions(field = editorField(), fields = [editorField('source'), editorField('choice', { type: 'select', options: [{ uuid: 'yes', value: 'Yes' }, { uuid: 'empty', value: '' }] }), editorField('number', { type: 'number', name: '' })]) {
  const onSave = vi.fn().mockResolvedValue(undefined); const onOpenChange = vi.fn();
  return { onSave, onOpenChange, ...render(<FieldConditionsModal field={field} fields={[field, ...fields]} onSave={onSave} onOpenChange={onOpenChange} title="Target" />) };
}
it('creates conditional rules with text/choice comparisons and OR/AND operations', async () => {
  const { onSave, onOpenChange } = conditions();
  change('Condition 1 field', 'number'); change('Condition 1 comparison', 'equal'); change('Condition 1 value', '12');
  fireEvent.click(screen.getByRole('button', { name: '+ Add condition' })); change('Condition 2 field', 'choice'); change('Condition 2 value', 'yes');
  fireEvent.click(screen.getByRole('button', { name: 'OR' })); fireEvent.click(screen.getByRole('button', { name: 'AND' })); save();
  expect(onSave).toHaveBeenCalledWith({ conditions: [expect.objectContaining({ field_uuid: 'number', value: '12', operation: undefined }), expect.objectContaining({ field_uuid: 'choice', value: 'yes', operation: 'or' })] });
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
});
it('uses number controls and clears comparison values for unary conditions', () => {
  const { onSave } = conditions(); change('Condition 1 field', 'number'); change('Condition 1 comparison', 'equal');
  expect((screen.getByLabelText('Condition 1 value') as HTMLInputElement).type).toBe('number');
  change('Condition 1 comparison', 'empty'); expect(screen.queryByLabelText('Condition 1 value')).toBeNull(); save();
  expect(onSave).toHaveBeenCalledWith({ conditions: [expect.objectContaining({ field_uuid: 'number', action: 'empty', value: undefined })] });
});
it('removes individual/all conditions and ignores incomplete draft conditions', () => {
  const original = editorField('target', { conditions: [{ field_uuid: 'source', action: 'equal', value: 'match' }] });
  const { onSave } = conditions(original); fireEvent.click(screen.getByRole('button', { name: '+ Add condition' }));
  fireEvent.click(screen.getAllByRole('button', { name: 'Remove condition' })[1]); save(); expect(onSave).toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '+ Add condition' }));
  fireEvent.click(screen.getAllByRole('button', { name: 'Remove condition' }).at(-1)!);
  expect(onSave).toHaveBeenLastCalledWith({ conditions: undefined });
});
it('filters cyclic dependency choices and normalizes unknown comparison actions', () => {
  const target = editorField('target', { conditions: [{ field_uuid: 'source', action: 'unknown' }] });
  const source = editorField('source');
  const dependent = editorField('dependent', { conditions: [{ field_uuid: 'target', action: 'equal', value: 'x' }] });
  const { onSave } = conditions(target, [source, dependent]);
  expect(screen.queryByRole('option', { name: 'dependent' })).toBeNull(); save();
  expect(onSave).toHaveBeenCalledWith({ conditions: [expect.objectContaining({ field_uuid: 'source', action: 'not_empty' })] });
});
