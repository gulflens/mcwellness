import { UNCUT, cleanRich } from '../../../../domain/reports/qeeg/text';
import type { BilingualRich, QeegContent } from '../../../../domain/reports/qeeg/types';

/**
 * What the brain-map form sends to `POST /api/reports/draft`, and what it
 * takes back from the answer.
 *
 * **The server's parts are left out.** The route refuses a body that carries
 * the client, where the report came from, or anything of what a follow-up is
 * compared with beyond which report (`routeOwnedIn`, docs/SPEC/reports-qeeg.md
 * section 4 rule 11). It reads those from the record itself on every save.
 *
 * **The summary is cleaned before it goes** (section 4 rule 8): the shape
 * refuses formatted text holding anything cleaning would remove, because its
 * marks count from its letters. `cleanRich` is the domain's rule, and cuts
 * nothing (`UNCUT`): text that is too long is refused by name, never cut.
 *
 * **Only the server's parts come back.** A save is on the wire while she goes
 * on typing, so the answer's copy of what she typed is already old. What the
 * form takes from it is what only the server knows: the client's age and sex,
 * what the follow-up is compared with as it stands, and each earlier score,
 * the last two only while she has not chosen another report since.
 */

function cleaned(text: BilingualRich): BilingualRich {
  return {
    en: cleanRich(text.en, UNCUT),
    ar: text.ar === null ? null : cleanRich(text.ar, UNCUT),
  };
}

export function requestBody(content: QeegContent): Record<string, unknown> {
  // The client and the source are the route's, and never sent.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { subject, provenance, ...typed } = content;
  const summary = cleaned(content.summary);
  switch (typed.edition) {
    case 'initial':
      return { ...typed, summary };
    case 'follow-up':
      return {
        ...typed,
        summary,
        comparedWith: { reportId: typed.comparedWith.reportId },
        change: { ...typed.change, summary: cleaned(typed.change.summary) },
      };
    default: {
      const unknown: never = typed;
      return unknown;
    }
  }
}

/** `local`, with the parts only the server knows taken from what it saved. */
export function withServerParts(local: QeegContent, saved: QeegContent): QeegContent {
  const subject = { ...saved.subject };
  // A comparison she changed while the save was on its way is hers, and so
  // are the earlier scores beside it: the answer speaks of the old one.
  if (
    local.edition === 'follow-up' &&
    saved.edition === 'follow-up' &&
    local.comparedWith.reportId === saved.comparedWith.reportId
  ) {
    const dashboard = { ...local.dashboard };
    for (const key of Object.keys(dashboard) as (keyof typeof dashboard)[]) {
      dashboard[key] = { ...dashboard[key], earlierScore: saved.dashboard[key].earlierScore };
    }
    return { ...local, subject, comparedWith: { ...saved.comparedWith }, dashboard };
  }
  return { ...local, subject };
}
