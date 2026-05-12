/**
 * map.js – Map view for Family Tree
 *
 * Uses Leaflet.js for rendering, OpenStreetMap tiles,
 * Nominatim for geocoding places without coordinates,
 * and Leaflet.heat for heatmap mode.
 */

/* -------------------------------------------------------
   HTML escaping helper
------------------------------------------------------- */
function _esc(str) {
  return (str || '').replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* -------------------------------------------------------
   Geocoding cache (localStorage)
------------------------------------------------------- */
const GEOCODE_CACHE_KEY = 'familyTree_geocodeCache';

function _loadGeocodeCache() {
  try {
    return JSON.parse(localStorage.getItem(GEOCODE_CACHE_KEY) || '{}');
  } catch { return {}; }
}

function _saveGeocodeCache(cache) {
  try {
    localStorage.setItem(GEOCODE_CACHE_KEY, JSON.stringify(cache));
  } catch (e) {
    console.warn('Could not save geocode cache:', e);
  }
}

/**
 * Geocode a place name via Nominatim (OpenStreetMap).
 * Results are cached in localStorage to avoid repeated requests.
 * Returns {lat, lon} or null if not found.
 */
async function geocodePlace(name) {
  if (!name || !name.trim()) return null;
  const cache = _loadGeocodeCache();
  const key = name.trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(cache, key)) return cache[key];

  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(name)}&format=json&limit=1`;
    const resp = await fetch(url, {
      headers: {
        'Accept-Language': 'en',
        'User-Agent': 'FamilyTreeApp/1.0 (open-source genealogy viewer)'
      }
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const results = await resp.json();
    const coords = results.length > 0
      ? { lat: parseFloat(results[0].lat), lon: parseFloat(results[0].lon) }
      : null;
    cache[key] = coords;
    _saveGeocodeCache(cache);
    return coords;
  } catch (e) {
    console.warn(`Geocoding failed for "${name}":`, e);
    return null;
  }
}

/* -------------------------------------------------------
   Map state
------------------------------------------------------- */
let _map = null;
let _markerLayer = null;
let _heatLayer = null;
let _mapMode = 'markers';   // 'markers' | 'heat'
let _mapModeManual = false; // true once the user has toggled manually
let _mapRendering = false;
const HEAT_THRESHOLD = 15;  // auto-switch to heat when total place entries exceed this

/* -------------------------------------------------------
   Initialisation
------------------------------------------------------- */
function initMap() {
  if (_map) return;

  _map = L.map('map-container', { zoomControl: true }).setView([20, 0], 2);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors',
    maxZoom: 19
  }).addTo(_map);

  _markerLayer = L.layerGroup().addTo(_map);
}

/* -------------------------------------------------------
   Marker icon builder
------------------------------------------------------- */
function _buildMarkerIcon(person) {
  const cachedUrl = _imageCache.get(person.id);
  const safeImgSrc = cachedUrl || sanitizeImageUrl(person.image);
  const living = !isAssumedDeceased(person);
  const borderColor = living ? '#4caf50' : '#e94560';

  let inner;
  if (safeImgSrc) {
    inner = `<img src="${safeImgSrc}" alt="${_esc(person.name)}" />`;
  } else {
    inner = `<span>${_esc(getInitials(person.name))}</span>`;
  }

  return L.divIcon({
    className: '',
    html: `<div class="map-marker-circle" style="border-color:${borderColor}">${inner}</div>`,
    iconSize:    [44, 44],
    iconAnchor:  [22, 22],
    popupAnchor: [0, -26]
  });
}

/* -------------------------------------------------------
   Place type labels
------------------------------------------------------- */
const PLACE_TYPE_LABELS = {
  birth: '🎂 Birth place',
  death: '✝ Death place',
  lived: '🏠 Lived here',
  work:  '💼 Work',
  other: '📍 Place'
};

function _placeTypeLabel(type) {
  return PLACE_TYPE_LABELS[type] || '📍 Place';
}

/* -------------------------------------------------------
   Render
------------------------------------------------------- */

/**
 * Main render entry point – collect all place entries with coordinates
 * (geocoding those that lack them), then render markers or heatmap.
 */
async function renderMap() {
  if (!_map) return;
  if (_mapRendering) return;
  _mapRendering = true;

  // Let Leaflet recalculate container dimensions (needed after panel becomes visible)
  _map.invalidateSize();

  const activeId = getActiveId();
  const data = activeId ? getFamilyData(activeId) : null;
  const persons = data ? (data.persons || []) : [];

  // Clear existing content
  _markerLayer.clearLayers();
  if (_heatLayer) {
    _map.removeLayer(_heatLayer);
    _heatLayer = null;
  }

  const statusEl = document.getElementById('map-status');
  statusEl.textContent = 'Loading locations…';
  document.getElementById('map-mode-btn').disabled = true;

  // Build list of entries that need geocoding
  const rawEntries = [];
  for (const person of persons) {
    for (const place of (person.places || [])) {
      if (place.coordinates && place.coordinates.lat != null && place.coordinates.lon != null) {
        rawEntries.push({
          person,
          place,
          coords: { lat: place.coordinates.lat, lon: place.coordinates.lon }
        });
      } else if (place.name) {
        rawEntries.push({ person, place, coords: null });
      }
    }
  }

  // Geocode entries that have no coordinates (with rate limiting)
  let geocodingCount = 0;
  for (const entry of rawEntries) {
    if (entry.coords) continue;
    geocodingCount++;
    statusEl.textContent = `Geocoding ${geocodingCount}…`;
    entry.coords = await geocodePlace(entry.place.name);
    // Nominatim requests up to 1 per second for fair-use; 1.1 s between calls
    await new Promise(r => setTimeout(r, 1100));
  }

  // Keep only entries that resolved to coordinates
  const entries = rawEntries.filter(e => e.coords !== null);

  document.getElementById('map-mode-btn').disabled = false;

  if (entries.length === 0) {
    statusEl.textContent = 'No location data found.';
    _mapRendering = false;
    return;
  }

  statusEl.textContent = `${entries.length} location${entries.length !== 1 ? 's' : ''}`;

  // Auto-switch to heatmap if not yet manually set and threshold exceeded
  if (!_mapModeManual && entries.length > HEAT_THRESHOLD) {
    _mapMode = 'heat';
    _updateMapModeButton();
  }

  if (_mapMode === 'heat') {
    _renderHeatmap(entries);
  } else {
    _renderMarkers(entries);
  }

  // Fit bounds
  const latlngs = entries.map(e => [e.coords.lat, e.coords.lon]);
  _map.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40], maxZoom: 10 });

  _mapRendering = false;
}

function _renderMarkers(entries) {
  for (const { person, place, coords } of entries) {
    const icon = _buildMarkerIcon(person);
    const marker = L.marker([coords.lat, coords.lon], { icon, title: person.name });

    const popupHtml = `
      <div class="map-popup" data-person-id="${_esc(person.id)}">
        <a href="#" class="map-popup-name">${_esc(person.name || '—')}</a>
        <div class="map-popup-type">${_esc(_placeTypeLabel(place.type))}</div>
        <div class="map-popup-place">${_esc(place.name || '')}</div>
        ${place.description ? `<div class="map-popup-desc">${_esc(place.description)}</div>` : ''}
      </div>`;

    marker.bindPopup(popupHtml, { maxWidth: 240 });
    // Attach click handler after popup opens to avoid inline JS in HTML
    marker.on('popupopen', () => {
      const popup = marker.getPopup();
      if (!popup) return;
      const el = popup.getElement();
      if (!el) return;
      const link = el.querySelector('.map-popup-name');
      const container = el.querySelector('.map-popup[data-person-id]');
      if (link && container) {
        const pid = container.dataset.personId;
        link.addEventListener('click', e => {
          e.preventDefault();
          showPersonDetail(pid);
        });
      }
    });
    _markerLayer.addLayer(marker);
  }
}

function _renderHeatmap(entries) {
  const points = entries.map(({ coords }) => [coords.lat, coords.lon, 1.0]);
  _heatLayer = L.heatLayer(points, {
    radius:   30,
    blur:     20,
    maxZoom:  12,
    gradient: { 0.3: '#57b8ff', 0.6: '#4caf50', 1.0: '#e94560' }
  }).addTo(_map);
}

/* -------------------------------------------------------
   Mode toggle
------------------------------------------------------- */
function _updateMapModeButton() {
  const btn = document.getElementById('map-mode-btn');
  if (!btn) return;
  if (_mapMode === 'markers') {
    btn.textContent = '🌡 Heatmap';
    btn.title = 'Switch to heatmap view';
  } else {
    btn.textContent = '📍 Markers';
    btn.title = 'Switch to marker view';
  }
}

function toggleMapMode() {
  if (_mapRendering) return;
  _mapModeManual = true;
  _mapMode = _mapMode === 'markers' ? 'heat' : 'markers';
  _updateMapModeButton();
  renderMap();
}
