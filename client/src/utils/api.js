const API_BASE = '/SCUBA_PhotoGallery2/api';
export const MEDIA_BASE = '/SCUBA_PhotoGallery2';

async function apiRequest(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const config = {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    },
    credentials: 'include',
    ...options
  };

  const response = await fetch(url, config);

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

export function fetchLibraries() {
  return apiRequest('/libraries');
}

export function fetchLibraryPhotos(libraryId) {
  return apiRequest(`/libraries/${libraryId}/photos`);
}

export function fetchPhoto(photoId) {
  return apiRequest(`/photos/${photoId}`);
}

export function updatePhoto(photoId, data) {
  return apiRequest(`/photos/${photoId}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
}

export function fetchDiveSites() {
  return apiRequest('/dive-sites');
}

export function adminLogin(passcode) {
  return apiRequest('/admin/login', {
    method: 'POST',
    body: JSON.stringify({ passcode })
  });
}

export function adminLogout() {
  return apiRequest('/admin/logout', {
    method: 'POST'
  });
}

export function checkAdmin() {
  return apiRequest('/admin/check');
}

export function triggerScan() {
  return apiRequest('/admin/scan', {
    method: 'POST'
  });
}

export function triggerSync() {
  return apiRequest('/admin/sync', {
    method: 'POST'
  });
}

export function healthCheck() {
  return apiRequest('/health');
}

// Dive Site List API
export function fetchDiveSiteList() {
  return apiRequest('/dive-site-list');
}

export function searchDiveSites(query) {
  return apiRequest(`/dive-site-list/search?q=${encodeURIComponent(query)}`);
}

export function createDiveSite(data) {
  return apiRequest('/dive-site-list', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export function updateDiveSite(id, data) {
  return apiRequest(`/dive-site-list/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
}

export function deleteDiveSite(id) {
  return apiRequest(`/dive-site-list/${id}`, {
    method: 'DELETE'
  });
}

export function updateCategoryDisplayName(categoryId, displayName) {
  return apiRequest(`/admin/categories/${categoryId}`, {
    method: 'PUT',
    body: JSON.stringify({ display_name: displayName })
  });
}

export function fetchTotalDives() {
  return apiRequest('/dive-sites/total-dives');
}
