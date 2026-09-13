import { useEffect, useState } from 'react';
import { GoalCategoryListResponse, type GoalCategory } from '../../api/clients/record-schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { readReference } from '../../shell/referenceCache';

export type GoalCategoriesState =
  { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; categories: readonly GoalCategory[] };

/** GET /api/clients/goal-categories, fetched once per mount (the owner-editable reference list). */
export function useGoalCategories(): GoalCategoriesState {
  const { apiFetch } = useAuth();
  const [state, setState] = useState<GoalCategoriesState>({ kind: 'loading' });

  useEffect(() => {
    let live = true;
    // Through the reference cache (app/shell/referenceCache.ts): the list is
    // the practice's and every drawer and wizard step that needs it opens it
    // again, so the second and every later open costs no round trip.
    void readReference(apiFetch, '/api/clients/goal-categories')
      .then((answer) => {
        if (!live) return;
        if (!answer.ok) {
          setState({ kind: 'error' });
          return;
        }
        const body = GoalCategoryListResponse.parse(answer.body);
        setState({ kind: 'ready', categories: body.categories });
      })
      .catch(() => {
        if (live) setState({ kind: 'error' });
      });
    return () => {
      live = false;
    };
  }, [apiFetch]);

  return state;
}
