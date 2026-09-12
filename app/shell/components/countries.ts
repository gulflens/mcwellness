/**
 * The country table a phone selector is driven with.
 *
 * This is presentation data, not a domain rule, which is why it lives here
 * and not in `domain/`: `domain/shared/phone.ts`'s `splitE164` takes dialling
 * codes as a plain `readonly string[]` argument precisely so that no country
 * list needs to live beside it. Nothing here is a rule about what a phone
 * number means — that rule (the leading-zero strip, the join, the split) is
 * already committed and tested in `domain/shared/phone.ts`.
 *
 * Order matters, but only for the dropdown. The UAE leads, the rest of the
 * GCC follows, then every other country and territory is alphabetical by
 * common English name — that is the order a country selector lists them in.
 * It is deliberately NOT the order used to read a dialling code backwards
 * (`countryForDialling`, below): several codes have more than one member
 * (`+1` for the United States, Canada and about two dozen Caribbean and
 * Atlantic territories; `+7` for Russia and Kazakhstan; a few smaller ones),
 * and alphabetically-first is rarely who anyone means — it would draw
 * Guernsey's flag beside a London mobile. `countryForDialling` consults an
 * explicit `CANONICAL` table first and only falls back to table order
 * (effectively arbitrary) for codes nobody has had to pick a default for.
 * `splitE164` (`domain/shared/phone.ts`) never returns a country at all —
 * only the code string and the remainder — so none of this affects it.
 */

export type Country = { iso: string; name: string; dialling: string; flag: string };

/** The two regional-indicator code points an ISO pair maps to. */
function flagOf(iso: string): string {
  return String.fromCodePoint(
    ...Array.from(iso.toUpperCase()).map((c) => 0x1f1e6 + (c.charCodeAt(0) - 65)),
  );
}

/**
 * The full ITU-T E.164 assignment list, common English names, ASCII spelling
 * throughout (a fast-reading staff console gains nothing from "Curaçao" over
 * "Curacao" and loses a class of copy-paste mismatches). A few things this
 * list deliberately does NOT include, because the code would be a guess
 * rather than an assignment:
 *
 * - Vatican City: ITU reserved it +379, but that range was never activated —
 *   every real Vatican number dials out as Italy's +39. Including +379 would
 *   be a country flag on a number nobody actually has.
 * - Western Sahara: no separate ITU assignment; numbers there dial as
 *   Morocco's +212.
 * - Christmas Island, Cocos (Keeling) Islands, Svalbard and Jan Mayen, Åland:
 *   each shares its parent's calling code with no distinguishing range of its
 *   own, unlike (say) Guernsey or Puerto Rico, which do have distinguishing
 *   ranges under a shared country code. Left out to match how phone-country
 *   pickers elsewhere draw this same line.
 */
