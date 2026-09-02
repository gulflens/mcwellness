/**
 * The fixed fictional name lists. Given names are words that read as names,
 * family names are landscape words, and the Arabic columns are the Arabic words
 * for the same things: nothing here can be mistaken for a real family. Every
 * synthetic person in this repository is named from these lists and nowhere
 * else (.claude/rules/testing.md).
 */

export type Name = { en: string; ar: string };

export const GIVEN_NAMES: readonly Name[] = [
  { en: 'Amber', ar: 'عنبر' },
  { en: 'Basil', ar: 'ريحان' },
  { en: 'Cedar', ar: 'أرز' },
  { en: 'Clover', ar: 'برسيم' },
  { en: 'Dahlia', ar: 'داليا' },
  { en: 'Ember', ar: 'جمرة' },
  { en: 'Fern', ar: 'سرخس' },
  { en: 'Hazel', ar: 'بندق' },
  { en: 'Iris', ar: 'سوسن' },
  { en: 'Jasper', ar: 'يشب' },
  { en: 'Juniper', ar: 'عرعر' },
  { en: 'Laurel', ar: 'غار' },
  { en: 'Maple', ar: 'قيقب' },
  { en: 'Olive', ar: 'زيتون' },
  { en: 'Pearl', ar: 'لؤلؤة' },
  { en: 'Reed', ar: 'قصب' },
  { en: 'Rowan', ar: 'غبيراء' },
  { en: 'Saffron', ar: 'زعفران' },
  { en: 'Sage', ar: 'مريمية' },
  { en: 'Willow', ar: 'صفصاف' },
] as const;

export const FAMILY_NAMES: readonly Name[] = [
  { en: 'Bay', ar: 'خليج' },
  { en: 'Cliff', ar: 'جرف' },
  { en: 'Creek', ar: 'خور' },
  { en: 'Dune', ar: 'كثيب' },
  { en: 'Harbour', ar: 'مرفأ' },
  { en: 'Lagoon', ar: 'بحيرة' },
  { en: 'Meadow', ar: 'مرج' },
  { en: 'Orchard', ar: 'بستان' },
  { en: 'Quarry', ar: 'محجر' },
  { en: 'Ridge', ar: 'حافة' },
  { en: 'Summit', ar: 'قمة' },
  { en: 'Valley', ar: 'وادي' },
] as const;

export function isListedGivenName(name: string): boolean {
  return GIVEN_NAMES.some((n) => n.en === name || n.ar === name);
}

export function isListedFamilyName(name: string): boolean {
  return FAMILY_NAMES.some((n) => n.en === name || n.ar === name);
}
