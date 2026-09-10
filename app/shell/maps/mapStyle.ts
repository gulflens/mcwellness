/**
 * The basemap both of the console's browser maps draw on: **Google's own
 * colours**, with the clutter turned off and nothing repainted.
 *
 * **Why no colours here any more.** Until the operator saw it on the live site
 * (2026-09-11), this file painted every feature from the console's own tokens
 * — all geometry `--paper` (`#e9e7ec`) and the roads `--rule` (`#d0cbd6`).
 * Those two sit about 1.2:1 apart, so the roads were very nearly invisible and
 * the map read as an empty grey panel: a quiet basemap taken so far that it
 * stopped being a map. Google's palette already separates land, water and road
 * legibly, and it is the one a coordinator recognises from every other map
 * they use. So the colours are Google's and this file no longer names one.
 *
 * That also settles the rule this file used to have to argue with
 * (`.claude/rules/ui.md`, "never hardcode colours"): with nothing painted, no
 * colour is declared here at all, from a token or otherwise.
 *
 * **What is still turned off**, because it is noise rather than colour: a shop,
 * a bus route and an emirate's boundary are not what this map is for. The day
 * map shows where a practitioner drives; the pin picker shows one front door.
 * Both read better without a layer of commerce and transit under the pins.
 */
export function mapStyle(): google.maps.MapTypeStyle[] {
  return [
    { featureType: 'poi', elementType: 'all', stylers: [{ visibility: 'off' }] },
    { featureType: 'transit', elementType: 'all', stylers: [{ visibility: 'off' }] },
    { featureType: 'administrative', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
  ];
}
