import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { FieldOptionsEditor } from '../../../apps/frontend/app/templates/[id]/edit/_components/fields/field-options-editor';
import { editorField, pageArea } from './fixtures';
vi.mock('sonner', () => ({ toast: { info: vi.fn() } }));
function setup(oneOption = false) {
  const field = editorField('choice', { type: 'radio', options: [{ uuid: 'one', value: 'Yes' }, ...oneOption ? [] : [{ uuid: 'two', value: 'No' }]], areas: [{ ...pageArea, option_uuid: 'one' }] });
  const props = { field, onSelect: vi.fn(), onStartDrawNewArea: vi.fn(), onUpdateField: vi.fn().mockResolvedValue(undefined) };
  return { props, ...render(<FieldOptionsEditor {...props} />) };
}
it('edits options, adds new rows after enter and removes both an option and its page area', () => {
  const { props } = setup(); const input = screen.getByRole('textbox', { name: 'Option 1' });
  fireEvent.change(input, { target: { value: 'Changed' } }); fireEvent.blur(input);
  expect(props.onUpdateField).toHaveBeenCalledWith({ options: [{ uuid: 'one', value: 'Changed' }, { uuid: 'two', value: 'No' }] });
  fireEvent.keyDown(input, { key: 'Enter' }); expect(props.onUpdateField).toHaveBeenLastCalledWith({ options: [expect.objectContaining({ value: 'Changed' }), expect.objectContaining({ value: '' }), { uuid: 'two', value: 'No' }] });
  fireEvent.change(input, { target: { value: '' } }); fireEvent.keyDown(input, { key: 'Enter' });
  fireEvent.click(screen.getByRole('button', { name: 'Remove option 1' })); expect(props.onUpdateField).toHaveBeenLastCalledWith({ areas: [], options: [{ uuid: 'two', value: 'No' }] });
  fireEvent.click(screen.getByRole('button', { name: '+ Add option' })); expect(props.onSelect).toHaveBeenCalled();
});
it('prevents deleting the final option and splits pasted lines into new stable-id choices', () => {
  const single = setup(true); fireEvent.click(screen.getByRole('button', { name: 'Remove option 1' })); expect(single.props.onUpdateField).not.toHaveBeenCalled(); single.unmount();
  const { props } = setup(); const input = screen.getByRole('textbox', { name: 'Option 1' });
  fireEvent.paste(input, { clipboardData: { getData: () => ' single ' } }); expect(props.onUpdateField).not.toHaveBeenCalled();
  fireEvent.paste(input, { clipboardData: { getData: () => ' One\r\nTwo\n\n Three ' } });
  expect(props.onUpdateField).toHaveBeenCalledWith({ options: [{ uuid: 'one', value: 'YesOne' }, expect.objectContaining({ value: 'Two' }), expect.objectContaining({ value: 'Three' }), { uuid: 'two', value: 'No' }] });
});
it('draws missing choice areas and exports an option-specific drag payload', () => {
  const { props } = setup(); expect(screen.queryByRole('button', { name: 'Draw area for option 1' })).toBeNull();
  const draw = screen.getByRole('button', { name: 'Draw area for option 2' }); fireEvent.click(draw);
  expect(props.onStartDrawNewArea).toHaveBeenCalledOnce(); expect(toast.info).toHaveBeenCalledWith('Drag this option button onto the page');
  const setData = vi.fn(); fireEvent.dragStart(draw, { dataTransfer: { setData, effectAllowed: '' } });
  expect(setData).toHaveBeenCalledWith('application/x-signa-template-field', JSON.stringify({ fieldUuid: 'choice', kind: 'existing', optionUuid: 'two' }));
});
