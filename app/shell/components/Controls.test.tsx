// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Field, Note, PageHeader, PasswordField, Select } from './Controls';

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

  it('lets the hint return when a cleared error is passed as an empty string', () => {
    render(<Field id="name" label="Name" hint="As it appears on the record" error="" />);
    const input = screen.getByLabelText('Name');
    expect(screen.getByText('As it appears on the record')).toBeTruthy();
    expect(input.getAttribute('aria-invalid')).toBeNull();
  });
});

describe('PasswordField', () => {
  it('shows the password on request and hides it again, saying which it will do', () => {
    render(<PasswordField id="password" label="Password" />);
    const input = screen.getByLabelText('Password');
    expect(input.getAttribute('type')).toBe('password');

    const show = screen.getByRole('button', { name: 'Show password' });
    expect(show.getAttribute('type')).toBe('button');
    expect(show.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(show);
    expect(input.getAttribute('type')).toBe('text');
    const hide = screen.getByRole('button', { name: 'Hide password' });
    expect(hide.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(hide);
    expect(input.getAttribute('type')).toBe('password');
    expect(screen.getByRole('button', { name: 'Show password' })).toBeTruthy();
  });

  it('marks the control invalid and swaps the hint for the error, then back', () => {
    const { rerender } = render(
      <PasswordField id="password" label="Password" hint="At least twelve characters" />,
    );
    const input = screen.getByLabelText('Password');
    expect(screen.getByText('At least twelve characters')).toBeTruthy();
    expect(input.getAttribute('aria-invalid')).toBeNull();

    rerender(
      <PasswordField
        id="password"
        label="Password"
        hint="At least twelve characters"
        error="Enter your password"
      />,
    );
    expect(screen.queryByText('At least twelve characters')).toBeNull();
    const message = screen.getByText('Enter your password');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe(message.id);

    rerender(<PasswordField id="password" label="Password" hint="At least twelve characters" />);
    expect(screen.getByText('At least twelve characters')).toBeTruthy();
    expect(input.getAttribute('aria-invalid')).toBeNull();
  });

  it('keeps the password hidden when the field is disabled, and the toggle with it', () => {
    render(<PasswordField id="password" label="Password" disabled />);
    const toggle = screen.getByRole('button', { name: 'Show password' });
    expect(toggle.hasAttribute('disabled')).toBe(true);
    fireEvent.click(toggle);
    expect(screen.getByLabelText('Password').getAttribute('type')).toBe('password');
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

  it('lets the hint return when a cleared error is passed as an empty string', () => {
    render(
      <Select id="status" label="Status" hint="Filters the table below" error="">
        <option value="">Any status</option>
      </Select>,
    );
    const select = screen.getByLabelText('Status');
    expect(screen.getByText('Filters the table below')).toBeTruthy();
    expect(select.getAttribute('aria-invalid')).toBeNull();
  });
});

describe('disabled', () => {
  it('reaches the input, and the hint keeps explaining what the field waits for', () => {
    render(<Field id="price" label="Price" hint="Set once the visit type is chosen" disabled />);
    const input = screen.getByLabelText('Price');
    expect(input.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('Set once the visit type is chosen')).toBeTruthy();
  });

  it('reaches the select, and the hint keeps explaining what the field waits for', () => {
    render(
      <Select id="zone" label="Zone" hint="Set once the address is confirmed" disabled>
        <option value="">Any zone</option>
      </Select>,
    );
    const select = screen.getByLabelText('Zone');
    expect(select.hasAttribute('disabled')).toBe(true);
    expect(screen.getByText('Set once the address is confirmed')).toBeTruthy();
  });
});

describe('Note', () => {
  it('says a quiet thing with no role, and a critical thing as an alert', () => {
    render(<Note>Nothing here yet.</Note>);
    expect(screen.getByText('Nothing here yet.').getAttribute('role')).toBeNull();
    cleanup();
    render(<Note tone="critical">This could not be saved.</Note>);
    expect(screen.getByRole('alert').textContent).toBe('This could not be saved.');
  });

  it('announces a thing that wants noticing as a status, in the attention tone', () => {
    render(<Note tone="attention">This package runs out in 30 days.</Note>);
    const note = screen.getByRole('status');
    expect(note.textContent).toBe('This package runs out in 30 days.');
    expect(note.className).toContain('note--attention');
  });
});
