import { useEffect, useCallback, useState, useRef } from 'react';
import { MEDIA_BASE } from '../utils/api';
import AdminEditPanel from './AdminEditPanel';

export default function FullscreenViewer({ photo, onClose, onPrev, onNext, hasPrev, hasNext, onMapClick, admin, onPhotoUpdated, debugMode }) {
  const [infoCollapsed, setInfoCollapsed] = useState(false);
  const [currentPhoto, setCurrentPhoto] = useState(photo);

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
    // Update cursor classes
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

  // Re-fit on image load
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
  }, [currentPhoto, fitToScreen]);

  // Re-fit when info card collapses/expands (wait for CSS transition)
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
        // Debounce to let CSS layout settle (especially orientation changes)
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

  // Pointer handlers for zoom/pan/swipe
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
        // Swipe mode
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

  // Mouse wheel zoom (desktop, centered)
  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const rect = imageWrapRef.current.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    zoomAt(centerX, centerY, factor);
  }, [zoomAt]);

  const handleKeyDown = useCallback((e) => {
    switch (e.key) {
      case 'Escape':
        onClose();
        break;
      case 'ArrowLeft':
        if (hasPrev) onPrev();
        break;
      case 'ArrowRight':
        if (hasNext) onNext();
        break;
    }
  }, [onClose, onPrev, onNext, hasPrev, hasNext]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [handleKeyDown]);

  if (!currentPhoto) return null;

  const displayUrl = currentPhoto.display_path
    ? `${MEDIA_BASE}/cache/${currentPhoto.display_path}`
    : `${MEDIA_BASE}/cache/${currentPhoto.thumbnail_path || ''}`;

  const hasLocation = currentPhoto.latitude != null && currentPhoto.longitude != null;
  const viewerClassName = `fullscreen-viewer${admin ? ' admin-active' : ''}`;
  const diveSiteName = currentPhoto.dive_site_name || currentPhoto.dive_site || '';

  const handleSaved = (updated) => {
    setCurrentPhoto(updated);
    if (onPhotoUpdated) onPhotoUpdated(updated);
  };

  return (
    <div className={viewerClassName}>
      <div className={`viewer-toolbar${admin ? ' admin-active' : ''}`}>
        <button className="viewer-btn close-btn" onClick={onClose} title="Close (Esc)">
          &times;
        </button>
        <div className="viewer-counter">
          {currentPhoto.title || currentPhoto.filename}
        </div>
        <div className="viewer-toolbar-right">
          {/* Map button with scuba pin icon */}
          {hasLocation && (
            <button
              className="viewer-btn viewer-map-btn"
              onClick={() => onMapClick && onMapClick(currentPhoto)}
              title="Show on map"
            >
              <svg viewBox="0 0 64 80" width="18" height="22" aria-hidden="true" style={{display:'block'}}>
                <defs>
                  <filter id="mappin-toolbar" x="-20%" y="-20%" width="140%" height="140%">
                    <feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#000000" flood-opacity="0.28"/>
                  </filter>
                </defs>
                <path d="M32 76 C32 76 8 45 8 28 C8 14.745 18.745 4 32 4 C45.255 4 56 14.745 56 28 C56 45 32 76 32 76 Z" fill="#8B140E" filter="url(#mappin-toolbar)"/>
                <circle cx="32" cy="28" r="22" fill="#E11913"/>
                <path d="M15.7 13.2 L50.8 42.5 L45.7 48.6 L10.6 19.3 Z" fill="#FFF9E8"/>
                <path d="M15 25 C17 13 27 8 38 10 C27 11 18 17 15 25 Z" fill="#FFFFFF" opacity="0.18"/>
                <path d="M32 76 C32 76 8 45 8 28 C8 14.745 18.745 4 32 4 C45.255 4 56 14.745 56 28 C56 45 32 76 32 76 Z" fill="none" stroke="#5E0D09" stroke-width="3"/>
              </svg>
            </button>
          )}
          {/* Zoom controls - hidden on touch devices */}
          <button className="viewer-btn viewer-zoom-btn zoom-out-btn" onClick={() => {
            const r = imageWrapRef.current.getBoundingClientRect();
            zoomAt(r.width / 2, r.height / 2, 0.8);
          }} title="Zoom Out">−</button>
          <button className="viewer-btn viewer-zoom-btn zoom-in-btn" onClick={() => {
            const r = imageWrapRef.current.getBoundingClientRect();
            zoomAt(r.width / 2, r.height / 2, 1.25);
          }} title="Zoom In">+</button>
          <button className="viewer-btn viewer-reset-btn" onClick={fitToScreen} title="Fit / Reset">⟲</button>
        </div>
      </div>

      {/* Prev/Next overlay buttons centered on image */}
      <div className="viewer-image-area">
        <button
          className={`viewer-overlay-btn prev-overlay-btn ${!hasPrev ? 'disabled' : ''}`}
          onClick={hasPrev ? onPrev : undefined}
          disabled={!hasPrev}
          title="Previous (←)"
        >
          ‹
        </button>

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
        >
          ›
        </button>

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
          <div className="viewer-info-collapse-bar" onClick={() => setInfoCollapsed(!infoCollapsed)}>
            <span className="collapse-arrow">{infoCollapsed ? '^' : 'v'}</span>
          </div>

          <div className="info-top-row">
            <h2 className="info-species-name">{currentPhoto.title || <em>Untitled</em>}</h2>
            <div className="info-pills">
              {/* Country:Site pill */}
              {(currentPhoto.country || diveSiteName) && (
                <span className="pill">
                  <span className="pill-ico">📍</span>
                  {[currentPhoto.country, diveSiteName].filter(Boolean).join(': ')}
                </span>
              )}
              {/* Map pill with scuba pin icon and dive site name */}
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
              {/* Camera pill */}
              {currentPhoto.camera_body && (
                <span className="pill">
                  <span className="pill-ico">📷</span>
                  {currentPhoto.camera_body}
                </span>
              )}
              {/* Species/size pill */}
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
                  <span className="meta-item">
                    <strong>Lens:</strong> {currentPhoto.lens}
                  </span>
                )}
                {currentPhoto.housing && (
                  <span className="meta-item">
                    <strong>Housing:</strong> {currentPhoto.housing}
                  </span>
                )}
                {currentPhoto.lighting && (
                  <span className="meta-item">
                    <strong>Lighting:</strong> {currentPhoto.lighting}
                  </span>
                )}
              </div>
            </>
          )}
        </div>

        {admin && (
          <div className="admin-edit-section">
            <AdminEditPanel
              photo={currentPhoto}
              onSaved={handleSaved}
              onCancel={() => {}}
            />
          </div>
        )}
      </div>
    </div>
  );
}