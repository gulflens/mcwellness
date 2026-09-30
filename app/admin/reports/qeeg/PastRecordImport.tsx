import { useEffect, useRef, useState } from 'react';
import { displayFromIso, isoDateIn } from '@domain/shared';
import { ageOn } from '../../../../domain/shared/dates';
import { readLegacyReport, type LegacyImage } from '../../../../domain/reports/qeeg/legacy/read';
import {
  subjectDisagreements,
  type Disagreement,
  type RecordFacts,
} from '../../../../domain/reports/qeeg/legacy/subjectCheck';
import type { ImportNote, MapEntry, QeegInitial } from '../../../../domain/reports/qeeg/types';
import { FigureFiledResponse } from '../../../api/reports/qeeg/figureSchema';
import { ImportResponse, ReportResponse } from '../../../api/reports/schema';
import { useAuth } from '../../../shell/auth/AuthContext';
import { Button, Note } from '../../../shell/components/Controls';
import { prepareFile, sha256Hex } from './mapFile';
import { figureRefusalSentence } from './refusals';
import { noteSentence, pastRecordRefusalSentence, readRefusalSentence } from './pastRecordWords';
import './qeeg.css';

/**
 * "Bring in a past record": a brain-map report the practice wrote in its old
 * tool, brought in against this client so a follow-up can be compared with it
 * (docs/SPEC/reports-qeeg.md section 11; brief R, item 7).
 *
 * **Read here, in the browser** (point 1). The chosen file is read by
 * `readLegacyReport`, and its fingerprint is taken over its bytes. What is sent
 * is the reader's content and that fingerprint, never the file.
 *
 * **Checked against this client, and never sent** (point 2). The name, age
 * and sex the file typed are shown beside this client's record, with a
 * warning where they disagree (`subjectDisagreements`), and go no further
 * than this screen. The file's Arabic name is compared and said to agree or
 * not, and not shown: the console is English (tests/lint/console-is-english).
 *
 * **In three steps, each after she has seen what the next will keep** (point
 * 5): she reads what the file holds and what could not be carried, and brings
 * it in; its pictures are made into maps as the form makes them
 * (`prepareFile`) and filed through the ordinary maps door, and a picture that
 * cannot be is left out and noted by its place; then she reads every note,
 * the pictures' included, and keeps it. A record brought in and not kept stays
 * a draft; choosing the same file again goes on with it, because the import
 * door answers where a record of the same file already is.
 *
 * Every refusal is a sentence (`pastRecordWords.ts`).
 */

export const PAST_RECORD_REASONS = Object.freeze({
  import: 'Past record brought in from the old report tool',
  map: 'Brain map of a past record brought in',
  keep: 'Past record kept as read over',
});

/** The practice's own day, as the accounting screens read it. */
const PRACTICE_TIME_ZONE = 'Asia/Dubai';

/** Far more than any report the old tool saved, with eight pictures inside it. */
const MOST_FILE_BYTES = 80 * 1024 * 1024;

type Read = Extract<ReturnType<typeof readLegacyReport>, { ok: true }>;

type Brought = {
  reportId: string;
  savedAt: string;
  maps: Record<string, MapEntry & { position: number }>;
  leftOut: string[];
  /** Why each picture left out was, in words, by its place. */
  said: string[];
  /** A picture made ready, to show before keeping, by its key. */
  thumbs: Record<string, string>;
};

type Stage =
  | { kind: 'choose' }
  | { kind: 'review'; read: Read; sha: string }
  | { kind: 'working'; read: Read; sha: string; step: string }
  | { kind: 'ready'; read: Read; brought: Brought }
  | { kind: 'kept' };

type ClientFacts = RecordFacts & { name: string };

/** A picture made ready, as a link the page can show, or none where the browser gives none. */
function thumbnailOf(png: Uint8Array): string | null {
  try {
    return URL.createObjectURL(new Blob([png as Uint8Array<ArrayBuffer>], { type: 'image/png' }));
  } catch {
    return null;
  }
}

