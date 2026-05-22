/**
 * map.js – Map view for Family Tree
 *
 * Uses Leaflet.js for rendering, OpenStreetMap tiles,
 * Nominatim for geocoding places without coordinates,
 * and Leaflet.markercluster for clustering co-located markers.
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
   Geocoding cache (in-memory + localStorage)
------------------------------------------------------- */
const GEOCODE_CACHE_KEY = 'familyTree_geocodeCache';

// In-memory cache to avoid redundant localStorage reads and duplicate API calls
// within the same page session.
const _geocodeMemoryCache = new Map();

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
 * Results are cached first in memory (for the current session) and then in
 * localStorage (across sessions) to avoid repeated API requests.
 * Returns {lat, lon} or null if not found.
 */
async function geocodePlace(name) {
  if (!name || !name.trim()) return null;
  const key = name.trim().toLowerCase();

  // 1. In-memory cache (fastest – no I/O)
  if (_geocodeMemoryCache.has(key)) return _geocodeMemoryCache.get(key);

  // 2. localStorage cache (persistent across sessions)
  const lsCache = _loadGeocodeCache();
  if (Object.prototype.hasOwnProperty.call(lsCache, key)) {
    _geocodeMemoryCache.set(key, lsCache[key]);
    return lsCache[key];
  }

  // 3. External API call
  console.info(`Geocoding "${name}" via Nominatim...`);
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
    _geocodeMemoryCache.set(key, coords);
    lsCache[key] = coords;
    _saveGeocodeCache(lsCache);
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
let _clusterLayer = null;
let _autoSpiderfyLayers = [];
let _mapRendering = false;
const AUTO_SPIDERFY_MAX_PERSONS = 8;
const CLUSTER_ANIMATION_TIMEOUT_MS = 250;

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

  _clusterLayer = L.markerClusterGroup().addTo(_map);
}

function _clearAutoSpiderfyLayers() {
  _autoSpiderfyLayers.forEach(layer => {
    if (_map && _map.hasLayer(layer)) _map.removeLayer(layer);
  });
  _autoSpiderfyLayers = [];
}

function _createAutoSpiderfyLayer() {
  const layer = L.markerClusterGroup().addTo(_map);
  _autoSpiderfyLayers.push(layer);
  return layer;
}