const ROWS: readonly [iso: string, name: string, dialling: string][] = [
  ['AE', 'United Arab Emirates', '+971'],
  ['SA', 'Saudi Arabia', '+966'],
  ['QA', 'Qatar', '+974'],
  ['BH', 'Bahrain', '+973'],
  ['KW', 'Kuwait', '+965'],
  ['OM', 'Oman', '+968'],
  ['AF', 'Afghanistan', '+93'],
  ['AL', 'Albania', '+355'],
  ['DZ', 'Algeria', '+213'],
  ['AS', 'American Samoa', '+1'],
  ['AD', 'Andorra', '+376'],
  ['AO', 'Angola', '+244'],
  ['AI', 'Anguilla', '+1'],
  ['AG', 'Antigua and Barbuda', '+1'],
  ['AR', 'Argentina', '+54'],
  ['AM', 'Armenia', '+374'],
  ['AW', 'Aruba', '+297'],
  ['AU', 'Australia', '+61'],
  ['AT', 'Austria', '+43'],
  ['AZ', 'Azerbaijan', '+994'],
  ['BS', 'Bahamas', '+1'],
  ['BD', 'Bangladesh', '+880'],
  ['BB', 'Barbados', '+1'],
  ['BY', 'Belarus', '+375'],
  ['BE', 'Belgium', '+32'],
  ['BZ', 'Belize', '+501'],
  ['BJ', 'Benin', '+229'],
  ['BM', 'Bermuda', '+1'],
  ['BT', 'Bhutan', '+975'],
  ['BO', 'Bolivia', '+591'],
  ['BA', 'Bosnia and Herzegovina', '+387'],
  ['BW', 'Botswana', '+267'],
  ['BR', 'Brazil', '+55'],
  ['IO', 'British Indian Ocean Territory', '+246'],
  ['VG', 'British Virgin Islands', '+1'],
  ['BN', 'Brunei', '+673'],
  ['BG', 'Bulgaria', '+359'],
  ['BF', 'Burkina Faso', '+226'],
  ['BI', 'Burundi', '+257'],
  ['KH', 'Cambodia', '+855'],
  ['CM', 'Cameroon', '+237'],
  ['CA', 'Canada', '+1'],
  ['CV', 'Cape Verde', '+238'],
  ['BQ', 'Caribbean Netherlands', '+599'],
  ['KY', 'Cayman Islands', '+1'],
  ['CF', 'Central African Republic', '+236'],
  ['TD', 'Chad', '+235'],
  ['CL', 'Chile', '+56'],
  ['CN', 'China', '+86'],
  ['CO', 'Colombia', '+57'],
  ['KM', 'Comoros', '+269'],
  ['CG', 'Congo-Brazzaville', '+242'],
  ['CD', 'Congo-Kinshasa', '+243'],
  ['CK', 'Cook Islands', '+682'],
  ['CR', 'Costa Rica', '+506'],
  ['HR', 'Croatia', '+385'],
  ['CU', 'Cuba', '+53'],
  ['CW', 'Curacao', '+599'],
  ['CY', 'Cyprus', '+357'],
  ['CZ', 'Czech Republic', '+420'],
  ['DK', 'Denmark', '+45'],
  ['DJ', 'Djibouti', '+253'],
  ['DM', 'Dominica', '+1'],
  ['DO', 'Dominican Republic', '+1'],
  ['TL', 'East Timor', '+670'],
  ['EC', 'Ecuador', '+593'],
  ['EG', 'Egypt', '+20'],
  ['SV', 'El Salvador', '+503'],
  ['GQ', 'Equatorial Guinea', '+240'],
  ['ER', 'Eritrea', '+291'],
  ['EE', 'Estonia', '+372'],
  ['SZ', 'Eswatini', '+268'],
  ['ET', 'Ethiopia', '+251'],
  ['FK', 'Falkland Islands', '+500'],
  ['FO', 'Faroe Islands', '+298'],
  ['FJ', 'Fiji', '+679'],
  ['FI', 'Finland', '+358'],
  ['FR', 'France', '+33'],
  ['GF', 'French Guiana', '+594'],
  ['PF', 'French Polynesia', '+689'],
  ['GA', 'Gabon', '+241'],
  ['GM', 'Gambia', '+220'],
  ['GE', 'Georgia', '+995'],
  ['DE', 'Germany', '+49'],
  ['GH', 'Ghana', '+233'],
  ['GI', 'Gibraltar', '+350'],
  ['GR', 'Greece', '+30'],
  ['GL', 'Greenland', '+299'],
  ['GD', 'Grenada', '+1'],
  ['GP', 'Guadeloupe', '+590'],
  ['GU', 'Guam', '+1'],
  ['GT', 'Guatemala', '+502'],
  ['GG', 'Guernsey', '+44'],
  ['GN', 'Guinea', '+224'],
  ['GW', 'Guinea-Bissau', '+245'],
  ['GY', 'Guyana', '+592'],
  ['HT', 'Haiti', '+509'],
  ['HN', 'Honduras', '+504'],
  ['HK', 'Hong Kong', '+852'],
  ['HU', 'Hungary', '+36'],
  ['IS', 'Iceland', '+354'],
  ['IN', 'India', '+91'],
  ['ID', 'Indonesia', '+62'],
  ['IR', 'Iran', '+98'],
  ['IQ', 'Iraq', '+964'],
  ['IE', 'Ireland', '+353'],
  ['IM', 'Isle of Man', '+44'],
  ['IL', 'Israel', '+972'],
  ['IT', 'Italy', '+39'],
  ['CI', 'Ivory Coast', '+225'],
  ['JM', 'Jamaica', '+1'],
  ['JP', 'Japan', '+81'],
  ['JE', 'Jersey', '+44'],
  ['JO', 'Jordan', '+962'],
  ['KZ', 'Kazakhstan', '+7'],
  ['KE', 'Kenya', '+254'],
  ['KI', 'Kiribati', '+686'],
  ['XK', 'Kosovo', '+383'],
  ['KG', 'Kyrgyzstan', '+996'],
  ['LA', 'Laos', '+856'],
  ['LV', 'Latvia', '+371'],
  ['LB', 'Lebanon', '+961'],
  ['LS', 'Lesotho', '+266'],
  ['LR', 'Liberia', '+231'],
  ['LY', 'Libya', '+218'],
  ['LI', 'Liechtenstein', '+423'],
  ['LT', 'Lithuania', '+370'],
  ['LU', 'Luxembourg', '+352'],
  ['MO', 'Macau', '+853'],
  ['MG', 'Madagascar', '+261'],
  ['MW', 'Malawi', '+265'],
  ['MY', 'Malaysia', '+60'],
  ['MV', 'Maldives', '+960'],
  ['ML', 'Mali', '+223'],
  ['MT', 'Malta', '+356'],
  ['MH', 'Marshall Islands', '+692'],
  ['MQ', 'Martinique', '+596'],
  ['MR', 'Mauritania', '+222'],
  ['MU', 'Mauritius', '+230'],
  ['YT', 'Mayotte', '+262'],
  ['MX', 'Mexico', '+52'],
  ['FM', 'Micronesia', '+691'],
  ['MD', 'Moldova', '+373'],
  ['MC', 'Monaco', '+377'],
  ['MN', 'Mongolia', '+976'],
  ['ME', 'Montenegro', '+382'],
  ['MS', 'Montserrat', '+1'],
  ['MA', 'Morocco', '+212'],
  ['MZ', 'Mozambique', '+258'],
  ['MM', 'Myanmar', '+95'],
  ['NA', 'Namibia', '+264'],
  ['NR', 'Nauru', '+674'],
  ['NP', 'Nepal', '+977'],
  ['NL', 'Netherlands', '+31'],
  ['NC', 'New Caledonia', '+687'],
  ['NZ', 'New Zealand', '+64'],
  ['NI', 'Nicaragua', '+505'],
  ['NE', 'Niger', '+227'],
  ['NG', 'Nigeria', '+234'],
  ['NU', 'Niue', '+683'],
  ['NF', 'Norfolk Island', '+672'],
  ['KP', 'North Korea', '+850'],
  ['MK', 'North Macedonia', '+389'],
  ['MP', 'Northern Mariana Islands', '+1'],
  ['NO', 'Norway', '+47'],
  ['PK', 'Pakistan', '+92'],
  ['PW', 'Palau', '+680'],
  ['PS', 'Palestine', '+970'],
  ['PA', 'Panama', '+507'],
  ['PG', 'Papua New Guinea', '+675'],
  ['PY', 'Paraguay', '+595'],
  ['PE', 'Peru', '+51'],
  ['PH', 'Philippines', '+63'],
  ['PL', 'Poland', '+48'],
  ['PT', 'Portugal', '+351'],
  ['PR', 'Puerto Rico', '+1'],
  ['RE', 'Reunion', '+262'],
  ['RO', 'Romania', '+40'],
  ['RU', 'Russia', '+7'],
  ['RW', 'Rwanda', '+250'],
  ['BL', 'Saint Barthelemy', '+590'],
  ['SH', 'Saint Helena', '+290'],
  ['KN', 'Saint Kitts and Nevis', '+1'],
  ['LC', 'Saint Lucia', '+1'],
  ['MF', 'Saint Martin', '+590'],
  ['VC', 'Saint Vincent and the Grenadines', '+1'],
  ['WS', 'Samoa', '+685'],
  ['SM', 'San Marino', '+378'],
  ['ST', 'Sao Tome and Principe', '+239'],
  ['SN', 'Senegal', '+221'],
  ['RS', 'Serbia', '+381'],
  ['SC', 'Seychelles', '+248'],
  ['SL', 'Sierra Leone', '+232'],
  ['SG', 'Singapore', '+65'],
  ['SX', 'Sint Maarten', '+1'],
  ['SK', 'Slovakia', '+421'],
  ['SI', 'Slovenia', '+386'],
  ['SB', 'Solomon Islands', '+677'],
  ['SO', 'Somalia', '+252'],
  ['ZA', 'South Africa', '+27'],
  ['KR', 'South Korea', '+82'],
  ['SS', 'South Sudan', '+211'],
  ['ES', 'Spain', '+34'],
  ['LK', 'Sri Lanka', '+94'],
  ['SD', 'Sudan', '+249'],
  ['SR', 'Suriname', '+597'],
  ['SE', 'Sweden', '+46'],
  ['CH', 'Switzerland', '+41'],
  ['SY', 'Syria', '+963'],
  ['TW', 'Taiwan', '+886'],
  ['TJ', 'Tajikistan', '+992'],
  ['TZ', 'Tanzania', '+255'],
  ['TH', 'Thailand', '+66'],
  ['TG', 'Togo', '+228'],
  ['TK', 'Tokelau', '+690'],
  ['TO', 'Tonga', '+676'],
  ['TT', 'Trinidad and Tobago', '+1'],
  ['TN', 'Tunisia', '+216'],
  ['TR', 'Turkey', '+90'],
  ['TM', 'Turkmenistan', '+993'],
  ['TC', 'Turks and Caicos Islands', '+1'],
  ['TV', 'Tuvalu', '+688'],
  ['UG', 'Uganda', '+256'],
  ['UA', 'Ukraine', '+380'],
  ['GB', 'United Kingdom', '+44'],
  ['US', 'United States', '+1'],
  ['UY', 'Uruguay', '+598'],
  ['VI', 'US Virgin Islands', '+1'],
  ['UZ', 'Uzbekistan', '+998'],
  ['VU', 'Vanuatu', '+678'],
  ['VE', 'Venezuela', '+58'],
  ['VN', 'Vietnam', '+84'],
  ['WF', 'Wallis and Futuna', '+681'],
  ['YE', 'Yemen', '+967'],
  ['ZM', 'Zambia', '+260'],
  ['ZW', 'Zimbabwe', '+263'],
];

