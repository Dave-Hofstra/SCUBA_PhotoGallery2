import { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from 'react';
import { fetchLibraries, fetchLibraryPhotos, fetchDiveSites, adminLogin, adminLogout, checkAdmin, triggerSync, updateCategoryDisplayName, fetchTotalDives, updatePhotoOrder, createCategoryDivider, updateCategoryDivider, deleteCategoryDivider, reorderCategoryDividers, MEDIA_BASE } from '../utils/api';
import faviconIcon from '/favicon-32x32.png';
import appIcon from '/apple-touch-icon.png';
import FullscreenViewer from '../components/FullscreenViewer';
import DiveSiteListEditor from '../components/DiveSiteListEditor';
import DiveDataUploadModal from '../components/DiveDataUploadModal';

const DiveMapModal = lazy(() => import('../components/DiveMapModal'));
const DiveMapModal_FlyTo = lazy(() => import('../components/DiveMapModal_FlyTo'));
import { APP_VERSION } from '../config/appConfig';

export default function GalleryPage() {
  const [libraries, setLibraries] = useState([]);
  const [activeLibraryId, setActiveLibraryId] = useState(null);
  const [categories, setCategories] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [diveSites, setDiveSites] = useState([]);
  const [totalDives, setTotalDives] = useState(0);
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
  const [showDiveDataUpload, setShowDiveDataUpload] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState(null);
  const [editingCategoryName, setEditingCategoryName] = useState('');
  const [reorderMode, setReorderMode] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState(new Set());
  const [editingDividerId, setEditingDividerId] = useState(null);
  const [editingDividerTitle, setEditingDividerTitle] = useState('');
  const [creatingDividerCategoryId, setCreatingDividerCategoryId] = useState(null);
  const [creatingDividerTitle, setCreatingDividerTitle] = useState('');
  const photoOrderSnapshotRef = useRef(null);
  const dividerOrderSnapshotRef = useRef(null);
  const dragPhotoIdRef = useRef(null);
  const dragDividerIdRef = useRef(null);
  const dropTargetIdRef = useRef(null);
  const dropTargetTypeRef = useRef(null);
  const dragScrollIntervalRef = useRef(null);
  const lastCursorYRef = useRef(0);
  const getInitialColumns = () => window.innerWidth >= 1024 ? 6 : 3;
  const [columns, setColumns] = useState(getInitialColumns);
  const [searchQuery, setSearchQuery] = useState('');
  // Filter categories by search query (client-side, matches title, description, species, dive site, filename, etc.)
  const filteredCategories = useMemo(() => {
    if (!searchQuery.trim()) return categories;
    const q = searchQuery.toLowerCase().trim();
    return categories.map(cat => {
      const matchingPhotos = cat.photos.filter(p => {
        const fields = [
          p.title, p.description, p.species, p.dive_site_name, p.dive_site,
          p.country, p.lens, p.lighting, p.camera_body, p.filename
        ];
        return fields.some(f => f && f.toLowerCase().includes(q));
      });
      return matchingPhotos.length > 0 ? { ...cat, photos: matchingPhotos } : null;
    }).filter(Boolean);
  }, [categories, searchQuery]);
  const passcodeRef = useRef(null);
  const [isStandalone, setIsStandalone] = useState(
    window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true
  );
  const [standalonePrompt, setStandalonePrompt] = useState(
    window.innerWidth <= 768 && !isStandalone && !sessionStorage.getItem('standalonePromptDismissed')
  );
  const [isAndroid, setIsAndroid] = useState(/android/i.test(navigator.userAgent));
  const [isIOS, setIsIOS] = useState(/iphone|ipad|ipod/i.test(navigator.userAgent));
  const [installFailed, setInstallFailed] = useState(false);
  const deferredPromptRef = useRef(null);
  const categoryTitleRefs = useRef({});
  const [showShareQR, setShowShareQR] = useState(false);

  // Detect standalone mode and platform on mount
  useEffect(() => {
    const mobile = window.innerWidth <= 768;
    const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
    const android = /android/i.test(navigator.userAgent);
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    setIsStandalone(standalone);
    setIsAndroid(android);
    setIsIOS(ios);
    if (mobile && !standalone && !sessionStorage.getItem('standalonePromptDismissed')) {
      setStandalonePrompt(true);
    }
    // Capture beforeinstallprompt for Android
    const handleBeforeInstall = (e) => {
      e.preventDefault();
      deferredPromptRef.current = e;
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstall);

    // Register service worker for PWA install capability
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/SCUBA_PhotoGallery2/sw.js').catch(() => {
        // SW registration failed — PWA install prompt won't fire, but that's ok
      });
    }

    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
  }, []);

  const handleMaybeLater = () => {
    sessionStorage.setItem('standalonePromptDismissed', 'true');
    setStandalonePrompt(false);
  };

  const handleAddToHomeScreen = () => {
    const deferredPrompt = deferredPromptRef.current;
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.then((choiceResult) => {
        if (choiceResult.outcome === 'accepted') {
          localStorage.setItem('standalonePromptDismissed', 'true');
          setStandalonePrompt(false);
        }
        deferredPromptRef.current = null;
      });
    } else {
      // No install prompt available — show manual instructions
      setInstallFailed(true);
    }
  };

  // Fetch libraries on mount
  useEffect(() => {
    fetchLibraries()
      .then(data => {
        // Sort: All-Time first, Wall_Photos second, then rest by display_name descending
        const sorted = [...data].sort((a, b) => {
          const aName = a.display_name || a.name;
          const bName = b.display_name || b.name;
          const aIsAllTime = aName.includes('All-Time') || a.name.includes('All-Time');
          const bIsAllTime = bName.includes('All-Time') || b.name.includes('All-Time');
          if (aIsAllTime && !bIsAllTime) return -1;
          if (!aIsAllTime && bIsAllTime) return 1;
          if (a.name === 'Wall_Photos') return -1;
          if (b.name === 'Wall_Photos') return 1;
          return bName.localeCompare(aName);
        });
        setLibraries(sorted);
        // Default to All-Time library
        const allTime = sorted.find(l => (l.display_name || l.name).includes('All-Time') || l.name.includes('All-Time'));
        if (allTime) {
          setActiveLibraryId(allTime.id);
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
      fetchDiveSites(),
      fetchTotalDives()
    ])
      .then(([photoData, siteData, totalData]) => {
        setCategories(photoData.categories || []);
        setPhotos(photoData.photos || []);
        setDiveSites(siteData || []);
        setTotalDives(totalData.total || 0);
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

  // Mark/unmark photo as viewed (called from FullscreenViewer dwell timer or manual toggle)
  const handlePhotoViewed = useCallback((photoId, viewed = true) => {
    setPhotos(prev => prev.map(p => p.id === photoId ? { ...p, viewed_by_me: viewed } : p));
    setCategories(prev => prev.map(cat => ({
      ...cat,
      photos: cat.photos.map(p => p.id === photoId ? { ...p, viewed_by_me: viewed } : p)
    })));
    // Do NOT update viewerPhoto here — FullscreenViewer manages its own local
    // currentPhoto state for viewed_by_me. Updating the prop would reset zoom.
  }, []);

  // Handle like toggle from FullscreenViewer
  const handleLikeToggle = useCallback((photoId, liked, count) => {
    setPhotos(prev => prev.map(p => p.id === photoId ? { ...p, liked_by_me: liked, like_count: count } : p));
    setCategories(prev => prev.map(cat => ({
      ...cat,
      photos: cat.photos.map(p => p.id === photoId ? { ...p, liked_by_me: liked, like_count: count } : p)
    })));
    // Update viewerPhoto so FullscreenViewer reflects the change live
    setViewerPhoto(prev => prev?.id === photoId ? { ...prev, liked_by_me: liked, like_count: count } : prev);
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
    // Use dive_site_list_id for matching if available
    if (photo.dive_site_list_id) {
      const siteId = `dsl_${photo.dive_site_list_id}`;
      setMapModal({ open: true, mode: 'selectedSite', activeSiteId: siteId });
      return;
    }

    // Fallback: find the nearest dive site by coordinates
    if (photo.latitude != null && photo.longitude != null) {
      const nearest = diveSites.reduce((best, site) => {
        if (site.latitude == null || site.longitude == null) return best;
        const dLat = photo.latitude - site.latitude;
        const dLng = photo.longitude - site.longitude;
        const dist = dLat * dLat + dLng * dLng;
        if (!best || dist < best.dist) return { site, dist };
        return best;
      }, null);

      if (nearest && nearest.site && nearest.site.id) {
        const siteId = `dsl_${nearest.site.id}`;
        setMapModal({ open: true, mode: 'selectedSite', activeSiteId: siteId });
        return;
      }
    }

    // Last resort: use lat/lng key (will show all pins grey, no flyTo)
    const siteId = `${photo.latitude}_${photo.longitude}`;
    setMapModal({ open: true, mode: 'selectedSite', activeSiteId: siteId });
  }, [diveSites]);

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
      alert(err.message || 'Invalid passcode');
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

  // Reorder mode handlers
  const handleStartReorder = useCallback(() => {
    // Snapshot current photo order (from categories, which is what the user sees)
    const allPhotoIds = categories.flatMap(c => c.photos.map(p => p.id));
    photoOrderSnapshotRef.current = allPhotoIds;
    // Snapshot divider sort_order per category
    dividerOrderSnapshotRef.current = categories.map(cat => ({
      categoryId: cat.category_id,
      dividers: (cat.dividers || []).map(d => ({ id: d.id, sort_order: d.sort_order }))
    }));
    setSelectedPhotoIds(new Set());
    setReorderMode(true);
  }, [categories]);

  const handleCancelReorder = useCallback(() => {
    // Restore from snapshot — rebuild categories and photos from saved order
    if (photoOrderSnapshotRef.current) {
      const snapshotIds = photoOrderSnapshotRef.current;
      const dividerSnapshot = dividerOrderSnapshotRef.current;
      setCategories(prev => {
        return prev.map(cat => {
          const catPhotoIds = snapshotIds.filter(id => {
            const photo = cat.photos.find(p => p.id === id);
            return !!photo;
          });
          const photoMap = new Map(cat.photos.map(p => [p.id, p]));
          // Restore array order AND reset sort_order to match index position
          const restoredPhotos = catPhotoIds.map((id, idx) => {
            const photo = photoMap.get(id);
            if (photo) return { ...photo, sort_order: idx };
            return null;
          }).filter(Boolean);

          // Restore divider sort_order from snapshot
          const snapshotCat = dividerSnapshot ? dividerSnapshot.find(s => s.categoryId === cat.category_id) : null;
          const restoredDividers = snapshotCat
            ? (cat.dividers || []).map(d => {
                const snap = snapshotCat.dividers.find(sd => sd.id === d.id);
                return snap ? { ...d, sort_order: snap.sort_order } : d;
              })
            : cat.dividers;

          return { ...cat, photos: restoredPhotos, dividers: restoredDividers };
        });
      });
      setPhotos(prev => {
        const photoMap = new Map(prev.map(p => [p.id, p]));
        // Restore flat array order AND reset sort_order to match index position
        return snapshotIds.map((id, idx) => {
          const photo = photoMap.get(id);
          if (photo) return { ...photo, sort_order: idx };
          return null;
        }).filter(Boolean);
      });
    }
    setReorderMode(false);
    setSelectedPhotoIds(new Set());
    photoOrderSnapshotRef.current = null;
    dividerOrderSnapshotRef.current = null;
  }, []);

  const handleSaveOrder = useCallback(async () => {
    setSavingOrder(true);
    try {
      // Get photo IDs from categories (the visual order the user sees)
      const photoIds = categories.flatMap(c => c.photos.map(p => p.id));
      await updatePhotoOrder(photoIds);

      // Save divider orders per category — send actual sort_order so they interleave with photos
      for (const cat of categories) {
        if (cat.dividers && cat.dividers.length > 0) {
          const dividerOrders = cat.dividers.map(d => ({ id: d.id, sort_order: d.sort_order }));
          await reorderCategoryDividers(cat.category_id, dividerOrders);
        }
      }

      setReorderMode(false);
      setSelectedPhotoIds(new Set());
      photoOrderSnapshotRef.current = null;
    } catch (err) {
      alert('Failed to save order: ' + err.message);
    }
    setSavingOrder(false);
  }, [categories]);

  // Toggle selection of a photo for multi-select drag
  const handleToggleSelect = useCallback((e, photoId) => {
    e.stopPropagation();
    e.preventDefault();
    setSelectedPhotoIds(prev => {
      const next = new Set(prev);
      if (next.has(photoId)) {
        next.delete(photoId);
      } else {
        next.add(photoId);
      }
      return next;
    });
  }, []);

  const handleDragStart = useCallback((e, photoId) => {
    dragPhotoIdRef.current = photoId;
    dragDividerIdRef.current = null;
    e.dataTransfer.effectAllowed = 'move';
    // Put all selected photo IDs in the data transfer
    const idsToMove = selectedPhotoIds.has(photoId) && selectedPhotoIds.size > 0
      ? Array.from(selectedPhotoIds)
      : [photoId];
    e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'photo', ids: idsToMove }));

    // Create a custom drag image — a canvas with just the count badge
    const thumb = e.target.closest('.photo-thumb');
    const canvas = document.createElement('canvas');
    const size = 56;
    canvas.width = size;
    canvas.height = size;
    canvas.style.position = 'absolute';
    canvas.style.top = '-9999px';
    canvas.style.left = '-9999px';
    const ctx = canvas.getContext('2d');
    // Draw red circle
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 2, 0, Math.PI * 2);
    ctx.fillStyle = '#e53935';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 3;
    ctx.stroke();
    // Draw count text
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 24px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(idsToMove.length), size / 2, size / 2);
    // Must be in the DOM for setDragImage to work reliably
    document.body.appendChild(canvas);
    e.dataTransfer.setDragImage(canvas, 0, 56);
    requestAnimationFrame(() => canvas.remove());

    // Add a slight delay to show dragging state and show count badge on original thumb
    setTimeout(() => {
      if (!thumb) return;
      thumb.classList.add('dragging');
      // Add count badge showing how many images are being dragged
      const existingBadge = thumb.querySelector('.reorder-drag-count');
      if (existingBadge) existingBadge.remove();
      const badge = document.createElement('div');
      badge.className = 'reorder-drag-count';
      badge.textContent = String(idsToMove.length);
      thumb.appendChild(badge);
    }, 0);
  }, [selectedPhotoIds]);

  // Drag start for a divider
  const handleDividerDragStart = useCallback((e, dividerId) => {
    dragDividerIdRef.current = dividerId;
    dragPhotoIdRef.current = null;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'divider', ids: [dividerId] }));

    const dividerEl = e.target.closest('.category-divider');
    if (dividerEl) {
      dividerEl.classList.add('dragging');
    }
  }, []);

  const clearDropIndicator = useCallback(() => {
    if (dropTargetIdRef.current) {
      // Clear photo drop indicators
      const prevPhoto = document.querySelector(`.photo-thumb[data-photo-id="${dropTargetIdRef.current}"]`);
      if (prevPhoto) {
        prevPhoto.classList.remove('drop-before', 'drop-after');
      }
      // Clear divider drop indicators
      const prevDivider = document.querySelector(`.category-divider[data-divider-id="${dropTargetIdRef.current}"]`);
      if (prevDivider) {
        prevDivider.classList.remove('drop-target');
      }
      dropTargetIdRef.current = null;
      dropTargetTypeRef.current = null;
    }
  }, []);

  const handleDragOver = useCallback((e, targetPhotoId) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const draggedPhotoId = dragPhotoIdRef.current;
    const draggedDividerId = dragDividerIdRef.current;

    // If nothing is being dragged, bail out
    if (draggedPhotoId === null && draggedDividerId === null) {
      clearDropIndicator();
      return;
    }
    // If dragging a photo onto itself, bail out
    if (draggedPhotoId !== null && draggedPhotoId === targetPhotoId) {
      clearDropIndicator();
      return;
    }

    // Update visual drop indicator — always "insert before" the hovered thumbnail
    if (dropTargetIdRef.current !== targetPhotoId) {
      clearDropIndicator();
      dropTargetIdRef.current = targetPhotoId;
      dropTargetTypeRef.current = 'photo';
    }

    e.currentTarget.classList.add('drop-before');

    // Auto-scroll when dragging near viewport edges
    lastCursorYRef.current = e.clientY;
    // Use a larger zone for upward scroll to account for the sticky header (~52px) and category title
    const scrollUpZonePx = 160;
    const scrollDownZonePx = 80;

    const shouldScrollUp = e.clientY < scrollUpZonePx;
    const shouldScrollDown = e.clientY > window.innerHeight - scrollDownZonePx;

    if (shouldScrollUp || shouldScrollDown) {
      if (!dragScrollIntervalRef.current) {
        dragScrollIntervalRef.current = setInterval(() => {
          const cursorY = lastCursorYRef.current;
          if (cursorY < scrollUpZonePx) {
            const speed = Math.max(5, Math.round((scrollUpZonePx - cursorY) / 6));
            window.scrollBy(0, -speed);
          } else if (cursorY > window.innerHeight - scrollDownZonePx) {
            const distanceFromEdge = cursorY - (window.innerHeight - scrollDownZonePx);
            const speed = Math.max(5, Math.round(distanceFromEdge / 4));
            window.scrollBy(0, speed);
          }
        }, 16); // ~60fps
      }
    } else {
      if (dragScrollIntervalRef.current) {
        clearInterval(dragScrollIntervalRef.current);
        dragScrollIntervalRef.current = null;
      }
    }
  }, [clearDropIndicator]);

  // Drag over for a divider (also acts as a drop target for photos)
  const handleDividerDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const targetDivider = e.currentTarget;
    const targetDividerId = parseInt(targetDivider.dataset.dividerId, 10);
    const draggedPhotoId = dragPhotoIdRef.current;
    const draggedDividerId = dragDividerIdRef.current;

    if (draggedPhotoId === null && draggedDividerId === null) {
      clearDropIndicator();
      return;
    }
    if (draggedDividerId !== null && draggedDividerId === targetDividerId) {
      clearDropIndicator();
      return;
    }

    if (dropTargetIdRef.current !== targetDividerId) {
      clearDropIndicator();
      dropTargetIdRef.current = targetDividerId;
      dropTargetTypeRef.current = 'divider';
    }

    targetDivider.classList.add('drop-target');

    // Auto-scroll
    lastCursorYRef.current = e.clientY;
    const scrollUpZonePx = 160;
    const scrollDownZonePx = 80;
    const shouldScrollUp = e.clientY < scrollUpZonePx;
    const shouldScrollDown = e.clientY > window.innerHeight - scrollDownZonePx;
    if (shouldScrollUp || shouldScrollDown) {
      if (!dragScrollIntervalRef.current) {
        dragScrollIntervalRef.current = setInterval(() => {
          const cursorY = lastCursorYRef.current;
          if (cursorY < scrollUpZonePx) {
            const speed = Math.max(5, Math.round((scrollUpZonePx - cursorY) / 6));
            window.scrollBy(0, -speed);
          } else if (cursorY > window.innerHeight - scrollDownZonePx) {
            const distanceFromEdge = cursorY - (window.innerHeight - scrollDownZonePx);
            const speed = Math.max(5, Math.round(distanceFromEdge / 4));
            window.scrollBy(0, speed);
          }
        }, 16);
      }
    } else {
      if (dragScrollIntervalRef.current) {
        clearInterval(dragScrollIntervalRef.current);
        dragScrollIntervalRef.current = null;
      }
    }
  }, [clearDropIndicator]);

  const handleDrop = useCallback((e, targetPhotoId) => {
    e.preventDefault();
    clearDropIndicator();

    const draggedDividerId = dragDividerIdRef.current;
    const draggedPhotoId = dragPhotoIdRef.current;

    // Handle divider drop on a photo
    if (draggedDividerId !== null) {
      setCategories(prev => {
        const dividerId = draggedDividerId;
        return prev.map(cat => {
          const dividers = [...(cat.dividers || [])];
          const photos = [...cat.photos];
          const dividerIdx = dividers.findIndex(d => d.id === dividerId);
          const photoIdx = photos.findIndex(p => p.id === targetPhotoId);
          if (dividerIdx === -1 || photoIdx === -1) return cat;
          if (dividers[dividerIdx].category_id !== photos[photoIdx].category_id) return cat;

          const [movedDivider] = dividers.splice(dividerIdx, 1);
          const prevSortOrder = photoIdx > 0 ? photos[photoIdx - 1].sort_order : -1;
          const targetSortOrder = photos[photoIdx].sort_order;
          movedDivider.sort_order = (prevSortOrder + targetSortOrder) / 2;
          dividers.splice(dividerIdx <= photoIdx ? photoIdx - 1 : photoIdx, 0, movedDivider);

          return { ...cat, dividers };
        });
      });
      dragDividerIdRef.current = null;
      return;
    }

    // Handle photo drop — completely ref/state based, no dataTransfer dependency
    if (draggedPhotoId === null) return;

    // Build idsToMove using local ref and selectedPhotoIds state
    const idsToMove = (selectedPhotoIds.has(draggedPhotoId) && selectedPhotoIds.size > 0)
      ? Array.from(selectedPhotoIds)
      : [draggedPhotoId];

    // Don't drop on ourselves if only one item
    if (idsToMove.length === 1 && idsToMove[0] === targetPhotoId) return;

    // Clear selection after drop
    setSelectedPhotoIds(new Set());

    // Perform the actual reorder once on drop
    setCategories(prev => {
      // Find all indices for the photos being moved and the target
      let targetCatIdx = -1, targetPhotoIdx = -1;
      const moveEntries = []; // { catIdx, photoIdx, photo }

      for (let ci = 0; ci < prev.length; ci++) {
        const cat = prev[ci];
        for (let pi = 0; pi < cat.photos.length; pi++) {
          const photo = cat.photos[pi];
          if (idsToMove.includes(photo.id)) {
            moveEntries.push({ catIdx: ci, photoIdx: pi, photo: { id: photo.id } });
          }
          if (photo.id === targetPhotoId) {
            targetCatIdx = ci;
            targetPhotoIdx = pi;
          }
        }
      }

      if (targetCatIdx === -1 || moveEntries.length === 0) return prev;

      // All moved photos must be in the same category as the target
      const allSameCategory = moveEntries.every(m => m.catIdx === targetCatIdx);
      if (!allSameCategory) return prev;

      // Sort move entries by index descending so we can remove without shifting
      moveEntries.sort((a, b) => b.photoIdx - a.photoIdx);

      const newCategories = prev.map(cat => ({ ...cat, photos: [...cat.photos] }));
      const catPhotos = newCategories[targetCatIdx].photos;

      // Remove all moved photos (in reverse order to preserve indices)
      const movedPhotos = [];
      for (const entry of moveEntries) {
        const [removed] = catPhotos.splice(entry.photoIdx, 1);
        movedPhotos.unshift(removed);
      }

      // Find the new target index after removals
      const newTargetIdx = catPhotos.findIndex(p => p.id === targetPhotoId);

      // IMPORTANT: assign new sort_order values so the combined sort places them correctly
      if (newTargetIdx === -1) {
        // Target was also moved? Just append at end
        const lastSortOrder = catPhotos.length > 0 ? catPhotos[catPhotos.length - 1].sort_order : 0;
        movedPhotos.forEach((p, i) => { p.sort_order = lastSortOrder + (i + 1); });
        catPhotos.push(...movedPhotos);
      } else {
        // Insert before the target — assign sort_order between predecessor and target
        const prevSortOrder = newTargetIdx > 0 ? catPhotos[newTargetIdx - 1].sort_order : -1;
        const targetSortOrder = catPhotos[newTargetIdx].sort_order;
        const step = (targetSortOrder - prevSortOrder) / (movedPhotos.length + 1);
        movedPhotos.forEach((p, i) => { p.sort_order = prevSortOrder + step * (i + 1); });
        catPhotos.splice(newTargetIdx, 0, ...movedPhotos);
      }

      return newCategories;
    });

    setPhotos(prev => {
      // Find indices for all photos being moved and the target
      const moveIndices = [];
      let targetIdx = -1;

      for (let i = 0; i < prev.length; i++) {
        if (idsToMove.includes(prev[i].id)) {
          moveIndices.push(i);
        }
        if (prev[i].id === targetPhotoId) {
          targetIdx = i;
        }
      }

      if (targetIdx === -1 || moveIndices.length === 0) return prev;

      // All must be in same category as target
      const targetCategoryId = prev[targetIdx].category_id;
      const allSameCategory = moveIndices.every(i => prev[i].category_id === targetCategoryId);
      if (!allSameCategory) return prev;

      // Sort descending for removal
      moveIndices.sort((a, b) => b - a);

      const newPhotos = [...prev];
      const movedPhotos = [];
      for (const idx of moveIndices) {
        const [removed] = newPhotos.splice(idx, 1);
        movedPhotos.unshift(removed);
      }

      // Find new target index after removals
      const newTargetIdx = newPhotos.findIndex(p => p.id === targetPhotoId);
      if (newTargetIdx === -1) {
        newPhotos.push(...movedPhotos);
      } else {
        newPhotos.splice(newTargetIdx, 0, ...movedPhotos);
      }

      return newPhotos;
    });

    dragPhotoIdRef.current = null;
  }, [clearDropIndicator, selectedPhotoIds]);

  // Drop on a divider — move the dragged item before this divider
  const handleDividerDrop = useCallback((e) => {
    e.preventDefault();
    clearDropIndicator();

    let dropData;
    try {
      dropData = JSON.parse(e.dataTransfer.getData('text/plain'));
    } catch {
      dropData = { type: 'photo', ids: [] };
    }

    const targetDivider = e.currentTarget;
    const targetDividerId = parseInt(targetDivider.dataset.dividerId, 10);

    if (dropData.type === 'photo') {
      const photoIds = dropData.ids;
      if (photoIds.length === 0) return;

      // Move the dragged photo(s) before this divider
      setCategories(prev => {
        return prev.map(cat => {
          const dividers = [...(cat.dividers || [])];
          const photos = [...cat.photos];
          const dividerIdx = dividers.findIndex(d => d.id === targetDividerId);
          if (dividerIdx === -1) return cat;
          const dividerCategoryId = dividers[dividerIdx].category_id;

          // Find the photo(s) to move
          const moveEntries = [];
          for (let pi = 0; pi < photos.length; pi++) {
            if (photoIds.includes(photos[pi].id)) {
              moveEntries.push({ photoIdx: pi, photo: photos[pi] });
            }
          }
          if (moveEntries.length === 0) return cat;

          // All photos must be in the same category as the divider
          const allSameCategory = moveEntries.every(m => m.photo.category_id === dividerCategoryId);
          if (!allSameCategory) return cat;

          // Sort descending for removal
          moveEntries.sort((a, b) => b.photoIdx - a.photoIdx);
          const movedPhotos = [];
          for (const entry of moveEntries) {
            const [removed] = photos.splice(entry.photoIdx, 1);
            movedPhotos.unshift(removed);
          }

          // Insert photos before the divider
          // After removals, find where the divider is now
          const newDividerIdx = dividers.findIndex(d => d.id === targetDividerId);
          // Find the sort_order of the photos just before the divider
          let insertIdx = photos.findIndex(p => p.sort_order > dividers[newDividerIdx].sort_order);
          if (insertIdx === -1) insertIdx = photos.length;
          photos.splice(insertIdx, 0, ...movedPhotos);

          return { ...cat, dividers, photos };
        });
      });

      // Also update flat photos array
      setPhotos(prev => {
        const moveIndices = photoIds.map(id => prev.findIndex(p => p.id === id)).filter(i => i !== -1);
        const targetPhoto = prev.find(p => p.id === photoIds[0]);
        if (!targetPhoto || moveIndices.length === 0) return prev;
        const targetCategoryId = targetPhoto.category_id;
        const allSameCategory = moveIndices.every(i => prev[i].category_id === targetCategoryId);
        if (!allSameCategory) return prev;

        moveIndices.sort((a, b) => b - a);
        const newPhotos = [...prev];
        const movedPhotos = [];
        for (const idx of moveIndices) {
          const [removed] = newPhotos.splice(idx, 1);
          movedPhotos.unshift(removed);
        }

        // Find the divider's position relative to photos
        // We need to find where the divider sits among photos
        const dividerSortOrder = categories
          .flatMap(c => c.dividers || [])
          .find(d => d.id === targetDividerId)?.sort_order || 0;

        const insertBeforeIdx = newPhotos.findIndex(p => p.sort_order > dividerSortOrder);
        if (insertBeforeIdx === -1) {
          newPhotos.push(...movedPhotos);
        } else {
          newPhotos.splice(insertBeforeIdx, 0, ...movedPhotos);
        }
        return newPhotos;
      });

      dragPhotoIdRef.current = null;
      return;
    }

    if (dropData.type === 'divider') {
      const dividerId = dropData.ids[0];
      if (dividerId === targetDividerId) return;

      // Reorder divider before the target divider
      setCategories(prev => {
        return prev.map(cat => {
          const dividers = [...(cat.dividers || [])];
          const srcIdx = dividers.findIndex(d => d.id === dividerId);
          const tgtIdx = dividers.findIndex(d => d.id === targetDividerId);
          if (srcIdx === -1 || tgtIdx === -1) return cat;
          if (dividers[srcIdx].category_id !== dividers[tgtIdx].category_id) return cat;

          const [movedDivider] = dividers.splice(srcIdx, 1);
          const newTgtIdx = dividers.findIndex(d => d.id === targetDividerId);
          if (newTgtIdx === -1) {
            dividers.push(movedDivider);
          } else {
            dividers.splice(newTgtIdx, 0, movedDivider);
          }

          return { ...cat, dividers };
        });
      });
      dragDividerIdRef.current = null;
    }
  }, [clearDropIndicator, categories]);

  const handleDragEnd = useCallback((e) => {
    clearDropIndicator();
    if (dragScrollIntervalRef.current) {
      clearInterval(dragScrollIntervalRef.current);
      dragScrollIntervalRef.current = null;
    }
    const thumb = e.target.closest('.photo-thumb');
    if (thumb) {
      thumb.classList.remove('dragging');
      const badge = thumb.querySelector('.reorder-drag-count');
      if (badge) badge.remove();
    }
    const dividerEl = e.target.closest('.category-divider');
    if (dividerEl) {
      dividerEl.classList.remove('dragging', 'drop-target');
    }
    dragPhotoIdRef.current = null;
    dragDividerIdRef.current = null;
  }, [clearDropIndicator]);

  const handleDragLeave = useCallback((e) => {
    // Only clear if we're actually leaving the thumbnail (not entering a child)
    if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget)) {
      e.currentTarget.classList.remove('drop-before');
    }
  }, []);

  const handleDividerDragLeave = useCallback((e) => {
    if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget)) {
      e.currentTarget.classList.remove('drop-target');
    }
  }, []);

  // Divider editing handlers
  const handleStartEditDivider = useCallback((dividerId, currentTitle) => {
    setEditingDividerId(dividerId);
    setEditingDividerTitle(currentTitle);
  }, []);

  const handleSaveDividerEdit = useCallback(async (dividerId) => {
    const title = editingDividerTitle.trim();
    if (!title) return;
    try {
      const updated = await updateCategoryDivider(dividerId, title);
      setCategories(prev => prev.map(cat => ({
        ...cat,
        dividers: (cat.dividers || []).map(d => d.id === dividerId ? { ...d, title: updated.title } : d)
      })));
      setEditingDividerId(null);
      setEditingDividerTitle('');
    } catch (err) {
      alert('Failed to update divider: ' + err.message);
    }
  }, [editingDividerTitle]);

  const handleCancelEditDivider = useCallback(() => {
    setEditingDividerId(null);
    setEditingDividerTitle('');
  }, []);

  const handleDeleteDivider = useCallback(async (dividerId) => {
    if (!confirm('Delete this section header?')) return;
    try {
      await deleteCategoryDivider(dividerId);
      setCategories(prev => prev.map(cat => ({
        ...cat,
        dividers: (cat.dividers || []).filter(d => d.id !== dividerId)
      })));
    } catch (err) {
      alert('Failed to delete divider: ' + err.message);
    }
  }, []);

  // Divider creation handlers
  const handleStartCreateDivider = useCallback((categoryId) => {
    setCreatingDividerCategoryId(categoryId);
    setCreatingDividerTitle('');
  }, []);

  const handleCreateDivider = useCallback(async () => {
    const title = creatingDividerTitle.trim();
    if (!title || creatingDividerCategoryId === null) return;
    try {
      const newDivider = await createCategoryDivider(creatingDividerCategoryId, title);
      // Place it before the first photo (sort_order = -1, or more negative if other dividers exist)
      const minDividerOrder = (newDivider.sort_order !== undefined && newDivider.sort_order !== null)
        ? newDivider.sort_order
        : -1;
      setCategories(prev => prev.map(cat => {
        if (cat.category_id === creatingDividerCategoryId) {
          // Find the minimum photo sort_order in this category
          const minPhotoOrder = cat.photos.length > 0
            ? Math.min(...cat.photos.map(p => p.sort_order || 0))
            : 0;
          const newSortOrder = Math.min(minDividerOrder, minPhotoOrder - 1);
          return {
            ...cat,
            dividers: [...(cat.dividers || []), { ...newDivider, sort_order: newSortOrder }]
          };
        }
        return cat;
      }));
      setCreatingDividerCategoryId(null);
      setCreatingDividerTitle('');
    } catch (err) {
      alert('Failed to create divider: ' + err.message);
    }
  }, [creatingDividerTitle, creatingDividerCategoryId]);

  const handleCancelCreateDivider = useCallback(() => {
    setCreatingDividerCategoryId(null);
    setCreatingDividerTitle('');
  }, []);

  // Determine CSS class for admin mode red tint
  const pageClassName = `gallery-page${admin ? ' admin-active' : ''}${reorderMode ? ' reorder-active' : ''}`;

  // Compute sticky top for dividers based on category title height
  // On mobile (<= 640px), the header wraps and the category title sticky top is 115px
  const getDividerStickyTop = useCallback((categoryIdx) => {
    const cat = categories[categoryIdx];
    if (!cat) return window.innerWidth <= 640 ? 115 : 52;
    const titleEl = categoryTitleRefs.current[cat.category_id];
    // On mobile, titles may wrap so use a larger fallback height
    const mobileFallback = 40;
    const desktopFallback = 40;
    const fallback = window.innerWidth <= 640 ? mobileFallback : desktopFallback;
    const titleHeight = titleEl ? titleEl.offsetHeight : fallback;
    const baseStickyTop = window.innerWidth <= 640 ? 115 : 52;
    return baseStickyTop + titleHeight;
  }, [categories]);

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
          {admin && (
            <a href="https://dhofstra.com/LandingPage/" className="header-icon" title="Home" style={{color:'var(--text)'}}>
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" style={{display:'block'}}>
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
                <polyline points="9 22 9 12 15 12 15 22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
              </svg>
            </a>
          )}
          {isStandalone && (
            <button className="header-icon" onClick={() => window.location.reload()} title="Refresh">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" style={{display:'block'}}>
                <path d="M1 4v6h6M23 20v-6h-6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
          )}
          <button className="header-icon share-qr-btn" onClick={() => setShowShareQR(true)} title="Share App">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" style={{display:'block'}}>
              <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
              <polyline points="16 6 12 2 8 6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
              <line x1="12" y1="2" x2="12" y2="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
            </svg>
          </button>
          <span className="badge-wrapper">
            <button className="header-library-btn lib-glow-pulse" onClick={() => setSidebarOpen(true)} title="Libraries">
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" style={{display:'block',flexShrink:0}}>
                <path d="M12 6c-2-1.2-4.2-1.9-6.7-2.1C4.6 3.8 4 4.4 4 5.1V18c0 .7.5 1.3 1.2 1.4 2.6.2 4.8.9 6.8 2.1V6z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
                <path d="M12 6c2-1.2 4.2-1.9 6.7-2.1.7-.1 1.3.5 1.3 1.2V18c0 .7-.5 1.3-1.2 1.4-2.6.2-4.8.9-6.8 2.1V6z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>
                <path d="M12 6v15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
              </svg>
              <span className="header-library-name">Library: {libraries.find(l => l.id === activeLibraryId)?.display_name || 'Library'}</span>
            </button>
            <span className="badge">{libraries.length}</span>
          </span>
          <span className="badge-wrapper">
            <button className="header-library-btn" onClick={openAllSitesMap} title="All Dive Sites">
              <svg viewBox="0 0 64 80" width="16" height="20" aria-hidden="true" style={{display:'block',flexShrink:0}}>
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
              <span className="header-library-name">All Dives</span>
            </button>
            <span className="badge badge-dives">{totalDives}</span>
          </span>
        </div>
        <h1>
          <img src={faviconIcon} alt="" width="32" height="32" style={{verticalAlign:'middle',marginRight:'8px'}} />
          Dave Hofstra's SCUBA Photo Gallery
        </h1>
        <div className="header-row-3">
          <div className="header-search">
            <span className="header-search-icon">🔍</span>
            <input type="text" className="header-search-input" placeholder="Search photos..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} onKeyDown={e => e.key === 'Escape' && setSearchQuery('')} />
            {searchQuery && <button className="header-search-clear" onClick={() => setSearchQuery('')} title="Clear search">✕</button>}
          </div>
          <div className="header-columns-slider">
            <label className="columns-label">Columns:</label>
            <input type="range" min="2" max="14" value={columns} onChange={e => setColumns(parseInt(e.target.value))} className="columns-range" />
            <span className="columns-value">{columns}</span>
            <button className="header-icon share-qr-btn" onClick={() => setShowShareQR(true)} title="Share App">
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" style={{display:'block'}}>
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
                <polyline points="16 6 12 2 8 6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
                <line x1="12" y1="2" x2="12" y2="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
              </svg>
            </button>
          </div>
        </div>
        <div className="header-right">
          {admin && (
            <>
              <button className="header-icon" onClick={() => setShowDiveDataUpload(true)} title="Upload Dive Data">📤</button>
              <button className="header-icon" onClick={handleSync} title={syncing ? 'Syncing...' : 'Sync Libraries'} disabled={syncing}>{syncing ? '⏳' : '🔄'}</button>
              <button className="header-icon" onClick={() => setShowSiteListEditor(true)} title="Dive Site List">📋</button>
              <button className={`header-icon${reorderMode ? ' active' : ''}`} onClick={reorderMode ? handleCancelReorder : handleStartReorder} title={reorderMode ? 'Cancel Reorder' : 'Reorder Photos'}>
                {reorderMode ? '✕' : (
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" style={{display:'block',color:'var(--text)'}}>
                    <path d="M12 2l-4 5h3v10H8l4 5 4-5h-3V7h3z"/>
                  </svg>
                )}
              </button>
              <button className="header-icon" onClick={handleAdminLogout} title="Admin Logout">🔒</button>
            </>
          )}
          {debugMode && !admin && (
            <button className="header-icon" onClick={() => setShowAdminLogin(true)} title="Admin Login">🔒</button>
          )}
        </div>
      </header>

      {showAdminLogin && !admin && (
        <div className="admin-login-bar">
          <input ref={passcodeRef} type="password" placeholder="Admin passcode" value={passcode} onChange={e => setPasscode(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAdminLogin()} />
          <button onClick={handleAdminLogin}>Login</button>
        </div>
      )}

      {loading ? (
        <div className="loading">Loading photos...</div>
      ) : categories.length === 0 ? (
        <div className="empty">No photos found. Run a scan first.</div>
      ) : (
        <div className="gallery-content">
          {filteredCategories.map((category, catIdx) => (
            <section key={category.category_id || catIdx} className="category-section">
              <h2 className="category-title" ref={el => { categoryTitleRefs.current[category.category_id] = el; }}>
                {editingCategoryId === category.category_id ? (
                  <span style={{display:'inline-flex',alignItems:'center',gap:'6px'}}>
                    <input type="text" value={editingCategoryName} onChange={e => setEditingCategoryName(e.target.value)}
                      onKeyDown={async (e) => {
                        if (e.key === 'Enter') {
                          try { await updateCategoryDisplayName(category.category_id, editingCategoryName); setCategories(prev => prev.map(c => c.category_id === category.category_id ? {...c, display_name: editingCategoryName} : c)); } catch(err) { alert('Failed to update: ' + err.message); }
                          setEditingCategoryId(null);
                        }
                        if (e.key === 'Escape') setEditingCategoryId(null);
                      }}
                      onBlur={() => setEditingCategoryId(null)} autoFocus
                      style={{background:'rgba(255,255,255,.1)',border:'1px solid var(--accent)',color:'#fff',padding:'4px 8px',borderRadius:'6px',fontSize:'14px',fontWeight:'700',width:'280px'}}
                    />
                    <button onClick={async () => {
                      try { await updateCategoryDisplayName(category.category_id, editingCategoryName); setCategories(prev => prev.map(c => c.category_id === category.category_id ? {...c, display_name: editingCategoryName} : c)); } catch(err) { alert('Failed to update: ' + err.message); }
                      setEditingCategoryId(null);
                    }} style={{background:'#4caf50',border:'none',color:'#fff',width:'32px',height:'32px',borderRadius:'8px',cursor:'pointer',fontSize:'18px',fontWeight:'700',display:'grid',placeItems:'center',flexShrink:0}} title="Save title">✓</button>
                  </span>
                ) : (
                  <>
                    <span className="category-type-label">{reorderMode ? '📁 Folder-Based Category' : ''}</span>
                    {category.display_name || category.name}
                    {admin && (
                      <span className="category-edit-btn" onClick={() => { setEditingCategoryId(category.category_id); setEditingCategoryName(category.display_name || category.name); }} title="Edit category title">✏️</span>
                    )}
                  </>
                )}
              </h2>
              {reorderMode && (
                <div className="reorder-bar">
                  <span className="reorder-bar-text">
                    {selectedPhotoIds.size > 0 ? `Drag photos to reorder (${selectedPhotoIds.size} selected)` : 'Click circles to select, then drag selected photos'}
                  </span>
                  <button className="reorder-save-btn" onClick={handleSaveOrder} disabled={savingOrder}>{savingOrder ? 'Saving...' : 'Save Order'}</button>
                  <button className="reorder-cancel-btn" onClick={handleCancelReorder}>Cancel</button>
                </div>
              )}
              {/* Add Section Header button (reorder mode only) */}
              {admin && reorderMode && creatingDividerCategoryId === category.category_id ? (
                <div className="create-divider-bar">
                  <input type="text" value={creatingDividerTitle} onChange={e => setCreatingDividerTitle(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleCreateDivider(); if (e.key === 'Escape') handleCancelCreateDivider(); }}
                    placeholder="Enter section header title..."
                    autoFocus
                    style={{flex:1,background:'rgba(255,255,255,.1)',border:'1px solid var(--accent)',color:'#fff',padding:'6px 10px',borderRadius:'6px',fontSize:'14px'}} />
                  <button onClick={handleCreateDivider} style={{background:'#4caf50',border:'none',color:'#fff',padding:'6px 14px',borderRadius:'6px',cursor:'pointer',fontSize:'14px',fontWeight:'600'}}>Add</button>
                  <button onClick={handleCancelCreateDivider} style={{background:'rgba(255,255,255,.15)',border:'1px solid var(--border)',color:'#fff',padding:'6px 14px',borderRadius:'6px',cursor:'pointer',fontSize:'14px'}}>Cancel</button>
                </div>
              ) : admin && reorderMode ? (
                <button className="add-divider-btn" onClick={() => handleStartCreateDivider(category.category_id)}>
                  + Add a Custom Titlebar to this Section
                </button>
              ) : null}
              <div className="photo-grid" style={{ '--cols-active': columns }}>
                {(() => {
                  const stickyTop = getDividerStickyTop(catIdx);
                  const dividers = category.dividers || [];
                  // Build combined array sorted by sort_order
                  const combined = [];
                  for (const p of category.photos) {
                    combined.push({ type: 'photo', id: p.id, sort_order: p.sort_order || 0, photo: p });
                  }
                  for (const d of dividers) {
                    combined.push({ type: 'divider', id: d.id, sort_order: d.sort_order || 0, divider: d });
                  }
                  combined.sort((a, b) => a.sort_order - b.sort_order);

                  return combined.map(item => {
                    if (item.type === 'divider') {
                      const divider = item.divider;
                      const isEditing = editingDividerId === divider.id;
                      return (
                        <div key={`divider-${divider.id}`}
                          className={`category-divider${reorderMode ? ' draggable' : ''}`}
                          data-divider-id={divider.id}
                          style={{ position: 'sticky', top: stickyTop + 'px' }}
                          draggable={reorderMode}
                          onDragStart={reorderMode ? (e) => handleDividerDragStart(e, divider.id) : undefined}
                          onDragOver={reorderMode ? handleDividerDragOver : undefined}
                          onDrop={reorderMode ? handleDividerDrop : undefined}
                          onDragEnd={reorderMode ? handleDragEnd : undefined}
                          onDragLeave={reorderMode ? handleDividerDragLeave : undefined}>
                          <span className="divider-type-label">{reorderMode ? 'Custom Titlebar' : ''}</span>
                          {isEditing ? (
                            <span style={{display:'inline-flex',alignItems:'center',gap:'6px'}}>
                              <input type="text" value={editingDividerTitle} onChange={e => setEditingDividerTitle(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') handleSaveDividerEdit(divider.id); if (e.key === 'Escape') handleCancelEditDivider(); }}
                                onBlur={() => handleSaveDividerEdit(divider.id)} autoFocus
                                style={{background:'rgba(255,255,255,.15)',border:'1px solid var(--accent)',color:'#fff',padding:'2px 8px',borderRadius:'6px',fontSize:'14px',fontWeight:'600',width:'280px',textAlign:'center'}}
                                onClick={e => e.stopPropagation()} />
                              <button onClick={() => handleSaveDividerEdit(divider.id)} style={{background:'#4caf50',border:'none',color:'#fff',width:'28px',height:'28px',borderRadius:'6px',cursor:'pointer',fontSize:'16px',fontWeight:'700',display:'grid',placeItems:'center',flexShrink:0}} title="Save">✓</button>
                              <button onClick={handleCancelEditDivider} style={{background:'rgba(255,255,255,.15)',border:'1px solid var(--border)',color:'#fff',width:'28px',height:'28px',borderRadius:'6px',cursor:'pointer',fontSize:'16px',display:'grid',placeItems:'center',flexShrink:0}} title="Cancel">✕</button>
                            </span>
                          ) : (
                            <>
                              <span className="divider-title-text">{divider.title}</span>
                              {admin && reorderMode && (
                                <span className="divider-controls">
                                  <button className="divider-edit-btn" onClick={e => { e.stopPropagation(); handleStartEditDivider(divider.id, divider.title); }} title="Edit section header">✏️</button>
                                  <button className="divider-delete-btn" onClick={e => { e.stopPropagation(); handleDeleteDivider(divider.id); }} title="Delete section header">🗑️</button>
                                  <span className="divider-drag-handle" title="Drag to reorder">⠿</span>
                                </span>
                              )}
                            </>
                          )}
                        </div>
                      );
                    } else {
                      const photo = item.photo;
                      const globalIndex = photos.findIndex(p => p.id === photo.id);
                      const isSelected = selectedPhotoIds.has(photo.id);
                      return (
                        <div key={photo.id}
                          className={`photo-thumb${reorderMode ? ' reorderable' : ''}${isSelected ? ' selected' : ''}`}
                          data-photo-id={photo.id}
                          onClick={() => { if (!reorderMode) openViewer(photo, globalIndex); }}
                          draggable={reorderMode}
                          onDragStart={reorderMode ? (e) => handleDragStart(e, photo.id) : undefined}
                          onDragOver={reorderMode ? (e) => handleDragOver(e, photo.id) : undefined}
                          onDrop={reorderMode ? (e) => handleDrop(e, photo.id) : undefined}
                          onDragEnd={reorderMode ? handleDragEnd : undefined}
                          onDragLeave={reorderMode ? handleDragLeave : undefined}
                        >
                          {reorderMode && (
                            <div className="reorder-select-circle" onClick={(e) => handleToggleSelect(e, photo.id)} onMouseDown={(e) => e.stopPropagation()}>
                              {isSelected && <div className="reorder-select-check" />}
                            </div>
                          )}
                          <img src={`${MEDIA_BASE}/cache/${photo.thumbnail_path || ''}`} alt={photo.title || photo.filename} loading="lazy" />
                          {/* View tracking overlays */}
                          {!reorderMode && photo.viewed_by_me && (
                            <div className="thumb-badge badge-viewed badge-tr" title="You've viewed this photo">✓</div>
                          )}
                          {!reorderMode && (photo.like_count > 0 || photo.liked_by_me) && (
                            <div className={`thumb-badge badge-likes badge-tl${photo.liked_by_me ? ' liked' : ''}`} title="Photo likes">
                              <span className="badge-heart">{photo.liked_by_me ? '❤️' : '♥'}</span>
                              <span className="badge-count">{photo.like_count}</span>
                            </div>
                          )}
                          <div className="thumb-info">
                            <div className="hoverTitle">{photo.title || photo.filename}</div>
                            <div className="hoverMetaContainer">
                              {photo.country && (<span className="hoverMetaLine"><span className="hoverIco">🏝️</span>{photo.country}</span>)}
                              {photo.dive_site_name && (
                                <span className="hoverMetaLine hoverMetaClickable" onClick={(e) => { e.stopPropagation(); openSiteMap(photo); }}>
                                  <span className="hoverIco">
                                    <svg viewBox="0 0 64 80" width="14" height="18" aria-hidden="true" style={{display:'block'}}>
                                      <defs><filter id="mappin-hover" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="#000000" flood-opacity="0.28"/></filter></defs>
                                      <path d="M32 76 C32 76 8 45 8 28 C8 14.745 18.745 4 32 4 C45.255 4 56 14.745 56 28 C56 45 32 76 32 76 Z" fill="#8B140E" filter="url(#mappin-hover)"/>
                                      <circle cx="32" cy="28" r="22" fill="#E11913"/>
                                      <path d="M15.7 13.2 L50.8 42.5 L45.7 48.6 L10.6 19.3 Z" fill="#FFF9E8"/>
                                      <path d="M15 25 C17 13 27 8 38 10 C27 11 18 17 15 25 Z" fill="#FFFFFF" opacity="0.18"/>
                                      <path d="M32 76 C32 76 8 45 8 28 C8 14.745 18.745 4 32 4 C45.255 4 56 14.745 56 28 C56 45 32 76 32 76 Z" fill="none" stroke="#5E0D09" stroke-width="3"/>
                                    </svg>
                                  </span>
                                  {photo.dive_site_name}
                                </span>
                              )}
                              {photo.camera_body && (<span className="hoverMetaLine"><span className="hoverIco">📷</span>{photo.camera_body}</span>)}
                              {photo.species && (<span className="hoverMetaLine"><span className="hoverIco">📏</span>{photo.species}</span>)}
                            </div>
                          </div>
                          {debugMode && (
                            <div className="debug-overlay">
                              <span className="debug-filename">{photo.filename}</span>
                              {photo.latitude != null && photo.longitude != null && (<span className="debug-location">{photo.latitude}, {photo.longitude}</span>)}
                            </div>
                          )}
                        </div>
                      );
                    }
                  });
                })()}
              </div>
            </section>
          ))}
        </div>
      )}

      {viewerPhoto && (
        <FullscreenViewer photo={viewerPhoto} onClose={closeViewer} onPrev={() => navigateViewer(-1)} onNext={() => navigateViewer(1)}
          hasPrev={viewerIndex > 0} hasNext={viewerIndex < photos.length - 1} onMapClick={(photo) => openSiteMap(photo)}
          admin={admin} onPhotoUpdated={handlePhotoUpdated} debugMode={debugMode} diveSites={diveSites}
          currentIndex={viewerIndex} totalPhotos={photos.length}
          onPhotoViewed={(photoId, viewed) => handlePhotoViewed(photoId, viewed)} onLikeToggle={(photoId, liked, count) => handleLikeToggle(photoId, liked, count)} />
      )}

      <Suspense fallback={null}>
        {mapModal.open && mapModal.mode === 'selectedSite' && (
          <DiveMapModal_FlyTo sites={diveSites} activeDiveSiteId={mapModal.activeSiteId} onClose={closeMap} />
        )}
        {mapModal.open && mapModal.mode === 'allSites' && (
          <DiveMapModal mode={mapModal.mode} sites={diveSites} activeDiveSiteId={mapModal.activeSiteId} onClose={closeMap} />
        )}
      </Suspense>

      {showDiveDataUpload && (
        <DiveDataUploadModal onClose={() => setShowDiveDataUpload(false)} />
      )}

      {showSiteListEditor && (
        <DiveSiteListEditor sites={[]} onClose={() => setShowSiteListEditor(false)} onSaved={() => {}} />
      )}

      {/* Library Sidebar */}
      <div className={`library-sidebar-backdrop ${sidebarOpen ? 'open' : ''}`} onClick={() => setSidebarOpen(false)}></div>
      <aside className={`library-sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="library-sidebar-header">
          <span className="library-sidebar-title">Libraries</span>
          <button className="library-sidebar-close" onClick={() => setSidebarOpen(false)}>✕</button>
        </div>
        <div className="library-sidebar-list">
          {libraries.map((lib, idx) => (
            <div key={lib.id}>
              {idx === 2 && <hr className="library-sidebar-divider" />}
              <div className={`library-sidebar-item ${lib.id === activeLibraryId ? 'active' : ''}`}
                onClick={() => { setActiveLibraryId(lib.id); setSidebarOpen(false); }}>
                <span className="library-sidebar-name">{lib.display_name}</span>
                <span className="library-sidebar-badge">{lib.photo_count || 0}</span>
              </div>
            </div>
          ))}
        </div>
      </aside>

      {/* Share QR Card */}
      {showShareQR && (
        <div className="share-qr-overlay" onClick={() => setShowShareQR(false)}>
          <div className="share-qr-card" onClick={e => e.stopPropagation()}>
            <button className="share-qr-close" onClick={() => setShowShareQR(false)} title="Close">✕</button>
            <div className="share-qr-content">
              <h2 className="share-qr-title">Share SCUBA Photo Gallery</h2>
              <p className="share-qr-desc">Scan this QR code to open the app on your device:</p>
              <div className="share-qr-image-wrap">
                <img src="/SCUBA_PhotoGallery2/share-qr.png" alt="QR Code for SCUBA Photo Gallery" className="share-qr-image" />
              </div>
              <p className="share-qr-url">https://dhofstra.com/SCUBA_PhotoGallery2/</p>
            </div>
          </div>
        </div>
      )}

      {/* Standalone prompt overlay for mobile */}
      {standalonePrompt && (
        <div className="standalone-overlay">
          <div className="standalone-card">
            <div className="standalone-icon">
              <img src={appIcon} alt="" width="120" height="120" style={{borderRadius:'18px',boxShadow:'0 4px 16px rgba(0,0,0,.5)'}} />
            </div>
            <h2 className="standalone-title">Install SCUBA Photo Gallery</h2>
            <p className="standalone-message">This app is <strong>much better</strong> when added as an app icon to your mobile home screen.</p>
            <div className="standalone-buttons">
              <button className="standalone-btn standalone-btn-later" onClick={handleMaybeLater}>Maybe Later</button>
              {isAndroid && !installFailed && (<button className="standalone-btn standalone-btn-install" onClick={handleAddToHomeScreen}>Add to Home Screen</button>)}
              {isAndroid && installFailed && (
                <div className="standalone-fallback">
                  <p className="standalone-fallback-title">Manual Install Instructions:</p>
                  <ol className="standalone-fallback-steps">
                    <li>Open the Chrome browser menu <strong>⋮</strong></li>
                    <li>Tap <strong>"Add to Home screen"</strong></li>
                    <li>Tap <strong>"Add"</strong> in the dialog</li>
                  </ol>
                </div>
              )}
              {isIOS && (<button className="standalone-btn standalone-btn-install" onClick={() => {}}><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" style={{display:'inline-block',verticalAlign:'middle',marginRight:'6px',fill:'currentColor'}}><path d="M12 2L8 6h3v7h2V6h3l-4-4z"/><path d="M20 11v7H4v-7H2v7c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2v-7h-2z"/></svg>Tap Share icon → "Add to Home Screen"</button>)}
            </div>
          </div>
        </div>
      )}

      <div className="version-footer">
        <span className="debug-hint">debug: <a href="#" className="debug-link" onClick={(e) => { e.preventDefault(); setShowAdminLogin(prev => !prev); }}>d</a> key</span>
        <span>Version {APP_VERSION}</span>
      </div>
    </div>
  );
}
