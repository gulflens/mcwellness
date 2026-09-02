// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Field, PageHeader, Select } from './Controls';

afterEach(cleanup);

describe('PageHeader', () => {
  it('renders the action inside the header, after the title', () => {
    render(
      <PageHeader
        title="Clients"
        aside="12 clients"
        action={<button type="button">Add client</button>}
      />,
    );
    const title = screen.getByRole('heading', { name: 'Clients' });
    const action = screen.getByRole('button', { name: 'Add client' });
    const header = title.closest('header');
    expect(header).not.toBeNull();
    expect(header?.contains(action)).toBe(true);
    expect(Boolean(title.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(
      true,
    );
  });
});

describe('Field', () => {
  it('marks the control invalid and swaps the hint for the error, then back', () => {
    const { rerender } = render(
      <Field id="name" label="Name" hint="As it appears on the record" />,
    );
    const input = screen.getByLabelText('Name');
    expect(screen.getByText('As it appears on the record')).toBeTruthy();
    expect(input.getAttribute('aria-invalid')).toBeNull();

    rerender(
      <Field id="name" label="Name" hint="As it appears on the record" error="Name is required" />,
    );
    expect(screen.queryByText('As it appears on the record')).toBeNull();
    const message = screen.getByText('Name is required');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe(message.id);
    expect(message.classList.contains('field__hint--error')).toBe(true);

    rerender(<Field id="name" label="Name" hint="As it appears on the record" />);
    expect(screen.getByText('As it appears on the record')).toBeTruthy();
    expect(screen.queryByText('Name is required')).toBeNull();
    expect(input.getAttribute('aria-invalid')).toBeNull();
  });
});

describe('Select', () => {
  it('marks the control invalid and swaps the hint for the error, then back', () => {
    const { rerender } = render(
      <Select id="status" label="Status" hint="Filters the table below">
        <option value="">Any status</option>
      </Select>,
    );
    const select = screen.getByLabelText('Status');
    expect(screen.getByText('Filters the table below')).toBeTruthy();
    expect(select.getAttribute('aria-invalid')).toBeNull();

    rerender(
      <Select id="status" label="Status" hint="Filters the table below" error="Choose a status">
        <option value="">Any status</option>
      </Select>,
    );
    expect(screen.queryByText('Filters the table below')).toBeNull();
    const message = screen.getByText('Choose a status');
    expect(select.getAttribute('aria-invalid')).toBe('true');
    expect(select.getAttribute('aria-describedby')).toBe(message.id);
    expect(message.classList.contains('field__hint--error')).toBe(true);

    rerender(
      <Select id="status" label="Status" hint="Filters the table below">
        <option value="">Any status</option>
      </Select>,
    );
    expect(screen.getByText('Filters the table below')).toBeTruthy();
    expect(screen.queryByText('Choose a status')).toBeNull();
    expect(select.getAttribute('aria-invalid')).toBeNull();
  });
});
