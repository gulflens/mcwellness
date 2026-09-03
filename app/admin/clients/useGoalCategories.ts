import { useEffect, useState } from 'react';
import { GoalCategoryListResponse, type GoalCategory } from '../../api/clients/record-schema';
import { useAuth } from '../../shell/auth/AuthContext';

export type GoalCategoriesState =
  { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; categories: readonly GoalCategory[] };

/** GET /api/clients/goal-categories, fetched once per mount (the owner-editable reference list). */
export function useGoalCategories(): GoalCategoriesState {
  const { apiFetch } = useAuth();
  const [state, setState] = useState<GoalCategoriesState>({ kind: 'loading' });

  useEffect(() => {
    let live = true;
    void apiFetch('/api/clients/goal-categories')
      .then(async (res) => {
        if (!live) return;
        if (!res.ok) {
          setState({ kind: 'error' });
          return;
        }
        const body = GoalCategoryListResponse.parse(await res.json());
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
