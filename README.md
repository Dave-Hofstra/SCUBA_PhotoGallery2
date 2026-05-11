# SCUBA Photo Gallery 2

A lightweight self-hosted web application for managing and displaying SCUBA diving photo galleries.

## Architecture

- **Frontend**: React + Vite (built to static files, served by nginx)
- **Backend**: Node.js + Express (runs on port 3001)
- **Database**: SQLite (stored in `data/scuba_gallery.sqlite`)
- **Image Processing**: Sharp (generates WebP thumbnails and display images)
- **Maps**: OpenFreeMap + MapLibre GL JS
- **Web Server**: nginx (reverse proxies `/api` to backend)

## Project Structure

```
SCUBA_PhotoGallery2/
├── photos/              # Original photo files (organized by library/category)
│   └── Wall_Photos/
│       └── Sample/      # Sample category folder
├── cache/               # Generated thumbnails and display images
│   ├── thumbnails/      # 400px wide WebP thumbnails
│   └── display/         # 1800px wide WebP display images
├── data/                # SQLite database
├── server/              # Backend Node.js application
│   ├── app.js           # Express server entry point
│   ├── database.js      # SQLite schema and connection
│   ├── scanner.js       # Filesystem scanner
│   ├── imageProcessor.js # Sharp image processing
│   ├── routes/          # API route handlers
│   ├── services/        # Auth service
│   └── scripts/         # Utility scripts
├── client/              # Frontend React application
│   ├── src/             # React source code
│   │   ├── components/  # React components
│   │   ├── pages/       # Page components
│   │   ├── config/      # Configuration (map settings)
│   │   ├── utils/       # API utilities
│   │   └── styles/      # CSS styles
│   └── dist/            # Built frontend (production)
├── .env                 # Environment configuration
├── nginx-example.conf   # Example nginx configuration
├── scuba-gallery.service # systemd service file
└── README.md
```

## Setup Instructions

### Prerequisites

- Ubuntu (or similar Linux distribution)
- Node.js 18+ and npm
- nginx
- systemd

### 1. Install Dependencies

```bash
# Navigate to project root
cd /mnt/ServerDocs/Websites/SCUBA_PhotoGallery2

# Install server dependencies
cd server && npm install && cd ..

# Install client dependencies
cd client && npm install && cd ..
```

### 2. Configure Environment

```bash
# Copy the example environment file
cp .env.example .env

# Edit .env to set your admin passcode hash
# Generate a hash: node server/scripts/generate-passcode-hash.js
# Default passcode is 5545 (already hashed in .env)
```

### 3. Copy Photo Assets

```bash
# Copy original photos from the old project
cp /mnt/ServerDocs/Websites/SCUBA_PhotoGallery/Wall_Photos/Photos-Originals/*.JPG \
   /mnt/ServerDocs/Websites/SCUBA_PhotoGallery2/photos/Wall_Photos/Sample/
```

### 4. Initialize Database and Scan

```bash
# Initialize the database
node server/scripts/init-db.js

# Run the scanner to register photos
# Start the server first:
node server/app.js

# Then trigger a scan (requires admin login):
curl -X POST http://localhost:3001/api/admin/login \
  -H "Content-Type: application/json" \
  -d '{"passcode":"5545"}' \
  -c cookies.txt

curl -X POST http://localhost:3001/api/admin/scan \
  -H "Content-Type: application/json" \
  -b cookies.txt
```

### 5. Generate Thumbnails and Display Images

```bash
# Start the server and trigger image processing via the API
# Or run the processor directly:
node -e "
const { processAllUnprocessed } = require('./server/imageProcessor');
processAllUnprocessed('./cache').then(r => console.log('Done:', r.length));
"
```

### 6. Import Metadata from info.js (Optional)

```bash
# Import metadata from the old project's info.js
node server/scripts/import-info-js.js
```

### 7. Development Mode

```bash
# Terminal 1: Start the backend
cd /mnt/ServerDocs/Websites/SCUBA_PhotoGallery2 && node server/app.js

# Terminal 2: Start the frontend dev server
cd /mnt/ServerDocs/Websites/SCUBA_PhotoGallery2/client && npm run dev

# Open http://localhost:5173 in your browser
```

