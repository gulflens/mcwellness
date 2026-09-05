import type { Db } from '../_middleware/request-context';

/**
 * The clients the signed-in person is a contact of.
 *
 * From `app.portal_client_ids()` (migration 700), which reads
 * `contact.user_id` against `app.current_actor_id()` and nothing a request can
 * set. A member of the practice is a contact of nobody, so the answer is empty
 * and their reach comes from their role instead; a household's reach comes
 * from this and nowhere else.
 *
 * Shared by every reports route rather than written into each, so the two
 * faces of the module can never resolve a household differently.
 */
export async function contactClientIds(db: Db): Promise<string[]> {
  const found = await db.query<{ ids: string[] }>('select app.portal_client_ids() as ids');
  return found.rows[0]?.ids ?? [];
}
