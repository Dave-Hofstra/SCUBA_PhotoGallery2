import { useState, useRef } from 'react';
import { uploadDiveData } from '../utils/api';

export default function DiveDataUploadModal({ onClose }) {
  const [dlexchFile, setDlexchFile] = useState(null);
  const [csvFile, setCsvFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const dlexchRef = useRef(null);
  const csvRef = useRef(null);

  const handleSave = async () => {
    if (!dlexchFile && !csvFile) {
      setError('Please select at least one file to upload.');
      return;
    }

    setUploading(true);
    setError(null);
    setResult(null);

    try {
      const formData = new FormData();
      if (dlexchFile) formData.append('dlexch', dlexchFile);
      if (csvFile) formData.append('csv', csvFile);

      const data = await uploadDiveData(formData);
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  };

  const handleCancel = () => {
    // Reset state
    setDlexchFile(null);
    setCsvFile(null);
    setResult(null);
    setError(null);
    onClose();
  };

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="modal-backdrop" onClick={handleCancel}>
      <div className="dive-data-upload-card" onClick={e => e.stopPropagation()}>
        <div className="dive-data-upload-header">
          <h2>Upload Dive Data</h2>
          <button className="modal-close-btn" onClick={handleCancel}>✕</button>
        </div>

        <div className="dive-data-upload-body">
          {result ? (
            <div className="dive-data-result">
              <div className="dive-data-result-icon">✅</div>
              <h3>Import Complete</h3>
              <div className="dive-data-result-files">
                {result.files.dlexch && <p>📄 Dlexch: {result.files.dlexch}</p>}
                {result.files.csv && <p>📄 CSV: {result.files.csv}</p>}
              </div>
              <div className="dive-data-result-stats">
                <div className="stat-row">
                  <span className="stat-label">Sites Inserted/Updated</span>
                  <span className="stat-value">{result.result.inserted}</span>
                </div>
                <div className="stat-row">
                  <span className="stat-label">Matched with CSV</span>
                  <span className="stat-value">{result.result.matched}</span>
                </div>
                <div className="stat-row">
                  <span className="stat-label">Unmatched Sites</span>
                  <span className="stat-value">{result.result.unmatched.length}</span>
                </div>
              </div>
              {result.result.unmatched.length > 0 && (
                <details className="dive-data-unmatched">
                  <summary>View unmatched dive sites ({result.result.unmatched.length})</summary>
                  <ul>
                    {result.result.unmatched.map((name, i) => (
                      <li key={i}>{name}</li>
                    ))}
                  </ul>
                </details>
              )}
              {result.result.errors.length > 0 && (
                <div className="dive-data-errors">
                  <p>Errors:</p>
                  <ul>
                    {result.result.errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}
              <button className="dive-data-close-btn" onClick={handleCancel}>Close</button>
            </div>
          ) : (
            <>
              <p className="dive-data-instructions">
                Upload new dive site data files to update the map and dive logs.
                You can upload one or both files — only the files you select will be processed.
              </p>

              {error && <div className="dive-data-error-msg">{error}</div>}

              <div className="dive-data-upload-section">
                <label className="dive-data-section-label">Dive Sites (.dlexch)</label>
                <p className="dive-data-section-desc">MacDive exported share file with GPS coordinates and dive site names.</p>
                <div className="dive-data-file-input-row">
                  <input
                    ref={dlexchRef}
                    type="file"
                    accept=".dlexch"
                    onChange={e => setDlexchFile(e.target.files[0] || null)}
                    className="dive-data-file-input"
                    id="dlexch-upload"
                  />
                  <label htmlFor="dlexch-upload" className="dive-data-file-label">
                    {dlexchFile ? 'Change File' : 'Choose .dlexch file'}
                  </label>
                  {dlexchFile && (
                    <span className="dive-data-file-name" title={dlexchFile.name}>
                      {dlexchFile.name} ({formatFileSize(dlexchFile.size)})
                    </span>
                  )}
                </div>
              </div>

              <div className="dive-data-upload-section">
                <label className="dive-data-section-label">Dive Log (.csv)</label>
                <p className="dive-data-section-desc">CSV export from MacDive with dive numbers, sites, cities, and countries.</p>
                <div className="dive-data-file-input-row">
                  <input
                    ref={csvRef}
                    type="file"
                    accept=".csv"
                    onChange={e => setCsvFile(e.target.files[0] || null)}
                    className="dive-data-file-input"
                    id="csv-upload"
                  />
                  <label htmlFor="csv-upload" className="dive-data-file-label">
                    {csvFile ? 'Change File' : 'Choose .csv file'}
                  </label>
                  {csvFile && (
                    <span className="dive-data-file-name" title={csvFile.name}>
                      {csvFile.name} ({formatFileSize(csvFile.size)})
                    </span>
                  )}
                </div>
              </div>

              <div className="dive-data-actions">
                <button className="dive-data-btn dive-data-btn-cancel" onClick={handleCancel}>
                  Cancel
                </button>
                <button
                  className="dive-data-btn dive-data-btn-save"
                  onClick={handleSave}
                  disabled={uploading || (!dlexchFile && !csvFile)}
                >
                  {uploading ? 'Importing...' : 'Save & Import'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}