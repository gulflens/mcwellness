import { useCallback, useState } from 'react';
import { PhotoLinkResponse } from '../../api/sessions/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button } from '../../shell/components/Controls';
import { Slider } from './Slider';
import { midpoint, type Answers, type ServiceSettings } from './steps';

/**
 * Pre-flight (docs/SPEC/session-capture.md section 3.2): the checklist the
 * practice set for this service as large toggles, then the before-session
 * questions on 0-to-10 sliders. One decision at the end of it — everything is
 * ready, or it is not.
 *
 * A practice that has set no checklist and no questions gets neither, and
 * the step is a single confirmation. That is deliberate: the settings are
 * data (service_type), and an empty setting is a valid one, not a gap to be
 * papered over with defaults invented here.
 *
 * **The last placement** (docs/SPEC/practitioner-phone.md section 4.5): when
 * the household has a photograph on their most recent completed visit, this
 * step offers a button, and only that tap fetches it. Nothing is pre-loaded,
 * so the trail records the practitioner who actually looked, once, and never a
 * photograph nobody opened. Offline, the button says the picture needs a
 * connection rather than failing at a door.
 */
const PHOTO_OFFLINE = 'The last placement is not available without a connection.';
const PHOTO_FAILED = 'The last placement could not be opened. Carry on without it.';

export function PreflightStep({
  service,
  previousPhotoDocumentId,
  checked,
  onToggle,
  answers,
  onAnswer,
  onContinue,
}: {
  service: ServiceSettings;
  /** The photograph on this client's last completed visit, or null. */
  previousPhotoDocumentId: string | null;
  checked: Readonly<Record<string, boolean>>;
  onToggle: (key: string, done: boolean) => void;
  answers: Answers;
  onAnswer: (key: string, value: number) => void;
  onContinue: () => void;
}) {
  const { apiFetch } = useAuth();
  const [photoState, setPhotoState] = useState<'idle' | 'asking' | 'offline' | 'failed'>('idle');
  const outstanding = service.preflightChecklist.filter((item) => !checked[item.key]);

  const showLastPlacement = useCallback(async () => {
    if (previousPhotoDocumentId === null) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setPhotoState('offline');
      return;
    }
    setPhotoState('asking');
    try {
      const res = await apiFetch(`/api/sessions/photo/${previousPhotoDocumentId}/link`);
      if (!res.ok) {
        setPhotoState('failed');
        return;
      }
      const parsed = PhotoLinkResponse.safeParse(await res.json());
      if (!parsed.success) {
        setPhotoState('failed');
        return;
      }
      // A new tab rather than an image on this screen: the link is short-lived
      // and the picture is a reference, not part of the record being made here.
      window.open(parsed.data.url, '_blank', 'noopener,noreferrer');
      setPhotoState('idle');
    } catch {
      setPhotoState('offline');
    }
  }, [apiFetch, previousPhotoDocumentId]);

  return (
    <div className="step">
      <h1>Before you start</h1>

      {service.preflightChecklist.length === 0 ? (
        <p className="note">This service has no checklist set.</p>
      ) : (
        <ul className="checks">
          {service.preflightChecklist.map((item) => (
            <li key={item.key}>
              <label className="check">
                <input
                  type="checkbox"
                  className="check__input"
                  checked={checked[item.key] ?? false}
                  onChange={(event) => onToggle(item.key, event.target.checked)}
                />
                <span className="check__box" aria-hidden="true" />
                <span className="check__label">
                  {item.labelEn}
                  {item.labelAr ? (
                    <span className="check__label-ar small muted" lang="ar" dir="rtl">
                      {item.labelAr}
                    </span>
                  ) : null}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}

      {previousPhotoDocumentId === null ? null : (
        <section>
          <h2>Last placement</h2>
          <Button onClick={() => void showLastPlacement()} disabled={photoState === 'asking'}>
            Show last placement
          </Button>
          <p className="note small" role="status">
            {photoState === 'offline' ? PHOTO_OFFLINE : photoState === 'failed' ? PHOTO_FAILED : ''}
          </p>
        </section>
      )}

      {service.ratingQuestions.length > 0 ? (
        <section className="ratings">
          <h2>How are they today?</h2>
          {service.ratingQuestions.map((question) => (
            <Slider
              key={question.key}
              id={`pre-${question.key}`}
              question={question}
              value={answers[question.key] ?? midpoint(question)}
              onChange={(value) => onAnswer(question.key, value)}
            />
          ))}
        </section>
      ) : null}

      <div className="step__dock">
        {outstanding.length > 0 ? (
          <p className="note small">
            {outstanding.length === 1
              ? 'One item is still outstanding.'
              : `${outstanding.length} items are still outstanding.`}
          </p>
        ) : null}
        <Button variant="primary" className="step__primary" onClick={onContinue}>
          Check the signal
        </Button>
      </div>
    </div>
  );
}
