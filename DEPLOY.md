# PPT Generator — Deployment Guide

## Requirements
- Node.js 18+ (20 LTS recommended)
- npm 9+
- At least 512MB RAM (1GB+ recommended)

## Setup

### 1. Upload files
Upload everything in this folder to your server (e.g. `/var/www/ppt-generator`)

### 2. Configure environment
```bash
cp .env.production.template .env.local
nano .env.local   # fill in your API keys
```

### 3. Install dependencies
```bash
npm install
```

### 4. Build
```bash
npm run build
```

### 5. Start
```bash
npm start
# runs on port 3000 by default
```

To run on a different port:
```bash
PORT=8080 npm start
```

## Running as a Service (PM2 — recommended)
```bash
npm install -g pm2
pm2 start "npm start" --name ppt-generator
pm2 save
pm2 startup   # auto-start on reboot
```

## Nginx Reverse Proxy (optional)
```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        # Large timeout for PPTX generation (can take 3-5 min)
        proxy_read_timeout 600;
        proxy_send_timeout 600;
    }
}
```

## Notes
- PPTX generation can take 3–5 minutes (audio + image generation)
- Make sure your server has outbound internet access to the API endpoints
- Stats are stored in `/tmp/ppt-generator-stats.json` (resets on server restart)
- Dashboard available at `/dashboard`
