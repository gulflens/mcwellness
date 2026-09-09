// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ConsentText } from './ConsentText';

/**
 * The wording renderer (docs/CONSENT). Small, and worth its own tests for two
 * reasons: the front matter is machinery that must never reach the person
 * signing, and the text is the one thing on this screen a lawyer wrote.
 */

afterEach(cleanup);

const WITH_FRONT_MATTER = [
  '---',
  'purpose: participation',
  'locale: en',
  'version: 0.1-draft',
  'status: draft',
  '---',
  '',
  '# Agreement to take part',
  '',
  '**Draft wording, in use until the lawyer approves a final version.**',
  '',
  '## 1. Who we are',
  '',
  'McWellness is a wellness practice.',
  'We do not diagnose or treat anything.',
  '',
  '- You may stop at any time.',
  '- You may ask for a copy of what you signed.',
  '',
  '### Keep seeing your doctor',
  '',
  'Nothing here replaces medical care.',
].join('\n');

describe('ConsentText', () => {
  it('renders the words and never the front matter', () => {
    render(<ConsentText markdown={WITH_FRONT_MATTER} />);
    expect(screen.getByText('Agreement to take part')).toBeTruthy();
    // purpose, locale, version and status are what the row already says; the
    // person signing has no use for them.
    expect(screen.queryByText(/purpose: participation/)).toBeNull();
    expect(screen.queryByText(/^---$/)).toBeNull();
  });

  it('keeps the shape a lawyer gave it: headings, paragraphs, bullets, bold', () => {
    const { container } = render(<ConsentText markdown={WITH_FRONT_MATTER} />);
    // The drawer owns an h2 for the client's name, so the wording starts below
    // it and a screen reader walks the levels in order.
    expect(container.querySelector('h4')?.textContent).toBe('Agreement to take part');
    expect(container.querySelector('h5')?.textContent).toBe('Keep seeing your doctor');
    expect(container.querySelectorAll('li').length).toBe(2);
    expect(container.querySelector('strong')?.textContent).toContain('Draft wording');
    // Consecutive lines are one paragraph, as markdown means them to be.
    expect(
      screen.getByText('McWellness is a wellness practice. We do not diagnose or treat anything.'),
    ).toBeTruthy();
  });

  it('renders Arabic wording as text, not as markup', () => {
    const arabic = [
      '---',
      'locale: ar',
      '---',
      '',
      '# الموافقة على المشاركة',
      '',
      'نص تجريبي.',
    ].join('\n');
    render(<ConsentText markdown={arabic} />);
    expect(screen.getByText('الموافقة على المشاركة')).toBeTruthy();
    expect(screen.getByText('نص تجريبي.')).toBeTruthy();
  });

  it('never turns markup in the file into markup on the page', () => {
    const { container } = render(
      <ConsentText markdown={'# Heading\n\n<script>alert(1)</script>\n\n<b>bold?</b>'} />,
    );
    // Built as React elements, never handed to an HTML parser: a tag in the
    // file is text on the page.
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('<script>alert(1)</script>');
  });

  it('renders a file with no front matter at all', () => {
    render(<ConsentText markdown={'Just a sentence.'} />);
    expect(screen.getByText('Just a sentence.')).toBeTruthy();
  });
});

describe('the practice’s own wording, as filed', () => {
  /**
   * The real file, not a fixture: this renderer exists for these words.
   *
   * Superseded on 2026-09-09 by the approved agreement, and still read from
   * `superseded/` deliberately. A consent names the text it was given against,
   * so the wording a household signed is rendered back to them for as long as
   * that consent stands — the renderer's job does not end when a version does,
   * and the hard-wrapped bullets below are only in the older text.
   */
  const participation = readFileSync('docs/CONSENT/superseded/participation.en.md', 'utf8');

  it('keeps a hard-wrapped bullet in its list', () => {
    render(<ConsentText markdown={participation} />);
    // Section 3 has four bullets and every one of them wraps. Each
    // continuation line used to flush the list and become a paragraph, so the
    // section rendered as four one-item lists with orphan fragments between
    // them — the lawyer's sentences broken in half on screen.
    const heading = screen.getByText(/What a session involves/);
    const list = heading.nextElementSibling;
    expect(list?.tagName).toBe('UL');
    expect(list?.querySelectorAll('li')).toHaveLength(4);
    // The wrapped half is inside its own bullet, not adrift beneath the list.
    expect(list?.querySelectorAll('li')[0]?.textContent).toContain('washes out with water');
  });

  it('renders emphasis as emphasis rather than asterisks', () => {
    render(<ConsentText markdown={'A wellness provider, *not* a medical clinic.'} />);
    expect(screen.getByText('not').tagName).toBe('EM');
    expect(screen.queryByText(/\*not\*/)).toBeNull();
  });
});
