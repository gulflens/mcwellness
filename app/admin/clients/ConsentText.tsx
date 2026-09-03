import { Fragment, type ReactNode } from 'react';

/**
 * The consent wording, rendered.
 *
 * The wording files are markdown (docs/CONSENT), because they are the
 * practice's own words kept in version control and reviewed by a lawyer, not
 * rows in a table. Showing them needs enough markdown to keep their shape —
 * headings, paragraphs, bullets, bold — and nothing more, so this is about
 * sixty lines rather than a dependency: a markdown library is a large surface
 * for four constructs, and every one of them here builds React elements.
 * Nothing is ever handed to `dangerouslySetInnerHTML`, so a wording file could
 * not inject markup even if one day it were edited by somebody who tried.
 *
 * The front matter is stripped, not rendered: `purpose`, `locale`, `version`
 * and `status` are what the row already says, and repeating them above the
 * text would be the machinery showing through.
 */

const FRONT_MATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;

/**
 * `**bold**` and `*italic*` inside a line. Two constructs, and the wording
 * files use both: the lawyer's own bracketed notes and the emphasis in "not a
 * medical clinic" are marked with single asterisks, and rendering those as
 * literal asterisks made the practice's own words look like a source file.
 * The double form is matched first, or `**` would be read as an empty italic.
 */
function inline(text: string, keyPrefix: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).map((part, index) => {
    const key = `${keyPrefix}-${index}`;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return <em key={key}>{part.slice(1, -1)}</em>;
    }
    return <Fragment key={key}>{part}</Fragment>;
  });
}

type Block =
  | { kind: 'heading'; level: 2 | 3; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: string[] };

/**
 * Lines to blocks. `#` and `##` both render as a level-2 heading and `###` as
 * a level 3: the drawer already owns an h2 for the client's name, so the
 * wording's own title cannot be an h1 without breaking the heading order a
 * screen reader walks.
 */
function parse(markdown: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let items: string[] = [];

  const flushParagraph = (): void => {
    if (paragraph.length > 0) {
      blocks.push({ kind: 'paragraph', text: paragraph.join(' ') });
      paragraph = [];
    }
  };
  const flushList = (): void => {
    if (items.length > 0) {
      blocks.push({ kind: 'list', items });
      items = [];
    }
  };

  for (const raw of markdown.replace(FRONT_MATTER, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') {
      flushParagraph();
      flushList();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading?.[1] && heading[2]) {
      flushParagraph();
      flushList();
      blocks.push({
        kind: 'heading',
        level: heading[1].length <= 2 ? 2 : 3,
        text: heading[2],
      });
      continue;
    }
    const bullet = /^[-*]\s+(.*)$/.exec(line);
    if (bullet?.[1]) {
      flushParagraph();
      items.push(bullet[1]);
      continue;
    }
    // A line under an open bullet is that bullet continuing, not a new
    // paragraph. The wording files are hard-wrapped at about seventy-five
    // characters, so nearly every bullet in them runs to two or three lines;
    // flushing the list here turned each one into a one-item list with an
    // orphan fragment beneath it, and section 3's four bullets rendered as
    // four lists. Markdown calls this a lazy continuation and so does this.
    if (items.length > 0) {
      items[items.length - 1] = `${items[items.length - 1] ?? ''} ${line}`;
      continue;
    }
    flushList();
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return blocks;
}

export function ConsentText({ markdown }: { markdown: string }) {
  return (
    <>
      {parse(markdown).map((block, index) => {
        const key = `block-${index}`;
        if (block.kind === 'heading') {
          return block.level === 2 ? (
            <h4 key={key} className="consent-text__heading">
              {inline(block.text, key)}
            </h4>
          ) : (
            <h5 key={key} className="consent-text__heading consent-text__heading--minor">
              {inline(block.text, key)}
            </h5>
          );
        }
        if (block.kind === 'list') {
          return (
            <ul key={key} className="consent-text__list">
              {block.items.map((item, itemIndex) => (
                <li key={`${key}-${itemIndex}`}>{inline(item, `${key}-${itemIndex}`)}</li>
              ))}
            </ul>
          );
        }
        return <p key={key}>{inline(block.text, key)}</p>;
      })}
    </>
  );
}
