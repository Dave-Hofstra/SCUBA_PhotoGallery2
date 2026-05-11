import { useEffect, useRef, useState, useMemo } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { VECTOR_STYLE as MAP_STYLE, DEFAULT_CENTER as MAP_CENTER, DEFAULT_ZOOM as MAP_ZOOM } from '../config/mapConfig';

export default function DiveMapModal({ mode, sites, activeDiveSiteId, onClose }) {
  const mapContainer = useRef(null);
  const mapInstance = useRef(null);
  const markersRef = useRef([]);
  const initialViewRef = useRef(null);
  const [selectedCity, setSelectedCity] = useState(null);

  // Extract unique city_island values for sidebar (only in allSites mode)
  const cities = useMemo(() => {
    if (mode !== 'allSites') return [];
    const cityMap = new Map();
    sites.forEach(s => {
      if (s.city_island) {
        const normalized = s.city_island.split(',')[0].trim();
        if (!cityMap.has(normalized)) {
          cityMap.set(normalized, []);
        }
        cityMap.get(normalized).push(s);
      }
    });
    return Array.from(cityMap.entries())
      .map(([name, siteList]) => ({ name, sites: siteList }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [sites, mode]);

  useEffect(() => {
    if (!mapContainer.current) return;

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: MAP_STYLE,
      center: MAP_CENTER,
      zoom: MAP_ZOOM,
      attributionControl: true
    });

    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    mapInstance.current = map;

    map.on('load', () => {
      addMarkers(map, sites, mode, activeDiveSiteId);

      // Capture initial view AFTER all animations complete (for reset button)
      map.once('idle', () => {
        initialViewRef.current = {
          center: map.getCenter(),
          zoom: map.getZoom()
        };
      });
    });

    return () => {
      markersRef.current.forEach(m => m.remove());
      markersRef.current = [];
      map.remove();
      mapInstance.current = null;
    };
  }, [sites, mode, activeDiveSiteId]);

  // Handle resize when modal opens
  useEffect(() => {
    if (mapInstance.current) {
      setTimeout(() => {
        mapInstance.current.resize();
      }, 100);
    }
  }, []);

  // Fly to city when selected
  useEffect(() => {
    if (!selectedCity || !mapInstance.current) return;
    const citySites = sites.filter(s => {
      if (!s.city_island) return false;
      const normalized = s.city_island.split(',')[0].trim();
      return normalized === selectedCity && s.latitude != null && s.longitude != null;
    });
    if (citySites.length === 0) return;

    const bounds = new maplibregl.LngLatBounds();
    citySites.forEach(s => bounds.extend([s.longitude, s.latitude]));
    mapInstance.current.fitBounds(bounds, { padding: 60, maxZoom: 10 });
  }, [selectedCity, sites]);

  function addMarkers(map, sites, mode, activeId) {
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    if (!sites || sites.length === 0) return;

    const bounds = new maplibregl.LngLatBounds();

    // Deduplicate sites by coordinates to avoid overlapping pins.
    // When multiple sites share coordinates, prefer the one matching activeId.
    // If neither matches activeId, prefer the one with the higher dive_count.
    // Never replace a site that matches activeId.
    const coordMap = new Map();
    for (const site of sites) {
      if (site.latitude == null || site.longitude == null) continue;
      const coordKey = `${site.latitude.toFixed(4)}_${site.longitude.toFixed(4)}`;
      const existing = coordMap.get(coordKey);
      if (!existing) {
        coordMap.set(coordKey, site);
      } else {
        const newKey = site.id ? `dsl_${site.id}` : `${site.latitude}_${site.longitude}`;
        const existingKey = existing.id ? `dsl_${existing.id}` : `${existing.latitude}_${existing.longitude}`;
        const existingMatchesActive = activeId && existingKey === activeId;
        const newMatchesActive = activeId && newKey === activeId;
        // Never replace a site that matches the active ID
        if (existingMatchesActive) {
          // But still merge dive_count from the duplicate if it's higher
          if ((site.dive_count || 0) > (existing.dive_count || 0)) {
            existing.dive_count = site.dive_count;
          }
          continue;
        }
        // Prefer the site matching the active ID
        if (newMatchesActive) {
          coordMap.set(coordKey, site);
        // Otherwise prefer the one with a higher dive_count
        } else if ((site.dive_count || 0) > (existing.dive_count || 0)) {
          coordMap.set(coordKey, site);
        }
      }
    }
    const uniqueSites = Array.from(coordMap.values());

    uniqueSites.forEach((site, index) => {
      if (site.latitude == null || site.longitude == null) return;

      // Match using dive_site_list id (dsl_ prefix) or lat_lng fallback
      const siteKey = site.id ? `dsl_${site.id}` : `${site.latitude}_${site.longitude}`;
      // In allSites mode, ALL pins are red (active). In selectedSite mode, only matched pin is red.
      const isActive = mode === 'allSites' || (mode === 'selectedSite' && siteKey === activeId);
      const lngLat = [site.longitude, site.latitude];
      bounds.extend(lngLat);

      const el = document.createElement('div');
      el.className = 'scuba-flag-marker';

      const diveCount = site.dive_count || 0;
      const scale = isActive ? 0.5 : 0.4;

      const pinBodyFill = isActive ? '#8B140E' : '#666';
      const circleFill = isActive ? '#E11913' : '#999';
      const stripeFill = isActive ? '#FFF9E8' : '#ddd';
      const borderStroke = isActive ? '#5E0D09' : '#555';

      el.innerHTML = `
        <div style="position: relative; width: ${64 * scale}px; height: ${80 * scale}px;">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 80" width="${64 * scale}" height="${80 * scale}" style="display: block;">
            <defs>
              <filter id="shadow-${index}" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#000000" flood-opacity="0.28"/>
              </filter>
            </defs>
            <path d="M32 76 C32 76 8 45 8 28 C8 14.745 18.745 4 32 4 C45.255 4 56 14.745 56 28 C56 45 32 76 32 76 Z" fill="${pinBodyFill}" filter="url(#shadow-${index})"/>
            <circle cx="32" cy="28" r="22" fill="${circleFill}"/>
            <path d="M15.7 13.2 L50.8 42.5 L45.7 48.6 L10.6 19.3 Z" fill="${stripeFill}"/>
            <path d="M15 25 C17 13 27 8 38 10 C27 11 18 17 15 25 Z" fill="#FFFFFF" opacity="0.18"/>
            <path d="M32 76 C32 76 8 45 8 28 C8 14.745 18.745 4 32 4 C45.255 4 56 14.745 56 28 C56 45 32 76 32 76 Z" fill="none" stroke="${borderStroke}" stroke-width="3"/>
          </svg>
          ${diveCount > 0 ? `<div style="
            position: absolute; top: -10px; right: -12px;
            background: #111;
            color: #fff;
            font-size: 13px;
            font-weight: 800;
            font-family: system-ui, -apple-system, sans-serif;
            width: 26px;
            height: 26px;
            border-radius: 13px;
            display: flex;
            align-items: center;
            justify-content: center;
            border: 2.5px solid #4fc3ff;
            box-shadow: 0 1px 4px rgba(0,0,0,.6);
            line-height: 1;
          ">${diveCount}</div>` : ''}
        </div>
      `;

      const siteName = site.dive_site_name || 'Unknown Site';
      const location = [site.city_island, site.country_region].filter(Boolean).join(', ');
      const popupHtml = `<b>${siteName}</b>${location ? `<br/>📍 ${location}` : ''}${diveCount > 0 ? `<br/>🤿 ${diveCount} dive${diveCount > 1 ? 's' : ''}` : ''}`;

      const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat(lngLat)
        .setPopup(
          new maplibregl.Popup({ offset: 45 })
            .setHTML(popupHtml)
        )
        .addTo(map);

      markersRef.current.push(marker);
    });

    // Auto-open popup for the active marker in selectedSite mode
    if (mode === 'selectedSite' && activeId) {
      const activeMarker = markersRef.current.find(m => {
        const lngLat = m.getLngLat();
        if (!lngLat) return false;
        const activeSite = sites.find(s => {
          if (s.latitude == null || s.longitude == null) return false;
          const key = s.id ? `dsl_${s.id}` : `${s.latitude}_${s.longitude}`;
          return key === activeId;
        });
        return activeSite &&
          Math.abs(lngLat.lng - activeSite.longitude) < 0.0001 &&
          Math.abs(lngLat.lat - activeSite.latitude) < 0.0001;
      });
      if (activeMarker) {
        activeMarker.togglePopup();
      }
    }

    // Fit bounds
    if (mode === 'allSites' && !bounds.isEmpty()) {
      map.fitBounds(bounds, { padding: 80, maxZoom: 10 });
    } else if (mode === 'selectedSite' && activeId) {
      const activeSite = sites.find(s => {
        const key = s.id ? `dsl_${s.id}` : `${s.latitude}_${s.longitude}`;
        return key === activeId;
      });
      if (activeSite && activeSite.latitude != null && activeSite.longitude != null) {
        map.flyTo({
          center: [activeSite.longitude, activeSite.latitude],
          zoom: 12,
          duration: 1000
        });
      }
    }
  }

  // Reset map to initial view
  const handleReset = () => {
    const map = mapInstance.current;
    if (!map) return;
    setSelectedCity(null);
    if (initialViewRef.current) {
      map.flyTo({
        center: initialViewRef.current.center,
        zoom: initialViewRef.current.zoom,
        duration: 1000
      });
    } else {
      map.flyTo({
        center: MAP_CENTER,
        zoom: MAP_ZOOM,
        duration: 1000
      });
    }
  };

  return (
    <div className="map-overlay open" onClick={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}>
      <div className="map-card">
        <div className="map-card-header">
          <span className="map-card-title">
            {mode === 'allSites' ? 'All Dive Sites' : 'Dive Site Map'}
          </span>
          <div className="map-header-actions">
            <button className="map-reset-btn" onClick={handleReset} title="Reset Map View">
              ↺
            </button>
            <button className="map-close-btn" onClick={onClose}>&times;</button>
          </div>
        </div>
        <div className="map-body">
          {mode === 'allSites' && cities.length > 0 && (
            <div className="map-sidebar">
              <div className="map-sidebar-title">Cities / Islands</div>
              <div className="map-sidebar-list">
                {cities.map(city => (
                  <div
                    key={city.name}
                    className={`map-sidebar-item ${selectedCity === city.name ? 'active' : ''}`}
                    onClick={() => setSelectedCity(selectedCity === city.name ? null : city.name)}
                  >
                    {city.name}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div ref={mapContainer} className="map-container" />
        </div>
      </div>
    </div>
  );
}