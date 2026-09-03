import { useState } from 'react';
import type { ClientRecordResponse, Location } from '../../api/clients/record-schema';
import { Button, Note } from '../../shell/components/Controls';
import { LocationForm } from './LocationForm';
import { VerifyPinForm } from './VerifyPinForm';

const EMIRATE_LABELS: Record<string, string> = {
  DXB: 'Dubai',
  AUH: 'Abu Dhabi',
  SHJ: 'Sharjah',
  AJM: 'Ajman',
  UAQ: 'Umm Al Quwain',
  RAK: 'Ras Al Khaimah',
  FUJ: 'Fujairah',
};
const LOCATION_LABEL_TEXT: Record<string, string> = {
  home: 'Home',
  work: 'Work',
  school: 'School',
  studio: 'The studio',
  base: 'Base',
  other: 'Other',
};

type Panel =
  | { kind: 'closed' }
  | { kind: 'add' }
  | { kind: 'edit'; location: Location }
  | { kind: 'verify'; location: Location };

/**
 * Locations (docs/SPEC/client-record.md section 4.2): Makani, the verified
 * pin, parking and gate pins (shown as present/absent — neither is
 * captured through a route this pull request builds), access notes, add,
 * edit and "verify pin".
 */
export function LocationsTab({
  clientId,
  record,
  onChanged,
  mayWrite,
}: {
  clientId: string;
  record: ClientRecordResponse;
  onChanged: () => void;
  /** False for a role the write routes would refuse: no Add, no Edit, no Verify pin. */
  mayWrite: boolean;
}) {
  const [panel, setPanel] = useState<Panel>({ kind: 'closed' });

  function saved() {
    setPanel({ kind: 'closed' });
    onChanged();
  }

  return (
    <div className="tab-section">
      {record.locations.length === 0 ? (
        <Note>No locations yet.</Note>
      ) : (
        <ul className="record-rows">
          {record.locations.map((location) => (
            <li key={location.id} className="record-row">
              <div className="record-row__main">
                <p>
                  {LOCATION_LABEL_TEXT[location.label] ?? location.label}
                  {location.isPrimary ? <span className="small muted"> (primary)</span> : null}
                </p>
                <p className="small muted">
                  {EMIRATE_LABELS[location.emirate] ?? location.emirate}
                </p>
                {location.displayAddress ? (
                  <p className="small muted">{location.displayAddress}</p>
                ) : null}
                <ul className="record-row__flags small muted">
                  <li>
                    Pin {location.entranceLat.toFixed(5)}, {location.entranceLng.toFixed(5)}
                  </li>
                  {location.makaniNumber ? (
                    <li className="numeric">Makani {location.makaniNumber}</li>
                  ) : null}
                  {location.hasParkingPoint ? <li>Parking pin on file</li> : null}
                  {location.hasCommunityGate ? <li>Gate pin on file</li> : null}
                </ul>
                {location.accessNotes ? (
                  <p className="small muted">{location.accessNotes}</p>
                ) : null}
              </div>
              {mayWrite ? (
                <div className="record-row__actions">
                  <Button variant="quiet" onClick={() => setPanel({ kind: 'verify', location })}>
                    Verify pin
                  </Button>
                  <Button variant="quiet" onClick={() => setPanel({ kind: 'edit', location })}>
                    Edit
                  </Button>
                </div>
              ) : null}
              {panel.kind === 'verify' && panel.location.id === location.id ? (
                <VerifyPinForm
                  clientId={clientId}
                  location={location}
                  onSaved={saved}
                  onCancel={() => setPanel({ kind: 'closed' })}
                />
              ) : null}
              {panel.kind === 'edit' && panel.location.id === location.id ? (
                <LocationForm
                  clientId={clientId}
                  location={location}
                  onSaved={saved}
                  onCancel={() => setPanel({ kind: 'closed' })}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {mayWrite && panel.kind === 'closed' ? (
        <Button variant="secondary" onClick={() => setPanel({ kind: 'add' })}>
          Add location
        </Button>
      ) : null}
      {panel.kind === 'add' ? (
        <LocationForm
          clientId={clientId}
          onSaved={saved}
          onCancel={() => setPanel({ kind: 'closed' })}
        />
      ) : null}
    </div>
  );
}
