# DEPLOYMENT GUIDE // OPERATION BLACKOUT

This document provides clear, step-by-step instructions to deploy **OPERATION BLACKOUT** to a persistent, publicly accessible HTTPS URL that stays online even when your laptop is closed.

---

## Method 1: Deploying to Render.com (Recommended Free Cloud Host)

Render provides a 100% free web service tier with automated SSL, WebSocket support for Socket.IO, and health check monitoring.

### Step 1: Push Code to a New GitHub Repository
1. Open PowerShell or a terminal inside the project directory:
   ```powershell
   cd C:\Users\prati\.gemini\antigravity\scratch\operation-blackout
   ```
2. Initialize git and commit:
   ```bash
   git init
   git add .
   git commit -m "Initial commit: OPERATION BLACKOUT CTF"
   ```
3. Create a **Private or Public** repository on [GitHub](https://github.com/new).
4. Link your remote and push:
   ```bash
   git remote add origin https://github.com/<YOUR_GITHUB_USERNAME>/<YOUR_REPO_NAME>.git
   git branch -M main
   git push -u origin main
   ```

### Step 2: Deploy with Render Blueprint
1. Log in to [Render.com](https://render.com).
2. Click **New +** in the top right, then select **Blueprint**.
3. Connect your GitHub account and select your `operation-blackout` repository.
4. Render will detect `render.yaml` automatically.
5. In the configuration screen:
   - **Service Name**: `operation-blackout`
   - **Environment Variables**:
     - `HOST_PIN`: Set your desired secret PIN for the Control Room (e.g. `9821` or `1337`).
     - `PUBLIC_URL`: Leave blank initially. Once Render provides your subdomain (e.g. `https://operation-blackout-xxxx.onrender.com`), set this to that exact URL so QR codes link directly to it.
6. Click **Apply**. Render will automatically build the container and deploy!

### Step 3: Verify and Launch
1. **Health Check**: Open `https://<YOUR-RENDER-URL>/health` in your browser. You should see:
   ```json
   { "status": "ok", "uptime": ..., "timestamp": ... }
   ```
2. **Open Control Room**: Go to `https://<YOUR-RENDER-URL>/host`.
3. Enter your `HOST_PIN`.
4. Scan the **Player QR Code** with your smartphone camera. You will immediately enter the game!

> **IMPORTANT NOTE ON FREE CLOUD HOSTS**:
> Free instances on Render spin down into sleep mode after 15 minutes of inactivity. Disks are ephemeral between restarts, though state persists in-memory while running. **Wake the app 2 minutes before your event** by opening the `/health` URL in your browser.

---

## Method 2: Instant Public LAN / Laptop Sharing via Cloudflare Tunnel

If you want to run the game directly from your laptop for a local or hybrid event, you can expose your local port securely with a Cloudflare Tunnel without port-forwarding or router configuration:

1. Start the server locally:
   ```powershell
   npm start
   ```
2. Open a separate terminal window and launch Cloudflare Tunnel:
   ```powershell
   .\cloudflared.exe tunnel --url http://localhost:3000
   ```
   *(If on macOS/Linux, install via `brew install cloudflare/cloudflare/cloudflared` and run `cloudflared tunnel --url http://localhost:3000`)*
3. Look for the public tunnel URL in the console output:
   ```text
   +-----------------------------------------------------------------------+
   |  Your quick Tunnel has been created! Visit it at:                     |
   |  https://random-words-1234.trycloudflare.com                          |
   +-----------------------------------------------------------------------+
   ```
4. Update `.env` or set `PUBLIC_URL=https://random-words-1234.trycloudflare.com` so QR codes point to the public tunnel link.

---

## Method 3: Deploying to Railway.app

1. Log in to [Railway.app](https://railway.app).
2. Click **New Project** > **Deploy from GitHub repo**.
3. Select your repository.
4. Railway will automatically detect the `Procfile` and `package.json`.
5. Under **Settings** > **Variables**, add:
   - `PORT`: `3000`
   - `HOST_PIN`: your secret PIN
   - `PUBLIC_URL`: your generated Railway domain
6. Click **Deploy**.

---

## Pre-Event Checklist (30 Minutes Before Kickoff)

- [ ] **Warm-up Ping**: Open `/health` in browser to ensure the cloud host is awake and responding.
- [ ] **Control Room Login**: Open `/host` on your organizer laptop and log in using your `HOST_PIN`.
- [ ] **Big Screen Display**: Connect your projector or main room monitor to `/screen` and press `F11` for clean fullscreen display.
- [ ] **QR Code Verification**: Scan the QR code shown on the Big Screen with your mobile phone to verify it loads `/play`.
- [ ] **Grid Entry Key**: Keep the Entry Key (`GRID-2026`) in mind. If agents struggle with the introductory Base64 transmission, click **Reveal Key** in `/host` to display it publicly on the Big Screen.
- [ ] **Audio Check**: Click anywhere on `/play` to verify the ambient cyber background music and sound synthesizer are active.
- [ ] **Timer Configuration**: Confirm default timer is set to 6 minutes (adjust with `+1m` / `-1m` if needed).

---

## Troubleshooting Guide

| Issue | Cause | Solution |
| :--- | :--- | :--- |
| **QR code shows localhost instead of public URL** | `PUBLIC_URL` environment variable not set | In your host dashboard (Render/Railway), add `PUBLIC_URL=https://your-app-domain.com`. Alternatively, the server auto-detects request headers. |
| **"Active in another tab" banner** | Same player session opened in 2 tabs | Click **Use This Tab**. The server transfers the session cleanly without closing or crashing the previous tab. |
| **"Terminal Locked" on player screen** | Multiple failed flag attempts or cheat strikes | Wait 30 seconds for the lockout timer, or open `/host` > Cheat Alerts panel and click **Forgive** / **Reinstate**. |
| **No sound on mobile phone** | Mobile browser autoplay policy | The player must click **ENTER THE GRID** on the landing screen, which initializes the Web Audio API context. |
| **Host PIN rejected** | PIN mismatch | Check `HOST_PIN` in your `.env` or Render environment settings (default is `1337`). |
