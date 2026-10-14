# OPERATION BLACKOUT: Multiplayer Cybersecurity CTF

> An interactive, real-time cyber incident simulation where players analyze clues, exploit simulated vulnerabilities, triage malware artifacts, and unmask an insider before the NovaCorp regional power grid suffers a catastrophic blackout.

---

## ⚡ Key Highlights

- **Zero-Dependency Sound**: Built-in procedural Web Audio API synthesizer generates BGM, sirens, chimes, failure buzzers, and Morse code. Works with 0 audio files, or easily drop your own MP3s.
- **Three Unified Interfaces**:
  - `/play` : Player responsive client (mobile, tablet, desktop)
  - `/host` : Real-time Control Room with live metrics, cheat alerts, plot twists, and timer controls
  - `/screen`: High-contrast projector view with dynamic QR code, top 10 leaderboard, and final podium
- **100% Ethical & Safe**: All challenges are in-app simulations. No real exploit code, no downloadable binaries, no shell execution.
- **Zero Annoying Dialogs**: Absolutely NO `window.alert`, `window.confirm`, or `window.prompt`. Fully styled, accessible in-page modals and toasts only.
- **Fair Anti-Cheat Engine**: 3-second grace period on window blur, devtools detection, and per-team salted flags that catch flag sharing immediately without closing or crashing tabs.

---

## 🚀 Quick Start (Local Run)

1. **Clone or Navigate to the Directory**:
   ```bash
   cd operation-blackout
   ```
2. **Install Dependencies**:
   ```bash
   npm install
   ```
3. **Run the Game Server**:
   ```bash
   npm start
   ```
4. **Access the Interfaces**:
   - **Player Interface**: [http://localhost:3000/play](http://localhost:3000/play)
   - **Control Room (Host)**: [http://localhost:3000/host](http://localhost:3000/host) (Default PIN: `1337`)
   - **Big Screen Projector**: [http://localhost:3000/screen](http://localhost:3000/screen)
   - **Health Endpoint**: [http://localhost:3000/health](http://localhost:3000/health)

---

## 🛠️ Configuration & Secrets

All configuration is managed via environment variables (or `.env` file):

| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `PORT` | `3000` | Port for Express & Socket.IO server |
| `HOST_PIN` | `1337` | Secret PIN to unlock the `/host` Control Room |
| `PUBLIC_URL` | *(empty)* | Optional public domain (e.g. `https://my-ctf.onrender.com`). Used for QR codes |
| `SESSION_SECRET` | `blackout-secret` | Cryptographic secret for cookies and host tokens |

---

## 📁 Custom Audio & Video Assets

You do not need any external media files to run the game. However, if you wish to drop your own media:

- **Audio (`/public/assets/audio/`)**:
  - `bgm.mp3`: Background cyber ambient loop
  - `correct.mp3`: ACCESS GRANTED sound
  - `wrong.mp3`: ACCESS DENIED sound
  - `alarm.mp3`: Siren alert
  - `unlock.mp3`: Unlocking door / hint sound
  - `victory.mp3`: Fanfare on vault completion
  - `heartbeat.mp3`: Tension heartbeat during high trace

- **Video (`/public/assets/video/`)**:
  - `intro.mp4`, `level1.mp4`, etc.: Fallback animations and canvas simulations run automatically if omitted.

---

## 📝 Customizing Levels & Quizzes

All challenge descriptions, questions, hints, and evidence fragments reside in [`data/levels.json`](data/levels.json). You can edit questions, change point values, or modify clues without touching server code.

---

## 🌐 Production Deployment

Refer to [`DEPLOY.md`](DEPLOY.md) for full deployment instructions on **Render.com**, **Railway.app**, or temporary sharing with **Cloudflare Tunnel**.