export const COUNTRIES: readonly Country[] = ROWS.map(([iso, name, dialling]) => ({
  iso,
  name,
  dialling,
  flag: flagOf(iso),
}));

export const DIALLING_CODES: readonly string[] = COUNTRIES.map((c) => c.dialling);

/**
 * The country a shared dialling code should resolve to when it is read
 * backwards. E.164 records no country, so a code with several members needs
 * a stated default; without one the alphabetically-first territory wins,
 * which puts Guernsey beside a London number. Named here, each because the
 * alphabetical winner is a small territory sharing a code with a clearly
 * larger, clearly-intended member:
 *
 * - `+1`  American Samoa (pop. ~45k) alphabetises ahead of the United States.
 * - `+7`  Kazakhstan alphabetises ahead of Russia.
 * - `+44` Guernsey alphabetises ahead of the United Kingdom.
 * - `+262` Mayotte alphabetises ahead of Reunion, the more populous and more
 *   commonly meant of the two.
 * - `+599` Caribbean Netherlands alphabetises ahead of Curacao, the larger
 *   and better-known constituent country of the two.
 *
 * `+590` (Guadeloupe, Saint Martin, Saint Barthelemy) is also shared, but
 * Guadeloupe — already the alphabetical winner — is the largest and most
 * commonly meant of the three, so it needs no override.
 */
const CANONICAL: Record<string, string> = {
  '+1': 'US',
  '+7': 'RU',
  '+44': 'GB',
  '+262': 'RE',
  '+599': 'CW',
};

/**
 * The country to show for a dialling code — e.g. to draw a flag beside a
 * stored phone number. Prefers the stated `CANONICAL` member for a shared
 * code; otherwise the first row in table order. A code with only one member
 * has nothing to disambiguate, so it always resolves to that member. An
 * unrecognised code resolves to `undefined` rather than guessing.
 */
export function countryForDialling(dialling: string): Country | undefined {
  const canonicalIso = CANONICAL[dialling];
  if (canonicalIso !== undefined) {
    const canonical = COUNTRIES.find((c) => c.iso === canonicalIso);
    if (canonical !== undefined) return canonical;
  }
  return COUNTRIES.find((c) => c.dialling === dialling);
}
