import { useState, type FormEvent } from 'react';
import { IdResponse } from '../../api/clients/record-schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Note, Select } from '../../shell/components/Controls';
import { Checkbox, Textarea } from './FormAtoms';
import { useGoalCategories } from './useGoalCategories';

const GENERIC_ERROR = 'This goal could not be saved. Try again.';
const FORBIDDEN_ERROR = 'Only the owner or a lead practitioner may set a goal.';

/**
 * Add a goal (docs/SPEC/client-record.md sections 4.2 and 6): a category
 * from the owner-editable reference list, free text beside it, never
 * instead of it. Reused by the drawer's Goals tab and the enrolment
 * wizard's goals step. Editing an existing goal's status lives on the
 * drawer's Goals tab alone — the wizard only ever adds one.
 */
export function GoalForm({
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
  const [isPrimary, setIsPrimary] = useState(false);
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
      setDescriptionError('Say what this goal is.');
      hasError = true;
    } else {
      setDescriptionError(undefined);
    }
    if (hasError) return;

    setBusy(true);
    try {
      const res = await apiFetch(`/api/clients/${clientId}/goals`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ categoryId, description: trimmed, isPrimary }),
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
          id="goal-category"
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
        id="goal-description"
        label="What this goal is"
        rows={3}
        value={description}
        onChange={(e) => {
          setDescription(e.target.value);
          setDescriptionError(undefined);
        }}
        error={descriptionError}
      />
      <Checkbox
        id="goal-is-primary"
        label="This is the main goal"
        checked={isPrimary}
        onChange={setIsPrimary}
      />
      {formError ? <Note tone="critical">{formError}</Note> : null}
      <div className="drawer__actions">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Saving…' : 'Add goal'}
        </Button>
      </div>
    </form>
  );
}
