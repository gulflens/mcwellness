import { useState } from 'react';
import { Link } from 'react-router';
import type { LocationMeResponse } from '../../api/location/schema';
import { useAuth } from '../../shell/auth/AuthContext';
import { Button, Note } from '../../shell/components/Controls';
import { LocationSharing, type LocationSharingProps } from './LocationSharing';
import '../TodayLanding.css';

/**
 * "Share my location while I help": the one page a helper has (round 76,
 * docs/SPEC/dispatch.md section 15.12). A helper is a member of the
 * practitioner's family who drives and carries kit on the day; they reach
 * their own location and nothing else, so this page holds exactly that — the
 * notice to read and accept the first time, the switch, the practitioner they
 * go with by first name, and whether sharing is live now — and the two things
 * every signed-in page has, signing out and changing the password they were
 * handed. No client, no visit, no address, no money, no navigation. English,
 * as every staff screen is.
 *
 * The switch, the notice and the sender are the practitioner's own
 * (`LocationSharing`), in a helper's words; this page only says around them
 * what the server last said.
 */

/** Live means a position is being sent now: agreed to the notice in force, switched on, on shift. */
function liveNow(status: LocationMeResponse): boolean {
  return (
    status.eligible &&
    status.consent !== null &&
    status.consent.noticeVersion === status.noticeVersion &&
    status.sharingOn &&
    status.shiftOpen
  );
}

export function HelperPage({ geolocation }: Pick<LocationSharingProps, 'geolocation'> = {}) {
  const { signOut } = useAuth();
  const [status, setStatus] = useState<LocationMeResponse | null>(null);
  const accompanies = status?.accompanies ?? null;
  return (
    <div className="ground" data-ground="dark">
      <main className="plain plain--instrument">
        <img className="today__logo" src="/brand/mark.png" alt="" width={384} height={410} />
        <h1>Share my location while I help</h1>
        {status === null ? null : accompanies === null ? (
          <Note>
            You are not helping anybody at the moment. The practice names whom you go with.
          </Note>
        ) : (
          <>
            <p>You are helping {accompanies}.</p>
            <p className="small" role="status">
              {liveNow(status)
                ? 'Your location is being shared now.'
                : 'Your location is not being shared now.'}
            </p>
          </>
        )}
        <LocationSharing helper geolocation={geolocation} onStatus={setStatus} />
        <Link className="link" to="/account/password">
          Change my password
        </Link>
        <Button onClick={() => void signOut()}>Sign out</Button>
      </main>
    </div>
  );
}
