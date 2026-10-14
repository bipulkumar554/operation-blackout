require('dotenv').config();
const http = require('http');
const path = require('path');
const express = require('express');
const { Server } = require('socket.io');
const cookieParser = require('cookie-parser');
const QRCode = require('qrcode');
const StateManager = require('./stateManager');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = '0.0.0.0';
const HOST_PIN = process.env.HOST_PIN || '1337';
const PUBLIC_URL = process.env.PUBLIC_URL || '';
const SESSION_SECRET = process.env.SESSION_SECRET || 'blackout-secret-key-super-safe';

const stateManager = new StateManager();

// Track active player sockets and tab sessions for multi-tab handling
// playerId -> { socketId, tabSessionId, lastHeartbeat }
const activeSessions = new Map();

// Rate limiting for Host PIN attempts
const hostPinAttempts = new Map(); // ip -> [timestamps]

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(SESSION_SECRET));

// Serve static assets
app.use(express.static(path.join(__dirname, 'public')));

// Helper to determine base URL
function getBaseUrl(req) {
  if (PUBLIC_URL && PUBLIC_URL.trim() !== '') {
    return PUBLIC_URL.replace(/\/$/, '');
  }
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
  return `${protocol}://${host}`;
}

// Routes
app.get('/', (req, res) => {
  res.redirect('/play');
});

app.get('/play', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'play.html'));
});

app.get('/host', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'host.html'));
});

app.get('/screen', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'screen.html'));
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: Date.now(),
    teams: Object.keys(stateManager.state.teams).length,
    onlinePlayers: Object.values(stateManager.state.players).filter(p => p.isOnline).length
  });
});

// Server-side QR Code Generator API
app.get('/api/qr', async (req, res) => {
  try {
    const targetPath = req.query.path || '/play';
    const baseUrl = getBaseUrl(req);
    const fullUrl = `${baseUrl}${targetPath.startsWith('/') ? targetPath : '/' + targetPath}`;
    
    const format = req.query.format || 'svg'; // svg or dataUrl
    if (format === 'dataUrl') {
      const dataUrl = await QRCode.toDataURL(fullUrl, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 320,
        color: {
          dark: '#00f3ff',
          light: '#070b12'
        }
      });
      res.json({ dataUrl, url: fullUrl });
    } else {
      const svg = await QRCode.toString(fullUrl, {
        type: 'svg',
        errorCorrectionLevel: 'M',
        margin: 2,
        color: {
          dark: '#00f3ff',
          light: '#070b12'
        }
      });
      res.setHeader('Content-Type', 'image/svg+xml');
      res.send(svg);
    }
  } catch (err) {
    console.error('QR code generation error:', err);
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

// Host authentication endpoint
app.post('/api/host/login', (req, res) => {
  const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();

  // Rate limiting check: 5 attempts per 60 seconds
  let attempts = hostPinAttempts.get(clientIp) || [];
  attempts = attempts.filter(t => now - t < 60000);
  if (attempts.length >= 5) {
    return res.status(429).json({
      success: false,
      error: 'Too many failed login attempts. Try again in 60 seconds.'
    });
  }

  const { pin } = req.body;
  if (String(pin).trim() === HOST_PIN.trim()) {
    hostPinAttempts.delete(clientIp);
    const hostToken = 'host-tok-' + Buffer.from(SESSION_SECRET).toString('base64').substring(0, 16);
    res.cookie('host_auth', hostToken, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000
    });
    return res.json({ success: true, hostToken });
  } else {
    attempts.push(now);
    hostPinAttempts.set(clientIp, attempts);
    return res.status(401).json({
      success: false,
      error: `Invalid Control Room PIN. (${5 - attempts.length} attempts remaining)`
    });
  }
});

// Host CSV Export
app.get('/api/host/export-csv', (req, res) => {
  // Validate token or cookie
  const authHeader = req.headers['x-host-token'] || req.cookies?.host_auth;
  const expected = 'host-tok-' + Buffer.from(SESSION_SECRET).toString('base64').substring(0, 16);
  if (authHeader !== expected && req.query.token !== expected) {
    return res.status(403).send('Unauthorized');
  }

  const csv = stateManager.exportCsv();
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="operation-blackout-results-${Date.now()}.csv"`);
  res.send(csv);
});

// State Backup Download
app.get('/api/host/state/backup', (req, res) => {
  const authHeader = req.headers['x-host-token'] || req.cookies?.host_auth;
  const expected = 'host-tok-' + Buffer.from(SESSION_SECRET).toString('base64').substring(0, 16);
  if (authHeader !== expected) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="operation-blackout-state-${Date.now()}.json"`);
  res.send(JSON.stringify(stateManager.state, null, 2));
});

