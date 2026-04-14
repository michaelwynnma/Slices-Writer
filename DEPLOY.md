# PPT Generator — Deployment Guide

---

## Option 1: Docker Compose (Recommended for Servers)

### Requirements
- Docker Engine 20.10+
- Docker Compose v2+
- Outbound internet access to the API endpoints

### Steps

#### 1. Clone the repository
```bash
git clone https://gitlab.corp.hongsong.club/michaelwynnma/ppt-generator.git
cd ppt-generator
```

#### 2. (Optional) Override API keys
The app has default API keys built in. If you need to use different keys, edit `docker-compose.yaml` and uncomment the relevant lines:
```yaml
environment:
  - CLAUDE_API_KEY=your-key-here
  - TTS_API_KEY=your-key-here
```

#### 3. Build and start
```bash
docker compose up -d --build
```
The first build takes 3–5 minutes. Subsequent starts are instant.

#### 4. Verify it's running
```bash
docker compose ps
docker compose logs -f
```
App is ready when you see: `✓ Ready`

#### 5. Open in browser
```
http://<server-ip>:3000
```

---

### Common Docker Commands

| Task | Command |
|------|---------|
| Start | `docker compose up -d` |
| Stop | `docker compose down` |
| Restart | `docker compose restart` |
| View logs | `docker compose logs -f` |
| Rebuild after code update | `docker compose up -d --build` |
| Check status | `docker compose ps` |

### Updating to a New Version
```bash
git pull
docker compose up -d --build
```

---

## Option 2: Manual (Node.js on Linux/Mac)

### Requirements
- Node.js 18+ (20 LTS recommended)
- npm 9+
- ffmpeg (required for dialogue audio)
- At least 512MB RAM (1GB+ recommended)

### Steps

#### 1. Clone the repository
```bash
git clone https://gitlab.corp.hongsong.club/michaelwynnma/ppt-generator.git
cd ppt-generator
```

#### 2. Install ffmpeg
```bash
# Ubuntu / Debian
sudo apt install -y ffmpeg

# CentOS / RHEL
sudo yum install -y ffmpeg

# macOS
brew install ffmpeg
```

#### 3. Install dependencies
```bash
npm install
```

#### 4. Build
```bash
npm run build
```

#### 5. Start
```bash
npm start
# runs on port 3000 by default
```

To run on a different port:
```bash
PORT=8080 npm start
```

### Running as a Service (PM2)
```bash
npm install -g pm2
pm2 start "npm start" --name ppt-generator
pm2 save
pm2 startup   # auto-start on reboot
```

### Nginx Reverse Proxy (optional)
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

---

## Notes
- PPTX generation can take 3–5 minutes (audio + image generation)
- Make sure your server has outbound internet access to the API endpoints
- Stats are stored in `/tmp/ppt-generator-stats.json` (resets on server restart)
- Dashboard available at `/dashboard`
