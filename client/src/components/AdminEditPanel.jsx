import { useState, useEffect, useRef } from 'react';
import { updatePhoto, searchDiveSites, fetchDiveSiteList } from '../utils/api';
import DiveSiteListEditor from './DiveSiteListEditor';

export default function AdminEditPanel({ photo, onSaved, onCancel }) {
  const [form, setForm] = useState({
    title: photo.title || '',
    country: photo.country || '',
    species: photo.species || '',
    camera_body: photo.camera_body || '',
    lens: photo.lens || '',
    housing: photo.housing || '',
    lighting: photo.lighting || '',
    description: photo.description || '',
    latitude: photo.latitude != null ? String(photo.latitude) : '',
    longitude: photo.longitude != null ? String(photo.longitude) : '',
    dive_count: photo.dive_count != null ? String(photo.dive_count) : ''
  });
  const [saving, setSaving] = useState(false);
  const [diveSiteSearch, setDiveSiteSearch] = useState('');
  const [diveSiteResults, setDiveSiteResults] = useState([]);
  const [showDiveSiteDropdown, setShowDiveSiteDropdown] = useState(false);
  const [selectedDiveSiteId, setSelectedDiveSiteId] = useState(photo.dive_site_list_id || null);
  const [selectedDiveSiteName, setSelectedDiveSiteName] = useState(photo.dive_site_name || '');
  const [showSiteListEditor, setShowSiteListEditor] = useState(false);
  const [allDiveSites, setAllDiveSites] = useState([]);
  const searchRef = useRef(null);
  const dropdownRef = useRef(null);

  // Load all dive sites for the dropdown
  useEffect(() => {
    fetchDiveSiteList().then(sites => {
      setAllDiveSites(sites);
      // If photo has a dive_site_list_id, find its name
      if (photo.dive_site_list_id) {
        const match = sites.find(s => s.id === photo.dive_site_list_id);
        if (match) {
          setSelectedDiveSiteName(match.dive_site_name);
          setDiveSiteSearch(match.dive_site_name);
        }
      }
    }).catch(() => {});
  }, [photo.dive_site_list_id]);

  // Search dive sites as user types
  useEffect(() => {
    if (diveSiteSearch.length < 1) {
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
  }, [diveSiteSearch]);

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

  const handleChange = (field) => (e) => {
    setForm(prev => ({ ...prev, [field]: e.target.value }));
  };

  const handleDiveSiteSelect = (site) => {
    setSelectedDiveSiteId(site.id);
    setSelectedDiveSiteName(site.dive_site_name);
    setDiveSiteSearch(site.dive_site_name);
    setShowDiveSiteDropdown(false);
    // Also auto-fill country if empty
    // Always auto-fill country from the selected dive site
    if (site.country_region) {
      setForm(prev => ({ ...prev, country: site.country_region }));
    }
    if (!form.latitude && site.latitude != null) {
      setForm(prev => ({ ...prev, latitude: String(site.latitude) }));
    }
    if (!form.longitude && site.longitude != null) {
      setForm(prev => ({ ...prev, longitude: String(site.longitude) }));
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        title: form.title || null,
        country: form.country || null,
        species: form.species || null,
        camera_body: form.camera_body || null,
        lens: form.lens || null,
        housing: form.housing || null,
        lighting: form.lighting || null,
        description: form.description || null,
        latitude: form.latitude ? parseFloat(form.latitude) : null,
        longitude: form.longitude ? parseFloat(form.longitude) : null,
        dive_count: form.dive_count ? parseInt(form.dive_count, 10) : null,
        dive_site_list_id: selectedDiveSiteId
      };

      await updatePhoto(photo.id, payload);
      onSaved();
    } catch (err) {
      alert('Failed to save: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSiteListSaved = () => {
    // Refresh dive site list
    fetchDiveSiteList().then(sites => {
      setAllDiveSites(sites);
    }).catch(() => {});
  };

  return (
    <div className="admin-edit-panel">
      <h3>Edit Metadata: {photo.title || photo.filename}</h3>
      <div className="edit-form">
        {[
          ['title', 'Species Name'],
          ['country', 'Country'],
          ['species', 'Size'],
          ['camera_body', 'Camera Body'],
          ['lens', 'Lens'],
          ['housing', 'Housing'],
          ['lighting', 'Lighting/Strobes'],
          ['description', 'Description']
        ].map(([field, label]) => (
          <div className={`edit-field ${field === 'title' ? 'edit-field-wide' : ''}`} key={field}>
            <label>{label}</label>
            {field === 'description' ? (
              <textarea value={form[field]} onChange={handleChange(field)} rows={3} />
            ) : (
              <input type="text" value={form[field]} onChange={handleChange(field)} />
            )}
          </div>
        ))}

        {/* Dive Site searchable dropdown */}
        <div className="edit-field">
          <label>Dive Site</label>
          <div className="dive-site-search-container">
            <input
              ref={searchRef}
              type="text"
              value={diveSiteSearch}
              onChange={e => {
                setDiveSiteSearch(e.target.value);
                setSelectedDiveSiteId(null);
                setSelectedDiveSiteName('');
              }}
              placeholder="Search dive sites..."
              className="dive-site-search-input"
            />
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
              <div className="dive-site-selected-badge">
                ✓ {selectedDiveSiteName}
              </div>
            )}
          </div>
        </div>

        <div className="edit-field">
          <label>Latitude</label>
          <input type="text" value={form.latitude} onChange={handleChange('latitude')} placeholder="e.g. 25.1234" />
        </div>
        <div className="edit-field">
          <label>Longitude</label>
          <input type="text" value={form.longitude} onChange={handleChange('longitude')} placeholder="e.g. -80.5678" />
        </div>
        <div className="edit-field">
          <label>Dive Count</label>
          <input type="number" value={form.dive_count} onChange={handleChange('dive_count')} />
        </div>
      </div>
      <div className="edit-actions">
        <button className="edit-btn save-btn" onClick={handleSave} disabled={saving}>
          {saving ? 'Saving...' : 'Save'}
        </button>
        <button className="edit-btn site-list-btn" onClick={() => setShowSiteListEditor(true)}>
          Dive Site List Edit
        </button>
        <button className="edit-btn cancel-btn" onClick={onCancel}>Cancel</button>
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
}