// State Backup Restore
app.post('/api/host/state/restore', (req, res) => {
  const authHeader = req.headers['x-host-token'] || req.cookies?.host_auth;
  const expected = 'host-tok-' + Buffer.from(SESSION_SECRET).toString('base64').substring(0, 16);
  if (authHeader !== expected) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const { backupData } = req.body;
  const result = stateManager.restoreBackup(typeof backupData === 'string' ? backupData : JSON.stringify(backupData));
  if (result.success) {
    broadcastStateUpdate();
    res.json({ success: true, message: 'State restored successfully' });
  } else {
    res.status(400).json({ success: false, error: result.error });
  }
});

// Helper to broadcast updates
function broadcastStateUpdate() {
  const publicState = stateManager.getPublicState();
  // Big Screen room gets public state
  io.to('screen_room').emit('publicStateUpdate', publicState);

  // Host room gets full state
  const hostState = stateManager.getFullHostState();
  io.to('host_room').emit('hostStateUpdate', hostState);

  // Each player gets their safe state
  for (const [playerId, player] of Object.entries(stateManager.state.players)) {
    if (player.socketId) {
      const safeState = stateManager.getSafePlayerState(playerId);
      if (safeState) {
        io.to(player.socketId).emit('playerStateUpdate', safeState);
      }
    }
  }
}

// Hook state manager callbacks
stateManager.onStateChangeCallback = () => {
  broadcastStateUpdate();
};

stateManager.onBroadcastCallback = (eventName, data) => {
  io.emit(eventName, data);
};

stateManager.onCheatAlertCallback = (alertItem) => {
  io.to('host_room').emit('newCheatAlert', alertItem);
};

