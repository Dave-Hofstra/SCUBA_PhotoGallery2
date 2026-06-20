import { useState, useEffect, useRef, useMemo } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { VECTOR_STYLE as MAP_STYLE, DEFAULT_CENTER as MAP_CENTER, DEFAULT_ZOOM as MAP_ZOOM } from '../config/mapConfig';

export default function DiveMapModal_FlyTo({ sites, activeDiveSiteId, onClose }) {
  const mapContainer = useRef(null);
  const mapInstance = useRef(null);
  const markersRef = useRef([]);
  const initialViewRef = useRef(null);
  const [zoomLevel, setZoomLevel] = useState(MAP_ZOOM);

  // Determine active site
  const activeSite = useMemo(() => {
    if (!activeDiveSiteId) return null;
    const activeId = parseInt(activeDiveSiteId.replace('dsl_', ''), 10);
    return sites.find(s => s.id === activeId) || null;
  }, [activeDiveSiteId, sites]);

  // Helper to create marker HTML
  // Active = standard red scuba flag, Inactive = grey scuba flag
  const createScubaMarker = (diveCount, index, isActive = false) => {
    const scale = 0.5;
    const pinBodyFill = isActive ? '#8B140E' : '#4a4a4a';
    const circleFill = isActive ? '#E11913' : '#888';
    const stripeFill = '#FFF9E8';
    const borderStroke = isActive ? '#5E0D09' : '#333';
    const badgeBorder = isActive ? '#4fc3ff' : '#666';

    return `
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
          border: 2.5px solid ${badgeBorder};
          box-shadow: 0 2px 6px rgba(0,0,0,0.4);
        ">${diveCount}</div>` : ''}
      </div>
    `;
  };

  // Remove all markers
  function clearAllMarkers() {
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];
  }

  useEffect(() => {
    if (!mapContainer.current) return;

    // Initialize map centered on the active site at zoom 9, then fly to zoom 14
    const initialCenter = (activeSite && activeSite.latitude != null && activeSite.longitude != null)
      ? [activeSite.longitude, activeSite.latitude]
      : MAP_CENTER;
    const initialZoom = activeSite ? 9 : MAP_ZOOM;

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: MAP_STYLE,
      center: initialCenter,
      zoom: initialZoom,
      attributionControl: true
    });

    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    mapInstance.current = map;

    // Create individual site markers with active site highlighted in red
    function createMarkers() {
      clearAllMarkers();
      let activeMarker = null;
      // Sort: active site last (topmost layer), then rest by dive_count ascending
      const sortedSites = [...sites].sort((a, b) => {
        const aKey = `dsl_${a.id}`;
        const bKey = `dsl_${b.id}`;
        if (aKey === activeDiveSiteId) return 1;
        if (bKey === activeDiveSiteId) return -1;
        return (a.dive_count || 0) - (b.dive_count || 0);
      });
      sortedSites.forEach((site, index) => {
        if (site.latitude == null || site.longitude == null) return;
        const lngLat = [site.longitude, site.latitude];

        const siteKey = `dsl_${site.id}`;
        const isActive = activeDiveSiteId === siteKey;

        const el = document.createElement('div');
        el.className = 'scuba-flag-marker';
        el.innerHTML = createScubaMarker(site.dive_count || 0, index, isActive);
        el.style.cursor = 'pointer';

        const siteName = site.dive_site_name || 'Unknown Site';
        const location = [site.city_island, site.country_region].filter(Boolean).join(', ');
        const diveCount = site.dive_count || 0;
        const popupHtml = `<b>${siteName}</b>${location ? `<br/>📍 ${location}` : ''}${diveCount > 0 ? `<br/>🤿 ${diveCount} dive${diveCount > 1 ? 's' : ''}` : ''}`;

        const popup = new maplibregl.Popup({ offset: 45 }).setHTML(popupHtml);
        const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat(lngLat)
          .setPopup(popup)
          .addTo(map);
        
        markersRef.current.push(marker);

        if (isActive) {
          activeMarker = marker;
        }
      });

      // Auto-open active marker popup after a short delay
      if (activeMarker) {
        setTimeout(() => {
          activeMarker.togglePopup();
        }, 500);
      }
    }

    map.on('load', () => {
      createMarkers();

      map.on('zoom', () => {
        setZoomLevel(map.getZoom());
      });

      // Wait for map to be fully idle (tiles rendered) before starting flyTo
      map.once('idle', () => {
        // Fly to active site: zoom from 10 to 15 with smooth animation
        if (activeSite && activeSite.latitude != null && activeSite.longitude != null) {
          map.flyTo({
            center: [activeSite.longitude, activeSite.latitude],
            zoom: 15,
            duration: 1500
          });
        }

        // Record initial view after flyTo settles
        map.once('moveend', () => {
          initialViewRef.current = {
            center: map.getCenter(),
            zoom: map.getZoom()
          };
        });
      });
    });

    return () => {
      document.querySelectorAll('.maplibregl-popup').forEach(el => el.remove());
      clearAllMarkers();
      map.remove();
      mapInstance.current = null;
    };
  }, [sites, activeDiveSiteId, activeSite]);

  // Handle resize when modal opens
  useEffect(() => {
    if (mapInstance.current) {
      setTimeout(() => {
        mapInstance.current.resize();
      }, 100);
    }
  }, []);

  // Reset map to initial view
  const handleReset = () => {
    const map = mapInstance.current;
    if (!map) return;
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
          <span className="map-card-title">Dive Site Map</span>
          <div className="map-header-actions">
            <button className="map-reset-btn" onClick={handleReset} title="Reset Map View">
              ↺
            </button>
            <button className="map-close-btn" onClick={onClose}>&times;</button>
          </div>
        </div>
        <div className="map-body">
          <div ref={mapContainer} className="map-container">
            <div className="map-zoom-indicator">Zoom: {zoomLevel.toFixed(1)}</div>
          </div>
        </div>
      </div>
    </div>
  );
}