/* -------------------------------------------------------
   Marker icon builder
------------------------------------------------------- */
function _buildMarkerIcon(person) {
  const cachedUrl = _imageCache.get(person.id);
  const safeImgSrc = cachedUrl || sanitizeImageUrl(person.image);
  const living = !isAssumedDeceased(person);
  const borderColor = living ? '#29b6f6' : '#e94560';

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
 * (geocoding those that lack them), then render clustered markers.
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
  _clusterLayer.clearLayers();
  _clearAutoSpiderfyLayers();

  const statusEl = document.getElementById('map-status');
  statusEl.textContent = 'Loading locations…';

  // Build list of birth-place entries that need geocoding
  const rawEntries = [];
  for (const person of persons) {
    for (const place of (person.places || [])) {
      if (place.type !== 'birth') continue;
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
  let geocodingUpdated = false;
  // Load localStorage cache once so we can determine cache-hit status for the
  // rate-limit decision without calling _loadGeocodeCache() per entry.
  const lsCacheSnapshot = _loadGeocodeCache();
  for (const entry of rawEntries) {
    if (entry.coords) continue;
    geocodingCount++;
    statusEl.textContent = `Geocoding ${geocodingCount}…`;
    // A result is "cached" (no API call needed) when it's already in memory or
    // in localStorage.  We check both before calling geocodePlace so we know
    // whether to apply Nominatim's fair-use rate-limit delay afterwards.
    const placeName = entry.place.name;
    const cacheKey = placeName ? placeName.trim().toLowerCase() : '';
    const wasCached = cacheKey && (
      _geocodeMemoryCache.has(cacheKey) ||
      Object.prototype.hasOwnProperty.call(lsCacheSnapshot, cacheKey)
    );
    entry.coords = await geocodePlace(placeName);
    if (entry.coords) {
      // Write coordinates back into the place object so they are persisted
      entry.place.coordinates = { lat: entry.coords.lat, lon: entry.coords.lon };
      geocodingUpdated = true;
    }
    // Nominatim fair-use: max 1 request per second. Skip the delay when the
    // result was served from cache (no API call was made).
    if (!wasCached) {
      await new Promise(r => setTimeout(r, 1100));
    }
  }

  // Persist newly geocoded coordinates back into the family data JSON
  if (geocodingUpdated && data && activeId) {
    try {
      saveFamilyData(activeId, data);
    } catch (e) {
      console.warn('Could not persist geocoded coordinates to family data:', e);
    }
  }

  // Keep only entries that resolved to coordinates
  const entries = rawEntries.filter(e => e.coords !== null);

  if (entries.length === 0) {
    statusEl.textContent = 'No location data found.';
    _mapRendering = false;
    return;
  }

  statusEl.textContent = `${entries.length} location${entries.length !== 1 ? 's' : ''}`;

  const groupedEntries = _groupEntriesByCoordinate(entries);
  const clusteredEntries = [];

  groupedEntries.forEach(group => {
    if (group.length >= 2 && group.length <= AUTO_SPIDERFY_MAX_PERSONS) {
      _renderMarkers(group, _createAutoSpiderfyLayer());
      return;
    }

    clusteredEntries.push(...group);
  });

  _renderMarkers(clusteredEntries, _clusterLayer);

  // Fit bounds
  const latlngs = entries.map(e => [e.coords.lat, e.coords.lon]);
  _map.fitBounds(L.latLngBounds(latlngs), { padding: [40, 40], maxZoom: 10 });
  _scheduleAutoSpiderfy();

  _mapRendering = false;
}

function _groupEntriesByCoordinate(entries) {
  const groups = new Map();

  entries.forEach(entry => {
    const key = `${entry.coords.lat},${entry.coords.lon}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  });

  return Array.from(groups.values());
}

function _scheduleAutoSpiderfy() {
  if (!_map || _autoSpiderfyLayers.length === 0) return;

  let mapSettled = false;
  const waitForClusterAnimations = () => {
    const layers = [_clusterLayer, ..._autoSpiderfyLayers];
    let pendingLayers = layers.length;

    const onLayerReady = () => {
      pendingLayers--;
      if (pendingLayers === 0) {
        _autoSpiderfyLayers.forEach(_spiderfyLayerCluster);
      }
    };

    layers.forEach(layer => {
      let resolved = false;
      const finish = () => {
        if (resolved) return;
        resolved = true;
        layer.off('animationend', finish);
        onLayerReady();
      };

      layer.once('animationend', finish);
      window.setTimeout(finish, CLUSTER_ANIMATION_TIMEOUT_MS);
    });
  };

  const onMapSettled = () => {
    if (mapSettled) return;
    mapSettled = true;
    _map.off('moveend', onMapSettled);
    waitForClusterAnimations();
  };

  _map.once('moveend', onMapSettled);
  // Fallback in case fitBounds keeps the current view and no moveend fires.
  window.setTimeout(onMapSettled, 0);
}

function _spiderfyLayerCluster(layer) {
  if (!layer || !layer._featureGroup) return;

  let visibleCluster = null;
  layer._featureGroup.eachLayer(featureLayer => {
    if (visibleCluster) return;
    if (!(featureLayer instanceof L.MarkerCluster)) return;
    if (!featureLayer._icon) return;

    const childCount = featureLayer.getChildCount();
    if (childCount > 1 && childCount <= AUTO_SPIDERFY_MAX_PERSONS) {
      visibleCluster = featureLayer;
    }
  });

  if (visibleCluster) visibleCluster.spiderfy();
}

function _renderMarkers(entries, targetLayer) {
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
    targetLayer.addLayer(marker);
  }
}
