// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgreementsScreen } from '../../app/client/AgreementsScreen';
import { FamilyScreen } from '../../app/client/FamilyScreen';
import { HomeScreen } from '../../app/client/HomeScreen';
import { MoneyScreen } from '../../app/client/MoneyScreen';
import { VisitsScreen } from '../../app/client/VisitsScreen';
import {
  AGREEMENTS,
  CHILD_A,
  FAMILY,
  HOME,
  HOME_NO_MONEY,
  MONEY,
  MOTHER_CONTACT,
  VISITS,
  alone,
} from './fixtures';
import { forgetLanguage, json, mountPortal, mountPortalAt } from './harness';

/**
 * The five screens, against a fake API, in English and in Arabic
 * (docs/SPEC/client-portal.md section 13).
 *
 * Each screen is asked three questions: does it render what the household is
 * entitled to see, does it say nothing it should not, and does it read in both
 * languages with the layout mirrored. The loading, empty and error states are
 * asked of the screens where they differ; the shape is the same everywhere,
 * because `usePortalRead` is the one place they are decided.
 */

afterEach(cleanup);
beforeEach(forgetLanguage);

/** Home is read by the root, so a screen test hands it to the screen's context. */
function withHome(answers: Record<string, () => Response> = {}) {
  return { '/api/portal/home': () => json(HOME), ...answers };
}

