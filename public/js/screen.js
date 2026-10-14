/**
 * OPERATION BLACKOUT - Big Screen Projector Engine
 */

(function () {
  const socket = io();

  const screenLevelBadge = document.getElementById('screen-level-badge');
  const screenTimer = document.getElementById('screen-timer');
  const screenAgentCount = document.getElementById('screen-agent-count');
  const screenEntryKeyBanner = document.getElementById('screen-entry-key-banner');
  const screenEntryKeyText = document.getElementById('screen-entry-key-text');
  const bigScreenQr = document.getElementById('big-screen-qr');
  const screenDirectUrl = document.getElementById('screen-direct-url');
  const screenLbTbody = document.getElementById('screen-lb-tbody');
  const screenFirstBloodTicker = document.getElementById('screen-first-blood-ticker');
  const screenFirstBloodText = document.getElementById('screen-first-blood-text');

  const screenMainGrid = document.getElementById('screen-main-grid');
  const screenPodiumView = document.getElementById('screen-podium-view');
  const podiumStage = document.getElementById('podium-stage');

  // Load QR code on startup
  async function loadScreenQr() {
    try {
      const resp = await fetch('/api/qr?path=/play&format=dataUrl');
      const data = await resp.json();
      if (bigScreenQr) bigScreenQr.src = data.dataUrl;
      if (screenDirectUrl) screenDirectUrl.textContent = data.url;
    } catch (e) {
      console.error('Error fetching screen QR:', e);
    }
  }
  loadScreenQr();

  socket.on('connect', () => {
    socket.emit('joinScreen');
  });

  socket.on('publicStateUpdate', (data) => {
    renderScreenState(data);
  });

  socket.on('firstBloodAlert', (data) => {
    if (data && data.isFirstBlood) {
      screenFirstBloodText.textContent = `FIRST BLOOD: ${data.teamName} solved ${data.levelTitle}! (+${data.pointsAwarded} pts)`;
      screenFirstBloodTicker.classList.remove('hidden');
      window.soundSystem?.playCorrect();
      setTimeout(() => {
        screenFirstBloodTicker.classList.add('hidden');
      }, 8000);
    }
  });

  function renderScreenState(data) {
    if (!data) return;

    // Header info
    screenLevelBadge.textContent = `LEVEL ${data.activeLevel || 1}`;
    screenAgentCount.textContent = data.onlinePlayerCount || 0;

    // Timer
    const rem = data.levelTimeRemaining ?? 360;
    const m = Math.floor(rem / 60);
    const s = rem % 60;
    screenTimer.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

    // Entry Key banner
    if (data.entryKeyRevealed && data.entryKey) {
      screenEntryKeyBanner.classList.remove('hidden');
      screenEntryKeyText.textContent = data.entryKey;
    } else {
      screenEntryKeyBanner.classList.add('hidden');
    }

    // Check if game ended -> show podium
    if (data.gameStatus === 'ENDED') {
      renderPodium(data.leaderboard || []);
      return;
    } else {
      screenMainGrid.classList.remove('hidden');
      screenPodiumView.classList.add('hidden');
    }

    // Render Top 10 Leaderboard
    const teams = (data.leaderboard || []).slice(0, 10);
    if (teams.length === 0) {
      screenLbTbody.innerHTML = `
        <tr>
          <td colspan="5" style="text-align:center; color:var(--text-muted); padding:30px;">
            Grid standing by. Waiting for agents to deploy...
          </td>
        </tr>
      `;
      return;
    }

    screenLbTbody.innerHTML = '';
    teams.forEach((t, idx) => {
      const tr = document.createElement('tr');
      const rankBadge = idx === 0 ? '🥇 #1' : idx === 1 ? '🥈 #2' : idx === 2 ? '🥉 #3' : `#${idx + 1}`;
      const solvedCount = (t.solvedLevels || []).length;
      const stageText = t.completedVault ? 'Vault Cleared 🏆' : `Level ${t.currentLevel}`;

      tr.innerHTML = `
        <td><strong>${rankBadge}</strong></td>
        <td><strong style="font-size:16px;">${t.name}</strong></td>
        <td>${solvedCount} / 5</td>
        <td>${stageText}</td>
        <td style="text-align:right;"><strong class="text-green" style="font-size:18px;">${t.score}</strong></td>
      `;
      screenLbTbody.appendChild(tr);
    });
  }

  function renderPodium(leaderboard) {
    screenMainGrid.classList.add('hidden');
    screenPodiumView.classList.remove('hidden');

    const top3 = leaderboard.slice(0, 3);
    const first = top3[0] || { name: 'None', score: 0 };
    const second = top3[1] || { name: 'None', score: 0 };
    const third = top3[2] || { name: 'None', score: 0 };

    podiumStage.innerHTML = `
      <!-- 2nd Place -->
      <div class="podium-step">
        <div style="margin-bottom:8px;">
          <strong style="font-size:18px; color:#cbd5e1;">${second.name}</strong><br>
          <span class="mono text-green">${second.score} pts</span>
        </div>
        <div class="podium-pedestal pedestal-2">2</div>
      </div>

      <!-- 1st Place -->
      <div class="podium-step">
        <div style="font-size:24px; margin-bottom:4px;">👑</div>
        <div style="margin-bottom:8px;">
          <strong style="font-size:22px; color:#ffd700;">${first.name}</strong><br>
          <span class="mono text-green" style="font-size:18px;">${first.score} pts</span>
        </div>
        <div class="podium-pedestal pedestal-1">1</div>
      </div>

      <!-- 3rd Place -->
      <div class="podium-step">
        <div style="margin-bottom:8px;">
          <strong style="font-size:16px; color:#cd7f32;">${third.name}</strong><br>
          <span class="mono text-green">${third.score} pts</span>
        </div>
        <div class="podium-pedestal pedestal-3">3</div>
      </div>
    `;
  }
})();
