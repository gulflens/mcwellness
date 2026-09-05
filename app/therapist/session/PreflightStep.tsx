import { useCallback, useEffect, useRef, useState } from 'react';
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
 *
 * **And it is shown here, on this screen, never opened elsewhere.** A new tab
 * put a photograph of a child's head outside the app's control — the tab's own
 * history and the browser's HTTP cache both outlive a sign-out — and under the
 * local store the signed link answers `content-disposition: attachment`, which
 * downloads it into the device's Downloads folder, where `forgetDevice` cannot
 * reach. So the bytes are fetched and rendered from an object URL, and that
 * URL is revoked when the picture is closed and when the step goes away.
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
  const [photoState, setPhotoState] = useState<'idle' | 'asking' | 'shown' | 'offline' | 'failed'>(
    'idle',
  );
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  // The object URL as the browser holds it, so it can be revoked from a
  // cleanup that does not re-run when state changes.
  const objectUrl = useRef<string | null>(null);
  const outstanding = service.preflightChecklist.filter((item) => !checked[item.key]);

  const forgetPicture = useCallback(() => {
    if (objectUrl.current !== null) {
      URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = null;
    }
    setPhotoUrl(null);
  }, []);

  // Leaving pre-flight is closing the picture: nothing of a household's
  // photograph outlives the step that asked for it.
  useEffect(() => forgetPicture, [forgetPicture]);

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
      // The link's own signature is its authorisation, so a vendor's host is
      // asked plainly; this API's own address is asked through `apiFetch`, the
      // way every other read on this screen is asked, and never handed the
      // session on somebody else's origin.
      const link = new URL(parsed.data.url, window.location.origin);
      const bytes =
        link.origin === window.location.origin
          ? await apiFetch(`${link.pathname}${link.search}`)
          : await fetch(parsed.data.url);
      if (!bytes.ok) {
        setPhotoState('failed');
        return;
      }
      // The store answers `application/octet-stream` under the local
      // implementation, so the blob is given the document's own type rather
      // than the transport's.
      const picture = new Blob([await bytes.arrayBuffer()], { type: parsed.data.mimeType });
      forgetPicture();
      objectUrl.current = URL.createObjectURL(picture);
      setPhotoUrl(objectUrl.current);
      setPhotoState('shown');
    } catch {
      setPhotoState('offline');
    }
  }, [apiFetch, forgetPicture, previousPhotoDocumentId]);

  const hideLastPlacement = useCallback(() => {
    forgetPicture();
    setPhotoState('idle');
  }, [forgetPicture]);

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
          {photoUrl === null ? (
            <Button onClick={() => void showLastPlacement()} disabled={photoState === 'asking'}>
              Show last placement
            </Button>
          ) : (
            <>
              <img className="placement" src={photoUrl} alt="The sensor placement last time" />
              <Button variant="quiet" onClick={hideLastPlacement}>
                Hide
              </Button>
            </>
          )}
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
