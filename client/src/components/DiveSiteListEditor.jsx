import { useState, useEffect } from 'react';
import { createDiveSite, updateDiveSite, deleteDiveSite, fetchDiveSiteList } from '../utils/api';

export default function DiveSiteListEditor({ sites: initialSites, onClose, onSaved }) {
  const [sites, setSites] = useState(initialSites || []);
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState({
    dive_site_name: '',
    city_island: '',
    country_region: '',
    latitude: '',
    longitude: '',
    notes: ''
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetchDiveSiteList().then(sites => {
      setSites(sites);
    }).catch(() => {});
  }, []);

  const startEdit = (site) => {
    setEditingId(site.id);
    setEditForm({
      dive_site_name: site.dive_site_name || '',
      city_island: site.city_island || '',
      country_region: site.country_region || '',
      latitude: site.latitude != null ? String(site.latitude) : '',
      longitude: site.longitude != null ? String(site.longitude) : '',
      notes: site.notes || ''
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditForm({});
  };

  const handleEditChange = (field) => (e) => {
    setEditForm(prev => ({ ...prev, [field]: e.target.value }));
  };

  const handleEditSave = async (id) => {
    setSaving(true);
    try {
      await updateDiveSite(id, {
        dive_site_name: editForm.dive_site_name,
        city_island: editForm.city_island || null,
        country_region: editForm.country_region || null,
        latitude: editForm.latitude ? parseFloat(editForm.latitude) : null,
        longitude: editForm.longitude ? parseFloat(editForm.longitude) : null,
        notes: editForm.notes || null
      });
      setEditingId(null);
      setEditForm({});
      setMessage('Dive site updated');
      setTimeout(() => setMessage(''), 2000);
      const updated = await fetchDiveSiteList();
      setSites(updated);
      if (onSaved) onSaved();
    } catch (err) {
      alert('Failed to update: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id, name) => {
    if (!confirm(`Delete dive site "${name}"? This cannot be undone.`)) return;
    try {
      await deleteDiveSite(id);
      setMessage('Dive site deleted');
      setTimeout(() => setMessage(''), 2000);
      const updated = await fetchDiveSiteList();
      setSites(updated);
      if (onSaved) onSaved();
    } catch (err) {
      alert('Failed to delete: ' + err.message);
    }
  };

  const handleAddChange = (field) => (e) => {
    setAddForm(prev => ({ ...prev, [field]: e.target.value }));
  };

  const handleAddSave = async () => {
    if (!addForm.dive_site_name.trim()) {
      alert('Dive site name is required');
      return;
    }
    setSaving(true);
    try {
      await createDiveSite({
        dive_site_name: addForm.dive_site_name.trim(),
        city_island: addForm.city_island || null,
        country_region: addForm.country_region || null,
        latitude: addForm.latitude ? parseFloat(addForm.latitude) : null,
        longitude: addForm.longitude ? parseFloat(addForm.longitude) : null,
        notes: addForm.notes || null
      });
      setAddForm({
        dive_site_name: '',
        city_island: '',
        country_region: '',
        latitude: '',
        longitude: '',
        notes: ''
      });
      setShowAddForm(false);
      setMessage('Dive site added');
      setTimeout(() => setMessage(''), 2000);
      const updated = await fetchDiveSiteList();
      setSites(updated);
      if (onSaved) onSaved();
    } catch (err) {
      alert('Failed to add: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="site-list-overlay" onClick={(e) => {
      if (e.target === e.currentTarget) onClose();
    }}>
      <div className="site-list-modal">
        <div className="site-list-header">
          <h2>Dive Site List Editor</h2>
          <button className="site-list-close" onClick={onClose}>&times;</button>
        </div>

        {message && <div className="site-list-message">{message}</div>}

        <div className="site-list-toolbar">
          <button className="edit-btn add-btn" onClick={() => setShowAddForm(!showAddForm)}>
            {showAddForm ? 'Cancel' : '+ Add Dive Site'}
          </button>
          <span className="site-list-count">{sites.length} sites</span>
        </div>

        {showAddForm && (
          <div className="site-list-add-form">
            <div className="add-form-row">
              <div className="add-field">
                <label>Dive Site Name *</label>
                <input type="text" value={addForm.dive_site_name} onChange={handleAddChange('dive_site_name')} />
              </div>
              <div className="add-field">
                <label>City/Island</label>
                <input type="text" value={addForm.city_island} onChange={handleAddChange('city_island')} />
              </div>
            </div>
            <div className="add-form-row">
              <div className="add-field">
                <label>Country/Region</label>
                <input type="text" value={addForm.country_region} onChange={handleAddChange('country_region')} />
              </div>
              <div className="add-field">
                <label>Latitude</label>
                <input type="text" value={addForm.latitude} onChange={handleAddChange('latitude')} placeholder="e.g. 12.2019" />
              </div>
              <div className="add-field">
                <label>Longitude</label>
                <input type="text" value={addForm.longitude} onChange={handleAddChange('longitude')} placeholder="e.g. -68.2624" />
              </div>
            </div>
            <div className="add-form-row">
              <div className="add-field full">
                <label>Notes</label>
                <input type="text" value={addForm.notes} onChange={handleAddChange('notes')} />
              </div>
            </div>
            <button className="edit-btn save-btn" onClick={handleAddSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save New Site'}
            </button>
          </div>
        )}

        <div className="site-list-table-container">
          <table className="site-list-table">
            <thead>
              <tr>
                <th>Dive Site Name</th>
                <th>City/Island</th>
                <th>Country/Region</th>
                <th>Latitude</th>
                <th>Longitude</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sites.map(site => (
                <tr key={site.id}>
                  {editingId === site.id ? (
                    <>
                      <td><input type="text" value={editForm.dive_site_name} onChange={handleEditChange('dive_site_name')} /></td>
                      <td><input type="text" value={editForm.city_island} onChange={handleEditChange('city_island')} /></td>
                      <td><input type="text" value={editForm.country_region} onChange={handleEditChange('country_region')} /></td>
                      <td><input type="text" value={editForm.latitude} onChange={handleEditChange('latitude')} className="coord-input" /></td>
                      <td><input type="text" value={editForm.longitude} onChange={handleEditChange('longitude')} className="coord-input" /></td>
                      <td className="actions-cell">
                        <button className="edit-btn save-btn small" onClick={() => handleEditSave(site.id)} disabled={saving}>Save</button>
                        <button className="edit-btn cancel-btn small" onClick={cancelEdit}>Cancel</button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td>{site.dive_site_name}</td>
                      <td>{site.city_island || '—'}</td>
                      <td>{site.country_region || '—'}</td>
                      <td className="coord">{site.latitude != null ? site.latitude.toFixed(4) : '—'}</td>
                      <td className="coord">{site.longitude != null ? site.longitude.toFixed(4) : '—'}</td>
                      <td className="actions-cell">
                        <button className="edit-btn edit-btn-sm" onClick={() => startEdit(site)}>Edit</button>
                        <button className="edit-btn delete-btn-sm" onClick={() => handleDelete(site.id, site.dive_site_name)}>Del</button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}