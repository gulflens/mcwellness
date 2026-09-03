import { useMemo, useState } from 'react';
import {
  GOAL_STATUSES,
  IdResponse,
  type ClientRecordResponse,
} from '../../api/clients/record-schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Note, Select } from '../../shell/components/Controls';
import { GoalForm } from './GoalForm';
import { useGoalCategories } from './useGoalCategories';

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  achieved: 'Achieved',
  dropped: 'Dropped',
};

/**
 * Goals (docs/SPEC/client-record.md sections 4.2 and 6): the category from
 * the reference list, free text beside it, status. Dropping a goal is a
 * sensitive action and needs a reason (section 9); the client-record tab
 * gates on that action, unlike the other tabs, because it is the one that
 * writes a status change directly.
 */
export function GoalsTab({
  clientId,
  record,
  onChanged,
}: {
  clientId: string;
  record: ClientRecordResponse;
  onChanged: () => void;
}) {
  const { apiFetch } = useAuth();
  const categories = useGoalCategories();
  const categoryNames = useMemo(
    () =>
      categories.kind === 'ready'
        ? new Map(categories.categories.map((c) => [c.code, c.name]))
        : new Map<string, string>(),
    [categories],
  );
  const [adding, setAdding] = useState(false);
  // The goal whose "dropped" is waiting on a reason, so the select keeps showing the
  // choice that was made rather than snapping back to the old status while the
  // prompt is open.
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function setStatus(goalId: string, status: string, withReason?: string) {
    setBusyId(goalId);
    setError(null);
    try {
      const res = await apiFetch(`/api/clients/${clientId}/goals/${goalId}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          ...(withReason ? { 'x-reason': withReason } : {}),
        },
        body: JSON.stringify({ status }),
      });
      if (res.status === 200) {
        IdResponse.parse(await res.json());
        setReasonFor(null);
        setReason('');
        onChanged();
        return;
      }
      if (res.status === 400) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        if (body?.error === 'reason_required') {
          setReasonFor(goalId);
          return;
        }
      }
      setError(
        res.status === 403
          ? 'Only the owner or a lead practitioner may change a goal.'
          : 'This goal could not be updated. Try again.',
      );
    } catch {
      setError('This goal could not be updated. Try again.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="tab-section">
      {record.goals.length === 0 ? (
        <Note>No goals yet.</Note>
      ) : (
        <ul className="record-rows">
          {record.goals.map((goal) => (
            <li key={goal.id} className="record-row">
              <div className="record-row__main">
                <p>
                  {categoryNames.get(goal.categoryCode) ?? goal.categoryCode}
                  {goal.isPrimary ? <span className="small muted"> (main goal)</span> : null}
                </p>
                <p className="small muted">{goal.description}</p>
              </div>
              <Select
                id={`goal-status-${goal.id}`}
                label="Status"
                value={reasonFor === goal.id ? 'dropped' : goal.status}
                disabled={busyId === goal.id}
                onChange={(e) => {
                  const next = e.target.value;
                  if (next === 'dropped') {
                    setReasonFor(goal.id);
                  } else {
                    void setStatus(goal.id, next);
                  }
                }}
              >
                {GOAL_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </option>
                ))}
              </Select>
              {reasonFor === goal.id ? (
                <div className="record-row__reason">
                  <label htmlFor={`goal-reason-${goal.id}`} className="field__label">
                    Why is this goal dropped?
                  </label>
                  <input
                    id={`goal-reason-${goal.id}`}
                    className="field__input"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <div className="drawer__actions">
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setReasonFor(null);
                        setReason('');
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="primary"
                      disabled={!reason.trim() || busyId === goal.id}
                      onClick={() => void setStatus(goal.id, 'dropped', reason.trim())}
                    >
                      Confirm
                    </Button>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {error ? <Note tone="critical">{error}</Note> : null}

      {!adding ? (
        <Button variant="secondary" onClick={() => setAdding(true)}>
          Add goal
        </Button>
      ) : (
        <GoalForm
          clientId={clientId}
          onSaved={() => {
            setAdding(false);
            onChanged();
          }}
          onCancel={() => setAdding(false)}
        />
      )}
    </div>
  );
}
