import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { Dropzone, DropzoneContent, DropzoneEmptyState } from '../../../apps/frontend/components/kibo-ui/dropzone';
it.each([
  [{}, 'Upload a file'],
  [{ maxFiles: 3, minSize: 1024 }, 'at least 1.00KB'],
  [{ maxSize: 2 * 1024 * 1024 }, 'less than 2.00MB'],
  [{ minSize: 1024, maxSize: 4096, accept: { 'application/pdf': ['.pdf'] } }, 'Accepts application/pdf between 1.00KB and 4.00KB'],
])('describes configured file type/count/size constraints %j', (props, text) => {
  render(<Dropzone {...props}><DropzoneEmptyState /><DropzoneContent /></Dropzone>);
  expect(screen.getByText(new RegExp(text))).toBeTruthy();
});
it('shows selected filenames with bounded overflow and supports custom empty/selected content', () => {
  const files = [1, 2, 3, 4].map(index => new File(['pdf'], `${index}.pdf`));
  const view = render(<Dropzone src={files}><DropzoneContent /><DropzoneEmptyState /></Dropzone>);
  expect(screen.getByText('1.pdf, 2.pdf, and 3.pdf and 1 more')).toBeTruthy();
  view.rerender(<Dropzone src={files.slice(0, 2)}><DropzoneContent /><DropzoneEmptyState /></Dropzone>);
  expect(screen.getByText('1.pdf and 2.pdf')).toBeTruthy();
  view.rerender(<Dropzone src={files}><DropzoneContent><span>Custom selection</span></DropzoneContent></Dropzone>); expect(screen.getByText('Custom selection')).toBeTruthy();
  view.rerender(<Dropzone><DropzoneEmptyState><span>Custom prompt</span></DropzoneEmptyState></Dropzone>); expect(screen.getByText('Custom prompt')).toBeTruthy();
});
it('forwards accepted drops and reports rejected files without accepting them', async () => {
  const onDrop = vi.fn(); const onError = vi.fn();
  render(<Dropzone accept={{ 'application/pdf': ['.pdf'] }} maxSize={4} onDrop={onDrop} onError={onError}><DropzoneEmptyState /></Dropzone>);
  const drop = (file: File) => ({ dataTransfer: { files: [file], items: [{ kind: 'file', type: file.type, getAsFile: () => file }], types: ['Files'] } });
  const valid = new File(['pdf'], 'file.pdf', { type: 'application/pdf' });
  fireEvent.dragEnter(screen.getByRole('button'), drop(valid)); fireEvent.drop(screen.getByRole('button'), drop(valid));
  await waitFor(() => expect(onDrop).toHaveBeenCalledWith([valid], [], expect.anything()));
  const rejected = new File(['too large'], 'large.pdf', { type: 'application/pdf' });
  fireEvent.drop(screen.getByRole('button'), drop(rejected)); await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.any(Error)));
  expect(onDrop).toHaveBeenCalledOnce();
});
it('keeps disabled uploads inaccessible and enforces provider composition for children', () => {
  const view = render(<Dropzone disabled><DropzoneEmptyState /></Dropzone>);
  expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true); view.unmount();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  expect(() => render(<DropzoneContent />)).toThrow('within a Dropzone');
  expect(() => render(<DropzoneEmptyState />)).toThrow('within a Dropzone');
});
