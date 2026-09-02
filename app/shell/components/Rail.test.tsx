// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Rail } from './Rail';

afterEach(cleanup);

describe('Rail', () => {
  it('links the sections that exist, marks the rest as arriving, and signs out', () => {
    const onSignOut = vi.fn();
    render(
      <MemoryRouter initialEntries={['/admin/clients']}>
        <Rail person={{ name: 'Owner', roles: 'Owner' }} onSignOut={onSignOut} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'Clients' })).toHaveProperty(
      'href',
      expect.stringContaining('/admin/clients'),
    );
    expect(screen.getByRole('link', { name: 'Schedule' })).toHaveProperty(
      'href',
      expect.stringContaining('/admin/schedule'),
    );
    expect(screen.getByRole('link', { name: 'Billing' })).toHaveProperty(
      'href',
      expect.stringContaining('/admin/billing'),
    );
    expect(screen.getAllByText('Arriving')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });
});