/** A picture held inside the file, as bytes the browser can decode. */
export function bytesOfDataUrl(url: string): Blob | null {
  const found = /^data:([^;,]+)((?:;[^;,]*)*),(.*)$/s.exec(url);
  if (found === null) return null;
  const [, type = '', params = '', data = ''] = found;
  try {
    if (params.includes(';base64')) {
      const binary = atob(data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return new Blob([bytes], { type });
    }
    return new Blob([decodeURIComponent(data)], { type });
  } catch {
    return null;
  }
}

const STAGE_WORDS: Readonly<Record<string, string>> = Object.freeze({
  initial: 'First report',
  follow_up: 'Follow-up',
  final: 'Final report',
});

const SEX_WORDS: Readonly<Record<string, string>> = Object.freeze({
  female: 'Female',
  male: 'Male',
  unknown: 'Not recorded',
});

const CONDITION_WORDS: Readonly<Record<string, string>> = Object.freeze({
  eyes_open: 'Eyes open',
  eyes_closed: 'Eyes closed',
  none: 'No condition',
});

const DISAGREEMENT_WORDS: Readonly<Record<Disagreement, string>> = Object.freeze({
  name: 'the name',
  nameAr: 'the Arabic name',
  age: 'the age',
  sex: 'the sex',
});

function list(words: readonly string[]): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} and ${words[words.length - 1] ?? ''}`;
}

function NotesList({ notes, empty }: { notes: readonly ImportNote[]; empty: string }) {
  if (notes.length === 0) return <p className="small">{empty}</p>;
  return (
    <ul className="small" aria-label="What could not be carried">
      {notes.map((note) => (
        <li key={`${note.code}:${note.at ?? ''}`}>{noteSentence(note)}</li>
      ))}
    </ul>
  );
}

export function PastRecordImport({
  clientId,
  onDone,
  onCancel,
}: {
  clientId: string;
  /** Kept: the new past record's id. */
  onDone: (reportId: string) => void;
  onCancel: () => void;
}) {
  const { apiFetch } = useAuth();
  const [stage, setStage] = useState<Stage>({ kind: 'choose' });
  const [error, setError] = useState<string | null>(null);
  const [facts, setFacts] = useState<ClientFacts | null | 'unreadable'>(null);
  /** Every picture shown, let go of when the screen closes. */
  const madeRef = useRef<string[]>([]);
  useEffect(
    () => () => {
      for (const url of madeRef.current) URL.revokeObjectURL(url);
    },
    [],
  );

  // The client's own record, to set the file's person beside. Read once.
  useEffect(() => {
    let live = true;
    void apiFetch(`/api/clients/${clientId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error('unreadable');
        const body = (await res.json()) as {
          givenName?: string;
          familyName?: string;
          givenNameAr?: string | null;
          familyNameAr?: string | null;
          dateOfBirth?: string | null;
          sexAtBirth?: 'female' | 'male' | 'unknown' | null;
        };
        const givenName = body.givenName ?? '';
        const familyName = body.familyName ?? '';
        return {
          name: [givenName, familyName].filter((part) => part !== '').join(' '),
          givenName,
          familyName,
          givenNameAr: body.givenNameAr ?? null,
          familyNameAr: body.familyNameAr ?? null,
          dateOfBirth: body.dateOfBirth ?? null,
          sexAtBirth: body.sexAtBirth ?? null,
        };
      })
      .then(
        (read) => {
          if (live) setFacts(read);
        },
        () => {
          if (live) setFacts('unreadable');
        },
      );
    return () => {
      live = false;
    };
  }, [apiFetch, clientId]);

  async function choose(file: File | undefined): Promise<void> {
    setError(null);
    if (file === undefined) return;
    if (file.size > MOST_FILE_BYTES) {
      setError(readRefusalSentence('too_large'));
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      setError(readRefusalSentence('not_json'));
      return;
    }
    const sha = await sha256Hex(bytes);
    const read = readLegacyReport(parsed, sha);
    if (!read.ok) {
      setError(readRefusalSentence(read.reason));
      return;
    }
    setStage({ kind: 'review', read, sha });
  }

  /** The draft this file is brought in as, or where one of the same file already is. */
  async function draftFor(
    read: Read,
    sha: string,
  ): Promise<{ reportId: string; savedAt: string } | null> {
    const res = await apiFetch('/api/reports/qeeg/import', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-reason': PAST_RECORD_REASONS.import },
      // The reader's content and the file's fingerprint. Never the file, and
      // never the person it typed.
      body: JSON.stringify({ clientId, sourceSha256: sha, content: read.content }),
    });
    const body: unknown = await res.json().catch(() => null);
    if (res.status === 201) {
      const made = ImportResponse.parse(body);
      return { reportId: made.report.id, savedAt: made.savedAt };
    }
    const found = body as { code?: unknown; status?: unknown; reportId?: unknown } | null;
    if (
      res.status === 409 &&
      found?.code === 'already_imported' &&
      found.status === 'draft' &&
      typeof found.reportId === 'string'
    ) {
      // Brought in before and not kept: go on with that draft.
      const again = await apiFetch(`/api/reports/${found.reportId}`);
      if (again.ok) {
        const draft = ReportResponse.parse(await again.json());
        if (draft.savedAt) return { reportId: found.reportId, savedAt: draft.savedAt };
      }
    }
    setError(pastRecordRefusalSentence(res.status, body));
    return null;
  }

  /** One picture of the file made into a map and filed, or why it could not be. */
  async function fileMap(
    reportId: string,
    image: LegacyImage,
  ): Promise<
    | { ok: true; entry: MapEntry; savedAt: string; thumb: string | null }
    | { ok: false; said: string }
  > {
    const blob = bytesOfDataUrl(image.dataUrl);
    if (blob === null)
      return { ok: false, said: figureRefusalSentence(0, { code: 'undecodable' }) };
    let prepared: Awaited<ReturnType<typeof prepareFile>>;
    try {
      prepared = await prepareFile(blob);
    } catch {
      return { ok: false, said: figureRefusalSentence(0, { code: 'cannot_prepare' }) };
    }
    if (!prepared.ok)
      return { ok: false, said: figureRefusalSentence(0, { code: prepared.refusal }) };
    const res = await apiFetch(`/api/reports/${reportId}/figures`, {
      method: 'PUT',
      headers: {
        'content-type': 'image/png',
        'x-sha256': prepared.sha256,
        'x-reason': PAST_RECORD_REASONS.map,
      },
      body: prepared.png as Uint8Array<ArrayBuffer>,
    });
    const body: unknown = await res.json().catch(() => null);
    const filed = FigureFiledResponse.safeParse(body);
    if (!res.ok || !filed.success) {
      return { ok: false, said: figureRefusalSentence(res.status, body) };
    }
    const { figureId, sha256, widthPx, heightPx } = filed.data.figure;
    return {
      thumb: thumbnailOf(prepared.png),
      ok: true,
      entry: {
        figureId,
        sha256,
        widthPx,
        heightPx,
        condition: image.condition,
        caption: image.caption,
      },
      savedAt: filed.data.savedAt,
    };
  }

  async function bringIn(read: Read, sha: string): Promise<void> {
    setError(null);
    setStage({ kind: 'working', read, sha, step: 'Bringing the record in.' });
    try {
      const draft = await draftFor(read, sha);
      if (draft === null) {
        setStage({ kind: 'review', read, sha });
        return;
      }
      const brought: Brought = { ...draft, maps: {}, leftOut: [], said: [], thumbs: {} };
      for (const [index, image] of read.images.entries()) {
        setStage({
          kind: 'working',
          read,
          sha,
          step: `Adding picture ${index + 1} of ${read.images.length}.`,
        });
        const place = Number(image.key.replace('map-', '')) + 1;
        const filed = await fileMap(draft.reportId, image);
        if (filed.ok) {
          brought.maps[image.key] = { ...filed.entry, position: Object.keys(brought.maps).length };
          brought.savedAt = filed.savedAt;
          if (filed.thumb !== null) {
            brought.thumbs[image.key] = filed.thumb;
            madeRef.current.push(filed.thumb);
          }
        } else {
          brought.leftOut.push(image.key);
          brought.said.push(`The picture in place ${place} of the file: ${filed.said}`);
        }
      }
      setStage({ kind: 'ready', read, brought });
    } catch {
      setError('The record could not be brought in. Check the connection and try again.');
      setStage({ kind: 'review', read, sha });
    }
  }

  async function keep(read: Read, brought: Brought): Promise<void> {
    setError(null);
    setStage({ kind: 'working', read, sha: '', step: 'Keeping the record.' });
    try {
      const res = await apiFetch(`/api/reports/${brought.reportId}/keep-import`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-reason': PAST_RECORD_REASONS.keep },
        body: JSON.stringify({
          savedAt: brought.savedAt,
          maps: brought.maps,
          leftOut: brought.leftOut,
        }),
      });
      if (res.ok) {
        setStage({ kind: 'kept' });
        onDone(brought.reportId);
        return;
      }
      setError(pastRecordRefusalSentence(res.status, await res.json().catch(() => null)));
    } catch {
      setError('The record could not be kept. Check the connection and try again.');
    }
    setStage({ kind: 'ready', read, brought });
  }

  const heading = <h3 className="report-editor__heading">Bring in a past record</h3>;

  if (stage.kind === 'choose') {
    return (
      <section className="qeeg-past" aria-label="Bring in a past record">
        {heading}
        <p className="small">
          A brain-map report saved by the practice’s old report tool is brought in so a follow-up
          can be compared with it. The file is read here, in the browser; only what the report
          records is sent. It is kept as a past record: never signed, never sent, and not shown to
          the household.
        </p>
        <label className="field__label" htmlFor="past-record-file">
          The report file from the old tool
        </label>
        <input
          id="past-record-file"
          type="file"
          accept=".json,application/json"
          onChange={(event) => void choose(event.currentTarget.files?.[0])}
        />
        {error ? <Note tone="critical">{error}</Note> : null}
        <div className="report-editor__actions">
          <Button variant="quiet" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </section>
    );
  }

  if (stage.kind === 'kept') return <Note>The past record was kept.</Note>;

  const { read } = stage;
  const content: QeegInitial = read.content;
  const recordedOn = content.recording.recordedOn;
  const on = recordedOn ?? isoDateIn(new Date(), PRACTICE_TIME_ZONE);
  const disagreements =
    facts !== null && facts !== 'unreadable' ? subjectDisagreements(read.asTyped, facts, on) : [];
  const typedOrNone = (value: string) => (value.trim() === '' ? 'Not in the file' : value);
  const recordAge =
    facts !== null && facts !== 'unreadable' && facts.dateOfBirth !== null
      ? String(ageOn(facts.dateOfBirth, on))
      : 'Not recorded';
  const recordHasArabic =
    facts !== null &&
    facts !== 'unreadable' &&
    [facts.givenNameAr, facts.familyNameAr].some((part) => part !== null && part.trim() !== '');
  // Compared, and said in words, never shown: the console is English.
  const arabicWord =
    read.asTyped.nameAr.trim() === ''
      ? 'Not in the file'
      : !recordHasArabic
        ? 'Cannot be compared: none on the record'
        : disagreements.includes('nameAr')
          ? 'Differs from the record'
          : 'Agrees with the record';

  const person = (
    <div className="ledger__scroll">
      <table className="ledger">
        <caption className="report-editor__heading">
          The person the file names, beside this client’s record
        </caption>
        <thead>
          <tr>
            <th scope="col" />
            <th scope="col">In the file</th>
            <th scope="col">On this client’s record</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Name</th>
            <td>{typedOrNone(read.asTyped.name)}</td>
            <td>{facts !== null && facts !== 'unreadable' ? facts.name : ''}</td>
          </tr>
          <tr>
            <th scope="row">Arabic name</th>
            <td>{arabicWord}</td>
            <td />
          </tr>
          <tr>
            <th scope="row">Age</th>
            <td className="numeric">{typedOrNone(read.asTyped.age)}</td>
            <td className="numeric">{recordAge}</td>
          </tr>
          <tr>
            <th scope="row">Sex</th>
            <td>{typedOrNone(read.asTyped.sex)}</td>
            <td>
              {facts !== null && facts !== 'unreadable'
                ? (SEX_WORDS[facts.sexAtBirth ?? 'unknown'] ?? '')
                : ''}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );

  return (
    <section className="qeeg-past" aria-label="Bring in a past record">
      {heading}
      {facts === 'unreadable' ? (
        <Note tone="critical">
          This client’s record could not be read, so the file cannot be checked against it. Nothing
          can be brought in until it can.
        </Note>
      ) : null}
      {person}
      <p className="small muted">
        The name, age and sex the file typed are shown here to check it is this client. They are not
        sent and not kept: a report gathers them from the record.
      </p>
      {disagreements.length > 0 ? (
        <Note tone="attention">
          The file does not match this client’s record in{' '}
          {list(disagreements.map((d) => DISAGREEMENT_WORDS[d]))}. Check it is the right client
          before bringing it in.
        </Note>
      ) : null}

      <dl className="report-view__facts">
        <dt>Recorded on</dt>
        <dd>{recordedOn === null ? 'Not in the file' : displayFromIso(recordedOn)}</dd>
        <dt>Called in the old tool</dt>
        <dd>{STAGE_WORDS[content.stage] ?? content.stage}</dd>
        <dt>Pictures in the file</dt>
        <dd className="numeric">{read.images.length}</dd>
      </dl>
      {recordedOn === null ? (
        <Note tone="attention">
          The file gives no day of recording, so a follow-up cannot be compared with this record.
        </Note>
      ) : null}

      {stage.kind === 'ready' ? (
        <div className="ledger__scroll">
          <table className="ledger">
            <caption className="report-editor__heading">The pictures as they will be kept</caption>
            <thead>
              <tr>
                <th scope="col" className="numeric">
                  Place in the file
                </th>
                <th scope="col">Picture</th>
                <th scope="col">Condition</th>
                <th scope="col">Caption</th>
              </tr>
            </thead>
            <tbody>
              {read.images.map((image) => {
                const place = Number(image.key.replace('map-', '')) + 1;
                const entry = stage.brought.maps[image.key];
                const thumb = stage.brought.thumbs[image.key];
                return (
                  <tr key={image.key}>
                    <td className="numeric">{place}</td>
                    <td>
                      {entry !== undefined && thumb !== undefined ? (
                        <img
                          className="qeeg-past__thumb"
                          src={thumb}
                          alt={`The picture in place ${place} of the file`}
                        />
                      ) : null}
                    </td>
                    {entry === undefined ? (
                      <td colSpan={2}>Not brought in</td>
                    ) : (
                      <>
                        <td>{CONDITION_WORDS[entry.condition ?? 'none'] ?? ''}</td>
                        <td>{entry.caption === null ? 'No caption' : entry.caption.en}</td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="small muted">
            A follow-up pairs its pictures with these by condition. Check each is the one it says.
          </p>
        </div>
      ) : null}

      <h4 className="report-editor__heading">What could not be carried</h4>
      {stage.kind === 'ready' ? (
        <>
          <NotesList
            notes={[
              ...read.notes,
              ...stage.brought.leftOut.map((key): ImportNote => ({
                code: 'map_not_brought_in',
                at: `images.${key}`,
              })),
            ]}
            empty="Everything in the file was carried."
          />
          {stage.brought.said.length > 0 ? (
            <ul className="small" aria-label="Why pictures were not brought in">
              {stage.brought.said.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <NotesList notes={read.notes} empty="Everything in the file was carried." />
      )}

      {stage.kind === 'working' ? <Note>{stage.step}</Note> : null}
      {error ? <Note tone="critical">{error}</Note> : null}

      <div className="report-editor__actions">
        {stage.kind === 'review' ? (
          <>
            <Button
              variant="primary"
              disabled={facts === null || facts === 'unreadable'}
              onClick={() => void bringIn(stage.read, stage.sha)}
            >
              Bring it in
            </Button>
            <Button onClick={() => setStage({ kind: 'choose' })}>Choose another file</Button>
          </>
        ) : null}
        {stage.kind === 'ready' ? (
          <>
            <p className="small">
              Keeping it freezes it as it was brought in. It is never signed or sent; if it was kept
              against the wrong client, the owner or the lead practitioner withdraws it.
            </p>
            <Button variant="primary" onClick={() => void keep(stage.read, stage.brought)}>
              Keep it as a past record
            </Button>
          </>
        ) : null}
        <Button variant="quiet" disabled={stage.kind === 'working'} onClick={onCancel}>
          {stage.kind === 'ready' ? 'Leave it as a draft' : 'Cancel'}
        </Button>
      </div>
    </section>
  );
}
