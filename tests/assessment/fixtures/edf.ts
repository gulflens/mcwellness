/**
 * A European Data Format header, built byte by byte, for the tests that ask
 * what the export's door does with a recording.
 *
 * **Nothing here is copied from a recording.** The practice's own sample files
 * are real people's brain activity, with a person's name in the very field
 * this fixture leaves empty, and one of the things the tests below prove is
 * that the platform never reads that field. So the fixture is written from the
 * published layout instead of taken from a file: the eight-byte version — an
 * ASCII zero followed by seven spaces — then the identification field and the
 * recording field of eighty bytes each, the start date and time, the header's
 * own length, the reserved field, the number of data records and how long one
 * lasts, and the count of signals; then one block of the same size describing
 * that one signal. Every field is left-justified and padded with spaces, which
 * is the format's own rule.
 *
 * The identification field takes whatever a caller puts in it, and every caller
 * here puts in either nothing at all or a sentinel that is plainly not a
 * person's name: `.claude/rules/testing.md` forbids a hand-written one, and a
 * realistic one would be exactly the thing this stream is trying not to hold.
 */

const ASCII = new TextEncoder();

/** One field: left-justified, space-padded, and never longer than its width. */
function field(value: string, width: number): Uint8Array {
  const out = new Uint8Array(width).fill(0x20);
  out.set(ASCII.encode(value).subarray(0, width));
  return out;
}

function joined(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * The smallest recording the format allows: one signal, one data record, one
 * sample in it. About half a kilobyte, which is what a test wants — the
 * practice's own recordings are tens of megabytes and the size is the body
 * cap's business, not this fixture's.
 */
export function minimalEdf(
  options: { identification?: string; recording?: string; sample?: number } = {},
): Uint8Array {
  const signals = 1;
  const header = joined([
    field('0', 8),
    field(options.identification ?? '', 80),
    field(options.recording ?? '', 80),
    field('01.01.00', 8),
    field('00.00.00', 8),
    field(String(256 * (signals + 1)), 8),
    field('', 44),
    field('1', 8),
    field('1', 8),
    field(String(signals), 4),
    // The one signal, in the order the format lists a signal's fields.
    field('Fp1', 16),
    field('', 80),
    field('uV', 8),
    field('-100', 8),
    field('100', 8),
    field('-2048', 8),
    field('2047', 8),
    field('', 80),
    field('1', 8),
    field('', 32),
  ]);
  // One two-byte sample, little-endian, as the format stores them.
  const value = options.sample ?? 0;
  const data = new Uint8Array([value & 0xff, (value >> 8) & 0xff]);
  return joined([header, data]);
}

/**
 * A stand-in for the amplifier software's own recording file, which begins
 * with no fixed bytes this stream can rely on (`domain/assessment/fileType.ts`
 * says why). Binary, and deliberately not the opening of anything the platform
 * already recognises.
 */
export function nativeRecording(): Uint8Array {
  const out = new Uint8Array(512);
  for (let at = 0; at < out.length; at += 1) out[at] = (at * 7 + 11) % 251;
  return out;
}
