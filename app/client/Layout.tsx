import type { ReactNode } from 'react';
import type { PortalClient } from '../api/portal/schema';
import { useWords } from './i18n';

/**
 * The two shapes every portal screen is built from
 * (docs/SPEC/client-portal.md section 3).
 *
 * **A household with several clients sees each screen sectioned by client, the
 * client's name as the section heading; one client, no heading.** That rule is
 * here rather than repeated on five screens, so it can never be right on four
 * of them.
 *
 * The Arabic name sits beneath the Latin one, and the other way about in the
 * Arabic edition: a household reads its own names first.
 */

export function Screen({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function ClientHeading({ client }: { client: PortalClient }) {
  const words = useWords();
  const first = words.locale === 'ar' && client.nameAr ? client.nameAr : client.name;
  const second = words.locale === 'ar' ? client.name : client.nameAr;
  return (
    <h3 className="portal__client">
      {first}
      {second && second !== first ? (
        <span className="portal__client-ar small" lang={words.locale === 'ar' ? 'en' : 'ar'}>
          {second}
        </span>
      ) : null}
    </h3>
  );
}

/**
 * One block per client, headed by the client's name when there is more than
 * one. A block that renders nothing is left out entirely, so a heading never
 * stands over an empty space.
 */
export function Sections({
  clients,
  render,
}: {
  clients: readonly PortalClient[];
  render: (client: PortalClient) => ReactNode;
}) {
  const several = clients.length > 1;
  const blocks = clients
    .map((client) => ({ client, content: render(client) }))
    .filter((block) => block.content !== null && block.content !== false);

  return (
    <>
      {blocks.map(({ client, content }) => (
        <div key={client.id} className="portal__section">
          {several ? <ClientHeading client={client} /> : null}
          {content}
        </div>
      ))}
    </>
  );
}
