/**
 * Where the map opens when a location has no pin yet: the middle of the
 * emirate the coordinator chose. Rounded to a city centre, not to any
 * address; a starting view, never a stored coordinate.
 */
export const EMIRATE_CENTRES: Record<string, { lat: number; lng: number }> = {
  DXB: { lat: 25.2048, lng: 55.2708 },
  AUH: { lat: 24.4539, lng: 54.3773 },
  SHJ: { lat: 25.3463, lng: 55.4209 },
  AJM: { lat: 25.4052, lng: 55.5136 },
  UAQ: { lat: 25.5647, lng: 55.5534 },
  RAK: { lat: 25.7895, lng: 55.9432 },
  FUJ: { lat: 25.1288, lng: 56.3265 },
};

export const UAE_CENTRE = { lat: 24.9, lng: 55.0 };