### 8. Production Build

```bash
# Build the frontend
cd /mnt/ServerDocs/Websites/SCUBA_PhotoGallery2/client && npm run build

# The built files will be in client/dist/
```

### 9. Configure nginx

```bash
# Copy the example nginx config
sudo cp /mnt/ServerDocs/Websites/SCUBA_PhotoGallery2/nginx-example.conf \
       /etc/nginx/sites-available/scuba-gallery

# Edit the config to match your domain/setup
sudo nano /etc/nginx/sites-available/scuba-gallery

# Enable the site
sudo ln -s /etc/nginx/sites-available/scuba-gallery /etc/nginx/sites-enabled/

# Test and reload
sudo nginx -t
sudo systemctl reload nginx
```

### 10. Set Up systemd Service

```bash
# Copy the service file
sudo cp /mnt/ServerDocs/Websites/SCUBA_PhotoGallery2/scuba-gallery.service \
       /etc/systemd/system/

# Edit the service file to set correct paths
sudo nano /etc/systemd/system/scuba-gallery.service

# Enable and start the service
sudo systemctl daemon-reload
sudo systemctl enable scuba-gallery
sudo systemctl start scuba-gallery

# Check status
sudo systemctl status scuba-gallery

# View logs
sudo journalctl -u scuba-gallery -f
```

## API Endpoints

| Method | Endpoint | Description | Auth Required |
|--------|----------|-------------|---------------|
| GET | /api/health | Health check | No |
| GET | /api/libraries | List photo libraries | No |
| GET | /api/libraries/:id/photos | Get photos grouped by category | No |
| GET | /api/photos/:id | Get single photo details | No |
| PUT | /api/photos/:id | Update photo metadata | Yes (admin) |
| GET | /api/dive-sites | List all dive sites | No |
| POST | /api/admin/login | Admin login | No |
| POST | /api/admin/logout | Admin logout | Yes |
| GET | /api/admin/check | Check admin status | No |
| POST | /api/admin/scan | Trigger filesystem scan | Yes |

## Adding New Photos

1. Place original photos in a category folder under `photos/<LibraryName>/<CategoryName>/`
2. Log in as admin and click the scan button (or POST to /api/admin/scan)
3. The scanner will register new photos and generate thumbnails/display images
4. Edit metadata through the admin interface

## Updating Dive Sites

When you have new dive sites from updated CSV and dlexch files:

1. Place the new files in the `DiveLog_Import/` folder with descriptive date-stamped names:
   ```
   DiveLog_Import/
   ├── David Hofstra csv all dives - YYYY-MM-DD.csv
   └── Share Dive Site YYYY-MM-DD HH.MM.SS.dlexch
   ```

2. Run the import script with the new file paths:
   ```bash
   node server/scripts/import-dive-sites.js \
     "DiveLog_Import/Share Dive Site 2026-06-01 12.00.00.dlexch" \
     "DiveLog_Import/David Hofstra csv all dives - 2026-06-01.csv"
   ```

   Or without arguments (uses the default files in DiveLog_Import/):
   ```bash
   node server/scripts/import-dive-sites.js
   ```

3. The script will:
   - Parse all dive sites from the dlexch JSON file
   - Match them with City/Island and Country/Region from the CSV
   - Insert or update records in the `dive_site_list` table
   - Report any unmatched dive sites

4. After import, restart the backend:
   ```bash
   sudo systemctl restart scuba-gallery
   ```

## Troubleshooting

### noexec Filesystem

If `/mnt/ServerDocs` is mounted with `noexec`, native Node.js modules won't work directly. Use symlinks:

```bash
# Install dependencies on a non-noexec filesystem
mkdir -p /home/dhofstra/scuba-server-modules
cp server/package.json /home/dhofstra/scuba-server-modules/
cd /home/dhofstra/scuba-server-modules && npm install

# Symlink back
ln -s /home/dhofstra/scuba-server-modules/node_modules server/node_modules
```

### Database Issues

```bash
# Reset the database (backup first!)
cp data/scuba_gallery.sqlite data/scuba_gallery.sqlite.bak
rm data/scuba_gallery.sqlite
node server/scripts/init-db.js
```

## License

Private project - all rights reserved.