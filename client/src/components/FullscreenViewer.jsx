import { useEffect, useCallback, useState, useRef, useMemo } from 'react';
import { MEDIA_BASE, markPhotoViewed, unmarkPhotoViewed, toggleLike } from '../utils/api';
import AdminEditPanel from './AdminEditPanel';

export default function FullscreenViewer({ photo, onClose, onPrev, onNext, hasPrev, hasNext, onMapClick, admin, onPhotoUpdated, debugMode, diveSites, currentIndex, totalPhotos, onPhotoViewed, onLikeToggle }) {
  const [infoCollapsed, setInfoCollapsed] = useState(false);
  const [currentPhoto, setCurrentPhoto] = useState(photo);
  const dwellTimerRef = useRef(null);

  // Zoom/pan state
  const imageWrapRef = useRef(null);
  const imageRef = useRef(null);
  const fitScale = useRef(1);
  const fitTx = useRef(0);
  const fitTy = useRef(0);
  const userScale = useRef(1);
  const userTx = useRef(0);
  const userTy = useRef(0);
  const pointers = useRef(new Map());
  const pinchStart = useRef(null);
  const isPanning = useRef(false);
  const swipeStartX = useRef(0);
  const swipeOffset = useRef(0);
  const swipeActive = useRef(false);
  const adminEditRef = useRef(null);

  useEffect(() => {
    setCurrentPhoto(photo);
    setInfoCollapsed(false);
    // Reset zoom on new photo
    userScale.current = 1;
    userTx.current = 0;
    userTy.current = 0;
  }, [photo]);

  const computeFit = useCallback(() => {
    const wrap = imageWrapRef.current;
    const img = imageRef.current;
    if (!wrap || !img) return;
    const boxW = wrap.clientWidth;
    const boxH = wrap.clientHeight;
    const imgW = img.naturalWidth || 1;
    const imgH = img.naturalHeight || 1;
    fitScale.current = Math.min(boxW / imgW, boxH / imgH);
    fitTx.current = (boxW - imgW * fitScale.current) / 2;
    fitTy.current = (boxH - imgH * fitScale.current) / 2;
  }, []);

  const applyTransform = useCallback(() => {
    const img = imageRef.current;
    if (!img) return;
    const s = fitScale.current * userScale.current;
    const x = fitTx.current + userTx.current;
    const y = fitTy.current + userTy.current;
    img.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
    const wrap = imageWrapRef.current;
    if (wrap) {
      wrap.style.cursor = userScale.current > 1.001 ? (isPanning.current ? 'grabbing' : 'grab') : 'default';
    }
  }, []);

  const fitToScreen = useCallback(() => {
    userScale.current = 1;
    userTx.current = 0;
    userTy.current = 0;
    computeFit();
    applyTransform();
  }, [computeFit, applyTransform]);

  const zoomAt = useCallback((px, py, factor) => {
    const newScale = Math.min(8, Math.max(1, userScale.current * factor));
    if (newScale === userScale.current) return;
    if (newScale === 1) {
      fitToScreen();
      return;
    }
    const totalOldScale = fitScale.current * userScale.current;
    const ix = (px - (fitTx.current + userTx.current)) / totalOldScale;
    const iy = (py - (fitTy.current + userTy.current)) / totalOldScale;
    userScale.current = newScale;
    const totalNewScale = fitScale.current * userScale.current;
    userTx.current = px - fitTx.current - ix * totalNewScale;
    userTy.current = py - fitTy.current - iy * totalNewScale;
    applyTransform();
  }, [fitToScreen, applyTransform]);

  useEffect(() => {
    const img = imageRef.current;
    if (!img) return;
    const onLoad = () => {
      img.style.width = img.naturalWidth + 'px';
      img.style.height = img.naturalHeight + 'px';
      fitToScreen();
    };
    if (img.complete && img.naturalWidth > 0) {
      onLoad();
    } else {
      img.addEventListener('load', onLoad);
      return () => img.removeEventListener('load', onLoad);
    }
  }, [currentPhoto?.id, fitToScreen]);

  useEffect(() => {
    if (imageRef.current && imageRef.current.naturalWidth > 0) {
      const timer = setTimeout(() => fitToScreen(), 350);
      return () => clearTimeout(timer);
    }
  }, [infoCollapsed, fitToScreen]);

  useEffect(() => {
    let resizeTimer = null;
    const onResize = () => {
      if (imageRef.current && imageRef.current.naturalWidth > 0) {
        if (resizeTimer) clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => fitToScreen(), 200);
      }
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      if (resizeTimer) clearTimeout(resizeTimer);
    };
  }, [fitToScreen]);

  const handlePointerDown = useCallback((e) => {
    const wrap = imageWrapRef.current;
    if (!wrap) return;
    wrap.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 1) {
      if (userScale.current > 1.001) {
        isPanning.current = true;
        applyTransform();
      } else {
        swipeActive.current = true;
        swipeOffset.current = 0;
        swipeStartX.current = e.clientX;
      }
    }

    if (pointers.current.size === 2) {
      swipeActive.current = false;
      const pts = Array.from(pointers.current.values());
      pinchStart.current = {
        dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
        userScale: userScale.current
      };
    }
  }, [applyTransform]);

  const handlePointerMove = useCallback((e) => {
    if (!pointers.current.has(e.pointerId)) return;
    const prev = pointers.current.get(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.current.size === 1) {
      if (swipeActive.current) {
        swipeOffset.current = e.clientX - swipeStartX.current;
      } else if (userScale.current > 1.001) {
        userTx.current += (e.clientX - prev.x);
        userTy.current += (e.clientY - prev.y);
        applyTransform();
      }
    } else if (pointers.current.size === 2 && pinchStart.current) {
      const pts = Array.from(pointers.current.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const ratio = dist / pinchStart.current.dist;
      const newScale = Math.min(8, Math.max(1, pinchStart.current.userScale * ratio));
      if (newScale === 1) {
        fitToScreen();
      } else {
        const rect = imageWrapRef.current.getBoundingClientRect();
        const midX = ((pts[0].x + pts[1].x) / 2) - rect.left;
        const midY = ((pts[0].y + pts[1].y) / 2) - rect.top;
        zoomAt(midX, midY, newScale / userScale.current);
      }
    }
  }, [applyTransform, fitToScreen, zoomAt]);

  const handlePointerUp = useCallback((e) => {
    if (swipeActive.current) {
      swipeActive.current = false;
      const absOffset = Math.abs(swipeOffset.current);
      if (absOffset > 50) {
        if (swipeOffset.current < 0 && hasNext) onNext();
        else if (swipeOffset.current > 0 && hasPrev) onPrev();
      }
    }
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchStart.current = null;
    isPanning.current = false;
    applyTransform();
  }, [hasNext, hasPrev, onNext, onPrev, applyTransform]);

  const handlePointerCancel = useCallback((e) => {
    swipeActive.current = false;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchStart.current = null;
    isPanning.current = false;
    applyTransform();
  }, [applyTransform]);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const rect = imageWrapRef.current.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    zoomAt(centerX, centerY, factor);
  }, [zoomAt]);

  // Close with unsaved changes check
  const handleClose = useCallback(() => {
    if (adminEditRef.current && adminEditRef.current.hasUnsavedChanges()) {
      if (!confirm('You have unsaved changes. Discard them?')) return;
    }
    onClose();
  }, [onClose]);

  // Admin mode: forward navigation to AdminEditPanel
  const handleAdminNav = useCallback((dir) => {
    if (adminEditRef.current && adminEditRef.current.navigateTo) {
      adminEditRef.current.navigateTo(dir);
    }
  }, []);

  const handleKeyDown = useCallback((e) => {
    // Don't handle arrow keys when user is typing in an input/textarea
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) {
      return;
    }
    switch (e.key) {
      case 'Escape':
        handleClose();
        break;
      case 'ArrowLeft':
        if (admin) {
          handleAdminNav('prev');
        } else if (hasPrev) {
          onPrev();
        }
        break;
      case 'ArrowRight':
        if (admin) {
          handleAdminNav('next');
        } else if (hasNext) {
          onNext();
        }
        break;
    }
  }, [handleClose, onPrev, onNext, hasPrev, hasNext, admin, handleAdminNav]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [handleKeyDown]);

  // Derive liked/likeCount directly from currentPhoto (parent updates viewerPhoto on toggle)
  const liked = currentPhoto?.liked_by_me || false;
  const likeCount = currentPhoto?.like_count || 0;

  // 10-second dwell timer — mark photo as viewed if viewing for >=10s
  useEffect(() => {
    if (admin) return; // Don't track views in admin mode

    dwellTimerRef.current = setTimeout(() => {
      if (currentPhoto?.id) {
        markPhotoViewed(currentPhoto.id).catch(() => {});
        if (onPhotoViewed) onPhotoViewed(currentPhoto.id, true);
        // Update local state so the toolbar viewed badge shows immediately
        setCurrentPhoto(prev => prev ? { ...prev, viewed_by_me: true } : prev);
      }
    }, 10000);

    return () => {
      if (dwellTimerRef.current) {
        clearTimeout(dwellTimerRef.current);
        dwellTimerRef.current = null;
      }
    };
  }, [currentPhoto?.id, admin, onPhotoViewed]);

  // Heart like toggle handler — calls API, parent updates viewerPhoto on resolve
  const handleLikeToggle = useCallback(async () => {
    if (!currentPhoto?.id) return;
    // Optimistic: immediately update parent so the viewerPhoto prop reflects the toggle
    const nextLiked = !liked;
    const nextCount = liked ? likeCount - 1 : likeCount + 1;
    if (onLikeToggle) onLikeToggle(currentPhoto.id, nextLiked, nextCount);
    try {
      const result = await toggleLike(currentPhoto.id);
      // Apply actual server result
      if (onLikeToggle) onLikeToggle(currentPhoto.id, result.liked, result.count);
    } catch (err) {
      // Revert on failure — re-toggle back to original
      if (onLikeToggle) onLikeToggle(currentPhoto.id, liked, likeCount);
    }
  }, [currentPhoto?.id, liked, likeCount, onLikeToggle]);

  if (!currentPhoto) return null;

  const displayUrl = currentPhoto.display_path
    ? `${MEDIA_BASE}/cache/${currentPhoto.display_path}`
    : `${MEDIA_BASE}/cache/${currentPhoto.thumbnail_path || ''}`;

  const hasLocation = currentPhoto.latitude != null && currentPhoto.longitude != null;
  const viewerClassName = `fullscreen-viewer${admin ? ' admin-active' : ''}`;
  const diveSiteName = currentPhoto.dive_site_name || currentPhoto.dive_site || '';

  // Look up the matching dive site and its dive count
  const matchingSite = useMemo(() => {
    if (!diveSites || !currentPhoto.dive_site_list_id) return null;
    return diveSites.find(s => s.id === currentPhoto.dive_site_list_id) || null;
  }, [diveSites, currentPhoto.dive_site_list_id]);
  const diveSiteDiveCount = matchingSite ? matchingSite.dive_count || 0 : 0;

  const handleSaved = (updated) => {
    if (updated) {
      setCurrentPhoto(updated);
      if (onPhotoUpdated) onPhotoUpdated(updated);
    }
  };

  return (
    <div className={viewerClassName}>
      <div className={`viewer-toolbar${admin ? ' admin-active' : ''}`}>
        {/* Row 1: Close + Species Name (centered) */}
        <div className="viewer-toolbar-row viewer-toolbar-row1">
          <div className="viewer-toolbar-left">
            <button className="viewer-btn close-btn" onClick={handleClose} title="Close (Esc)">
              &times;
            </button>
          </div>
          <div className="viewer-counter">
            {currentPhoto.title || currentPhoto.filename} {totalPhotos !== undefined ? `(${(currentIndex ?? 0) + 1} of ${totalPhotos})` : ''}
          </div>
          <div className="viewer-toolbar-row1-spacer"></div>
        </div>
        {/* Row 2: Action buttons (heart, viewed, flyto, zoom, fit, download) */}
        <div className="viewer-toolbar-row viewer-toolbar-row2">
          <div className="viewer-toolbar-actions">
            {!admin && (
              <>
                <span className={`toolbar-heart-btn ${liked ? 'liked' : ''}`} onClick={handleLikeToggle} title={liked ? 'Unlike' : 'Like'}>
                  <span className="toolbar-heart-ico">{liked ? '❤️' : '🤍'}</span>
                  <span className="toolbar-like-count">{likeCount}</span>
                </span>
                <span
                  className={`toolbar-viewed-badge${currentPhoto.viewed_by_me ? '' : ' not-viewed'}`}
                  onClick={async () => {
                    if (!currentPhoto?.id) return;
                    if (currentPhoto.viewed_by_me) {
                      try { await unmarkPhotoViewed(currentPhoto.id); } catch {}
                      setCurrentPhoto(prev => prev ? { ...prev, viewed_by_me: false } : prev);
                      if (onPhotoViewed) onPhotoViewed(currentPhoto.id, false);
                      if (dwellTimerRef.current) {
                        clearTimeout(dwellTimerRef.current);
                      }
                      dwellTimerRef.current = setTimeout(async () => {
                        if (currentPhoto?.id) {
                          try { await markPhotoViewed(currentPhoto.id); } catch {}
                          setCurrentPhoto(prev => prev ? { ...prev, viewed_by_me: true } : prev);
                          if (onPhotoViewed) onPhotoViewed(currentPhoto.id);
                        }
                        dwellTimerRef.current = null;
                      }, 10000);
                    } else {
                      try { await markPhotoViewed(currentPhoto.id); } catch {}
                      setCurrentPhoto(prev => prev ? { ...prev, viewed_by_me: true } : prev);
                      if (onPhotoViewed) onPhotoViewed(currentPhoto.id, true);
                      if (dwellTimerRef.current) {
                        clearTimeout(dwellTimerRef.current);
                        dwellTimerRef.current = null;
                      }
                    }
                  }}
                  title={currentPhoto.viewed_by_me ? 'Click to unmark (starts 10s timer to mark again)' : 'Click to mark as viewed'}
                >
                  {currentPhoto.viewed_by_me ? '✓ Viewed' : '◯ Unviewed'}
                </span>
              </>
            )}
            {hasLocation && (
              <span className="viewer-map-badge-wrap">
                <button
                  className="viewer-map-site-btn"
                  onClick={() => onMapClick && onMapClick(currentPhoto)}
                  title="Fly to dive site"
                >
                  <svg viewBox="0 0 64 80" width="14" height="18" aria-hidden="true" style={{display:'block',flexShrink:0}}>
                    <defs>
                      <filter id="mappin-flyto" x="-20%" y="-20%" width="140%" height="140%">
                        <feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#000000" flood-opacity="0.28"/>
                      </filter>
                    </defs>
                    <path d="M32 76 C32 76 8 45 8 28 C8 14.745 18.745 4 32 4 C45.255 4 56 14.745 56 28 C56 45 32 76 32 76 Z" fill="#8B140E" filter="url(#mappin-flyto)"/>
                    <circle cx="32" cy="28" r="22" fill="#E11913"/>
                    <path d="M15.7 13.2 L50.8 42.5 L45.7 48.6 L10.6 19.3 Z" fill="#FFF9E8"/>
                    <path d="M15 25 C17 13 27 8 38 10 C27 11 18 17 15 25 Z" fill="#FFFFFF" opacity="0.18"/>
                    <path d="M32 76 C32 76 8 45 8 28 C8 14.745 18.745 4 32 4 C45.255 4 56 14.745 56 28 C56 45 32 76 32 76 Z" fill="none" stroke="#5E0D09" stroke-width="3"/>
                  </svg>
                  <span className="viewer-map-site-label">FlyTo Site</span>
                </button>
                {diveSiteDiveCount > 0 && (
                  <span className="viewer-map-site-badge">{diveSiteDiveCount}</span>
                )}
              </span>
            )}
            {!admin && (
              <>
                <button className="viewer-btn viewer-zoom-btn zoom-out-btn" onClick={() => {
                  const r = imageWrapRef.current.getBoundingClientRect();
                  zoomAt(r.width / 2, r.height / 2, 0.8);
                }} title="Zoom Out">−</button>
                <button className="viewer-btn viewer-zoom-btn zoom-in-btn" onClick={() => {
                  const r = imageWrapRef.current.getBoundingClientRect();
                  zoomAt(r.width / 2, r.height / 2, 1.25);
                }} title="Zoom In">+</button>
                <button className="viewer-btn viewer-reset-btn" onClick={fitToScreen} title="Fit / Reset">⟲</button>
              </>
            )}
            {currentPhoto.relative_path && (
              <a
                className="viewer-btn viewer-download-btn"
                href={`/photos/${currentPhoto.relative_path}`}
                download
                title="Download Original"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" style={{display:'block'}}>
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
                  <polyline points="7 10 12 15 17 10" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
                  <line x1="12" y1="15" x2="12" y2="3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
                </svg>
              </a>
            )}
          </div>
        </div>
      </div>

      {admin ? (
        /* ADMIN MODE: side-by-side layout */
        <div className="admin-split-layout">
          <div className="admin-split-photo">
            <div className="viewer-image-area" style={{ height: '100%' }}>
              <div
                className="viewer-image-wrap"
                ref={imageWrapRef}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerCancel}
                onWheel={handleWheel}
                style={{ width: '100%', height: '100%' }}
              >
                <img
                  ref={imageRef}
                  className="viewer-image-zoomed"
                  src={displayUrl}
                  alt={currentPhoto.title || currentPhoto.filename}
                  draggable={false}
                />
              </div>

              {debugMode && (
                <div className="debug-overlay viewer-debug-overlay">
                  <span className="debug-filename">{currentPhoto.filename}</span>
                  {currentPhoto.latitude != null && currentPhoto.longitude != null && (
                    <span className="debug-location">{currentPhoto.latitude}, {currentPhoto.longitude}</span>
                  )}
                </div>
              )}
            </div>
          </div>
          <div className="admin-split-editor">
            <AdminEditPanel
              ref={adminEditRef}
              photo={currentPhoto}
              onSaved={handleSaved}
              onCancel={() => {}}
              onNavigate={onPrev}
              onNavigateNext={onNext}
              hasPrev={hasPrev}
              hasNext={hasNext}
            />
          </div>
        </div>
      ) : (
        /* NORMAL MODE: existing full-photo layout */
        <>
          <div className="viewer-image-area">
            <button
              className={`viewer-overlay-btn prev-overlay-btn ${!hasPrev ? 'disabled' : ''}`}
              onClick={hasPrev ? onPrev : undefined}
              disabled={!hasPrev}
              title="Previous (←)"
            >‹</button>

            <div
              className="viewer-image-wrap"
              ref={imageWrapRef}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
              onWheel={handleWheel}
            >
              <img
                ref={imageRef}
                className="viewer-image-zoomed"
                src={displayUrl}
                alt={currentPhoto.title || currentPhoto.filename}
                draggable={false}
              />
            </div>

            <button
              className={`viewer-overlay-btn next-overlay-btn ${!hasNext ? 'disabled' : ''}`}
              onClick={hasNext ? onNext : undefined}
              disabled={!hasNext}
              title="Next (→)"
            >›</button>

            {debugMode && (
              <div className="debug-overlay viewer-debug-overlay">
                <span className="debug-filename">{currentPhoto.filename}</span>
                {currentPhoto.latitude != null && currentPhoto.longitude != null && (
                  <span className="debug-location">{currentPhoto.latitude}, {currentPhoto.longitude}</span>
                )}
              </div>
            )}
          </div>

          <div className={`viewer-info-card${infoCollapsed ? ' collapsed' : ''}`}>
            <div className="viewer-info-inner">
              <div className="viewer-info-collapse-bar viewer-glow-pulse" onClick={() => setInfoCollapsed(!infoCollapsed)}>
                <span className="collapse-arrow">{infoCollapsed ? '^' : 'v'}</span>
              </div>

              <div className="info-top-row">
                <h2 className="info-species-name">{currentPhoto.title || <em>Untitled</em>}</h2>
                <div className="info-pills">
                  {currentPhoto.country && (
                    <span className="pill">
                      <span className="pill-ico">🏝️</span>
                      {currentPhoto.country}
                    </span>
                  )}
                  {hasLocation && (
                    <span className="pill location" onClick={() => onMapClick && onMapClick(currentPhoto)} title="Show on map">
                      <svg viewBox="0 0 64 80" width="14" height="18" aria-hidden="true" style={{verticalAlign:'middle'}}>
                        <defs>
                          <filter id="mappin-pill" x="-20%" y="-20%" width="140%" height="140%">
                            <feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#000000" flood-opacity="0.28"/>
                          </filter>
                        </defs>
                        <path d="M32 76 C32 76 8 45 8 28 C8 14.745 18.745 4 32 4 C45.255 4 56 14.745 56 28 C56 45 32 76 32 76 Z" fill="#8B140E" filter="url(#mappin-pill)"/>
                        <circle cx="32" cy="28" r="22" fill="#E11913"/>
                        <path d="M15.7 13.2 L50.8 42.5 L45.7 48.6 L10.6 19.3 Z" fill="#FFF9E8"/>
                        <path d="M15 25 C17 13 27 8 38 10 C27 11 18 17 15 25 Z" fill="#FFFFFF" opacity="0.18"/>
                        <path d="M32 76 C32 76 8 45 8 28 C8 14.745 18.745 4 32 4 C45.255 4 56 14.745 56 28 C56 45 32 76 32 76 Z" fill="none" stroke="#5E0D09" stroke-width="3"/>
                      </svg>
                      {diveSiteName || 'Map'}
                    </span>
                  )}
                  {currentPhoto.camera_body && (
                    <span className="pill">
                      <span className="pill-ico">📷</span>
                      {currentPhoto.camera_body}
                    </span>
                  )}
                  {currentPhoto.species && (
                    <span className="pill">
                      <span className="pill-ico">📏</span>
                      {currentPhoto.species}
                    </span>
                  )}
                </div>
              </div>

              {!infoCollapsed && (
                <>
                  {currentPhoto.description && (
                    <div className="info-description">{currentPhoto.description}</div>
                  )}
                  <div className="info-meta-list">
                    {currentPhoto.lens && (
                      <span className="meta-item"><strong>Lens:</strong> {currentPhoto.lens}</span>
                    )}
                    {currentPhoto.lighting && (
                      <span className="meta-item"><strong>Lighting:</strong> {currentPhoto.lighting}</span>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}