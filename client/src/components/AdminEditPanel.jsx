import { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { updatePhoto, searchDiveSites, fetchDiveSiteList } from '../utils/api';
import DiveSiteListEditor from './DiveSiteListEditor';

const AdminEditPanel = forwardRef(function AdminEditPanel({ photo, onSaved, onCancel, onNavigate, onNavigateNext, hasPrev, hasNext }, ref) {
  const [form, setForm] = useState({
    title: photo.title || '',
    species: photo.species || '',
    camera_body: photo.camera_body || 'Olympus TG-7',
    lens: photo.lens || 'None',
    lighting: photo.lighting || 'None',
    description: photo.description || ''
  });
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [diveSiteSearch, setDiveSiteSearch] = useState('');
  const [diveSiteResults, setDiveSiteResults] = useState([]);
  const [showDiveSiteDropdown, setShowDiveSiteDropdown] = useState(false);
  const [selectedDiveSiteId, setSelectedDiveSiteId] = useState(photo.dive_site_list_id || null);
  const [selectedDiveSiteName, setSelectedDiveSiteName] = useState(photo.dive_site_name || '');
  const [selectedDiveSiteData, setSelectedDiveSiteData] = useState(null);
  const [showSiteListEditor, setShowSiteListEditor] = useState(false);
  const [allDiveSites, setAllDiveSites] = useState([]);
  const [saveMessage, setSaveMessage] = useState(null);
  const searchRef = useRef(null);
  const dropdownRef = useRef(null);
  const formRef = useRef(photo);
  const initialLoadDone = useRef(false);
  const autoSaveTimer = useRef(null);
  const savingRef = useRef(false);

  // Reset form when photo changes
  useEffect(() => {
    setForm({
      title: photo.title || '',
      species: photo.species || '',
      camera_body: photo.camera_body || 'Olympus TG-7',
      lens: photo.lens || 'None',
      lighting: photo.lighting || 'None',
      description: photo.description || ''
    });
    setDirty(false);
    setSaveMessage(null);
    setSelectedDiveSiteId(photo.dive_site_list_id || null);
    setSelectedDiveSiteName(photo.dive_site_name || '');
    setSelectedDiveSiteData(null);
    setDiveSiteSearch(photo.dive_site_name || '');
    formRef.current = photo;
  }, [photo]);

  // Expose methods to parent
  useImperativeHandle(ref, () => ({
    navigateTo(dir) {
      if (dirty) {
        if (!confirm('You have unsaved changes. Discard them?')) return;
      }
      setDirty(false);
      if (dir === 'prev' && onNavigate) onNavigate();
      else if (dir === 'next' && onNavigateNext) onNavigateNext();
    },
    hasUnsavedChanges() {
      return dirty;
    }
  }), [dirty, onNavigate, onNavigateNext]);

  // Mark form as dirty when any field changes
  const handleChange = (field) => (e) => {
    setForm(prev => ({ ...prev, [field]: e.target.value }));
    setDirty(true);
    setSaveMessage(null);
  };

  // Auto-save: debounce save when dirty changes to true
  useEffect(() => {
    if (!dirty) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      handleSave(true);
    }, 800);
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
  }, [dirty, form, selectedDiveSiteId]);

  // Load all dive sites for the dropdown
  useEffect(() => {
    initialLoadDone.current = false;
    fetchDiveSiteList().then(sites => {
      setAllDiveSites(sites);
      if (photo.dive_site_list_id) {
        const match = sites.find(s => s.id === photo.dive_site_list_id);
        if (match) {
          setSelectedDiveSiteName(match.dive_site_name);
          setSelectedDiveSiteData(match);
          setDiveSiteSearch(match.dive_site_name);
          setDiveSiteResults([]);
          setShowDiveSiteDropdown(false);
        }
      }
      initialLoadDone.current = true;
    }).catch(() => {
      initialLoadDone.current = true;
    });
  }, [photo.dive_site_list_id]);

  // Search dive sites as user types (skip on initial load)
  useEffect(() => {
    if (!initialLoadDone.current) return;
    if (diveSiteSearch.length < 1) {
      setDiveSiteResults([]);
      setShowDiveSiteDropdown(false);
      return;
    }
    // If the search string matches the currently selected site name, don't show dropdown
    if (selectedDiveSiteName && diveSiteSearch === selectedDiveSiteName) {
      setDiveSiteResults([]);
      setShowDiveSiteDropdown(false);
      return;
    }
    const timer = setTimeout(() => {
      searchDiveSites(diveSiteSearch).then(results => {
        setDiveSiteResults(results);
        setShowDiveSiteDropdown(results.length > 0);
      }).catch(() => {});
    }, 200);
    return () => clearTimeout(timer);
  }, [diveSiteSearch, selectedDiveSiteName]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target) &&
          searchRef.current && !searchRef.current.contains(e.target)) {
        setShowDiveSiteDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleDiveSiteSelect = (site) => {
    setSelectedDiveSiteId(site.id);
    setSelectedDiveSiteName(site.dive_site_name);
    setSelectedDiveSiteData(site);
    setDiveSiteSearch(site.dive_site_name);
    setDiveSiteResults([]);
    setShowDiveSiteDropdown(false);
    setDirty(true);
    setSaveMessage(null);
  };

  const handleSave = async (silent = false) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const payload = {
        title: form.title || null,
        species: form.species || null,
        camera_body: form.camera_body || null,
        lens: form.lens || null,
        lighting: form.lighting || null,
        description: form.description || null,
        dive_site_list_id: selectedDiveSiteId
      };

      const updated = await updatePhoto(photo.id, payload);
      setDirty(false);
      if (!silent) {
        setSaveMessage({ type: 'success', text: 'Saved successfully!' });
        setTimeout(() => setSaveMessage(null), 3000);
      }
      onSaved(updated);
    } catch (err) {
      setSaveMessage({ type: 'error', text: 'Save failed: ' + err.message });
    } finally {
      setSaving(false);
      savingRef.current = false;
    }
  };

  const handleSiteListSaved = () => {
    fetchDiveSiteList().then(sites => {
      setAllDiveSites(sites);
    }).catch(() => {});
  };

  // Navigate handlers with unsaved warning
  const handlePrev = () => {
    if (dirty) {
      if (!confirm('You have unsaved changes. Discard them?')) return;
    }
    setDirty(false);
    if (onNavigate) onNavigate();
  };

  const handleNext = () => {
    if (dirty) {
      if (!confirm('You have unsaved changes. Discard them?')) return;
    }
    setDirty(false);
    if (onNavigateNext) onNavigateNext();
  };

  return (
    <div className="admin-edit-panel">
      <div className="admin-edit-header">
        <h3>Edit Metadata</h3>
        <span className="admin-edit-filename">{photo.filename}</span>
      </div>

      <div className="admin-edit-form">
        {/* Row 1: Species Name + Subject Size */}
        <div className="admin-edit-row">
          <div className="admin-edit-field">
            <label>Species Name</label>
            <div className="admin-clearable-input">
              <input type="text" value={form.title} onChange={handleChange('title')} placeholder="e.g. Green Sea Turtle" />
              {form.title && (
                <button className="admin-clear-btn" onClick={() => { setForm(prev => ({ ...prev, title: '' })); setDirty(true); setSaveMessage(null); }} tabIndex="-1" aria-label="Clear species name">&times;</button>
              )}
            </div>
          </div>
          <div className="admin-edit-field">
            <label>Subject Size</label>
            <div className="admin-clearable-input">
              <input type="text" value={form.species} onChange={handleChange('species')} placeholder="e.g. 30 cm" />
              {form.species && (
                <button className="admin-clear-btn" onClick={() => { setForm(prev => ({ ...prev, species: '' })); setDirty(true); setSaveMessage(null); }} tabIndex="-1" aria-label="Clear subject size">&times;</button>
              )}
            </div>
          </div>
        </div>

        {/* Row 2: Camera + Lens */}
        <div className="admin-edit-row">
          <div className="admin-edit-field">
            <label>Camera</label>
            <select value={form.camera_body} onChange={handleChange('camera_body')}>
              <option value="Olympus TG-7">Olympus TG-7</option>
              <option value="iPhone 14 Pro Max">iPhone 14 Pro Max</option>
            </select>
          </div>
          <div className="admin-edit-field">
            <label>Lens</label>
            <select value={form.lens} onChange={handleChange('lens')}>
              <option value="None">None</option>
              <option value="Wide-Angle (KRL-07)">Wide-Angle (KRL-07)</option>
              <option value="Backscatter M52 Air Lens">Backscatter M52 Air Lens</option>
            </select>
          </div>
          <div className="admin-edit-field">
            <label>Lighting/Strobes</label>
            <select value={form.lighting} onChange={handleChange('lighting')}>
              <option value="None">None</option>
              <option value="Inon S220 Strobes (Dual)">Inon S220 Strobes (Dual)</option>
              <option value="Video Lights">Video Lights</option>
              <option value="Dive Torch">Dive Torch</option>
            </select>
          </div>
        </div>

        {/* Dive Site */}
        <div className="admin-edit-row">
          <div className="admin-edit-field admin-edit-field-wide">
            <label>Dive Site</label>
            <div className="dive-site-search-container">
              <div className="admin-clearable-input">
                <input
                  ref={searchRef}
                  type="text"
                  value={diveSiteSearch}
                  onChange={e => {
                    setDiveSiteSearch(e.target.value);
                    setSelectedDiveSiteId(null);
                    setSelectedDiveSiteName('');
                    setDirty(true);
                    setSaveMessage(null);
                  }}
                  placeholder="Search dive sites..."
                  className="dive-site-search-input"
                />
                {diveSiteSearch && (
                  <button className="admin-clear-btn" onClick={() => { setDiveSiteSearch(''); setSelectedDiveSiteId(null); setSelectedDiveSiteName(''); setSelectedDiveSiteData(null); setDirty(true); setSaveMessage(null); }} tabIndex="-1" aria-label="Clear dive site">&times;</button>
                )}
              </div>
              {showDiveSiteDropdown && diveSiteResults.length > 0 && (
                <div ref={dropdownRef} className="dive-site-dropdown">
                  {diveSiteResults.map(site => (
                    <div
                      key={site.id}
                      className={`dive-site-option ${site.id === selectedDiveSiteId ? 'selected' : ''}`}
                      onClick={() => handleDiveSiteSelect(site)}
                    >
                      <span className="dive-site-option-name">{site.dive_site_name}</span>
                      <span className="dive-site-option-location">
                        {[site.city_island, site.country_region].filter(Boolean).join(', ')}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {selectedDiveSiteId && (
                <>
                  <div className="dive-site-selected-badge">✓ {selectedDiveSiteName}</div>
                  {selectedDiveSiteData && (
                    <div className="dive-site-info">
                      <span className="dive-site-info-item">
                        <span className="dive-site-info-label">City/Island</span>
                        <span className="dive-site-info-value">{selectedDiveSiteData.city_island || '—'}</span>
                      </span>
                      <span className="dive-site-info-item">
                        <span className="dive-site-info-label">GPS</span>
                        <span className="dive-site-info-value dive-site-info-gps">
                          {selectedDiveSiteData.latitude != null && selectedDiveSiteData.longitude != null
                            ? `${selectedDiveSiteData.latitude}, ${selectedDiveSiteData.longitude}`
                            : '—'}
                        </span>
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Description — fills remaining space */}
        <div className="admin-edit-row admin-edit-row-grow">
          <div className="admin-edit-field admin-edit-field-wide admin-edit-field-grow">
            <label>Description</label>
            <textarea value={form.description} onChange={handleChange('description')} placeholder="Notes about the photo..." />
          </div>
        </div>
      </div>

      {/* Save message */}
      {saveMessage && (
        <div className={`admin-edit-message ${saveMessage.type}`}>
          {saveMessage.text}
        </div>
      )}

      {/* Actions bar */}
      <div className="admin-edit-actions">
        <div className="admin-edit-nav">
          <button
            className="admin-nav-btn"
            onClick={handlePrev}
            disabled={!hasPrev}
            title="Previous Photo"
          >
            ← Previous
          </button>
          <button
            className="admin-nav-btn"
            onClick={handleNext}
            disabled={!hasNext}
            title="Next Photo"
          >
            Next →
          </button>
        </div>
        <div className="admin-edit-save-group">
          <button className="admin-site-list-btn" onClick={() => setShowSiteListEditor(true)}>
            Dive Site List
          </button>
          <button className="admin-save-btn" onClick={() => handleSave(false)} disabled={saving}>
            {saving ? 'Saving...' : dirty ? '💾 Save Changes' : 'Save'}
          </button>
        </div>
      </div>

      {showSiteListEditor && (
        <DiveSiteListEditor
          sites={allDiveSites}
          onClose={() => {
            setShowSiteListEditor(false);
            handleSiteListSaved();
          }}
          onSaved={handleSiteListSaved}
        />
      )}
    </div>
  );
});

export default AdminEditPanel;