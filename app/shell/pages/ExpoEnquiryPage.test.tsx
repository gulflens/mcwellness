// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExpoEnquiryPage } from './ExpoEnquiryPage';

/**
 * The expo form, as a visitor's phone runs it: what it sends, what it refuses
 * to send, and what it says back. Synthetic throughout (.claude/rules/testing.md).
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function mount(answer: () => Promise<Response> = async () => json({ ok: true })) {
  const posts: { url: string; body: Record<string, unknown> }[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    posts.push({ url: String(input), body: JSON.parse(String(init?.body)) });
    return answer();
  });
  vi.stubGlobal('fetch', fetchImpl);
  render(<ExpoEnquiryPage />);
  return { posts };
}

function fillIn() {
  fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Rowan Meadow' } });
  fireEvent.change(screen.getByLabelText('WhatsApp number'), { target: { value: '50 000 0098' } });
  fireEvent.change(screen.getByLabelText('Where you live (optional)'), {
    target: { value: 'Mirdif' },
  });
  fireEvent.change(screen.getByLabelText('Who are you asking for?'), {
    target: { value: 'child' },
  });
  fireEvent.change(screen.getByLabelText('What are you interested in?'), {
    target: { value: 'both' },
  });
  fireEvent.change(screen.getByLabelText('What would you like to know? (optional)'), {
    target: { value: 'Saw the stand' },
  });
}

const agree = () =>
  fireEvent.click(
    screen.getByLabelText(
      'By submitting, you agree to be contacted by McWellness about your enquiry.',
    ),
  );

describe('ExpoEnquiryPage', () => {
  it('sends what the visitor typed as an expo enquiry, with the trap empty', async () => {
    const { posts } = mount();
    fillIn();
    agree();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({
      url: '/api/enquiries',
      body: {
        source: 'expo',
        name: 'Rowan Meadow',
        phone: '+971500000098',
        email: '',
        area: 'Mirdif',
        enquiring_for: 'child',
        interest: 'both',
        message: 'Saw the stand',
        consent: 'on',
        // The wording this form shows, so the practice knows what this person
        // was told; and the optional tick, left alone.
        notice: 2,
        marketing: '',
        website: '',
      },
    });
  });

  it('says the details are kept and can be deleted, and no longer that an enquiry keeps nothing', () => {
    mount();
    expect(screen.getByText(/we keep them so we can follow up with you later/)).toBeTruthy();
    expect(screen.getByText(/You can ask us to delete them at any time/)).toBeTruthy();
    // The earlier promise. A form that showed it must not be one that says `notice: 2`.
    expect(screen.queryByText(/keeps nothing personal/)).toBeNull();
  });

  it('asks about news separately, leaves it unticked, and does not need it to send', async () => {
    const { posts } = mount();
    const news = screen.getByRole('checkbox', {
      name: 'Keep me posted about McWellness news and offers, including on social media.',
    }) as HTMLInputElement;
    expect(news.checked).toBe(false);
    expect(news.required).toBe(false);
    fillIn();
    agree();
    // Sendable without it: agreeing to be rung back is not agreeing to be marketed to.
    expect(screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')).toBe(false);
    fireEvent.click(news);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]?.body).toMatchObject({ notice: 2, marketing: 'on', consent: 'on' });
  });

  it('will not send until the box is ticked', () => {
    const { posts } = mount();
    fillIn();
    const send = screen.getByRole('button', { name: 'Send' });
    expect(send.hasAttribute('disabled')).toBe(true);
    fireEvent.click(send);
    expect(posts).toHaveLength(0);
    agree();
    expect(send.hasAttribute('disabled')).toBe(false);
  });

  it('marks the fields it needs before asking the door, and the ones the door says are missing', async () => {
    const { posts } = mount(async () =>
      json({ error: 'incomplete', missing: ['phone'], requestId: 'x' }, 400),
    );
    agree();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(screen.getByText('Please check the fields marked.')).toBeTruthy();
    expect(screen.getByText('Please tell us your name.')).toBeTruthy();
    expect(screen.getByText('Please give a number we can reach you on.')).toBeTruthy();
    expect(screen.getAllByText('Please choose one.')).toHaveLength(2);
    expect(posts).toHaveLength(0);

    fillIn();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(await screen.findByText('Please give a number we can reach you on.')).toBeTruthy();
    expect(screen.queryByText('Please tell us your name.')).toBeNull();
  });

  it('says thank you and offers to send another', async () => {
    mount();
    fillIn();
    agree();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('heading', { name: 'Thank you' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Send another' }));
    expect(screen.getByRole('heading', { name: 'Good to meet you' })).toBeTruthy();
    expect((screen.getByLabelText('Your name') as HTMLInputElement).value).toBe('');
  });

  it('says to try again when the door is unavailable', async () => {
    mount(async () => json({ ok: false }, 503));
    fillIn();
    agree();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(
      await screen.findByText('That did not go through. Please try again, or ask us at the stand.'),
    ).toBeTruthy();
  });

  it('links the privacy policy in a new tab and names the app as the sender of nothing', () => {
    mount();
    const link = screen.getByRole('link', { name: 'privacy policy' });
    expect(link.getAttribute('href')).toBe('https://mcwellnessuae.com/privacy.html');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });
});