describe('Home', () => {
  it('shows the next visit, the money and what is waiting, in English', async () => {
    mountPortal(<HomeScreen />, { answers: withHome() });
    expect(await screen.findByText('Your next visit')).toBeTruthy();
    // The arrival window, both ends, never a point time.
    expect(await screen.findByText('10:00 to 10:45')).toBeTruthy();
    expect(screen.getByText('At home')).toBeTruthy();
    // Owed for one child, in credit for the other; the figure is bare and the
    // currency is named once by the section.
    expect(screen.getByText('Owed')).toBeTruthy();
    expect(screen.getByText('1,000.00')).toBeTruthy();
    expect(screen.getByText('In credit')).toBeTruthy();
    expect(screen.getByText('Session 1 of 2')).toBeTruthy();
    expect(screen.getByText(/A newer version of this wording exists/)).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Message the practice' })).toBeTruthy();
  });

  it('reads right to left in Arabic, with the same facts', async () => {
    const { container } = mountPortal(<HomeScreen />, { locale: 'ar', answers: withHome() });
    expect(await screen.findByText('زيارتك القادمة')).toBeTruthy();
    expect(screen.getByText('في المنزل')).toBeTruthy();
    expect(screen.getByText('الجلسة 1 من 2')).toBeTruthy();
    expect(screen.getByText('راسل المركز')).toBeTruthy();
    // A mirrored layout, declared once on the portal's own root.
    const root = container.querySelector('.portal');
    expect(root?.getAttribute('dir')).toBe('rtl');
    expect(root?.getAttribute('lang')).toBe('ar');
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('says nothing is booked rather than leaving a gap', async () => {
    mountPortal(<HomeScreen />, {
      answers: withHome({ '/api/portal/home': () => json({ ...HOME, nextVisit: null }) }),
    });
    expect(await screen.findByText('Nothing is booked at the moment.')).toBeTruthy();
  });

  it('offers no button when the practice has recorded no number', async () => {
    mountPortal(<HomeScreen />, {
      answers: {
        '/api/portal/home': () =>
          json({ ...HOME, practice: { ...HOME.practice, whatsappNumber: null } }),
      },
    });
    expect(await screen.findByText(/has not recorded a WhatsApp number/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Message the practice' })).toBeNull();
  });

  it("shows a young person's own login no figure at all", async () => {
    mountPortal(<HomeScreen />, {
      answers: {
        '/api/portal/home': () =>
          json({
            ...HOME,
            clients: [{ ...HOME.clients[0], moneyVisible: false }],
            money: [],
          }),
      },
    });
    expect(await screen.findByText('Your next visit')).toBeTruthy();
    expect(screen.queryByText('Owed')).toBeNull();
    expect(screen.queryByText('1,000.00')).toBeNull();
  });

  it('says so, once, when it cannot be loaded', async () => {
    mountPortal(<HomeScreen />, {
      answers: { '/api/portal/home': () => json({ error: 'internal' }, 500) },
    });
    expect(await screen.findByText('That could not be loaded. Try again.')).toBeTruthy();
  });
});

describe('Visits', () => {
  it('splits upcoming from past and names the outcome, in English', async () => {
    mountPortal(<VisitsScreen />, { answers: { '/api/portal/visits': () => json(VISITS) } });
    expect(await screen.findByText('Upcoming')).toBeTruthy();
    expect(screen.getByText('Past')).toBeTruthy();
    expect(screen.getByText('Completed')).toBeTruthy();
    // A late cancellation reads as "Cancelled" and nothing more.
    expect(screen.getByText('Cancelled')).toBeTruthy();
    expect(screen.queryByText(/late/i)).toBeNull();
  });

  it('names the outcome in Arabic too', async () => {
    mountPortal(<VisitsScreen />, {
      locale: 'ar',
      answers: { '/api/portal/visits': () => json(VISITS) },
    });
    expect(await screen.findByText('القادمة')).toBeTruthy();
    expect(screen.getByText('تمت')).toBeTruthy();
    expect(screen.getByText('ملغاة')).toBeTruthy();
  });

  it('heads each block with the client when a household has several', async () => {
    mountPortal(<VisitsScreen />, { answers: { '/api/portal/visits': () => json(VISITS) } });
    // Once under Upcoming and once under Past: two lists, both sectioned.
    expect((await screen.findAllByText('Cedar Meadow')).length).toBe(2);
    expect(screen.getAllByText('Clover Meadow').length).toBe(1);
  });

  it('leaves the heading off a household of one', async () => {
    const one = {
      ...alone(VISITS),
      past: VISITS.past.filter((visit) => visit.clientId === CHILD_A),
    };
    mountPortal(<VisitsScreen />, { answers: { '/api/portal/visits': () => json(one) } });
    expect(await screen.findByText('Upcoming')).toBeTruthy();
    expect(screen.queryByText('Cedar Meadow')).toBeNull();
  });

  it('says nothing is booked rather than showing an empty list', async () => {
    mountPortal(<VisitsScreen />, {
      answers: { '/api/portal/visits': () => json({ ...VISITS, upcoming: [], past: [] }) },
    });
    expect(await screen.findByText('No visits are booked.')).toBeTruthy();
    expect(screen.getByText('No visits yet.')).toBeTruthy();
  });
});

describe('Money', () => {
  it('shows what is owed, the programme and the papers', async () => {
    mountPortal(<MoneyScreen />, { answers: { '/api/portal/money': () => json(MONEY) } });
    expect(await screen.findByText('Amounts in AED')).toBeTruthy();
    expect(screen.getByText('1,000.00')).toBeTruthy();
    expect(screen.getByText('Session 1 of 2')).toBeTruthy();
    expect(screen.getByText('INV-000001')).toBeTruthy();
    expect(screen.getByText('Bank transfer')).toBeTruthy();
    expect(screen.getByText('RCT-000001')).toBeTruthy();
  });

  it('says a forgiven charge was forgiven, with the day, and leaves the figure on the row', () => {
    mountPortal(<MoneyScreen />, { answers: { '/api/portal/money': () => json(MONEY) } });
    // The waived fee: the word, the day the practice let it go, and the amount
    // still standing beside it (billing-06.md request 1).
    return waitFor(() => {
      expect(screen.getByText('Waived 21 August 2026')).toBeTruthy();
      expect(screen.getByText('150.00')).toBeTruthy();
      // And the ordinary invoice above it says nothing of the kind: one row
      // carries the word, not the list.
      expect(screen.getAllByText(/^Waived/)).toHaveLength(1);
    });
  });

  it('opens a document through a link fetched when the button is pressed', async () => {
    const { calls } = mountPortal(<MoneyScreen />, {
      answers: {
        '/api/portal/money': () => json(MONEY),
        '/api/portal/documents': () =>
          json({ url: '/api/storage/a-key?token=x&expires=1', expiresInSeconds: 300 }),
      },
    });
    const open = await screen.findByRole('button', { name: 'Open' });
    // Nothing is fetched until it is pressed: a link in the markup is a link
    // in a screenshot.
    expect(calls.some((call) => call.path.includes('/documents/'))).toBe(false);
    fireEvent.click(open);
    await waitFor(() => expect(calls.some((call) => call.path.includes('/documents/'))).toBe(true));
  });

  it('says so when this screen is not the person’s to open', async () => {
    mountPortal(<MoneyScreen />, {
      answers: {
        '/api/portal/money': () => json({ error: 'forbidden', code: 'money_not_shown' }, 403),
      },
    });
    expect(await screen.findByText('This part of the record is not yours to open.')).toBeTruthy();
  });

  it('reads in Arabic', async () => {
    mountPortal(<MoneyScreen />, {
      locale: 'ar',
      answers: { '/api/portal/money': () => json(MONEY) },
    });
    expect(await screen.findByText('المبالغ بالدرهم')).toBeTruthy();
    expect(screen.getByText('الفواتير')).toBeTruthy();
    expect(screen.getByText('حوالة بنكية')).toBeTruthy();
    // The forgiven fee, in the word the rendered invoice uses for it.
    expect(screen.getByText(/أُعفي بتاريخ/)).toBeTruthy();
  });

  it('is not offered at all where nobody on the record is shown money', async () => {
    // A young person's own login. No tab, and the path itself lands on Home:
    // the screen is absent rather than present and refusing (section 3.3).
    mountPortalAt('/portal/money', {
      answers: { '/api/portal/home': () => json(HOME_NO_MONEY) },
    });
    expect(await screen.findByText('Your next visit')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Money' })).toBeNull();
    expect(screen.queryByText('Amounts in AED')).toBeNull();
    // The four screens that are theirs are all still there.
    for (const tab of ['Home', 'Visits', 'Family', 'Agreements']) {
      expect(screen.getByRole('link', { name: tab })).toBeTruthy();
    }
  });

  it('is not offered in Arabic either, and lands on Home the same way', async () => {
    mountPortalAt('/portal/money', {
      locale: 'ar',
      answers: { '/api/portal/home': () => json(HOME_NO_MONEY) },
    });
    expect(await screen.findByText('زيارتك القادمة')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'الحساب' })).toBeNull();
    expect(screen.getByRole('link', { name: 'الزيارات' })).toBeTruthy();
  });
});

describe('Family', () => {
  it('shows the address as a line, read-only, and says why', async () => {
    mountPortal(<FamilyScreen />, { answers: { '/api/portal/family': () => json(FAMILY) } });
    expect(await screen.findByText('Villa 1, Street 2, Synthetic Community, Dubai')).toBeTruthy();
    // One per client: the sentence belongs beside the address it explains.
    expect(screen.getAllByText(/The practice changes the address/).length).toBe(2);
    // And never what the practitioner navigates by.
    expect(screen.queryByText(/Makani/i)).toBeNull();
    expect(screen.queryByText(/Ring twice/)).toBeNull();
  });

  it('marks the signed-in person’s own row and gives it the one form', async () => {
    mountPortal(<FamilyScreen />, { answers: { '/api/portal/family': () => json(FAMILY) } });
    expect(await screen.findByText('This is you')).toBeTruthy();
    expect(screen.getByLabelText('Telephone')).toBeTruthy();
    expect(screen.getByLabelText('Email')).toBeTruthy();
    expect(screen.getByLabelText('Happy to be messaged on WhatsApp')).toBeTruthy();
    // The other parent's row has no form of its own.
    expect(screen.getAllByRole('button', { name: 'Save' })).toHaveLength(1);
  });

  it('saves the three fields and says so', async () => {
    const { calls } = mountPortal(<FamilyScreen />, {
      answers: {
        '/api/portal/family': () => json(FAMILY),
        '/api/portal/contacts': () => json({ id: MOTHER_CONTACT }),
      },
    });
    fireEvent.change(await screen.findByLabelText('Telephone'), {
      target: { value: '+971500000031' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Saved.')).toBeTruthy();

    const save = calls.find((call) => call.path.includes('/api/portal/contacts/'));
    expect(save?.init?.method).toBe('PATCH');
    expect(JSON.parse(String(save?.init?.body))).toEqual({
      phone: '+971500000031',
      email: 'hazel.meadow@example.com',
      whatsappOptIn: true,
    });
  });

  it('says which field was refused, in that field', async () => {
    mountPortal(<FamilyScreen />, {
      answers: {
        '/api/portal/family': () => json(FAMILY),
        '/api/portal/contacts': () => json({ error: 'bad_request', code: 'phone' }, 400),
      },
    });
    fireEvent.change(await screen.findByLabelText('Telephone'), {
      target: { value: 'not a number' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('A telephone number is +971 50 000 0000.')).toBeTruthy();
  });

  it('reads in Arabic', async () => {
    mountPortal(<FamilyScreen />, {
      locale: 'ar',
      answers: { '/api/portal/family': () => json(FAMILY) },
    });
    expect((await screen.findAllByText('الأشخاص في السجل')).length).toBe(2);
    expect(screen.getByText('الأم')).toBeTruthy();
    expect(screen.getByLabelText('الهاتف')).toBeTruthy();
  });
});

describe('Agreements', () => {
  it('says what was agreed, by whom, and that a newer wording exists', async () => {
    mountPortal(<AgreementsScreen />, {
      answers: { '/api/portal/agreements': () => json(AGREEMENTS) },
    });
    expect(await screen.findByText('taking part as a minor')).toBeTruthy();
    expect(screen.getByText('photos and video')).toBeTruthy();
    expect(screen.getAllByText('mother').length).toBeGreaterThan(0);
    expect(screen.getByText(/A newer version of this wording exists/)).toBeTruthy();
  });

  it('offers to ask, and asks nothing until the form is sent', async () => {
    const { calls } = mountPortal(<AgreementsScreen />, {
      answers: {
        '/api/portal/agreements': () => json(AGREEMENTS),
        '/api/portal/requests': () =>
          json({ request: { id: '00000001-0000-4000-8000-000000000041' } }, 201),
      },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Ask to withdraw' }));
    // The form is open and the screen says plainly that nothing has happened.
    expect(
      screen.getByText('Nothing here withdraws or erases anything. The practice will be in touch.'),
    ).toBeTruthy();
    expect(calls.some((call) => call.path === '/api/portal/requests')).toBe(false);

    fireEvent.change(screen.getByLabelText(/Tell the practice/), {
      target: { value: 'We would like to stop the photographs, please.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() =>
      expect(calls.some((call) => call.path === '/api/portal/requests')).toBe(true),
    );
    const sent = calls.find((call) => call.path === '/api/portal/requests');
    expect(JSON.parse(String(sent?.init?.body))).toMatchObject({
      kind: 'consent_withdrawal',
      clientId: CHILD_A,
    });
  });

  it('says the practice already has the ask rather than offering it twice', async () => {
    mountPortal(<AgreementsScreen />, {
      answers: {
        '/api/portal/agreements': () =>
          json({
            ...AGREEMENTS,
            agreements: [{ ...AGREEMENTS.agreements[0], requestedWithdrawal: true }],
            erasureRequested: [CHILD_A],
          }),
      },
    });
    expect((await screen.findAllByText('The practice has your request.')).length).toBeGreaterThan(
      0,
    );
    expect(screen.queryByRole('button', { name: 'Ask to withdraw' })).toBeNull();
  });

  it('reads in Arabic', async () => {
    mountPortal(<AgreementsScreen />, {
      locale: 'ar',
      answers: { '/api/portal/agreements': () => json(AGREEMENTS) },
    });
    expect(await screen.findByText('مشاركة قاصر')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'اطلب السحب' }).length).toBe(1);
    expect(screen.getAllByRole('button', { name: 'اطلب محو السجل' }).length).toBe(2);
  });
});

describe('the language switch', () => {
  it('changes the whole portal, and is remembered in this browser', async () => {
    const { unmount } = mountPortal(<HomeScreen />, { answers: withHome() });
    expect(await screen.findByText('Your next visit')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'العربية' }));
    expect(await screen.findByText('زيارتك القادمة')).toBeTruthy();
    unmount();

    // Opened again — the person's own record still says English, and the
    // browser's own choice wins over it (docs/SPEC/client-portal.md 12).
    mountPortal(<HomeScreen />, { answers: withHome() });
    expect(await screen.findByText('زيارتك القادمة')).toBeTruthy();
  });
});
