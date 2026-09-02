// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ClientStatusChip, StatusChip, type StatusTone } from './StatusChip';

afterEach(cleanup);

describe('StatusChip', () => {
  it.each<StatusTone>(['ok', 'attention', 'critical', 'neutral'])(
    'renders the %s tone as its own token class',
    (tone) => {
      render(<StatusChip label="Ready" tone={tone} />);
      const chip = screen.getByText('Ready');
      expect(chip.className).toContain(`status--${tone}`);
    },
  );
});

describe('ClientStatusChip', () => {
  it('keeps the client record vocabulary unchanged: one class and label per status', () => {
    const cases: Array<[Parameters<typeof ClientStatusChip>[0]['status'], string]> = [
      ['lead', 'Lead'],
      ['active', 'Active'],
      ['paused', 'Paused'],
      ['closed', 'Closed'],
      ['erased', 'Erased'],
    ];
    for (const [status, label] of cases) {
      const { unmount } = render(<ClientStatusChip status={status} />);
      const chip = screen.getByText(label);
      expect(chip.className).toBe(`status status--${status}`);
      unmount();
    }
  });
});
