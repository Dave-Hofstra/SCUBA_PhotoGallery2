import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchLibraries, fetchLibraryPhotos, fetchDiveSites, adminLogin, adminLogout, checkAdmin, triggerSync, MEDIA_BASE } from '../utils/api';
import FullscreenViewer from '../components/FullscreenViewer';
import DiveMapModal from '../components/DiveMapModal';
import MapTestModal from '../components/MapTestModal';
import DiveSiteListEditor from '../components/DiveSiteListEditor';
import { APP_VERSION } from '../config/appConfig';

export default function GalleryPage() {
  const [libraries, setLibraries] = useState([]);
  const [activeLibraryId, setActiveLibraryId] = useState(null);
  const [categories, setCategories] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [diveSites, setDiveSites] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [viewerPhoto, setViewerPhoto] = useState(null);
  const [viewerIndex, setViewerIndex] = useState(-1);
  const [mapModal, setMapModal] = useState({ open: false, mode: 'allSites', activeSiteId: null });
  const [admin, setAdmin] = useState(false);
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [passcode, setPasscode] = useState('');
  const [showSiteListEditor, setShowSiteListEditor] = useState(false);
  const [debugMode, setDebugMode] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [showMapTest, setShowMapTest] = useState(false);
  const getInitialColumns = () => window.innerWidth >= 1024 ? 6 : 3;
  const [columns, setColumns] = useState(getInitialColumns);
  const passcodeRef = useRef(null);

  // Fetch libraries on mount
  useEffect(() => {
    fetchLibraries()
      .then(data => {
        // Sort: Wall_Photos first, then rest alphabetically by display_name
        const sorted = [...data].sort((a, b) => {
          if (a.name === 'Wall_Photos') return -1;
          if (b.name === 'Wall_Photos') return 1;
          return (a.display_name || a.name).localeCompare(b.display_name || b.name);
        });
        setLibraries(sorted);
        // Default to Wall_Photos library
        const wallPhotos = sorted.find(l => l.name === 'Wall_Photos');
        if (wallPhotos) {
          setActiveLibraryId(wallPhotos.id);
        } else if (sorted.length > 0) {
          setActiveLibraryId(sorted[0].id);
        }
        setLoading(false);
      })
      .catch(err => {
        setError('Failed to load libraries');
        setLoading(false);
      });

    // Check admin status
    checkAdmin().then(data => {
      setAdmin(data.admin);
    }).catch(() => {});
  }, []);

  // Auto-focus passcode input when login bar appears
  useEffect(() => {
    if (showAdminLogin && passcodeRef.current) {
      passcodeRef.current.focus();
    }
  }, [showAdminLogin]);

  // Debug mode toggle on 'd' key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'd' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Don't toggle if typing in an input
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        setDebugMode(prev => !prev);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Fetch photos when library changes
  useEffect(() => {
    if (!activeLibraryId) return;

    setLoading(true);
    Promise.all([
      fetchLibraryPhotos(activeLibraryId),
      fetchDiveSites()
    ])
      .then(([photoData, siteData]) => {
        setCategories(photoData.categories || []);
        setPhotos(photoData.photos || []);
        setDiveSites(siteData || []);
        setLoading(false);
      })
      .catch(err => {
        setError('Failed to load photos');
        setLoading(false);
      });
  }, [activeLibraryId]);

  const openViewer = useCallback((photo, index) => {
    setViewerPhoto(photo);
    setViewerIndex(index);
  }, []);

  const closeViewer = useCallback(() => {
    setViewerPhoto(null);
    setViewerIndex(-1);
  }, []);

  const handlePhotoUpdated = useCallback((updated) => {
    setPhotos(prev => prev.map(p => p.id === updated.id ? { ...p, ...updated } : p));
  }, []);

  const navigateViewer = useCallback((direction) => {
    const currentIndex = photos.findIndex(p => p.id === viewerPhoto?.id);
    if (currentIndex === -1) return;

    const newIndex = currentIndex + direction;
    if (newIndex < 0 || newIndex >= photos.length) return;

    setViewerPhoto(photos[newIndex]);
    setViewerIndex(newIndex);
  }, [photos, viewerPhoto]);

  const openAllSitesMap = useCallback(() => {
    setMapModal({ open: true, mode: 'allSites', activeSiteId: null });
  }, []);

  const openSiteMap = useCallback((photo) => {
    // Use dive_site_list_id for matching if available, otherwise fall back to lat_lng
    const siteId = photo.dive_site_list_id
      ? `dsl_${photo.dive_site_list_id}`
      : `${photo.latitude}_${photo.longitude}`;
    setMapModal({ open: true, mode: 'selectedSite', activeSiteId: siteId });
  }, []);

  const closeMap = useCallback(() => {
    setMapModal({ open: false, mode: 'allSites', activeSiteId: null });
  }, []);

  const handleAdminLogin = useCallback(async () => {
    try {
      const data = await adminLogin(passcode);
      if (data.success) {
        setAdmin(true);
        setShowAdminLogin(false);
        setPasscode('');
      }
    } catch (err) {
      alert('Invalid passcode');
    }
  }, [passcode]);

  const handleAdminLogout = useCallback(async () => {
    await adminLogout();
    setAdmin(false);
  }, []);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    try {
      const result = await triggerSync();
      alert(`Sync complete!\n\nCleanup: ${result.cleanup.recordsRemoved} removed, ${result.cleanup.cacheFilesRemoved} cache files\nScan: ${result.scan.length} libraries scanned\nProcessing: ${result.processing.succeeded} processed, ${result.processing.failed} failed`);
      // Refresh current library
      if (activeLibraryId) {
        const photoData = await fetchLibraryPhotos(activeLibraryId);
        setCategories(photoData.categories || []);
        setPhotos(photoData.photos || []);
      }
      // Refresh library list for updated counts
      const libData = await fetchLibraries();
      setLibraries(libData);
    } catch (err) {
      alert('Sync failed: ' + err.message);
    }
    setSyncing(false);
  }, [activeLibraryId]);

  // Determine CSS class for admin mode red tint
  const pageClassName = `gallery-page${admin ? ' admin-active' : ''}`;

  if (loading && libraries.length === 0) {
    return <div className="loading">Loading gallery...</div>;
  }

  if (error) {
    return <div className="error">{error}</div>;
  }

  return (
    <div className={pageClassName}>
      <header className="gallery-header">
        <div className="header-left">
          <a href="/" className="header-icon" title="Home" style={{color:'var(--text)'}}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" style={{display:'block'}}>
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
              <polyline points="9 22 9 12 15 12 15 22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
            </svg>
          </a>
          <button className="header-icon" onClick={openAllSitesMap} title="All Dive Sites">
            <svg viewBox="0 0 64 80" width="18" height="22" aria-hidden="true" style={{display:'block'}}>
              <defs>
                <filter id="mappin-header" x="-20%" y="-20%" width="140%" height="140%">
                  <feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#000000" flood-opacity="0.28"/>
                </filter>
              </defs>
              <path d="M32 76 C32 76 8 45 8 28 C8 14.745 18.745 4 32 4 C45.255 4 56 14.745 56 28 C56 45 32 76 32 76 Z" fill="#8B140E" filter="url(#mappin-header)"/>
              <circle cx="32" cy="28" r="22" fill="#E11913"/>
              <path d="M15.7 13.2 L50.8 42.5 L45.7 48.6 L10.6 19.3 Z" fill="#FFF9E8"/>
              <path d="M15 25 C17 13 27 8 38 10 C27 11 18 17 15 25 Z" fill="#FFFFFF" opacity="0.18"/>
              <path d="M32 76 C32 76 8 45 8 28 C8 14.745 18.745 4 32 4 C45.255 4 56 14.745 56 28 C56 45 32 76 32 76 Z" fill="none" stroke="#5E0D09" stroke-width="3"/>
            </svg>
          </button>
          <button className="header-library-btn" onClick={() => setShowMapTest(true)} title="Map Testing">
            Map Testing
          </button>
          <button className="header-library-btn" onClick={() => setSidebarOpen(true)} title="Libraries">
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" style={{display:'block',flexShrink:0}}>
              <path d="M12 6c-2-1.2-4.2-1.9-6.7-2.1C4.6 3.8 4 4.4 4 5.1V18c0 .7.5 1.3 1.2 1.4 2.6.2 4.8.9 6.8 2.1V6z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
              <path d="M12 6c2-1.2 4.2-1.9 6.7-2.1.7-.1 1.3.5 1.3 1.2V18c0 .7-.5 1.3-1.2 1.4-2.6.2-4.8.9-6.8 2.1V6z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
              <path d="M12 6v15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
            </svg>
            <span className="header-library-name">{libraries.find(l => l.id === activeLibraryId)?.display_name || 'Library'}</span>
          </button>
        </div>
        <h1>Dave Hofstra's SCUBA Photo Gallery</h1>
        <div className="header-columns-slider">
          <label className="columns-label">Columns:</label>
          <input
            type="range"
            min="2"
            max="14"
            value={columns}
            onChange={e => setColumns(parseInt(e.target.value))}
            className="columns-range"
          />
          <span className="columns-value">{columns}</span>
        </div>
        <div className="header-right">
          {admin && (
            <>
              <button className="header-icon" onClick={handleSync} title={syncing ? 'Syncing...' : 'Sync Libraries'} disabled={syncing}>
                {syncing ? '⏳' : '🔄'}
              </button>
              <button className="header-icon" onClick={() => setShowSiteListEditor(true)} title="Dive Site List">
                📋
              </button>
              <button className="header-icon" onClick={handleAdminLogout} title="Admin Logout">
                🔒
              </button>
            </>
          )}
          {debugMode && !admin && (
            <button className="header-icon" onClick={() => setShowAdminLogin(true)} title="Admin Login">
              🔒
            </button>
          )}
        </div>
      </header>

      {showAdminLogin && !admin && (
        <div className="admin-login-bar">
          <input
            ref={passcodeRef}
            type="password"
            placeholder="Admin passcode"
            value={passcode}
            onChange={e => setPasscode(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAdminLogin()}
          />
          <button onClick={handleAdminLogin}>Login</button>
        </div>
      )}

      {loading ? (
        <div className="loading">Loading photos...</div>
      ) : categories.length === 0 ? (
        <div className="empty">No photos found. Run a scan first.</div>
      ) : (
        <div className="gallery-content">
          {categories.map(category => (
            <section key={category.id} className="category-section">
              <h2 className="category-title">{category.display_name || category.name}</h2>
              <div className="photo-grid" style={{ '--cols-active': columns }}>
                {category.photos.map((photo, idx) => {
                  const globalIndex = photos.findIndex(p => p.id === photo.id);
                  return (
                    <div
                      key={photo.id}
                      className="photo-thumb"
                      onClick={() => openViewer(photo, globalIndex)}
                    >
                      <img
                        src={`${MEDIA_BASE}/cache/${photo.thumbnail_path || ''}`}
                        alt={photo.title || photo.filename}
                        loading="lazy"
                      />
                      <div className="thumb-info">
                        <div className="hoverTitle">{photo.title || photo.filename}</div>
                        <div className="hoverMetaContainer">
                          {photo.country && (
                            <span className="hoverMetaLine">
                              <span className="hoverIco">📍</span>
                              {photo.country}
                            </span>
                          )}
                          {photo.dive_site_name && (
                            <span className="hoverMetaLine">
                              <span className="hoverIco">🤿</span>
                              {photo.dive_site_name}
                            </span>
                          )}
                          {photo.camera_body && (
                            <span className="hoverMetaLine">
                              <span className="hoverIco">📷</span>
                              {photo.camera_body}
                            </span>
                          )}
                          {photo.species && (
                            <span className="hoverMetaLine">
                              <span className="hoverIco">📏</span>
                              {photo.species}
                            </span>
                          )}
                        </div>
                      </div>
                      {debugMode && (
                        <div className="debug-overlay">
                          <span className="debug-filename">{photo.filename}</span>
                          {photo.latitude != null && photo.longitude != null && (
                            <span className="debug-location">{photo.latitude}, {photo.longitude}</span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      {viewerPhoto && (
        <FullscreenViewer
          photo={viewerPhoto}
          onClose={closeViewer}
          onPrev={() => navigateViewer(-1)}
          onNext={() => navigateViewer(1)}
          hasPrev={viewerIndex > 0}
          hasNext={viewerIndex < photos.length - 1}
          onMapClick={(photo) => openSiteMap(photo)}
          admin={admin}
          onPhotoUpdated={handlePhotoUpdated}
          debugMode={debugMode}
        />
      )}

      {mapModal.open && (
        <DiveMapModal
          mode={mapModal.mode}
          sites={diveSites}
          activeDiveSiteId={mapModal.activeSiteId}
          onClose={closeMap}
        />
      )}

      {showMapTest && (
        <MapTestModal
          mode="allSites"
          sites={diveSites}
          activeDiveSiteId={null}
          onClose={() => setShowMapTest(false)}
        />
      )}

      {showSiteListEditor && (
        <DiveSiteListEditor
          sites={[]}
          onClose={() => setShowSiteListEditor(false)}
          onSaved={() => {}}
        />
      )}

      {/* Library Sidebar */}
      <div className={`library-sidebar-backdrop ${sidebarOpen ? 'open' : ''}`} onClick={() => setSidebarOpen(false)}></div>
      <aside className={`library-sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="library-sidebar-header">
          <span className="library-sidebar-title">Libraries</span>
          <button className="library-sidebar-close" onClick={() => setSidebarOpen(false)}>✕</button>
        </div>
        <div className="library-sidebar-list">
          {libraries.map(lib => (
            <div
              key={lib.id}
              className={`library-sidebar-item ${lib.id === activeLibraryId ? 'active' : ''}`}
              onClick={() => { setActiveLibraryId(lib.id); setSidebarOpen(false); }}
            >
              <span className="library-sidebar-name">{lib.display_name}</span>
              <span className="library-sidebar-badge">{lib.photo_count || 0}</span>
            </div>
          ))}
        </div>
      </aside>

      <div className="version-footer">
        <span className="debug-hint">debug: <a href="#" className="debug-link" onClick={(e) => { e.preventDefault(); setShowAdminLogin(prev => !prev); }}>d</a> key</span>
        <span>Version {APP_VERSION}</span>
      </div>
    </div>
  );
}