// Socket.IO Connection Handler
io.on('connection', (socket) => {
  let boundPlayerId = null;
  let boundTabSessionId = null;

  // Screen View Subscription
  socket.on('joinScreen', () => {
    socket.join('screen_room');
    socket.emit('publicStateUpdate', stateManager.getPublicState());
  });

  // Host View Subscription
  socket.on('joinHost', (data) => {
    const pin = data?.pin;
    const token = data?.token;
    const expected = 'host-tok-' + Buffer.from(SESSION_SECRET).toString('base64').substring(0, 16);
    if ((pin && pin.trim() === HOST_PIN.trim()) || token === expected) {
      socket.join('host_room');
      socket.emit('hostAuthenticated', { success: true });
      socket.emit('hostStateUpdate', stateManager.getFullHostState());
    } else {
      socket.emit('hostAuthError', { error: 'Invalid PIN or unauthorized token.' });
    }
  });

  // Entry Key Verification
  socket.on('verifyEntryKey', (data, callback) => {
    const inputKey = data?.key;
    const isCorrect = stateManager.verifyEntryKey(inputKey);
    if (typeof callback === 'function') {
      callback({ success: isCorrect, error: isCorrect ? null : 'ACCESS DENIED: Invalid Grid Entry Key. Inspect transmission or ask Control Room.' });
    }
  });

  // Player Registration
  socket.on('registerPlayer', (data, callback) => {
    try {
      const { playerName, teamName, isSolo, tabSessionId } = data || {};
      const reg = stateManager.registerPlayer(playerName, teamName, isSolo);

      if (reg.success) {
        boundPlayerId = reg.playerId;
        boundTabSessionId = tabSessionId || 'tab-' + Math.random().toString(36).substring(2, 9);
        
        const player = stateManager.state.players[boundPlayerId];
        player.socketId = socket.id;
        player.isOnline = true;

        activeSessions.set(boundPlayerId, {
          socketId: socket.id,
          tabSessionId: boundTabSessionId,
          lastHeartbeat: Date.now()
        });

        socket.join(`team_${reg.teamId}`);

        if (typeof callback === 'function') {
          callback({
            success: true,
            playerId: reg.playerId,
            token: reg.token,
            teamId: reg.teamId,
            teamName: reg.teamName,
            teamSalt: reg.teamSalt,
            tabSessionId: boundTabSessionId,
            playerState: stateManager.getSafePlayerState(reg.playerId)
          });
        }
        broadcastStateUpdate();
      } else {
        if (typeof callback === 'function') {
          callback({ success: false, error: reg.error });
        }
      }
    } catch (e) {
      console.error('Error during registerPlayer:', e);
      if (typeof callback === 'function') {
        callback({ success: false, error: 'Registration error: ' + e.message });
      }
    }
  });

  // Session Resumption / Multi-Tab Check
  socket.on('resumeSession', (data, callback) => {
    try {
      const { playerId, token, tabSessionId } = data || {};
      const player = stateManager.validatePlayerSession(playerId, token);

      if (!player) {
        if (typeof callback === 'function') {
          callback({ success: false, error: 'Session expired or invalid credentials.' });
        }
        return;
      }

      const existingSession = activeSessions.get(playerId);
      const incomingTab = tabSessionId || 'tab-default';

      // Check if session is already active in another socket/tab
      if (existingSession && existingSession.socketId !== socket.id && existingSession.tabSessionId !== incomingTab) {
        // Inform this tab that another tab is currently active
        if (typeof callback === 'function') {
          callback({
            success: true,
            activeInOtherTab: true,
            playerId,
            tabSessionId: incomingTab,
            playerState: stateManager.getSafePlayerState(playerId)
          });
        }
        return;
      }

      // Resume session on this socket
      boundPlayerId = playerId;
      boundTabSessionId = incomingTab;
      player.socketId = socket.id;
      player.isOnline = true;
      player.lastActivity = Date.now();

      activeSessions.set(playerId, {
        socketId: socket.id,
        tabSessionId: boundTabSessionId,
        lastHeartbeat: Date.now()
      });

      socket.join(`team_${player.teamId}`);

      if (typeof callback === 'function') {
        callback({
          success: true,
          activeInOtherTab: false,
          playerState: stateManager.getSafePlayerState(playerId)
        });
      }
      broadcastStateUpdate();
    } catch (e) {
      console.error('Error resuming session:', e);
      if (typeof callback === 'function') {
        callback({ success: false, error: 'Session resumption error: ' + e.message });
      }
    }
  });

  // Tab Takeover: Switch active session to current tab
  socket.on('takeoverSession', (data, callback) => {
    try {
      const { playerId, token, tabSessionId } = data || {};
      const player = stateManager.validatePlayerSession(playerId, token);

      if (!player) {
        if (typeof callback === 'function') {
          callback({ success: false, error: 'Invalid session' });
        }
        return;
      }

      const prevSession = activeSessions.get(playerId);
      if (prevSession && prevSession.socketId && prevSession.socketId !== socket.id) {
        // Notify former tab that another tab has taken over
        io.to(prevSession.socketId).emit('tabReplaced', {
          message: 'Active session transferred to another browser tab.'
        });
      }

      boundPlayerId = playerId;
      boundTabSessionId = tabSessionId;
      player.socketId = socket.id;
      player.isOnline = true;

      activeSessions.set(playerId, {
        socketId: socket.id,
        tabSessionId,
        lastHeartbeat: Date.now()
      });

      socket.join(`team_${player.teamId}`);

      if (typeof callback === 'function') {
        callback({
          success: true,
          playerState: stateManager.getSafePlayerState(playerId)
        });
      }
      broadcastStateUpdate();
    } catch (e) {
      console.error('Error in takeoverSession:', e);
      if (typeof callback === 'function') {
        callback({ success: false, error: e.message });
      }
    }
  });

  // Level Key mini-gate
  socket.on('verifyLevelKey', (data, callback) => {
    try {
      const { playerId, levelNumber, levelKey } = data || {};
      const player = stateManager.state.players[playerId];
      if (!player) return callback?.({ success: false, error: 'Unauthorized' });

      const result = stateManager.verifyLevelKey(player.teamId, levelNumber, levelKey);
      if (typeof callback === 'function') {
        callback(result);
      }
    } catch (e) {
      callback?.({ success: false, error: e.message });
    }
  });

  // Flag Submission
  socket.on('submitFlag', (data, callback) => {
    try {
      const { playerId, levelNumber, flag } = data || {};
      const player = stateManager.state.players[playerId];
      if (!player) {
        return callback?.({ success: false, error: 'Unauthorized agent session.' });
      }

      const result = stateManager.submitFlag(player.teamId, playerId, levelNumber, flag);
      if (typeof callback === 'function') {
        callback(result);
      }
      broadcastStateUpdate();
    } catch (e) {
      console.error('Error submitting flag:', e);
      callback?.({ success: false, error: 'Flag verification error.' });
    }
  });

  // Vault Submission
  socket.on('submitVault', (data, callback) => {
    try {
      const { playerId, insiderId, hackerAlias } = data || {};
      const player = stateManager.state.players[playerId];
      if (!player) return callback?.({ success: false, error: 'Unauthorized' });

      const result = stateManager.submitVault(player.teamId, playerId, insiderId, hackerAlias);
      if (typeof callback === 'function') {
        callback(result);
      }
      broadcastStateUpdate();
    } catch (e) {
      console.error('Error submitting vault:', e);
      callback?.({ success: false, error: e.message });
    }
  });

  // Quiz Answer Submission
  socket.on('submitQuiz', (data, callback) => {
    try {
      const { playerId, levelNumber, questionIndex, answerIndex } = data || {};
      const player = stateManager.state.players[playerId];
      if (!player) return callback?.({ success: false, error: 'Unauthorized' });

      const result = stateManager.submitQuizAnswer(player.teamId, levelNumber, questionIndex, answerIndex);
      if (typeof callback === 'function') {
        callback(result);
      }
      broadcastStateUpdate();
    } catch (e) {
      console.error('Error submitting quiz:', e);
      callback?.({ success: false, error: e.message });
    }
  });

  // Request Hint
  socket.on('requestHint', (data, callback) => {
    try {
      const { playerId, levelNumber, hintId } = data || {};
      const player = stateManager.state.players[playerId];
      if (!player) return callback?.({ success: false, error: 'Unauthorized' });

      const result = stateManager.requestHint(player.teamId, levelNumber, hintId);
      if (typeof callback === 'function') {
        callback(result);
      }
      broadcastStateUpdate();
    } catch (e) {
      console.error('Error requesting hint:', e);
      callback?.({ success: false, error: e.message });
    }
  });

  // Anti-Cheat Reporting from Client
  socket.on('reportAntiCheatEvent', (data, callback) => {
    try {
      const { playerId, reason, details } = data || {};
      const player = stateManager.state.players[playerId];
      if (!player) return callback?.({ success: false });

      const strikeAlert = stateManager.recordStrike(player.teamId, playerId, reason, details);
      if (typeof callback === 'function') {
        callback({ success: true, strikeAlert });
      }
      broadcastStateUpdate();
    } catch (e) {
      console.error('Error reporting anti-cheat event:', e);
      callback?.({ success: false });
    }
  });

  // --- HOST CONTROLS ---

  socket.on('hostSetGameStatus', (data, callback) => {
    const result = stateManager.setGameStatus(data.status);
    broadcastStateUpdate();
    callback?.(result);
  });

  socket.on('hostReleaseLevel', (data, callback) => {
    let result;
    if (data.teamId && data.teamId !== 'ALL') {
      result = stateManager.releaseLevelForTeam(data.teamId, data.levelNumber);
    } else {
      result = stateManager.releaseLevelGlobal(data.levelNumber);
    }
    broadcastStateUpdate();
    callback?.(result);
  });

  socket.on('hostAdjustTimer', (data, callback) => {
    const result = stateManager.adjustLevelTimer(data.deltaMinutes);
    broadcastStateUpdate();
    callback?.(result);
  });

  socket.on('hostAwardBonus', (data, callback) => {
    const result = stateManager.awardBonus(data.teamId, data.points, data.reason);
    broadcastStateUpdate();
    callback?.(result);
  });

  socket.on('hostPenalize', (data, callback) => {
    const result = stateManager.penalizeTeam(data.teamId, data.points, data.reason);
    broadcastStateUpdate();
    callback?.(result);
  });

  socket.on('hostLockTeam', (data, callback) => {
    const result = stateManager.lockTeam(data.teamId, data.duration || 30);
    broadcastStateUpdate();
    callback?.(result);
  });

  socket.on('hostDisqualify', (data, callback) => {
    const result = stateManager.disqualifyTeam(data.teamId);
    broadcastStateUpdate();
    callback?.(result);
  });

  socket.on('hostReinstate', (data, callback) => {
    const result = stateManager.reinstateTeam(data.teamId);
    broadcastStateUpdate();
    callback?.(result);
  });

  socket.on('hostForgiveStrike', (data, callback) => {
    const result = stateManager.forgiveStrike(data.alertId);
    broadcastStateUpdate();
    callback?.(result);
  });

  socket.on('hostKickPlayer', (data, callback) => {
    const result = stateManager.kickPlayer(data.playerId);
    broadcastStateUpdate();
    callback?.(result);
  });

  socket.on('hostPlotTwist', (data, callback) => {
    const result = stateManager.triggerPlotTwist(data.type, data.duration);
    broadcastStateUpdate();
    callback?.(result);
  });

  socket.on('hostBroadcast', (data, callback) => {
    const result = stateManager.broadcastMessage(data.message, data.isSiren);
    callback?.(result);
  });

  socket.on('hostRevealEntryKey', (data, callback) => {
    stateManager.revealEntryKey();
    broadcastStateUpdate();
    callback?.({ success: true, key: stateManager.state.entryKey });
  });

  socket.on('hostHideEntryKey', (data, callback) => {
    stateManager.hideEntryKey();
    broadcastStateUpdate();
    callback?.({ success: true });
  });

  socket.on('hostResetGame', (data, callback) => {
    stateManager.resetGame();
    broadcastStateUpdate();
    callback?.({ success: true });
  });

  // Disconnect handling
  socket.on('disconnect', () => {
    if (boundPlayerId && stateManager.state.players[boundPlayerId]) {
      const player = stateManager.state.players[boundPlayerId];
      if (player.socketId === socket.id) {
        player.isOnline = false;
        player.socketId = null;
        broadcastStateUpdate();
      }
    }
  });
});

// Start listening
server.listen(PORT, HOST, () => {
  console.log('====================================================');
  console.log(` OPERATION BLACKOUT - CTF Server running!`);
  console.log(` Port: ${PORT} | Host: ${HOST}`);
  console.log(` Public URL: ${PUBLIC_URL || 'Auto-detecting request host'}`);
  console.log(` Player Interface: http://localhost:${PORT}/play`);
  console.log(` Control Room:     http://localhost:${PORT}/host`);
  console.log(` Big Screen:       http://localhost:${PORT}/screen`);
  console.log(` Health Check:     http://localhost:${PORT}/health`);
  console.log(` Default Host PIN: ${HOST_PIN}`);
  console.log('====================================================');
});
