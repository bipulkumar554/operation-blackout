/**
 * OPERATION BLACKOUT - Player Client Engine
 */

(function () {
  const socket = io();

  // Tab Session Identifier
  let tabSessionId = sessionStorage.getItem('ob_tab_session_id');
  if (!tabSessionId) {
    tabSessionId = 'tab-' + Math.random().toString(36).substring(2, 10);
    sessionStorage.setItem('ob_tab_session_id', tabSessionId);
  }

  // State Cache
  let currentPlayerData = null;
  let currentTeamData = null;
  let currentLevels = [];
  let publicStateCache = null;
  let activeLevelNumber = 1;
  let soundMuted = false;
  let blurTimer = null;
  let lastCountdownTickSecond = -1;

  // DOM Elements
  const connectionBadge = document.getElementById('connection-badge');
  const connectionText = document.getElementById('connection-status-text');
  const gameTopBar = document.getElementById('game-top-bar');
  const plotTwistBanner = document.getElementById('plot-twist-banner');
  const strikeWarningBanner = document.getElementById('strike-warning-banner');
  const strikeWarningText = document.getElementById('strike-warning-text');
  const strikeCountBadge = document.getElementById('strike-count-badge');

  // Screens
  const screenLanding = document.getElementById('screen-landing');
  const screenEntryGate = document.getElementById('screen-entry-gate');
  const screenJoin = document.getElementById('screen-join');
  const screenLobby = document.getElementById('screen-lobby');
  const screenGame = document.getElementById('screen-game');
  const screenVictory = document.getElementById('screen-victory');
  const tabCollisionModal = document.getElementById('tab-collision-modal');

  // Stats
  const statPlayerName = document.getElementById('stat-player-name');
  const statTeamName = document.getElementById('stat-team-name');
  const statScore = document.getElementById('stat-score');
  const statStreakBadge = document.getElementById('stat-streak-badge');
  const statTimer = document.getElementById('stat-timer');
  const tracePercentage = document.getElementById('trace-percentage');
  const traceFillBar = document.getElementById('trace-fill-bar');

  // Atmosphere & Sound Controls
  const selectAtmosphere = document.getElementById('select-atmosphere');
  const btnAudioToggle = document.getElementById('btn-audio-toggle');

  // Setup Atmosphere Switcher
  if (selectAtmosphere) {
    selectAtmosphere.onchange = (e) => {
      document.body.className = e.target.value;
      localStorage.setItem('ob_atmosphere', e.target.value);
    };
    const savedAtmosphere = localStorage.getItem('ob_atmosphere');
    if (savedAtmosphere) {
      selectAtmosphere.value = savedAtmosphere;
      document.body.className = savedAtmosphere;
    }
  }

  // Setup Audio Toggle
  if (btnAudioToggle) {
    btnAudioToggle.onclick = () => {
      soundMuted = !soundMuted;
      window.soundSystem.setMute(soundMuted);
      btnAudioToggle.textContent = soundMuted ? '🔇' : '🔊';
    };
  }

  // Screen Switcher Helper
  function showScreen(screenEl) {
    [screenLanding, screenEntryGate, screenJoin, screenLobby, screenGame, screenVictory].forEach(s => {
      if (s) s.classList.add('hidden');
    });
    if (screenEl) screenEl.classList.remove('hidden');
  }

  // --- Socket Connectivity Status ---
  socket.on('connect', () => {
    connectionBadge.className = 'connection-badge';
    connectionText.textContent = 'Connected';
    attemptAutoResume();
  });

  socket.on('disconnect', () => {
    connectionBadge.className = 'connection-badge reconnecting';
    connectionText.textContent = 'Reconnecting...';
  });

  socket.on('connect_error', () => {
    connectionBadge.className = 'connection-badge disconnected';
    connectionText.textContent = 'Offline';
  });

  // --- Session Restoration ---
  function attemptAutoResume() {
    const savedPlayerId = localStorage.getItem('ob_player_id');
    const savedToken = localStorage.getItem('ob_player_token');

    if (savedPlayerId && savedToken) {
      socket.emit('resumeSession', {
        playerId: savedPlayerId,
        token: savedToken,
        tabSessionId
      }, (res) => {
        if (res && res.success) {
          if (res.activeInOtherTab) {
            tabCollisionModal.classList.remove('hidden');
          } else {
            tabCollisionModal.classList.add('hidden');
            handlePlayerStateUpdate(res.playerState);
          }
        }
      });
    }
  }

  // Takeover Button (for duplicate tabs)
  const btnTakeoverTab = document.getElementById('btn-takeover-tab');
  if (btnTakeoverTab) {
    btnTakeoverTab.onclick = () => {
      const savedPlayerId = localStorage.getItem('ob_player_id');
      const savedToken = localStorage.getItem('ob_player_token');
      socket.emit('takeoverSession', {
        playerId: savedPlayerId,
        token: savedToken,
        tabSessionId
      }, (res) => {
        if (res && res.success) {
          tabCollisionModal.classList.add('hidden');
          handlePlayerStateUpdate(res.playerState);
          window.showToast('Session active in this tab', 'success');
        }
      });
    };
  }

  socket.on('tabReplaced', (data) => {
    tabCollisionModal.classList.remove('hidden');
    window.showToast(data.message || 'Session active in another tab', 'warning');
  });

  // --- Landing & Audio Initiation ---
  const btnEnterGrid = document.getElementById('btn-enter-grid');
  const landingTypewriter = document.getElementById('landing-typewriter');

  // Typewriter effect on landing
  const briefingLines = [
    "[SYSTEM INTEGRITY COMPROMISED: NOVACORP SUBSTATION 04]",
    "[ATTACK VECTOR: ADVERSARY 'SHADOW-X' ACTIVE ON GRID BUS]",
    "[INCIDENT STATUS: MULTI-STAGE BREACH IN PROGRESS]",
    "[MISSION: ETHICAL INCIDENT RESPONSE TEAM DEPLOYMENT REQUIRED]"
  ];
  let curLine = 0;
  let curChar = 0;
  function typeBriefing() {
    if (curLine < briefingLines.length) {
      if (curChar < briefingLines[curLine].length) {
        landingTypewriter.innerHTML += briefingLines[curLine].charAt(curChar);
        curChar++;
        setTimeout(typeBriefing, 24);
      } else {
        landingTypewriter.innerHTML += '<br>';
        curLine++;
        curChar = 0;
        setTimeout(typeBriefing, 350);
      }
    }
  }
  typeBriefing();

  if (btnEnterGrid) {
    btnEnterGrid.onclick = () => {
      window.soundSystem.init();
      window.soundSystem.startBgm();
      window.soundSystem.playUnlock();

      // Check if entry transmission needs displaying
      const box = document.getElementById('entry-transmission-box');
      if (box) {
        box.textContent = "INTERCEPTED TRANSMISSION // SOURCE: UNKNOWN // CHANNEL 0x7F //\n" +
          "... [SYS_ALERT]: RECON UNIT DETECTED. ENCRYPTED ACCESS CODE DISCOVERED IN BASE64 FRAGMENT: 'R1JJRC0yMDI2' ...\n" +
          "DECODE TO UNLOCK THE GRID ENTRY GATE.";
      }
      showScreen(screenEntryGate);
    };
  }

  // Copy transmission clue
  const btnCopyTransmission = document.getElementById('btn-copy-transmission');
  if (btnCopyTransmission) {
    btnCopyTransmission.onclick = () => {
      window.copyToClipboard('R1JJRC0yMDI2', 'Base64 clue copied to clipboard!');
    };
  }

  // --- Secret Key Gate Submission ---
  const formEntryKey = document.getElementById('form-entry-key');
  const inputEntryKey = document.getElementById('input-entry-key');
  const entryKeyFeedback = document.getElementById('entry-key-feedback');

  if (formEntryKey) {
    formEntryKey.onsubmit = (e) => {
      e.preventDefault();
      const keyVal = inputEntryKey.value.trim();
      socket.emit('verifyEntryKey', { key: keyVal }, (res) => {
        if (res && res.success) {
          window.soundSystem.playUnlock();
          window.showToast('Grid Entry Key Accepted!', 'success', 2500);
          showScreen(screenJoin);
        } else {
          window.soundSystem.playWrong();
          formEntryKey.classList.add('screen-shake');
          setTimeout(() => formEntryKey.classList.remove('screen-shake'), 400);
          entryKeyFeedback.innerHTML = `<span class="text-red">${res?.error || 'Invalid key.'}</span>`;
        }
      });
    };
  }

  // --- Agent Join / Registration ---
  const formJoin = document.getElementById('form-join');
  const inputAgentName = document.getElementById('input-agent-name');
  const inputTeamName = document.getElementById('input-team-name');
  const groupTeamName = document.getElementById('group-team-name');
  const deployRadios = document.querySelectorAll('input[name="deploy-mode"]');

  deployRadios.forEach(r => {
    r.onchange = () => {
      if (r.value === 'team') {
        groupTeamName.style.display = 'block';
        inputTeamName.setAttribute('required', 'required');
      } else {
        groupTeamName.style.display = 'none';
        inputTeamName.removeAttribute('required');
      }
    };
  });

  if (formJoin) {
    formJoin.onsubmit = (e) => {
      e.preventDefault();
      const agentName = inputAgentName.value.trim();
      const isSolo = document.querySelector('input[name="deploy-mode"]:checked')?.value === 'solo';
      const teamName = isSolo ? agentName : inputTeamName.value.trim();

      socket.emit('registerPlayer', {
        playerName: agentName,
        teamName,
        isSolo,
        tabSessionId
      }, (res) => {
        if (res && res.success) {
          localStorage.setItem('ob_player_id', res.playerId);
          localStorage.setItem('ob_player_token', res.token);
          window.soundSystem.playUnlock();

          // Show Fair Play modal on first join
          if (!localStorage.getItem('ob_fair_play_accepted')) {
            showFairPlayModal(() => {
              handlePlayerStateUpdate(res.playerState);
            });
          } else {
            handlePlayerStateUpdate(res.playerState);
          }
        } else {
          window.showToast(res?.error || 'Registration failed', 'danger');
        }
      });
    };
  }

  function showFairPlayModal(onAccept) {
    const bodyHtml = `
      <div style="font-size:13px; line-height:1.6; color:#cbd5e1;">
        <p style="margin-bottom:10px;"><strong>RULES OF ENGAGEMENT:</strong></p>
        <ul style="padding-left:18px; margin-bottom:12px; display:flex; flex-direction:column; gap:6px;">
          <li>This CTF is a simulated ethical hacking exercise. No real exploits or shell executions.</li>
          <li><strong>Anti-Cheat Active:</strong> Switching away from this window for over 3 seconds or sharing flags will register strikes.</li>
          <li><strong>Strikes:</strong> Strike 1 (-20 pts), Strike 2 (-50 pts & 30s lock), Strike 3 (-100 pts & terminal lock).</li>
          <li>Copy and paste are allowed in all inputs and decoder tools.</li>
        </ul>
        <p style="color:var(--neon-green); font-size:12px;">Work with your team, maintain focus, and unmask SHADOW-X!</p>
      </div>
    `;
    window.showModal({
      title: '🛡️ FAIR PLAY AGREEMENT',
      body: bodyHtml,
      confirmText: 'I Understand & Agree',
      onConfirm: () => {
        localStorage.setItem('ob_fair_play_accepted', 'true');
        if (onAccept) onAccept();
      }
    });
  }

  // --- State Updates & Rendering ---
  socket.on('playerStateUpdate', (data) => {
    handlePlayerStateUpdate(data);
  });

  socket.on('publicStateUpdate', (data) => {
    publicStateCache = data;
    updatePublicStats(data);
  });

  function handlePlayerStateUpdate(state) {
    if (!state) return;
    currentPlayerData = state.player;
    currentTeamData = state.team;
    currentLevels = state.levels || [];
    publicStateCache = state.publicState || publicStateCache;

    // Update Top Bar
    gameTopBar.classList.remove('hidden');
    statPlayerName.textContent = currentPlayerData.name;
    statTeamName.textContent = currentTeamData.name;
    statScore.textContent = currentTeamData.score;
    
    // Streak multiplier
    const streak = currentTeamData.streak || 0;
    const mult = Math.min(1.5, 1.0 + Math.max(0, streak - 1) * 0.1).toFixed(1);
    statStreakBadge.textContent = `${mult}x`;

    // Trace Meter
    const trace = Math.round(currentTeamData.trace || 0);
    tracePercentage.textContent = `${trace}%`;
    traceFillBar.style.width = `${trace}%`;
    if (trace >= 75) {
      traceFillBar.classList.add('high-danger');
      window.soundSystem.playHeartbeat();
    } else {
      traceFillBar.classList.remove('high-danger');
    }

    // Strike Banner
    if (currentTeamData.strikes > 0) {
      strikeWarningBanner.classList.remove('hidden');
      strikeCountBadge.textContent = `Strike ${currentTeamData.strikes}`;
      strikeWarningText.textContent = currentTeamData.isLocked ? 
        `Terminal locked! Wait for timer or host review.` : 
        `Penalty applied for fair play violation.`;
    } else {
      strikeWarningBanner.classList.add('hidden');
    }

    // Game Status Routing
    const gameStatus = publicStateCache?.gameStatus || 'LOBBY';

    if (currentTeamData.completedVault || gameStatus === 'ENDED') {
      renderVictoryScreen();
      return;
    }

    if (gameStatus === 'LOBBY') {
      showScreen(screenLobby);
      document.getElementById('lobby-team-name').textContent = currentTeamData.name;
      document.getElementById('lobby-salt-badge').textContent = `_${currentTeamData.salt || 'a7f3'}`;
      document.getElementById('lobby-online-count').textContent = publicStateCache?.onlinePlayerCount || 1;
      return;
    }

    if (gameStatus === 'RUNNING' || gameStatus === 'PAUSED') {
      showScreen(screenGame);
      renderActiveChallenge();
      renderSidePanel();
    }
  }

  function updatePublicStats(data) {
    if (!data) return;
    const seconds = data.levelTimeRemaining ?? 360;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    statTimer.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

    // Countdown tick sound in last 10 seconds
    if (data.gameStatus === 'RUNNING' && seconds <= 10 && seconds > 0 && seconds !== lastCountdownTickSecond) {
      lastCountdownTickSecond = seconds;
      window.soundSystem.playTick();
    }

    // Plot Twist notification banner
    if (data.plotTwist) {
      plotTwistBanner.classList.remove('hidden');
      plotTwistBanner.textContent = `⚡ ${data.plotTwist.message}`;
      if (data.plotTwist.type === 'blackout') {
        document.body.classList.add('twist-blackout');
      }
    } else {
      plotTwistBanner.classList.add('hidden');
      document.body.classList.remove('twist-blackout');
    }
  }

  // --- Active Challenge Rendering ---
  function renderActiveChallenge() {
    if (!currentLevels.length) return;

    activeLevelNumber = currentTeamData.currentLevel || 1;
    const level = currentLevels.find(l => l.number === activeLevelNumber) || currentLevels[0];

    // Check if team can access this level or if Level Key mini-gate is required
    const cardLevelKeyGate = document.getElementById('card-level-key-gate');
    const cardActiveChallenge = document.getElementById('card-active-challenge');

    if (!level.isAccessible) {
      // Need host release or previous solve
      cardLevelKeyGate.classList.remove('hidden');
      document.getElementById('level-key-prompt-title').textContent = `Waiting for Level ${level.number} Unlock`;
      cardActiveChallenge.classList.add('hidden');
      return;
    }

    // Header info
    document.getElementById('badge-level-num').textContent = `LEVEL ${level.number}`;
    document.getElementById('challenge-title').textContent = level.title;
    document.getElementById('challenge-description').textContent = level.description;
    document.getElementById('challenge-points-val').textContent = `${level.points} pts`;

    cardLevelKeyGate.classList.add('hidden');
    cardActiveChallenge.classList.remove('hidden');

    // Mount interactive challenge UI based on challenge type
    const mount = document.getElementById('challenge-interactive-mount');
    mount.innerHTML = '';

    if (level.number === 1) {
      mount.appendChild(renderLevel1Recon(level));
    } else if (level.number === 2) {
      mount.appendChild(renderLevel2Web(level));
    } else if (level.number === 3) {
      mount.appendChild(renderLevel3Crypto(level));
    } else if (level.number === 4) {
      mount.appendChild(renderLevel4Malware(level));
    } else if (level.number === 5) {
      mount.appendChild(renderLevel5Vault(level));
    }

    // Show ethical hacker note if already solved
    const noteContainer = document.getElementById('ethical-note-container');
    if (level.isSolved && level.ethicalHackerNote) {
      noteContainer.classList.remove('hidden');
      document.getElementById('ethical-skill-name').textContent = level.ethicalHackerNote.skill;
      document.getElementById('ethical-how-defenders-fix').textContent = level.ethicalHackerNote.howDefendersFix;
      document.getElementById('ethical-permission-notice').textContent = `⚖️ ${level.ethicalHackerNote.permissionNotice}`;
    } else {
      noteContainer.classList.add('hidden');
    }

    // Hide or show flag submission form
    const flagSection = document.getElementById('flag-submission-section');
    if (level.isSolved || level.number === 5) {
      flagSection.style.display = (level.number === 5) ? 'none' : 'none';
    } else {
      flagSection.style.display = 'block';
    }
  }

  // --- Level 1: Reconnaissance UI ---
  function renderLevel1Recon(level) {
    const container = document.createElement('div');
    container.innerHTML = `
      <div class="mock-browser">
        <div class="mock-browser-bar">
          <span style="color:#ef4444;">●</span>
          <span style="color:#eab308;">●</span>
          <span style="color:#22c55e;">●</span>
          <div class="mock-url">http://staging.novacorp.internal</div>
          <button type="button" class="btn btn-sm btn-icon" id="btn-recon-copy-url">Copy URL</button>
        </div>
        <div style="padding: 10px 14px; background-color:#070d18; border-bottom:1px solid var(--border-color); display:flex; gap:8px; flex-wrap:wrap;">
          <button type="button" class="btn btn-sm" id="btn-tab-viewsource">📄 View Source</button>
          <button type="button" class="btn btn-sm" id="btn-tab-robots">🤖 robots.txt</button>
          <button type="button" class="btn btn-sm" id="btn-tab-dns">🌐 DNS / TXT Records</button>
          <button type="button" class="btn btn-sm" id="btn-tab-exif">📷 Image Metadata EXIF</button>
        </div>
        <div class="code-preview" id="recon-output-panel">
          Select an investigation button above to inspect target artifacts...
        </div>
      </div>
    `;

    setTimeout(() => {
      const panel = container.querySelector('#recon-output-panel');
      const reconData = level.reconData || {};

      container.querySelector('#btn-recon-copy-url').onclick = () => {
        window.copyToClipboard('http://staging.novacorp.internal');
      };

      container.querySelector('#btn-tab-viewsource').onclick = () => {
        panel.textContent = reconData.htmlSource || '<!-- HTML Source Not Found -->';
      };
      container.querySelector('#btn-tab-robots').onclick = () => {
        panel.textContent = reconData.robotsTxt || 'User-agent: *\nDisallow: /';
      };
      container.querySelector('#btn-tab-dns').onclick = () => {
        panel.textContent = JSON.stringify(reconData.dnsRecords, null, 2);
      };
      container.querySelector('#btn-tab-exif').onclick = () => {
        panel.textContent = JSON.stringify(reconData.imageMetadata, null, 2);
      };

      // Default to View Source
      panel.textContent = reconData.htmlSource || 'Click a tab to inspect.';
    }, 0);

    return container;
  }

  // --- Level 2: Web Security UI ---
  function renderLevel2Web(level) {
    const container = document.createElement('div');
    container.innerHTML = `
      <div class="card" style="background-color: #080f1e; margin-bottom: 16px;">
        <div class="card-header">
          <span class="mono text-cyan">PORTAL: Substation Relay Admin Auth</span>
          <span class="badge badge-yellow">VULNERABLE QUERY SIMULATOR</span>
        </div>
        
        <div style="font-size:12px; font-family:var(--font-mono); color:#94a3b8; margin-bottom:12px; background:#04070e; padding:10px; border-radius:4px;">
          SQL Query: <span class="text-yellow">SELECT * FROM operators WHERE username = '<span id="sql-query-display"></span>' AND password = '...'</span>
        </div>

        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-bottom:12px;">
          <div>
            <label>Username</label>
            <input type="text" id="sqli-user-input" class="input" placeholder="e.g. ' OR '1'='1">
          </div>
          <div>
            <label>Password</label>
            <input type="password" id="sqli-pass-input" class="input" value="anything">
          </div>
        </div>

        <div class="flex-between">
          <button type="button" class="btn btn-sm" id="btn-quick-sqli">Paste Payload: ' OR '1'='1</button>
          <button type="button" class="btn btn-primary btn-sm" id="btn-test-sqli">Authenticate</button>
        </div>
      </div>

      <div id="operator-console-panel" class="card hidden" style="background-color: #060b14; border-color: var(--neon-cyan);">
        <div class="card-header">
          <span class="text-cyan font-bold">OPERATOR CONSOLE // COOKIE INSPECTOR</span>
          <span class="badge badge-green">SESSION ACTIVE</span>
        </div>

        <p style="font-size: 13px; color: var(--text-muted); margin-bottom: 12px;">
          Authentication bypassed. However, your role is currently <code>user</code>. Escalate privileges to <code>admin</code> in the cookie store below.
        </p>

        <table class="cookie-table">
          <thead>
            <tr>
              <th>Cookie Name</th>
              <th>Cookie Value</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>session_id</td>
              <td><span class="mono">sess_99a820c</span></td>
              <td><span class="badge">Locked</span></td>
            </tr>
            <tr>
              <td><strong>role</strong></td>
              <td><input type="text" id="cookie-role-input" class="input" value="user" style="padding:4px 8px; font-size:12px;"></td>
              <td><button type="button" class="btn btn-sm btn-success" id="btn-apply-cookie">Apply & Refresh</button></td>
            </tr>
          </tbody>
        </table>

        <div id="cookie-result-area" style="margin-top: 14px; font-size: 13px;"></div>
      </div>
    `;

    setTimeout(() => {
      const userInput = container.querySelector('#sqli-user-input');
      const queryDisplay = container.querySelector('#sql-query-display');
      const consolePanel = container.querySelector('#operator-console-panel');

      userInput.oninput = () => {
        queryDisplay.textContent = userInput.value;
      };

      container.querySelector('#btn-quick-sqli').onclick = () => {
        userInput.value = "' OR '1'='1";
        queryDisplay.textContent = userInput.value;
      };

      container.querySelector('#btn-test-sqli').onclick = () => {
        const val = userInput.value.trim();
        if (val.includes("' OR '1'='1") || val.includes("' OR 1=1") || val.includes("admin'")) {
          window.soundSystem.playCorrect();
          window.showToast('SQL Injection Bypass Successful!', 'success');
          consolePanel.classList.remove('hidden');
        } else {
          window.soundSystem.playWrong();
          window.showToast('Authentication failed: Invalid credentials or SQL syntax.', 'danger');
        }
      };

      container.querySelector('#btn-apply-cookie').onclick = () => {
        const role = container.querySelector('#cookie-role-input').value.trim();
        const resArea = container.querySelector('#cookie-result-area');
        if (role === 'admin') {
          window.soundSystem.playCorrect();
          resArea.innerHTML = `
            <div style="background:rgba(0,255,136,0.1); border:1px solid var(--neon-green); padding:10px; border-radius:4px; color:var(--neon-green);">
              <strong>ADMINISTRATOR PRIVILEGES GRANTED!</strong><br>
              Flag Token: <code class="mono text-cyan">NIGHT{SQLI_COOKIE_BYPASS}</code><br>
              <button type="button" class="btn btn-sm btn-success" style="margin-top:6px;" id="btn-copy-web-flag">Copy Flag</button>
            </div>
          `;
          resArea.querySelector('#btn-copy-web-flag').onclick = () => {
            window.copyToClipboard('NIGHT{SQLI_COOKIE_BYPASS}');
            document.getElementById('input-flag-submission').value = 'NIGHT{SQLI_COOKIE_BYPASS}';
          };
        } else {
          window.soundSystem.playWrong();
          resArea.innerHTML = `<span class="text-red">Access denied: Role is still '${role}'. Change to 'admin'.</span>`;
        }
      };
    }, 0);

    return container;
  }

  // --- Level 3: Cryptography UI ---
  function renderLevel3Crypto(level) {
    const container = document.createElement('div');
    const cryptoData = level.cryptoChallenge || {};

    container.innerHTML = `
      <div class="card" style="background-color: #070c18; margin-bottom: 16px;">
        <div class="card-header">
          <span class="mono text-cyan">STAGE 1: Layered Ciphertext</span>
          <button type="button" class="btn btn-sm" id="btn-copy-hex">Copy Hex</button>
        </div>
        <p style="font-size:12px; color:var(--text-muted); margin-bottom:8px;">
          Intercepted transmission sequence: Hex &rarr; Base64 &rarr; Caesar (Shift +3).
        </p>
        <div class="code-preview" id="crypto-hex-display" style="word-break: break-all; margin-bottom: 12px;">
          ${cryptoData.ciphertextHex || '526b4a46534656665230684a534646575346394b56557848'}
        </div>
        <button type="button" class="btn btn-sm btn-primary" id="btn-send-to-toolkit">Send to Decoder Toolkit</button>
      </div>

      <div class="card" style="background-color: #070c18;">
        <div class="card-header">
          <span class="mono text-yellow">STAGE 2: Audio Signal Transmission</span>
          <span class="badge badge-yellow">MORSE CODE BEACON</span>
        </div>
        <p style="font-size:12px; color:var(--text-muted); margin-bottom:12px;">
          An automated beacon is broadcasting an audio signature on the tactical channel. Listen and decode the word:
        </p>

        <div class="flex-row" style="gap:10px; margin-bottom:12px;">
          <button type="button" class="btn btn-primary btn-sm" id="btn-play-morse">🔊 Play Audio Morse Signal</button>
          <span id="morse-playing-indicator" class="mono text-cyan hidden" style="font-size:12px;">● Transmitting...</span>
        </div>

        <div style="font-size:11px; color:var(--text-muted);">
          Visual representation: <code class="mono text-cyan">${cryptoData.morseCode || '... .... .- -.. --- .--'}</code>
        </div>
      </div>
    `;

    setTimeout(() => {
      container.querySelector('#btn-copy-hex').onclick = () => {
        window.copyToClipboard(cryptoData.ciphertextHex, 'Hex ciphertext copied!');
      };

      container.querySelector('#btn-send-to-toolkit').onclick = () => {
        document.querySelector('[data-side-tab="tools"]')?.click();
        document.getElementById('toolkit-input').value = cryptoData.ciphertextHex;
        window.showToast('Hex sent to Decoder Toolkit', 'info');
      };

      const btnPlayMorse = container.querySelector('#btn-play-morse');
      const indicator = container.querySelector('#morse-playing-indicator');
      btnPlayMorse.onclick = () => {
        indicator.classList.remove('hidden');
        btnPlayMorse.disabled = true;
        window.soundSystem.playMorseCode(cryptoData.morseCode || '... .... .- -.. --- .--', () => {
          indicator.classList.add('hidden');
          btnPlayMorse.disabled = false;
        });
      };
    }, 0);

    return container;
  }

  // --- Level 4: Malware Hunter UI ---
  function renderLevel4Malware(level) {
    const container = document.createElement('div');
    const artifacts = level.malwareArtifacts || {};

    container.innerHTML = `
      <div class="sub-tabs">
        <button type="button" class="sub-tab-btn active" id="tab-btn-procs">1. Process Explorer</button>
        <button type="button" class="sub-tab-btn" id="tab-btn-logs">2. Network & Auth Log</button>
        <button type="button" class="sub-tab-btn" id="tab-btn-script">3. Persistence Script</button>
      </div>

      <div id="malware-view-procs" class="card" style="background:#050912; margin-bottom:16px;">
        <table class="cookie-table">
          <thead>
            <tr><th>PID</th><th>Process Name</th><th>Path</th><th>User</th><th>Network Outbound</th></tr>
          </thead>
          <tbody>
            ${(artifacts.processList || []).map(p => `
              <tr style="${p.name === 'svch0st.exe' ? 'background:rgba(255,51,102,0.06);' : ''}">
                <td>${p.pid}</td>
                <td><strong>${p.name}</strong></td>
                <td>${p.path}</td>
                <td>${p.user}</td>
                <td>${p.network}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <div id="malware-view-logs" class="card hidden" style="background:#050912; margin-bottom:16px;">
        <div class="code-preview" style="color:#a5f3fc;">
          ${(artifacts.networkLog || []).join('\n')}
        </div>
      </div>

      <div id="malware-view-script" class="card hidden" style="background:#050912; margin-bottom:16px;">
        <div class="code-preview" style="color:#fdba74;">
          ${artifacts.persistenceScript || '# No script found'}
        </div>
      </div>

      <div class="card" style="background:#091224; border-color:var(--neon-cyan);">
        <h4 style="font-size:13px; margin-bottom:12px; color:var(--neon-cyan);">Forensic Triage Checklist</h4>
        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:10px; margin-bottom:12px;">
          <div>
            <label style="font-size:11px;">Rogue Process</label>
            <input type="text" id="triage-proc" class="input" placeholder="e.g. svch0st.exe">
          </div>
          <div>
            <label style="font-size:11px;">C2 Domain</label>
            <input type="text" id="triage-c2" class="input" placeholder="e.g. c2-darknode.internal">
          </div>
          <div>
            <label style="font-size:11px;">Persistence Reg Name</label>
            <input type="text" id="triage-reg" class="input" placeholder="e.g. WinUpdateHelper">
          </div>
        </div>
        <button type="button" class="btn btn-primary btn-sm" id="btn-verify-triage">Verify Artifacts</button>
        <div id="triage-result-feedback" style="margin-top:10px; font-size:12px;"></div>
      </div>
    `;

    setTimeout(() => {
      const vProcs = container.querySelector('#malware-view-procs');
      const vLogs = container.querySelector('#malware-view-logs');
      const vScript = container.querySelector('#malware-view-script');

      const bProcs = container.querySelector('#tab-btn-procs');
      const bLogs = container.querySelector('#tab-btn-logs');
      const bScript = container.querySelector('#tab-btn-script');

      function hideAll() {
        [vProcs, vLogs, vScript].forEach(v => v.classList.add('hidden'));
        [bProcs, bLogs, bScript].forEach(b => b.classList.remove('active'));
      }

      bProcs.onclick = () => { hideAll(); vProcs.classList.remove('hidden'); bProcs.classList.add('active'); };
      bLogs.onclick = () => { hideAll(); vLogs.classList.remove('hidden'); bLogs.classList.add('active'); };
      bScript.onclick = () => { hideAll(); vScript.classList.remove('hidden'); bScript.classList.add('active'); };

      container.querySelector('#btn-verify-triage').onclick = () => {
        const proc = container.querySelector('#triage-proc').value.trim().toLowerCase();
        const c2 = container.querySelector('#triage-c2').value.trim().toLowerCase();
        const reg = container.querySelector('#triage-reg').value.trim();

        if (proc === 'svch0st.exe' && c2 === 'c2-darknode.internal' && reg.toLowerCase() === 'winupdatehelper') {
          window.soundSystem.playCorrect();
          const feedback = container.querySelector('#triage-result-feedback');
          feedback.innerHTML = `
            <div style="background:rgba(0,255,136,0.1); border:1px solid var(--neon-green); padding:10px; border-radius:4px; color:var(--neon-green);">
              <strong>ALL 3 MALICIOUS ARTIFACTS CONFIRMED!</strong><br>
              Flag Token: <code class="mono text-cyan">NIGHT{MALWARE_ARTIFACT_HUNTED}</code><br>
              <button type="button" class="btn btn-sm btn-success" style="margin-top:6px;" id="btn-copy-mal-flag">Copy Flag</button>
            </div>
          `;
          feedback.querySelector('#btn-copy-mal-flag').onclick = () => {
            window.copyToClipboard('NIGHT{MALWARE_ARTIFACT_HUNTED}');
            document.getElementById('input-flag-submission').value = 'NIGHT{MALWARE_ARTIFACT_HUNTED}';
          };
        } else {
          window.soundSystem.playWrong();
          window.showToast('Triage mismatch: Inspect process typo, external beacon domain, and Run registry key.', 'danger');
        }
      };
    }, 0);

    return container;
  }

  // --- Level 5: Final Vault UI ---
  function renderLevel5Vault(level) {
    const container = document.createElement('div');
    container.innerHTML = `
      <div class="card" style="background:#091122; border-color:var(--neon-cyan); text-align:center; padding:24px;">
        <div class="badge badge-cyan" style="margin-bottom:12px;">CRITICAL SYSTEM OVERRIDE</div>
        <h3 style="font-size:22px; margin-bottom:8px;">NovaCorp Master Power Grid Vault</h3>
        <p style="font-size:13px; color:var(--text-muted); max-width:540px; margin:0 auto 20px;">
          Synthesize the evidence fragments gathered across all previous operations. Unmask the insider and enter the adversary alias to abort the blackout sequence.
        </p>

        <form id="form-vault-submit" style="max-width:440px; margin:0 auto; text-align:left;">
          <div class="form-group">
            <label for="input-insider-id">Insider Employee ID (Fragments: EMP + 44 + 71)</label>
            <input type="text" id="input-insider-id" class="input" placeholder="e.g. EMP-4471" required autocomplete="off">
          </div>

          <div class="form-group">
            <label for="input-hacker-alias">Hacker Alias (Level 4 Fragment)</label>
            <input type="text" id="input-hacker-alias" class="input" placeholder="e.g. SHADOW-X" required autocomplete="off">
          </div>

          <button type="submit" class="btn btn-primary btn-lg" style="width:100%; margin-top:8px;">
            ⚡ EXECUTE OVERRIDE & RESTORE GRID
          </button>
        </form>
      </div>
    `;

    setTimeout(() => {
      const form = container.querySelector('#form-vault-submit');
      form.onsubmit = (e) => {
        e.preventDefault();
        const insiderId = container.querySelector('#input-insider-id').value.trim();
        const hackerAlias = container.querySelector('#input-hacker-alias').value.trim();

        socket.emit('submitVault', {
          playerId: currentPlayerData.id,
          insiderId,
          hackerAlias
        }, (res) => {
          if (res && res.success) {
            window.soundSystem.playVictory();
            window.showToast('VAULT CRACKED! Grid power restored!', 'success', 5000);
            renderVictoryScreen();
          } else {
            window.soundSystem.playWrong();
            window.showToast(res?.error || 'Vault override failed.', 'danger');
          }
        });
      };
    }, 0);

    return container;
  }

  // --- Flag Submission Handler ---
  const formFlagSubmit = document.getElementById('form-flag-submit');
  const inputFlagSubmission = document.getElementById('input-flag-submission');
  const flagFeedbackStatus = document.getElementById('flag-feedback-status');

  if (formFlagSubmit) {
    formFlagSubmit.onsubmit = (e) => {
      e.preventDefault();
      const rawFlag = inputFlagSubmission.value.trim();
      if (!rawFlag) return;

      socket.emit('submitFlag', {
        playerId: currentPlayerData.id,
        levelNumber: activeLevelNumber,
        flag: rawFlag
      }, (res) => {
        if (res && res.success) {
          window.soundSystem.playCorrect();
          document.body.classList.add('flash-green');
          setTimeout(() => document.body.classList.remove('flash-green'), 400);

          flagFeedbackStatus.innerHTML = `<span class="text-green font-bold">ACCESS GRANTED! +${res.pointsAwarded} pts</span>`;
          window.showToast(`ACCESS GRANTED! +${res.pointsAwarded} pts!`, 'success');

          // Render ethical note immediately
          const noteContainer = document.getElementById('ethical-note-container');
          if (res.ethicalHackerNote) {
            noteContainer.classList.remove('hidden');
            document.getElementById('ethical-skill-name').textContent = res.ethicalHackerNote.skill;
            document.getElementById('ethical-how-defenders-fix').textContent = res.ethicalHackerNote.howDefendersFix;
            document.getElementById('ethical-permission-notice').textContent = `⚖️ ${res.ethicalHackerNote.permissionNotice}`;
          }
        } else {
          window.soundSystem.playWrong();
          document.body.classList.add('flash-red');
          setTimeout(() => document.body.classList.remove('flash-red'), 400);

          if (navigator.vibrate) {
            navigator.vibrate([100, 50, 100]);
          }

          flagFeedbackStatus.innerHTML = `<span class="text-red font-bold">${res?.error || 'ACCESS DENIED'}</span>`;
          window.showToast(res?.error || 'ACCESS DENIED', 'danger');
        }
      });
    };
  }

  // Proceed button after ethical note
  const btnProceedNextLevel = document.getElementById('btn-proceed-next-level');
  if (btnProceedNextLevel) {
    btnProceedNextLevel.onclick = () => {
      if (activeLevelNumber < 5) {
        activeLevelNumber++;
        renderActiveChallenge();
      } else {
        renderVictoryScreen();
      }
    };
  }

  // --- Side Panel Handling (Hints, Tools, Quiz) ---
  const sideTabBtns = document.querySelectorAll('.sub-tab-btn[data-side-tab]');
  const sideCards = {
    hints: document.getElementById('side-tab-hints'),
    tools: document.getElementById('side-tab-tools'),
    quiz: document.getElementById('side-tab-quiz'),
    briefing: document.getElementById('side-tab-briefing')
  };

  sideTabBtns.forEach(btn => {
    btn.onclick = () => {
      sideTabBtns.forEach(b => b.classList.remove('active'));
      Object.values(sideCards).forEach(c => c && c.classList.add('hidden'));

      btn.classList.add('active');
      const target = btn.getAttribute('data-side-tab');
      if (sideCards[target]) sideCards[target].classList.remove('hidden');
    };
  });

  function renderSidePanel() {
    renderHintsList();
    renderQuizList();
    renderBriefingTab();
  }

  function renderHintsList() {
    const list = document.getElementById('hints-list-container');
    if (!list) return;
    list.innerHTML = '';

    const level = currentLevels.find(l => l.number === activeLevelNumber);
    if (!level || !level.hints) return;

    level.hints.forEach((h, idx) => {
      const item = document.createElement('div');
      item.style.cssText = 'background:#080e1b; border:1px solid var(--border-color); border-radius:4px; padding:10px; font-size:12px;';

      if (h.unlocked) {
        item.innerHTML = `
          <div class="flex-between" style="margin-bottom:4px;">
            <strong class="text-green">Hint #${h.id} [UNLOCKED]</strong>
          </div>
          <p style="color:#e2e8f0;">${h.text}</p>
        `;
      } else {
        item.innerHTML = `
          <div class="flex-between">
            <span>Hint #${h.id} (Cost: <strong class="text-yellow">${h.cost} pts</strong>)</span>
            <button type="button" class="btn btn-sm btn-warning" id="btn-unlock-hint-${h.id}">Unlock</button>
          </div>
        `;
        setTimeout(() => {
          const btn = item.querySelector(`#btn-unlock-hint-${h.id}`);
          if (btn) {
            btn.onclick = () => {
              window.showModal({
                title: `Unlock Hint #${h.id}?`,
                body: `Unlocking this clue will deduct <strong>${h.cost} points</strong> from your team score.`,
                confirmText: 'Purchase Clue',
                cancelText: 'Cancel',
                onConfirm: () => {
                  socket.emit('requestHint', {
                    playerId: currentPlayerData.id,
                    levelNumber: activeLevelNumber,
                    hintId: h.id
                  }, (res) => {
                    if (res && res.success) {
                      window.soundSystem.playHint();
                      window.showToast(`Hint #${h.id} unlocked!`, 'success');
                    } else {
                      window.showToast(res?.error || 'Unable to purchase hint', 'danger');
                    }
                  });
                }
              });
            };
          }
        }, 0);
      }
      list.appendChild(item);
    });
  }

  function renderQuizList() {
    const list = document.getElementById('quiz-list-container');
    if (!list) return;
    list.innerHTML = '';

    const level = currentLevels.find(l => l.number === activeLevelNumber);
    if (!level || !level.quiz) return;

    level.quiz.forEach((q, qIdx) => {
      const card = document.createElement('div');
      card.className = 'quiz-card';
      card.innerHTML = `
        <div style="font-size:12px; font-weight:600; margin-bottom:6px; color:#f1f5f9;">
          Q${qIdx + 1}. ${q.question}
        </div>
        <div class="quiz-options-group">
          ${q.options.map((opt, oIdx) => `
            <button type="button" class="quiz-option-btn" data-q="${qIdx}" data-o="${oIdx}">
              <span>${opt}</span>
            </button>
          `).join('')}
        </div>
        <div class="quiz-feedback-box" style="margin-top:6px; font-size:11px;"></div>
      `;

      // If already answered
      if (q.status) {
        const btns = card.querySelectorAll('.quiz-option-btn');
        btns.forEach(b => {
          b.disabled = true;
          const optIdx = parseInt(b.getAttribute('data-o'), 10);
          if (optIdx === q.status.selected) {
            b.classList.add(q.status.correct ? 'correct' : 'wrong');
          }
        });
        const fb = card.querySelector('.quiz-feedback-box');
        fb.innerHTML = q.status.correct ? 
          `<span class="text-green">✓ Correct (+20 pts)</span>` : 
          `<span class="text-red">✗ Incorrect (-5 pts)</span>`;
      } else {
        const btns = card.querySelectorAll('.quiz-option-btn');
        btns.forEach(b => {
          b.onclick = () => {
            const chosenIdx = parseInt(b.getAttribute('data-o'), 10);
            socket.emit('submitQuiz', {
              playerId: currentPlayerData.id,
              levelNumber: activeLevelNumber,
              questionIndex: qIdx,
              answerIndex: chosenIdx
            }, (res) => {
              if (res && res.success) {
                if (res.isCorrect) {
                  window.soundSystem.playCorrect();
                  window.showToast('Correct knowledge check! +20 pts', 'success');
                } else {
                  window.soundSystem.playWrong();
                  window.showToast('Incorrect answer: -5 pts', 'danger');
                }
              }
            });
          };
        });
      }

      list.appendChild(card);
    });
  }

  function renderBriefingTab() {
    const list = document.getElementById('evidence-fragments-list');
    if (list && currentTeamData) {
      const frags = currentTeamData.evidenceFragments || [];
      list.textContent = frags.length > 0 ? frags.join(' - ') : 'None yet. Complete missions to collect fragments.';
    }
  }

  // --- Decoder Toolkit Actions ---
  const toolkitInput = document.getElementById('toolkit-input');
  const toolkitOutput = document.getElementById('toolkit-output');

  document.getElementById('btn-paste-toolkit')?.addEventListener('click', async () => {
    try {
      const clipText = await navigator.clipboard.readText();
      toolkitInput.value = clipText;
    } catch (e) {
      window.showToast('Paste permission needed or use Ctrl+V', 'info');
    }
  });

  document.getElementById('btn-copy-toolkit')?.addEventListener('click', () => {
    if (toolkitOutput.value) {
      window.copyToClipboard(toolkitOutput.value, 'Output copied!');
    }
  });

  document.getElementById('tool-b64-dec')?.addEventListener('click', () => {
    try {
      toolkitOutput.value = atob(toolkitInput.value.trim());
      window.soundSystem.playUnlock();
    } catch (e) {
      toolkitOutput.value = '[Error: Invalid Base64 string]';
    }
  });

  document.getElementById('tool-hex-dec')?.addEventListener('click', () => {
    try {
      const cleanHex = toolkitInput.value.trim().replace(/\s+/g, '');
      let str = '';
      for (let i = 0; i < cleanHex.length; i += 2) {
        str += String.fromCharCode(parseInt(cleanHex.substr(i, 2), 16));
      }
      toolkitOutput.value = str;
      window.soundSystem.playUnlock();
    } catch (e) {
      toolkitOutput.value = '[Error: Invalid Hex string]';
    }
  });

  document.getElementById('tool-rot-dec')?.addEventListener('click', () => {
    const input = toolkitInput.value;
    toolkitOutput.value = input.replace(/[a-zA-Z]/g, c => {
      const code = c.charCodeAt(0);
      const base = code <= 90 ? 65 : 97;
      return String.fromCharCode(((code - base + 13) % 26) + base);
    });
    window.soundSystem.playUnlock();
  });

  document.getElementById('tool-caesar-sub3')?.addEventListener('click', () => {
    const input = toolkitInput.value;
    toolkitOutput.value = input.replace(/[a-zA-Z]/g, c => {
      const code = c.charCodeAt(0);
      const base = code <= 90 ? 65 : 97;
      return String.fromCharCode(((code - base - 3 + 26) % 26) + base);
    });
    window.soundSystem.playUnlock();
  });

  document.getElementById('tool-url-dec')?.addEventListener('click', () => {
    try {
      toolkitOutput.value = decodeURIComponent(toolkitInput.value.trim());
      window.soundSystem.playUnlock();
    } catch (e) {
      toolkitOutput.value = '[Error: Invalid URL encoding]';
    }
  });

  // --- Victory & Celebration Screen ---
  function renderVictoryScreen() {
    showScreen(screenVictory);
    document.getElementById('victory-insider-id').textContent = 'EMP-4471';
    document.getElementById('victory-final-score').textContent = currentTeamData?.score || 0;

    startConfetti();
  }

  document.getElementById('btn-replay-celebration')?.addEventListener('click', () => {
    window.soundSystem.playVictory();
    startConfetti();
  });

  // Confetti Particle System
  function startConfetti() {
    const canvas = document.getElementById('confetti-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const particles = [];
    const colors = ['#00f3ff', '#00ff88', '#ffcc00', '#ff3366', '#38bdf8'];

    for (let i = 0; i < 150; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height - canvas.height,
        r: Math.random() * 6 + 3,
        d: Math.random() * 150 + 10,
        color: colors[Math.floor(Math.random() * colors.length)],
        tilt: Math.floor(Math.random() * 10) - 10,
        tiltAngleIncremental: (Math.random() * 0.07) + 0.05,
        tiltAngle: 0
      });
    }

    let animationFrameId;
    let frames = 0;

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach((p, idx) => {
        p.tiltAngle += p.tiltAngleIncremental;
        p.y += (Math.cos(p.d) + 3 + p.r / 2) / 2;
        p.x += Math.sin(p.d);
        p.tilt = Math.sin(p.tiltAngle - (idx / 3)) * 15;

        ctx.beginPath();
        ctx.lineWidth = p.r / 2;
        ctx.strokeStyle = p.color;
        ctx.moveTo(p.x + p.tilt + p.r, p.y);
        ctx.lineTo(p.x + p.tilt, p.y + p.tilt + p.r);
        ctx.stroke();

        if (p.y > canvas.height) {
          particles[idx].y = -20;
          particles[idx].x = Math.random() * canvas.width;
        }
      });

      frames++;
      if (frames < 300) {
        animationFrameId = requestAnimationFrame(draw);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    }
    draw();
  }

  // --- Anti-Cheat Event Listeners (Fair Play, Grace Period) ---

  // 1. Tab Switch / Window Blur with 3-second grace period
  window.addEventListener('blur', () => {
    // Only track if logged in and actively playing
    if (!currentPlayerData || screenGame.classList.contains('hidden')) return;

    if (blurTimer) clearTimeout(blurTimer);
    blurTimer = setTimeout(() => {
      socket.emit('reportAntiCheatEvent', {
        playerId: currentPlayerData.id,
        reason: 'WINDOW_BLUR',
        details: 'Agent left game window for longer than 3-second grace period.'
      });
    }, 3200); // 3.2s grace
  });

  window.addEventListener('focus', () => {
    if (blurTimer) {
      clearTimeout(blurTimer);
      blurTimer = null;
    }
  });

  // 2. DevTools shortcut detection outside in-app code view
  window.addEventListener('keydown', (e) => {
    if (
      e.key === 'F12' ||
      (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'i' || e.key === 'C' || e.key === 'c' || e.key === 'J' || e.key === 'j'))
    ) {
      if (currentPlayerData && !screenGame.classList.contains('hidden')) {
        e.preventDefault();
        window.showToast('DevTools shortcut detected. Use in-app View Source button.', 'warning');
        socket.emit('reportAntiCheatEvent', {
          playerId: currentPlayerData.id,
          reason: 'DEVTOOLS_SHORTCUT',
          details: `Shortcut pressed: ${e.key}`
        });
      }
    }
  });

  // 3. Right-Click on challenge panels
  window.addEventListener('contextmenu', (e) => {
    const isInsideInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';
    if (!isInsideInput && currentPlayerData && !screenGame.classList.contains('hidden')) {
      // Allow normal context menu for copy/paste inside inputs, suppress on challenge cards
      const challengeCard = document.getElementById('card-active-challenge');
      if (challengeCard && challengeCard.contains(e.target)) {
        e.preventDefault();
        window.showToast('Inspection tripwire: Use in-app tools to investigate artifacts.', 'warning', 2000);
      }
    }
  });

  // Broadcast listeners from server
  socket.on('firstBloodAlert', (data) => {
    if (data && data.isFirstBlood) {
      window.showToast(`🔥 FIRST BLOOD: ${data.teamName} solved ${data.levelTitle}! (+${data.pointsAwarded} pts)`, 'warning', 5000);
      window.soundSystem.playCorrect();
    }
  });

  socket.on('hostBroadcast', (data) => {
    if (data) {
      window.showToast(`📢 CONTROL ROOM: ${data.message}`, 'warning', 7000);
      if (data.isSiren) {
        window.soundSystem.playSiren();
      }
    }
  });

})();
