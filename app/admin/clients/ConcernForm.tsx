import { useState, type FormEvent } from 'react';
import { IdResponse } from '../../api/clients/record-schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Note, Select } from '../../shell/components/Controls';
import { Textarea } from './FormAtoms';
import { useGoalCategories } from './useGoalCategories';

const GENERIC_ERROR = 'This concern could not be saved. Try again.';
const FORBIDDEN_ERROR = 'Only the owner, an admin or the lead practitioner may record a concern.';

/**
 * Add a concern (docs/SPEC/client-record.md section 4.6): what the household
 * is worried about, as a category from the same owner-editable list a goal
 * uses and their own words beside it, never instead of it. The same shape as
 * GoalForm and deliberately not the same form — a concern has no "main" flag,
 * is "open" or "resolved" rather than achieved, and is never printed into a
 * report, which is the whole reason it is not a goal. Reused by the drawer's
 * Goals tab and the enrolment wizard's goals step; resolving one lives on the
 * tab alone.
 */
export function ConcernForm({
  clientId,
  onSaved,
  onCancel,
}: {
  clientId: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { apiFetch } = useAuth();
  const categories = useGoalCategories();
  const [categoryId, setCategoryId] = useState('');
  const [description, setDescription] = useState('');
  const [categoryError, setCategoryError] = useState<string | undefined>();
  const [descriptionError, setDescriptionError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    let hasError = false;
    if (!categoryId) {
      setCategoryError('Choose a category.');
      hasError = true;
    } else {
      setCategoryError(undefined);
    }
    const trimmed = description.trim();
    if (!trimmed) {
      setDescriptionError('Say what the household is worried about.');
      hasError = true;
    } else {
      setDescriptionError(undefined);
    }
    if (hasError) return;

    setBusy(true);
    try {
      const res = await apiFetch(`/api/clients/${clientId}/concerns`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ categoryId, description: trimmed }),
      });
      if (res.status === 201) {
        IdResponse.parse(await res.json());
        onSaved();
        return;
      }
      setFormError(res.status === 403 ? FORBIDDEN_ERROR : GENERIC_ERROR);
    } catch {
      setFormError(GENERIC_ERROR);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="drawer__form" onSubmit={(e) => void submit(e)}>
      {categories.kind === 'error' ? (
        <Note tone="critical">The list of categories could not be loaded. Try again.</Note>
      ) : (
        <Select
          id="concern-category"
          label="Category"
          value={categoryId}
          disabled={categories.kind === 'loading'}
          onChange={(e) => {
            setCategoryId(e.target.value);
            setCategoryError(undefined);
          }}
          error={categoryError}
        >
          <option value="">
            {categories.kind === 'loading' ? 'Loading categories…' : 'Choose a category'}
          </option>
          {categories.kind === 'ready'
            ? categories.categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))
            : null}
        </Select>
      )}
      <Textarea
        id="concern-description"
        label="What the household is worried about"
        rows={3}
        value={description}
        onChange={(e) => {
          setDescription(e.target.value);
          setDescriptionError(undefined);
        }}
        error={descriptionError}
      />
      {formError ? <Note tone="critical">{formError}</Note> : null}
      <div className="drawer__actions">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Saving…' : 'Add concern'}
        </Button>
      </div>
    </form>
  );
}
