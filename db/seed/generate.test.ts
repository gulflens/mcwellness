import { describe, expect, it } from 'vitest';
import { ageOn, generateSeed, SEED_OWNER_USER_ID, SEED_TENANT_ID, SEED_TODAY } from './generate';
import { isListedFamilyName, isListedGivenName } from './names';

// The same two "looks real" patterns the repository hook uses
// (.claude/hooks/no-real-identifiers.sh), applied to everything the generator emits.
const EMIRATES_ID_LIKE = /784-?(19[0-9]{2}|20[0-9]{2})-?[0-9]{7}-?[0-9]/g;
const UAE_MOBILE_LIKE = /\+?971[ -]?5[0-9][ -]?[0-9]{3}[ -]?[0-9]{4}/g;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const data = generateSeed();
const text = JSON.stringify(data);
const minors = data.clients.filter((c) => ageOn(c.dateOfBirth, data.today) < 18);
const adults = data.clients.filter((c) => ageOn(c.dateOfBirth, data.today) >= 18);

// An independent Luhn check, written right to left, so the generator's own
// arithmetic is not the thing that verifies it.
function passesLuhn(digits: string): boolean {
  let sum = 0;
  for (let i = digits.length - 1, double = false; i >= 0; i--, double = !double) {
    let d = Number(digits[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

describe('generateSeed', () => {
  it('produces the same practice every time', () => {
    expect(JSON.stringify(generateSeed())).toBe(text);
    expect(JSON.stringify(generateSeed({ seed: 1 }))).not.toBe(text);
  });

  it('builds one practice, six logins, three practitioners, six services and twenty clients', () => {
    expect(data.tenant.id).toBe(SEED_TENANT_ID);
    expect(data.users).toHaveLength(6);
    expect(data.users[0]?.id).toBe(SEED_OWNER_USER_ID);
    expect(data.practitioners).toHaveLength(3);
    expect(data.serviceTypes).toHaveLength(6);
    expect(data.clients).toHaveLength(20);
    // Five of the six services are priced; Compassionate Inquiry deliberately is not.
    expect(data.prices).toHaveLength(5);
    expect(data.packages).toHaveLength(3);
    expect(data.today).toBe(SEED_TODAY);
    expect(data.roles.filter((r) => r.role === 'owner')).toHaveLength(1);
    expect(data.roles.filter((r) => r.role === 'admin')).toHaveLength(2);
  });

  it('splits the clients into twelve adults and eight minors with a spread of statuses', () => {
    expect(adults).toHaveLength(12);
    expect(minors).toHaveLength(8);
    const byStatus = (s: string) => data.clients.filter((c) => c.status === s).length;
    expect([byStatus('lead'), byStatus('active'), byStatus('paused'), byStatus('closed')]).toEqual([
      4, 12, 2, 2,
    ]);
    expect(data.clients.filter((c) => c.preferredLocale === 'ar')).toHaveLength(8);
    for (const client of data.clients.filter((c) => c.preferredLocale === 'ar')) {
      expect(client.givenNameAr).not.toBeNull();
      expect(client.familyNameAr).not.toBeNull();
    }
  });

  it('keeps every phone, email and Emirates ID inside the reserved fake ranges', () => {
    const phones = [...data.users.map((u) => u.phone), ...data.contacts.map((c) => c.phone)];
    for (const p of phones) expect(p).toMatch(/^\+97150000[0-9]{4}$/);
    expect(new Set(phones).size).toBe(phones.length);
    const emails = [...data.users.map((u) => u.email), ...data.contacts.map((c) => c.email)];
    for (const e of emails) expect(e).toMatch(/^[a-z0-9.]+@example\.com$/);
    for (const c of data.contacts.filter((c) => c.emiratesId !== null)) {
      expect(c.emiratesId).toMatch(/^784-1900-[0-9]{7}-[0-9]$/);
      expect(passesLuhn(c.emiratesId?.replace(/\D/g, '') ?? '')).toBe(true);
    }
    for (const match of text.match(EMIRATES_ID_LIKE) ?? []) expect(match).toMatch(/^784-1900-/);
    for (const match of text.match(UAE_MOBILE_LIKE) ?? []) expect(match).toMatch(/^\+97150000/);
  });

  it('names every person from the fixed fictional lists', () => {
    for (const c of data.clients) {
      expect(isListedGivenName(c.givenName)).toBe(true);
      expect(isListedFamilyName(c.familyName)).toBe(true);
      if (c.givenNameAr !== null) expect(isListedGivenName(c.givenNameAr)).toBe(true);
    }
    for (const u of data.users) {
      const [given, family] = u.displayName.split(' ');
      expect(isListedGivenName(given ?? '')).toBe(true);
      expect(isListedFamilyName(family ?? '')).toBe(true);
    }
    for (const c of data.contacts) {
      expect(isListedGivenName(c.givenName)).toBe(true);
      expect(isListedFamilyName(c.familyName)).toBe(true);
      if (c.givenNameAr !== null) expect(isListedGivenName(c.givenNameAr)).toBe(true);
      if (c.familyNameAr !== null) expect(isListedFamilyName(c.familyNameAr)).toBe(true);
    }
  });

  it('names each contact as part of their own household, in the language it reads', () => {
    for (const client of data.clients) {
      const household = data.contacts.filter((c) => c.clientId === client.id);
      expect(household.length).toBeGreaterThan(0);
      for (const contact of household) {
        // One family name across the household: a mother and her child share it.
        expect(contact.familyName, contact.id).toBe(client.familyName);
        // Arabic wherever the client carries Arabic, and nowhere else.
        expect(contact.familyNameAr, contact.id).toBe(client.familyNameAr);
        if (client.givenNameAr === null) expect(contact.givenNameAr, contact.id).toBeNull();
        else expect(contact.givenNameAr, contact.id).not.toBeNull();
        // An adult is their own contact and carries their own name; a parent
        // is somebody else, and is never the child under another relationship.
        if (contact.relationship === 'self') {
          expect(contact.givenName).toBe(client.givenName);
          expect(contact.givenNameAr).toBe(client.givenNameAr);
        } else {
          expect(contact.givenName).not.toBe(client.givenName);
        }
      }
      // Two parents are two people, not one name twice.
      const givenNames = household.map((c) => c.givenName);
      expect(new Set(givenNames).size).toBe(givenNames.length);
    }
  });

  it('gives every minor a consenting legal guardian, with an Emirates ID only once they have consented', () => {
    for (const minor of minors) {
      const guardians = data.contacts.filter(
        (c) => c.clientId === minor.id && c.isLegalGuardian && c.canConsent,
      );
      expect(guardians).toHaveLength(1);
      if (minor.status === 'lead') expect(guardians[0]?.emiratesId).toBeNull();
      else expect(guardians[0]?.emiratesId).not.toBeNull();
      expect(minor.primaryContactId).toBe(guardians[0]?.id);
    }
    const holders = data.contacts.filter((c) => c.emiratesId !== null);
    expect(holders).toHaveLength(minors.filter((m) => m.status !== 'lead').length);
    for (const holder of holders) {
      expect(holder.isLegalGuardian && holder.canConsent).toBe(true);
      expect(minors.some((m) => m.id === holder.clientId)).toBe(true);
    }
    for (const adult of adults) {
      const self = data.contacts.filter((c) => c.clientId === adult.id);
      expect(self).toHaveLength(1);
      expect(self[0]?.relationship).toBe('self');
    }
  });

  it('gives every client who was ever active the consents the activation rule requires', () => {
    for (const client of data.clients) {
      const purposes = data.consents
        .filter((c) => c.clientId === client.id && c.status === 'active')
        .map((c) => c.purpose);
      if (client.status === 'lead') {
        expect(purposes).toEqual([]);
        continue;
      }
      expect(purposes).toContain('participation');
      expect(purposes).toContain('home_visit');
      if (ageOn(client.dateOfBirth, data.today) < 18)
        expect(purposes).toContain('minor_participation');
      expect(data.locations.some((l) => l.id === client.primaryLocationId)).toBe(true);
    }
    expect(data.consents.filter((c) => c.status === 'withdrawn')).toHaveLength(1);
    for (const consent of data.consents) {
      expect(data.documents.some((d) => d.id === consent.textDocumentId)).toBe(true);
      expect(data.contacts.some((c) => c.id === consent.givenByContactId)).toBe(true);
    }
  });

  it('numbers the records MW-000001 to MW-000020 and never repeats an id', () => {
    expect(data.clients.map((c) => c.mrn)).toEqual(
      Array.from({ length: 20 }, (_, i) => `MW-${String(i + 1).padStart(6, '0')}`),
    );
    const ids = [
      data.tenant.id,
      ...data.users.flatMap((u) => [u.id, u.authId]),
      ...data.roles.map((r) => r.id),
      ...data.serviceTypes.map((s) => s.id),
      ...data.prices.map((p) => p.id),
      ...data.packages.flatMap((p) => [p.id, p.price.id, ...p.components.map((c) => c.id)]),
      ...data.practitioners.map((p) => p.id),
      ...data.credentials.map((c) => c.id),
      ...data.locations.map((l) => l.id),
      ...data.clients.map((c) => c.id),
      ...data.contacts.map((c) => c.id),
      ...data.documents.map((d) => d.id),
      ...data.consents.map((c) => c.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(UUID_V4);
  });

  it("carries the practice's own prices, net, and no service priced twice", () => {
    const priced = new Map(data.prices.map((p) => [p.serviceTypeId, p.unitPriceFils]));
    expect(priced.size).toBe(data.prices.length);
    const fils = (code: string): number => {
      const service = data.serviceTypes.find((s) => s.code === code);
      const found = service === undefined ? undefined : priced.get(service.id);
      if (found === undefined) throw new Error(`No price for ${code}.`);
      return found;
    };
    // The founder's decisions of 2026-09-03, net of VAT.
    expect(fils('nf-session')).toBe(70_000);
    expect(fils('brain-map')).toBe(82_500);
    // Included in something else and never billed: zero, not absent.
    expect(fils('consultation')).toBe(0);
    expect(fils('results-call')).toBe(0);
    expect(fils('discovery-call')).toBe(0);
    // Compassionate Inquiry has no figure yet, and so has no row.
    const inquiry = data.serviceTypes.find((s) => s.code === 'compassionate-inquiry');
    expect(priced.has(inquiry?.id ?? '')).toBe(false);
    for (const price of data.prices) {
      expect(price.vatRateBasisPoints).toBe(500);
      expect(price.vatSettingVersion).toBe(1);
      expect(price.validFrom < data.today).toBe(true);
    }
  });

  it("prices each programme at its contents' total, and sells it for the founder's own figure", () => {
    expect(data.packages.map((p) => p.code)).toEqual(['silver', 'gold', 'platinum']);
    const unit = (serviceTypeId: string): number => {
      const found = data.prices.find((p) => p.serviceTypeId === serviceTypeId);
      if (found === undefined) throw new Error('A component has no price.');
      return found.unitPriceFils;
    };
    const listed = [1_215_000, 1_997_500, 3_130_000];
    const selling = [1_032_500, 1_697_500, 2_660_500];
    data.packages.forEach((bundle, i) => {
      // The list price is what the contents come to one at a time: the screen
      // shows both figures, and a bundle whose parts do not add up is a drift
      // warning there, so the seed must not be the thing that raises one.
      const total = bundle.components.reduce(
        (sum, c) => sum + c.quantity * unit(c.serviceTypeId),
        0,
      );
      expect(bundle.listPriceFils, bundle.code).toBe(total);
      expect(bundle.listPriceFils, bundle.code).toBe(listed[i]);
      expect(bundle.price.amountFils, bundle.code).toBe(selling[i]);
      expect(bundle.price.amountFils).toBeLessThan(bundle.listPriceFils);
      expect(bundle.price.amendmentReason).toContain('Launch pricing');
      expect(bundle.expiryMonths).toBe(12);
      expect(bundle.components.map((c) => c.lineNo)).toEqual([1, 2, 3]);
      for (const component of bundle.components) expect(component.packageId).toBe(bundle.id);
    });
  });

  it('places a home in every emirate, with a Makani number only in Dubai', () => {
    const homes = data.locations.filter((l) => l.label === 'home');
    expect(homes).toHaveLength(20);
    expect(new Set(homes.map((l) => l.emirate)).size).toBe(7);
    for (const home of homes) {
      if (home.emirate === 'DXB') expect(home.makaniNumber).toMatch(/^[0-9]{10}$/);
      else expect(home.makaniNumber).toBeNull();
    }
    expect(
      data.credentials.filter((c) => c.validTo !== null && c.validTo < data.today),
    ).toHaveLength(1);
  });
});
