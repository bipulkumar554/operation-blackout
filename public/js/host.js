/**
 * OPERATION BLACKOUT - Host Control Room Engine
 */

(function () {
  const socket = io();

  let hostToken = localStorage.getItem('ob_host_token') || null;
  let cachedHostState = null;

  // DOM Elements
  const hostAuthScreen = document.getElementById('host-auth-screen');
  const formHostLogin = document.getElementById('form-host-login');
  const inputHostPin = document.getElementById('input-host-pin');
  const hostLoginFeedback = document.getElementById('host-login-feedback');

  const qrThumbPlay = document.getElementById('qr-thumb-play');
  const qrThumbScreen = document.getElementById('qr-thumb-screen');
  const hostEntryKeyBadge = document.getElementById('host-entry-key-badge');
  const btnToggleRevealKey = document.getElementById('btn-toggle-reveal-key');
  const hostOnlineAgentsCount = document.getElementById('host-online-agents-count');

  const hostGameStatusBadge = document.getElementById('host-game-status-badge');
  const hostTimerDisplay = document.getElementById('host-timer-display');
  const hostActiveLevelLabel = document.getElementById('host-active-level-label');

  const tbodyTeams = document.getElementById('tbody-teams');
  const tbodyPlayers = document.getElementById('tbody-players');
  const tbodyCheatAlerts = document.getElementById('tbody-cheat-alerts');
  const hostActivityFeed = document.getElementById('host-activity-feed');
  const selectPointsTeam = document.getElementById('select-points-team');
  const selectTeamRelease = document.getElementById('select-team-release');

  // --- Authentication ---
  if (hostToken) {
    socket.emit('joinHost', { token: hostToken });
  }

  socket.on('hostAuthenticated', () => {
    hostAuthScreen.classList.add('hidden');
    loadQRCodes();
  });

  socket.on('hostAuthError', () => {
    hostAuthScreen.classList.remove('hidden');
    localStorage.removeItem('ob_host_token');
  });

  if (formHostLogin) {
    formHostLogin.onsubmit = async (e) => {
      e.preventDefault();
      const pin = inputHostPin.value.trim();

      try {
        const resp = await fetch('/api/host/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pin })
        });
        const data = await resp.json();

        if (data.success) {
          hostToken = data.hostToken;
          localStorage.setItem('ob_host_token', hostToken);
          socket.emit('joinHost', { pin, token: hostToken });
          hostAuthScreen.classList.add('hidden');
          loadQRCodes();
          window.showToast('Control Room unlocked', 'success');
        } else {
          hostLoginFeedback.innerHTML = `<span class="text-red">${data.error || 'Invalid PIN'}</span>`;
        }
      } catch (err) {
        hostLoginFeedback.innerHTML = `<span class="text-red">Connection error: ${err.message}</span>`;
      }
    };
  }

  // --- QR Code Fetcher ---
  async function loadQRCodes() {
    try {
      const pResp = await fetch('/api/qr?path=/play&format=dataUrl');
      const pData = await pResp.json();
      if (qrThumbPlay) qrThumbPlay.src = pData.dataUrl;

      const sResp = await fetch('/api/qr?path=/screen&format=dataUrl');
      const sData = await sResp.json();
      if (qrThumbScreen) qrThumbScreen.src = sData.dataUrl;
    } catch (e) {
      console.error('Error fetching QR codes:', e);
    }
  }

  document.getElementById('btn-copy-play-url')?.addEventListener('click', () => {
    const playUrl = `${window.location.origin}/play`;
    window.copyToClipboard(playUrl, 'Player Link copied: ' + playUrl);
  });

  document.getElementById('btn-copy-screen-url')?.addEventListener('click', () => {
    const screenUrl = `${window.location.origin}/screen`;
    window.copyToClipboard(screenUrl, 'Big Screen Link copied: ' + screenUrl);
  });

  // --- Reveal / Hide Entry Key ---
  if (btnToggleRevealKey) {
    btnToggleRevealKey.onclick = () => {
      if (cachedHostState?.publicState?.entryKeyRevealed) {
        socket.emit('hostHideEntryKey', {}, () => {
          window.showToast('Grid Entry Key Hidden', 'info');
        });
      } else {
        socket.emit('hostRevealEntryKey', {}, () => {
          window.showToast('Grid Entry Key Revealed to Screen & Players!', 'success');
        });
      }
    };
  }

  // --- Host State Updates ---
  socket.on('hostStateUpdate', (data) => {
    cachedHostState = data;
    renderHostDashboard(data);
  });

  socket.on('newCheatAlert', (alertItem) => {
    window.showToast(`🚨 CHEAT DETECTED: ${alertItem.teamName} - ${alertItem.reason}`, 'danger', 6000);
  });

  function renderHostDashboard(data) {
    if (!data) return;
    const pub = data.publicState || {};
    const full = data.fullState || {};

    // Header info
    hostOnlineAgentsCount.textContent = pub.onlinePlayerCount || 0;
    hostGameStatusBadge.textContent = pub.gameStatus;
    hostGameStatusBadge.className = `badge ${pub.gameStatus === 'RUNNING' ? 'badge-green' : pub.gameStatus === 'PAUSED' ? 'badge-yellow' : 'badge-cyan'}`;
    
    // Timer
    const rem = pub.levelTimeRemaining ?? 360;
    const m = Math.floor(rem / 60);
    const s = rem % 60;
    hostTimerDisplay.textContent = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

    // Level label
    hostActiveLevelLabel.textContent = `L${pub.activeLevel} Active (Released: ${pub.releasedLevels?.join(', ') || '1'})`;

    // Entry key button status
    if (pub.entryKeyRevealed) {
      btnToggleRevealKey.textContent = 'Hide Key';
      btnToggleRevealKey.className = 'btn btn-sm btn-danger';
      hostEntryKeyBadge.style.color = '#00ff88';
    } else {
      btnToggleRevealKey.textContent = 'Reveal Key';
      btnToggleRevealKey.className = 'btn btn-sm btn-warning';
      hostEntryKeyBadge.style.color = '#ffcc00';
    }
    hostEntryKeyBadge.textContent = full.entryKey || 'GRID-2026';

    // Populate Teams dropdowns
    updateTeamDropdowns(full.teams || {});

    // Render Solves Bar Chart
    renderSolvesChart(full.teams || {});

    // Render Leaderboard & Teams Table
    renderTeamsTable(full.teams || {});

    // Render Players Table
    renderPlayersTable(full.players || {});

    // Render Cheat Alerts Table
    renderCheatAlertsTable(full.cheatAlerts || []);

    // Render Activity Feed
    renderActivityFeed(full.activityLog || []);
  }

  function updateTeamDropdowns(teams) {
    const teamEntries = Object.values(teams);

    // Points team selector
    const currentPointsVal = selectPointsTeam.value;
    selectPointsTeam.innerHTML = '<option value="ALL">ALL TEAMS (Bulk Bonus)</option>';
    teamEntries.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = `${t.name} (${t.score} pts)`;
      selectPointsTeam.appendChild(opt);
    });
    selectPointsTeam.value = currentPointsVal || 'ALL';

    // Team release selector
    const currentRelVal = selectTeamRelease.value;
    selectTeamRelease.innerHTML = '';
    teamEntries.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name;
      selectTeamRelease.appendChild(opt);
    });
    if (currentRelVal) selectTeamRelease.value = currentRelVal;
  }

  function renderSolvesChart(teams) {
    const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    const teamList = Object.values(teams);
    teamList.forEach(t => {
      (t.solvedLevels || []).forEach(lvl => {
        if (counts[lvl] !== undefined) counts[lvl]++;
      });
    });

    const maxCount = Math.max(1, ...Object.values(counts));
    [1, 2, 3, 4, 5].forEach(lvl => {
      const bar = document.getElementById(`bar-l${lvl}`);
      const val = document.getElementById(`bar-val-l${lvl}`);
      if (bar && val) {
        val.textContent = counts[lvl];
        const pct = Math.max(8, Math.round((counts[lvl] / maxCount) * 100));
        bar.style.height = `${pct}%`;
      }
    });
  }

  function renderTeamsTable(teams) {
    const sorted = Object.values(teams).sort((a, b) => b.score - a.score);
    document.getElementById('badge-team-count').textContent = `${sorted.length} Teams`;

    if (sorted.length === 0) {
      tbodyTeams.innerHTML = '<tr><td colspan="9" style="text-align:center; color:var(--text-muted);">Waiting for teams to join the grid...</td></tr>';
      return;
    }

    tbodyTeams.innerHTML = '';
    sorted.forEach((t, idx) => {
      const tr = document.createElement('tr');
      const isLocked = t.isLocked && Date.now() < t.lockUntil;
      const statusBadge = t.disqualified ? '<span class="badge badge-red">DISQUALIFIED</span>' :
        isLocked ? '<span class="badge badge-yellow">LOCKED</span>' :
        '<span class="badge badge-green">ACTIVE</span>';

      tr.innerHTML = `
        <td><strong>#${idx + 1}</strong></td>
        <td><strong>${t.name}</strong> <span class="mono text-muted" style="font-size:10px;">(_${t.salt})</span></td>
        <td><strong class="text-green">${t.score}</strong></td>
        <td>L${t.currentLevel}</td>
        <td>${t.solvedLevels?.join(', ') || '-'}</td>
        <td><span class="${t.trace > 70 ? 'text-red font-bold' : ''}">${t.trace}%</span></td>
        <td><span class="${t.strikes > 0 ? 'text-red font-bold' : ''}">${t.strikes}</span></td>
        <td>${statusBadge}</td>
        <td>
          <div class="flex-row" style="gap:4px;">
            <button type="button" class="btn btn-sm btn-action-lock" data-team="${t.id}" title="Lock terminal for 30s">Lock 30s</button>
            ${t.disqualified ? 
              `<button type="button" class="btn btn-sm btn-success btn-action-reinstate" data-team="${t.id}">Reinstate</button>` :
              `<button type="button" class="btn btn-sm btn-danger btn-action-dq" data-team="${t.id}">DQ</button>`}
          </div>
        </td>
      `;
      tbodyTeams.appendChild(tr);
    });

    // Attach actions
    tbodyTeams.querySelectorAll('.btn-action-lock').forEach(btn => {
      btn.onclick = () => {
        const teamId = btn.getAttribute('data-team');
        socket.emit('hostLockTeam', { teamId, duration: 30 }, () => {
          window.showToast('Team terminal locked for 30s', 'warning');
        });
      };
    });

    tbodyTeams.querySelectorAll('.btn-action-dq').forEach(btn => {
      btn.onclick = () => {
        const teamId = btn.getAttribute('data-team');
        window.showModal({
          title: 'Disqualify Team?',
          body: 'This will freeze the team terminal and invalidate their score.',
          confirmText: 'Disqualify',
          cancelText: 'Cancel',
          isDanger: true,
          onConfirm: () => {
            socket.emit('hostDisqualify', { teamId }, () => {
              window.showToast('Team Disqualified', 'danger');
            });
          }
        });
      };
    });

    tbodyTeams.querySelectorAll('.btn-action-reinstate').forEach(btn => {
      btn.onclick = () => {
        const teamId = btn.getAttribute('data-team');
        socket.emit('hostReinstate', { teamId }, () => {
          window.showToast('Team reinstated. Strikes cleared.', 'success');
        });
      };
    });
  }

  function renderPlayersTable(players) {
    const list = Object.values(players);
    if (list.length === 0) {
      tbodyPlayers.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">No agents connected.</td></tr>';
      return;
    }

    tbodyPlayers.innerHTML = '';
    list.forEach(p => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${p.name}</strong></td>
        <td>${p.teamId}</td>
        <td>${p.isOnline ? '<span class="badge badge-green">ONLINE</span>' : '<span class="badge">OFFLINE</span>'}</td>
        <td class="mono" style="font-size:10px;">${p.id}</td>
        <td>
          <button type="button" class="btn btn-sm btn-danger btn-kick-player" data-player="${p.id}">Kick</button>
        </td>
      `;
      tbodyPlayers.appendChild(tr);
    });

    tbodyPlayers.querySelectorAll('.btn-kick-player').forEach(btn => {
      btn.onclick = () => {
        const pId = btn.getAttribute('data-player');
        window.showModal({
          title: 'Kick Agent?',
          body: 'Remove this agent session from the grid?',
          confirmText: 'Kick',
          cancelText: 'Cancel',
          isDanger: true,
          onConfirm: () => {
            socket.emit('hostKickPlayer', { playerId: pId }, () => {
              window.showToast('Agent kicked', 'info');
            });
          }
        });
      };
    });
  }

  function renderCheatAlertsTable(alerts) {
    document.getElementById('badge-cheat-count').textContent = `${alerts.length} Alerts`;
    if (alerts.length === 0) {
      tbodyCheatAlerts.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--text-muted);">No cheat alerts recorded. Subnet integrity normal.</td></tr>';
      return;
    }

    tbodyCheatAlerts.innerHTML = '';
    alerts.forEach(a => {
      const tr = document.createElement('tr');
      const timeStr = new Date(a.timestamp).toLocaleTimeString();
      const statusBadge = a.status === 'FORGIVEN' ? 
        '<span class="badge badge-green">FORGIVEN</span>' : 
        `<span class="badge badge-red">${a.status}</span>`;

      tr.innerHTML = `
        <td class="mono">${timeStr}</td>
        <td><strong>${a.teamName}</strong></td>
        <td>${a.playerName}</td>
        <td><strong class="text-red">${a.reason}</strong><br><span style="font-size:10px; color:var(--text-muted);">${a.details}</span></td>
        <td>-${a.penalty} pts</td>
        <td>${statusBadge}</td>
        <td>
          <div class="flex-row" style="gap:4px;">
            ${a.status !== 'FORGIVEN' ? `<button type="button" class="btn btn-sm btn-success btn-alert-forgive" data-alert="${a.id}">Forgive</button>` : ''}
            <button type="button" class="btn btn-sm btn-warning btn-alert-penalize" data-team="${a.teamId}">-25 pts</button>
            <button type="button" class="btn btn-sm btn-danger btn-alert-lock" data-team="${a.teamId}">Lock</button>
          </div>
        </td>
      `;
      tbodyCheatAlerts.appendChild(tr);
    });

    tbodyCheatAlerts.querySelectorAll('.btn-alert-forgive').forEach(btn => {
      btn.onclick = () => {
        const aId = btn.getAttribute('data-alert');
        socket.emit('hostForgiveStrike', { alertId: aId }, () => {
          window.showToast('Strike forgiven & penalty refunded', 'success');
        });
      };
    });

    tbodyCheatAlerts.querySelectorAll('.btn-alert-penalize').forEach(btn => {
      btn.onclick = () => {
        const tId = btn.getAttribute('data-team');
        socket.emit('hostPenalize', { teamId: tId, points: 25, reason: 'Anti-cheat manual penalty' }, () => {
          window.showToast('Deducted 25 pts', 'warning');
        });
      };
    });

    tbodyCheatAlerts.querySelectorAll('.btn-alert-lock').forEach(btn => {
      btn.onclick = () => {
        const tId = btn.getAttribute('data-team');
        socket.emit('hostLockTeam', { teamId: tId, duration: 30 }, () => {
          window.showToast('Team terminal locked for 30s', 'warning');
        });
      };
    });
  }

  function renderActivityFeed(logs) {
    if (logs.length === 0) return;
    hostActivityFeed.innerHTML = '';
    logs.slice(0, 40).forEach(log => {
      const item = document.createElement('div');
      item.className = 'activity-item';
      if (log.type === 'LEVEL_SOLVE') item.classList.add('solve');
      if (log.type === 'CHEAT_STRIKE') item.classList.add('strike');
      if (log.type === 'HINT_PURCHASE') item.classList.add('hint');

      const timeStr = new Date(log.timestamp).toLocaleTimeString();
      item.innerHTML = `
        <div>
          <strong>[${log.type}]</strong> ${log.message}
        </div>
        <span class="mono text-muted" style="font-size:10px;">${timeStr}</span>
      `;
      hostActivityFeed.appendChild(item);
    });
  }

  // --- Master Control Buttons ---
  document.getElementById('btn-host-start')?.addEventListener('click', () => {
    socket.emit('hostSetGameStatus', { status: 'RUNNING' }, () => {
      window.showToast('Game Started! Agents deployed to grid.', 'success');
    });
  });

  document.getElementById('btn-host-pause')?.addEventListener('click', () => {
    socket.emit('hostSetGameStatus', { status: 'PAUSED' }, () => {
      window.showToast('Game Paused', 'warning');
    });
  });

  document.getElementById('btn-host-end')?.addEventListener('click', () => {
    window.showModal({
      title: 'End Operation?',
      body: 'This will lock all challenges and present the final victory podium to players.',
      confirmText: 'End Operation',
      cancelText: 'Cancel',
      isDanger: true,
      onConfirm: () => {
        socket.emit('hostSetGameStatus', { status: 'ENDED' }, () => {
          window.showToast('Operation Ended', 'info');
        });
      }
    });
  });

  document.getElementById('btn-host-reset')?.addEventListener('click', () => {
    window.showModal({
      title: 'Reset Entire Game State?',
      body: 'WARNING: This will wipe scores, teams, and reset all levels to Lobby.',
      confirmText: 'Reset All',
      cancelText: 'Cancel',
      isDanger: true,
      onConfirm: () => {
        socket.emit('hostResetGame', {}, () => {
          window.showToast('Game has been reset', 'warning');
        });
      }
    });
  });

  // --- Timer Controls ---
  document.getElementById('btn-timer-sub1')?.addEventListener('click', () => {
    socket.emit('hostAdjustTimer', { deltaMinutes: -1 }, () => {
      window.showToast('Timer: -1 minute', 'info');
    });
  });

  document.getElementById('btn-timer-add1')?.addEventListener('click', () => {
    socket.emit('hostAdjustTimer', { deltaMinutes: 1 }, () => {
      window.showToast('Timer: +1 minute', 'info');
    });
  });

  // --- Level Release Buttons ---
  [1, 2, 3, 4, 5].forEach(num => {
    document.getElementById(`btn-rel-l${num}`)?.addEventListener('click', () => {
      socket.emit('hostReleaseLevel', { levelNumber: num }, () => {
        window.showToast(`Level ${num} released globally to everyone!`, 'success');
      });
    });
  });

  document.getElementById('btn-submit-team-release')?.addEventListener('click', () => {
    const tId = selectTeamRelease.value;
    const lNum = parseInt(document.getElementById('select-level-num-release').value, 10);
    if (!tId) return;

    socket.emit('hostReleaseLevel', { teamId: tId, levelNumber: lNum }, () => {
      window.showToast(`Level ${lNum} released for selected team!`, 'success');
    });
  });

  // --- Tactical Plot Twists ---
  document.getElementById('btn-twist-blackout')?.addEventListener('click', () => {
    socket.emit('hostPlotTwist', { type: 'blackout', duration: 10 }, () => {
      window.showToast('Blackout triggered for 10 seconds!', 'warning');
    });
  });

  document.getElementById('btn-twist-surge')?.addEventListener('click', () => {
    socket.emit('hostPlotTwist', { type: 'trace_surge', duration: 30 }, () => {
      window.showToast('Adversary Trace Surge active (30s)!', 'danger');
    });
  });

  document.getElementById('btn-twist-bonus')?.addEventListener('click', () => {
    socket.emit('hostPlotTwist', { type: 'bonus_round', duration: 60 }, () => {
      window.showToast('Bonus Round Active: 2x Points for 60s!', 'success');
    });
  });

  document.getElementById('btn-twist-alarm')?.addEventListener('click', () => {
    socket.emit('hostPlotTwist', { type: 'fake_alarm', duration: 10 }, () => {
      window.showToast('Simulated Intrusion Alarm triggered', 'warning');
    });
  });

  // --- Host Broadcast Form ---
  document.getElementById('form-host-broadcast')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = document.getElementById('input-broadcast-text').value.trim();
    const isSiren = document.getElementById('check-broadcast-siren').checked;
    if (!text) return;

    socket.emit('hostBroadcast', { message: text, isSiren }, () => {
      window.showToast('Broadcast sent to all agent screens', 'success');
      document.getElementById('input-broadcast-text').value = '';
    });
  });

  // --- Award / Deduct Points Form ---
  document.getElementById('form-award-points')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const target = selectPointsTeam.value;
    const pts = parseInt(document.getElementById('input-points-delta').value, 10);
    const reason = document.getElementById('input-points-reason').value.trim() || 'Host adjustment';

    if (isNaN(pts)) return;

    if (pts >= 0) {
      socket.emit('hostAwardBonus', { teamId: target, points: pts, reason }, () => {
        window.showToast(`Awarded +${pts} pts!`, 'success');
      });
    } else {
      socket.emit('hostPenalize', { teamId: target, points: Math.abs(pts), reason }, () => {
        window.showToast(`Deducted ${Math.abs(pts)} pts!`, 'warning');
      });
    }
  });

  // --- CSV Export & State Backup ---
  document.getElementById('btn-export-csv')?.addEventListener('click', () => {
    window.location.href = `/api/host/export-csv?token=${hostToken}`;
  });

  document.getElementById('btn-backup-state')?.addEventListener('click', () => {
    window.location.href = `/api/host/state/backup`;
  });

  document.getElementById('input-restore-file')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const rawJson = evt.target.result;
        const resp = await fetch('/api/host/state/restore', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-host-token': hostToken
          },
          body: JSON.stringify({ backupData: rawJson })
        });
        const res = await resp.json();
        if (res.success) {
          window.showToast('State successfully restored from file!', 'success');
        } else {
          window.showToast('Restore failed: ' + res.error, 'danger');
        }
      } catch (err) {
        window.showToast('Failed to parse backup JSON: ' + err.message, 'danger');
      }
    };
    reader.readAsText(file);
  });

})();
