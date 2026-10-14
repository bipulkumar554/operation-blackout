const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STATE_FILE = path.join(__dirname, 'data', 'state.json');
const LEVELS_FILE = path.join(__dirname, 'data', 'levels.json');

class StateManager {
  constructor() {
    this.levelsData = this.loadLevelsData();
    this.state = this.getDefaultState();
    this.loadState();

    // Auto-save every 5 seconds
    this.autosaveInterval = setInterval(() => {
      this.saveState();
    }, 5000);

    // Trace meter and game loop ticker
    this.gameLoopInterval = setInterval(() => {
      this.tickGameLoop();
    }, 1000);

    this.onStateChangeCallback = null;
    this.onBroadcastCallback = null;
    this.onCheatAlertCallback = null;
  }

  loadLevelsData() {
    try {
      const raw = fs.readFileSync(LEVELS_FILE, 'utf8');
      return JSON.parse(raw);
    } catch (e) {
      console.error('Failed to load levels.json:', e);
      return { story: {}, levels: [] };
    }
  }

  reloadLevelsData() {
    this.levelsData = this.loadLevelsData();
  }

  getDefaultState() {
    const defaultTimerMinutes = 6;
    return {
      gameStatus: 'LOBBY', // LOBBY, RUNNING, PAUSED, ENDED
      startTime: null,
      pausedAt: null,
      activeLevel: 1, // 1 to 5
      levelTimeLimitSeconds: defaultTimerMinutes * 60,
      levelTimeRemaining: defaultTimerMinutes * 60,
      releasedLevels: [1], // Global released levels
      teamReleasedLevels: {}, // teamId -> array of level numbers
      entryKey: this.levelsData.story?.entryKey || 'GRID-2026',
      entryKeyRevealed: false,
      teams: {},
      players: {},
      scoringConfig: {
        flagPoints: { 1: 100, 2: 150, 3: 200, 4: 250, 5: 500 },
        firstBloodBonus: 50,
        noHintBonus: 20,
        levelClearBonus: 100,
        quizCorrect: 20,
        quizWrong: -5,
        flagWrong: -5,
        hintCosts: [10, 20, 30],
        hintsEnabled: true
      },
      firstBloods: {}, // levelNumber -> { teamId, teamName, timestamp }
      activityLog: [],
      cheatAlerts: [],
      plotTwist: null, // { type, message, endsAt, multiplier }
      lastSaved: Date.now()
    };
  }

  loadState() {
    try {
      if (fs.existsSync(STATE_FILE)) {
        const raw = fs.readFileSync(STATE_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        // Merge with default state to ensure schema compatibility
        this.state = Object.assign(this.getDefaultState(), parsed);
        console.log('Restored state from', STATE_FILE, `(Teams: ${Object.keys(this.state.teams).length}, Players: ${Object.keys(this.state.players).length})`);
      } else {
        this.saveState();
      }
    } catch (e) {
      console.error('Error reading state.json; initializing default state:', e);
      this.state = this.getDefaultState();
    }
  }

  saveState() {
    try {
      this.state.lastSaved = Date.now();
      const dir = path.dirname(STATE_FILE);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(STATE_FILE, JSON.stringify(this.state, null, 2), 'utf8');
    } catch (e) {
      console.error('Failed to autosave state.json:', e);
    }
  }

  restoreBackup(backupJsonString) {
    try {
      const parsed = JSON.parse(backupJsonString);
      this.state = Object.assign(this.getDefaultState(), parsed);
      this.saveState();
      this.triggerStateChange();
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  resetGame() {
    const defaultTimerMinutes = 6;
    this.state = this.getDefaultState();
    this.saveState();
    this.triggerStateChange();
    this.logActivity('GAME_RESET', 'System', 'Game has been reset to initial state by host.');
  }

  tickGameLoop() {
    let changed = false;

    // Check plot twist expiry
    if (this.state.plotTwist && Date.now() > this.state.plotTwist.endsAt) {
      const expiredType = this.state.plotTwist.type;
      this.state.plotTwist = null;
      changed = true;
      if (this.onBroadcastCallback) {
        this.onBroadcastCallback('plotTwistEnd', { type: expiredType });
      }
    }

    // Active level timer countdown
    if (this.state.gameStatus === 'RUNNING') {
      if (this.state.levelTimeRemaining > 0) {
        this.state.levelTimeRemaining--;
        // Broadcast timer tick every 10 seconds or last 10 seconds
        if (this.state.levelTimeRemaining <= 10 || this.state.levelTimeRemaining % 10 === 0) {
          changed = true;
        }
      }

      // Trace meter simulation: increase trace by 0.25% per second (1% every 4s) for teams in game
      for (const teamId in this.state.teams) {
        const team = this.state.teams[teamId];
        if (team.disqualified || team.completedVault) continue;

        // Check lock expiration
        if (team.isLocked && Date.now() > team.lockUntil) {
          team.isLocked = false;
          team.lockUntil = 0;
          changed = true;
          this.logActivity('TEAM_UNLOCKED', team.name, `Team ${team.name} temporary lock expired.`);
        }

        // Trace accumulation (faster during trace surge)
        const traceSpeed = (this.state.plotTwist?.type === 'trace_surge') ? 1.0 : 0.25;
        team.trace = Math.min(100, Math.round((team.trace + traceSpeed) * 10) / 10);

        if (team.trace >= 100) {
          // Trace max penalty: -50 points and reset to 60%
          const penalty = 50;
          team.score = Math.max(0, team.score - penalty);
          team.trace = 60;
          changed = true;
          this.logActivity('TRACE_MAX', team.name, `SHADOW-X completed trace on ${team.name}! -50 points penalty.`);
          if (this.onBroadcastCallback) {
            this.onBroadcastCallback('teamTraceMax', { teamId, teamName: team.name, newScore: team.score });
          }
        }
      }
    }

    if (changed) {
      this.triggerStateChange();
    }
  }

  // --- Registration & Sessions ---

  registerPlayer(playerName, teamName, isSolo = false) {
    playerName = String(playerName || '').trim();
    teamName = String(teamName || '').trim() || playerName;

    if (!playerName) {
      return { success: false, error: 'Agent name is required.' };
    }

    // Find or create team
    let team = Object.values(this.state.teams).find(t => t.name.toLowerCase() === teamName.toLowerCase());
    if (!team) {
      const teamId = 'team-' + crypto.randomBytes(4).toString('hex');
      const salt = crypto.randomBytes(2).toString('hex'); // 4-char hex salt
      team = {
        id: teamId,
        name: teamName,
        isSolo,
        salt,
        score: 0,
        currentLevel: 1,
        solvedLevels: [], // [1, 2, ...]
        evidenceFragments: [], // ['EMP', '44', ...]
        hintsUsed: {}, // levelNumber -> [hintIds]
        strikes: 0,
        streak: 0,
        trace: 10, // starts at 10%
        isLocked: false,
        lockUntil: 0,
        disqualified: false,
        completedVault: false,
        vaultFinishTime: null,
        members: [],
        quizAnswers: {}, // levelNumber -> { qIndex: { answered: true, correct: true } }
        wrongFlagAttempts: [], // timestamps
        lastFlagAttempt: 0,
        createdAt: Date.now()
      };
      this.state.teams[teamId] = team;
    }

    // Check team size limit (up to 3 members per team)
    if (!team.isSolo && team.members.length >= 3 && !team.members.includes(playerName)) {
      return { success: false, error: 'Team is already full (maximum 3 agents).' };
    }

    // Create or retrieve player
    const playerId = 'agent-' + crypto.randomBytes(6).toString('hex');
    const token = crypto.randomBytes(16).toString('hex');

    if (!team.members.includes(playerName)) {
      team.members.push(playerName);
    }

    const player = {
      id: playerId,
      name: playerName,
      teamId: team.id,
      token,
      isOnline: true,
      socketId: null,
      lastActivity: Date.now()
    };
    this.state.players[playerId] = player;

    this.saveState();
    this.triggerStateChange();
    this.logActivity('AGENT_JOIN', team.name, `Agent ${playerName} joined team ${team.name}.`);

    return {
      success: true,
      playerId,
      token,
      teamId: team.id,
      teamName: team.name,
      teamSalt: team.salt
    };
  }

  validatePlayerSession(playerId, token) {
    if (!playerId || !token) return null;
    const player = this.state.players[playerId];
    if (player && player.token === token) {
      return player;
    }
    return null;
  }

  // --- Secret Entry Key ---

  verifyEntryKey(inputKey) {
    const expected = (this.state.entryKey || 'GRID-2026').trim().toUpperCase();
    const provided = String(inputKey || '').trim().toUpperCase();
    return expected === provided;
  }

  revealEntryKey() {
    this.state.entryKeyRevealed = true;
    this.saveState();
    this.triggerStateChange();
    this.logActivity('KEY_REVEAL', 'Host', `Host revealed grid entry key: ${this.state.entryKey}`);
  }

  hideEntryKey() {
    this.state.entryKeyRevealed = false;
    this.saveState();
    this.triggerStateChange();
  }

  // --- Level Gating & Flags ---

  canTeamAccessLevel(teamId, levelNumber) {
    const team = this.state.teams[teamId];
    if (!team) return false;
    if (team.disqualified) return false;

    // Must have solved previous levels
    if (levelNumber > 1) {
      if (!team.solvedLevels.includes(levelNumber - 1)) {
        return false;
      }
    }

    // Must be released either globally OR specifically for this team
    const globallyReleased = this.state.releasedLevels.includes(levelNumber);
    const teamReleased = (this.state.teamReleasedLevels[teamId] || []).includes(levelNumber);

    return (globallyReleased || teamReleased);
  }

  verifyLevelKey(teamId, levelNumber, inputKey) {
    const team = this.state.teams[teamId];
    if (!team) return { success: false, error: 'Team not found.' };

    const level = this.levelsData.levels.find(l => l.number === levelNumber);
    if (!level) return { success: false, error: 'Level not found.' };

    const expectedKey = (level.levelKey || '').trim().toUpperCase();
    const provided = String(inputKey || '').trim().toUpperCase();

    if (expectedKey === provided) {
      return { success: true };
    }
    return { success: false, error: 'Incorrect Level Key. Consult evidence from previous level.' };
  }

  getExpectedSaltedFlag(teamId, levelNumber) {
    const team = this.state.teams[teamId];
    if (!team) return null;
    const level = this.levelsData.levels.find(l => l.number === levelNumber);
    if (!level) return null;

    // Per-team salted flag: NIGHT{...}_<salt>
    return `${level.baseFlag}_${team.salt}`;
  }

  submitFlag(teamId, playerId, levelNumber, submittedFlag) {
    const team = this.state.teams[teamId];
    const player = this.state.players[playerId];
    if (!team || !player) return { success: false, error: 'Invalid agent credentials.' };

    if (team.disqualified) {
      return { success: false, error: 'Your team has been disqualified for security violations.' };
    }

    if (team.isLocked) {
      const waitSec = Math.max(1, Math.ceil((team.lockUntil - Date.now()) / 1000));
      return { success: false, error: `Team terminal is locked. Try again in ${waitSec}s.` };
    }

    // Rate limit: 1 attempt every 3s
    const now = Date.now();
    if (now - team.lastFlagAttempt < 3000) {
      return { success: false, error: 'Rate limit: wait 3 seconds before next flag submission.' };
    }
    team.lastFlagAttempt = now;

    // Clean up attempts older than 60s
    team.wrongFlagAttempts = (team.wrongFlagAttempts || []).filter(t => now - t < 60000);

    if (team.wrongFlagAttempts.length >= 5) {
      team.isLocked = true;
      team.lockUntil = now + 30000;
      this.recordStrike(teamId, playerId, 'BRUTE_FORCE', 'Lockout: 5 wrong flag attempts within 60 seconds.');
      return { success: false, error: 'Brute-force protection: 5 failed attempts in 1 min. Locked for 30 seconds.' };
    }

    const cleanInput = String(submittedFlag || '').trim();

    // Check if team already solved this level
    if (team.solvedLevels.includes(levelNumber)) {
      return { success: true, message: 'Level already solved!' };
    }

    // Check for Flag Sharing / Leaking from other teams
    for (const otherTeamId in this.state.teams) {
      if (otherTeamId !== teamId) {
        const otherTeam = this.state.teams[otherTeamId];
        const otherSaltedFlag = this.getExpectedSaltedFlag(otherTeamId, levelNumber);
        if (cleanInput.toUpperCase() === otherSaltedFlag?.toUpperCase()) {
          // Cheat detected!
          this.recordStrike(teamId, playerId, 'FLAG_SHARING', `Submitted flag belonging to ${otherTeam.name}.`);
          return {
            success: false,
            error: 'ACCESS DENIED: Flag sharing detected! Flag belongs to another team signature. Strike recorded.'
          };
        }
      }
    }

    const expectedFlag = this.getExpectedSaltedFlag(teamId, levelNumber);
    const level = this.levelsData.levels.find(l => l.number === levelNumber);

    if (!expectedFlag || !level) {
      return { success: false, error: 'Level configuration error.' };
    }

    if (cleanInput.toUpperCase() === expectedFlag.toUpperCase()) {
      // Correct Solve!
      team.solvedLevels.push(levelNumber);
      if (level.evidenceFragment && !team.evidenceFragments.includes(level.evidenceFragment)) {
        team.evidenceFragments.push(level.evidenceFragment);
      }

      // Calculate score
      let points = this.state.scoringConfig.flagPoints[levelNumber] || 100;

      // Plot twist 2x multiplier
      if (this.state.plotTwist?.type === 'bonus_round') {
        points *= (this.state.plotTwist.multiplier || 2);
      }

      // First blood bonus
      let isFirstBlood = false;
      if (!this.state.firstBloods[levelNumber]) {
        this.state.firstBloods[levelNumber] = {
          teamId: team.id,
          teamName: team.name,
          timestamp: now
        };
        points += this.state.scoringConfig.firstBloodBonus;
        isFirstBlood = true;
      }

      // No-hint bonus
      const hintsUsedThisLevel = (team.hintsUsed[levelNumber] || []).length;
      if (hintsUsedThisLevel === 0) {
        points += this.state.scoringConfig.noHintBonus;
      }

      // Streak multiplier: x1.1 per clean solve up to x1.5
      team.streak = (team.streak || 0) + 1;
      const streakMultiplier = Math.min(1.5, 1.0 + (team.streak - 1) * 0.1);
      const totalPointsAwarded = Math.round(points * streakMultiplier);

      team.score += totalPointsAwarded;

      // Drop trace meter by 30% on clean solve
      team.trace = Math.max(0, team.trace - 30);

      // Advance team's current level
      if (levelNumber < 5) {
        team.currentLevel = levelNumber + 1;
      } else {
        team.completedVault = true;
        team.vaultFinishTime = now;
      }

      this.saveState();
      this.triggerStateChange();

      const solveMsg = `${team.name} solved Level ${levelNumber} (${level.title})! +${totalPointsAwarded} pts${isFirstBlood ? ' [FIRST BLOOD]' : ''}`;
      this.logActivity('LEVEL_SOLVE', team.name, solveMsg, levelNumber);

      if (this.onBroadcastCallback) {
        this.onBroadcastCallback('firstBloodAlert', {
          isFirstBlood,
          levelNumber,
          levelTitle: level.title,
          teamName: team.name,
          pointsAwarded: totalPointsAwarded
        });
      }

      return {
        success: true,
        pointsAwarded: totalPointsAwarded,
        isFirstBlood,
        evidenceFragment: level.evidenceFragment,
        ethicalHackerNote: level.ethicalHackerNote,
        nextLevel: team.currentLevel,
        newScore: team.score
      };
    } else {
      // Wrong Flag
      team.wrongFlagAttempts.push(now);
      team.streak = 0; // reset streak
      const penalty = Math.abs(this.state.scoringConfig.flagWrong || 5);
      team.score = Math.max(0, team.score - penalty);

      this.saveState();
      this.triggerStateChange();

      return {
        success: false,
        error: `ACCESS DENIED: Invalid flag token. -${penalty} pts.`,
        newScore: team.score
      };
    }
  }

  // --- Final Vault Validation ---

  submitVault(teamId, playerId, insiderId, hackerAlias) {
    const team = this.state.teams[teamId];
    if (!team) return { success: false, error: 'Team not found.' };

    const expectedInsider = 'EMP-4471';
    const expectedHacker = 'SHADOW-X';

    const cleanInsider = String(insiderId || '').trim().toUpperCase();
    const cleanHacker = String(hackerAlias || '').trim().toUpperCase();

    if (cleanInsider === expectedInsider && cleanHacker === expectedHacker) {
      // Level 5 (Vault) solved!
      return this.submitFlag(teamId, playerId, 5, this.getExpectedSaltedFlag(teamId, 5));
    } else {
      team.score = Math.max(0, team.score - 10);
      this.saveState();
      this.triggerStateChange();
      return {
        success: false,
        error: 'OVERRIDE REJECTED: Insider credential ID or Hacker alias mismatch. -10 pts.'
      };
    }
  }

  // --- Quizzes ---

  submitQuizAnswer(teamId, levelNumber, questionIndex, answerIndex) {
    const team = this.state.teams[teamId];
    if (!team) return { success: false, error: 'Team not found.' };

    const level = this.levelsData.levels.find(l => l.number === levelNumber);
    if (!level || !level.quiz || !level.quiz[questionIndex]) {
      return { success: false, error: 'Question not found.' };
    }

    team.quizAnswers[levelNumber] = team.quizAnswers[levelNumber] || {};
    if (team.quizAnswers[levelNumber][questionIndex]) {
      return { success: false, error: 'Question already answered.' };
    }

    const question = level.quiz[questionIndex];
    const isCorrect = (question.correctIndex === answerIndex);

    let points = 0;
    if (isCorrect) {
      points = this.state.scoringConfig.quizCorrect;
      team.score += points;
      team.trace = Math.max(0, team.trace - 10); // Quiz drop trace
    } else {
      points = this.state.scoringConfig.quizWrong;
      team.score = Math.max(0, team.score + points); // points is negative
    }

    team.quizAnswers[levelNumber][questionIndex] = {
      answered: true,
      correct: isCorrect,
      selected: answerIndex,
      points
    };

    this.saveState();
    this.triggerStateChange();

    return {
      success: true,
      isCorrect,
      explanation: question.explanation,
      points,
      newScore: team.score
    };
  }

  // --- Hints ---

  requestHint(teamId, levelNumber, hintId) {
    const team = this.state.teams[teamId];
    if (!team) return { success: false, error: 'Team not found.' };

    if (!this.state.scoringConfig.hintsEnabled) {
      return { success: false, error: 'Hints have been disabled by the Control Room.' };
    }

    const level = this.levelsData.levels.find(l => l.number === levelNumber);
    if (!level) return { success: false, error: 'Level not found.' };

    const hint = level.hints.find(h => h.id === hintId);
    if (!hint) return { success: false, error: 'Hint not found.' };

    team.hintsUsed[levelNumber] = team.hintsUsed[levelNumber] || [];
    if (team.hintsUsed[levelNumber].includes(hintId)) {
      return { success: true, hintText: hint.text, alreadyUnlocked: true };
    }

    const cost = this.state.scoringConfig.hintCosts[hintId - 1] || hint.cost || 10;
    if (team.score < cost) {
      return { success: false, error: `Insufficient points. Hint costs ${cost} pts, you have ${team.score} pts.` };
    }

    team.score -= cost;
    team.hintsUsed[levelNumber].push(hintId);

    this.saveState();
    this.triggerStateChange();
    this.logActivity('HINT_PURCHASE', team.name, `Purchased Hint #${hintId} for Level ${levelNumber} (-${cost} pts).`, levelNumber);

    return {
      success: true,
      hintText: hint.text,
      cost,
      newScore: team.score
    };
  }

  // --- Anti-Cheat Tracking ---

  recordStrike(teamId, playerId, reason, details) {
    const team = this.state.teams[teamId];
    const player = this.state.players[playerId];
    if (!team) return null;

    team.strikes = (team.strikes || 0) + 1;
    let penalty = 0;
    let actionTaken = 'Warning Issued';

    if (team.strikes === 1) {
      penalty = 20;
      team.score = Math.max(0, team.score - penalty);
      actionTaken = 'Strike 1: -20 pts & Warning Banner';
    } else if (team.strikes === 2) {
      penalty = 50;
      team.score = Math.max(0, team.score - penalty);
      team.isLocked = true;
      team.lockUntil = Date.now() + 30000; // 30s lockout
      actionTaken = 'Strike 2: -50 pts & 30s Terminal Lock';
    } else if (team.strikes >= 3) {
      penalty = 100;
      team.score = Math.max(0, team.score - penalty);
      team.isLocked = true;
      team.lockUntil = Date.now() + 3600000; // Locked until host forgives or reinstates
      actionTaken = 'Strike 3: -100 pts & Terminal Locked indefinitely';
    }

    const alertItem = {
      id: 'alert-' + crypto.randomBytes(4).toString('hex'),
      teamId,
      teamName: team.name,
      playerId,
      playerName: player?.name || 'Unknown',
      reason,
      details,
      strikeNumber: team.strikes,
      penalty,
      actionTaken,
      timestamp: Date.now(),
      status: 'ACTIVE'
    };

    this.state.cheatAlerts.unshift(alertItem);
    // Keep last 100 alerts
    if (this.state.cheatAlerts.length > 100) this.state.cheatAlerts.pop();

    this.saveState();
    this.triggerStateChange();

    this.logActivity('CHEAT_STRIKE', team.name, `Strike ${team.strikes} for ${team.name} (${reason}): ${actionTaken}`);

    if (this.onCheatAlertCallback) {
      this.onCheatAlertCallback(alertItem);
    }

    return alertItem;
  }

  // --- Host Control Room Actions ---

  forgiveStrike(alertId) {
    const alert = this.state.cheatAlerts.find(a => a.id === alertId);
    if (!alert) return { success: false, error: 'Alert not found.' };

    const team = this.state.teams[alert.teamId];
    if (team) {
      // Refund penalty
      team.score += alert.penalty;
      team.strikes = Math.max(0, team.strikes - 1);
      if (team.strikes < 2) {
        team.isLocked = false;
        team.lockUntil = 0;
      }
    }
    alert.status = 'FORGIVEN';
    this.saveState();
    this.triggerStateChange();
    this.logActivity('HOST_FORGIVE', team?.name || 'System', `Host forgave strike for ${team?.name}. Points restored: +${alert.penalty}`);
    return { success: true };
  }

  penalizeTeam(teamId, points, reason) {
    const team = this.state.teams[teamId];
    if (!team) return { success: false, error: 'Team not found.' };

    points = parseInt(points, 10) || 0;
    team.score = Math.max(0, team.score - Math.abs(points));

    this.saveState();
    this.triggerStateChange();
    this.logActivity('HOST_PENALTY', team.name, `Host deducted ${points} pts from ${team.name}. Reason: ${reason}`);
    return { success: true, newScore: team.score };
  }

  awardBonus(teamId, points, reason) {
    points = parseInt(points, 10) || 0;
    if (teamId === 'ALL') {
      for (const tId in this.state.teams) {
        this.state.teams[tId].score += points;
      }
      this.logActivity('HOST_BONUS', 'All Teams', `Host awarded +${points} pts bonus to all teams! Reason: ${reason}`);
    } else {
      const team = this.state.teams[teamId];
      if (!team) return { success: false, error: 'Team not found.' };
      team.score += points;
      this.logActivity('HOST_BONUS', team.name, `Host awarded +${points} pts to ${team.name}. Reason: ${reason}`);
    }

    this.saveState();
    this.triggerStateChange();
    return { success: true };
  }

  lockTeam(teamId, durationSeconds = 30) {
    const team = this.state.teams[teamId];
    if (!team) return { success: false, error: 'Team not found.' };

    team.isLocked = true;
    team.lockUntil = Date.now() + (durationSeconds * 1000);

    this.saveState();
    this.triggerStateChange();
    this.logActivity('HOST_LOCK', team.name, `Host manually locked terminal for ${team.name} for ${durationSeconds}s.`);
    return { success: true };
  }

  disqualifyTeam(teamId) {
    const team = this.state.teams[teamId];
    if (!team) return { success: false, error: 'Team not found.' };

    team.disqualified = true;
    team.isLocked = true;

    this.saveState();
    this.triggerStateChange();
    this.logActivity('HOST_DQ', team.name, `Host DISQUALIFIED team ${team.name}.`);
    return { success: true };
  }

  reinstateTeam(teamId) {
    const team = this.state.teams[teamId];
    if (!team) return { success: false, error: 'Team not found.' };

    team.disqualified = false;
    team.isLocked = false;
    team.lockUntil = 0;
    team.strikes = 0;

    this.saveState();
    this.triggerStateChange();
    this.logActivity('HOST_REINSTATE', team.name, `Host reinstated team ${team.name}. Strikes reset.`);
    return { success: true };
  }

  kickPlayer(playerId) {
    const player = this.state.players[playerId];
    if (!player) return { success: false, error: 'Player not found.' };

    delete this.state.players[playerId];
    this.saveState();
    this.triggerStateChange();
    this.logActivity('HOST_KICK', player.name, `Host kicked player ${player.name}.`);
    return { success: true };
  }

  // --- Level Management ---

  releaseLevelGlobal(levelNumber) {
    levelNumber = parseInt(levelNumber, 10);
    if (!this.state.releasedLevels.includes(levelNumber)) {
      this.state.releasedLevels.push(levelNumber);
      this.state.releasedLevels.sort((a, b) => a - b);
    }
    this.state.activeLevel = levelNumber;
    this.state.levelTimeRemaining = this.state.levelTimeLimitSeconds;

    this.saveState();
    this.triggerStateChange();
    this.logActivity('LEVEL_RELEASE', 'All Teams', `Control Room released Level ${levelNumber} to all agents!`);
    return { success: true, releasedLevels: this.state.releasedLevels };
  }

  releaseLevelForTeam(teamId, levelNumber) {
    levelNumber = parseInt(levelNumber, 10);
    this.state.teamReleasedLevels[teamId] = this.state.teamReleasedLevels[teamId] || [];
    if (!this.state.teamReleasedLevels[teamId].includes(levelNumber)) {
      this.state.teamReleasedLevels[teamId].push(levelNumber);
    }
    const team = this.state.teams[teamId];
    this.saveState();
    this.triggerStateChange();
    this.logActivity('LEVEL_RELEASE_TEAM', team?.name || teamId, `Control Room released Level ${levelNumber} exclusively for ${team?.name}.`);
    return { success: true };
  }

  adjustLevelTimer(deltaMinutes) {
    const deltaSeconds = deltaMinutes * 60;
    this.state.levelTimeRemaining = Math.max(0, this.state.levelTimeRemaining + deltaSeconds);
    this.state.levelTimeLimitSeconds = Math.max(60, this.state.levelTimeLimitSeconds + deltaSeconds);

    this.saveState();
    this.triggerStateChange();
    this.logActivity('TIMER_ADJUST', 'Host', `Level timer adjusted by ${deltaMinutes > 0 ? '+' : ''}${deltaMinutes} min (${this.state.levelTimeRemaining}s remaining).`);
    return { success: true, remaining: this.state.levelTimeRemaining };
  }

  setGameStatus(newStatus) {
    if (!['LOBBY', 'RUNNING', 'PAUSED', 'ENDED'].includes(newStatus)) {
      return { success: false, error: 'Invalid game status' };
    }

    this.state.gameStatus = newStatus;
    if (newStatus === 'RUNNING' && !this.state.startTime) {
      this.state.startTime = Date.now();
    }

    this.saveState();
    this.triggerStateChange();
    this.logActivity('GAME_STATUS', 'Host', `Game status changed to ${newStatus}.`);
    return { success: true, status: newStatus };
  }

  // --- Plot Twists ---

  triggerPlotTwist(twistType, durationSeconds = 10) {
    let twist = null;
    if (twistType === 'blackout') {
      twist = {
        type: 'blackout',
        message: 'SYSTEM OVERRIDE: NovaCorp auxiliary power failure! Terminals flickering...',
        endsAt: Date.now() + (durationSeconds * 1000)
      };
    } else if (twistType === 'trace_surge') {
      twist = {
        type: 'trace_surge',
        message: 'TRACE SURGE: SHADOW-X active scanning speed tripled for 30s!',
        endsAt: Date.now() + (30 * 1000)
      };
    } else if (twistType === 'bonus_round') {
      twist = {
        type: 'bonus_round',
        multiplier: 2,
        message: 'BONUS ROUND ACTIVE: 2x points on all solves for the next 60 seconds!',
        endsAt: Date.now() + (60 * 1000)
      };
    } else if (twistType === 'fake_alarm') {
      twist = {
        type: 'fake_alarm',
        message: 'FALSE POSITIVE IDS ALARM: Host simulated intrusion tripwire!',
        endsAt: Date.now() + (10 * 1000)
      };
    }

    this.state.plotTwist = twist;
    this.saveState();
    this.triggerStateChange();

    this.logActivity('PLOT_TWIST', 'Host', `Plot Twist triggered: ${twistType.toUpperCase()}`);

    if (this.onBroadcastCallback && twist) {
      this.onBroadcastCallback('plotTwistStart', twist);
    }

    return { success: true, twist };
  }

  broadcastMessage(messageText, isSiren = false) {
    const item = {
      message: messageText,
      isSiren,
      timestamp: Date.now()
    };

    this.logActivity('BROADCAST', 'Host', messageText);

    if (this.onBroadcastCallback) {
      this.onBroadcastCallback('hostBroadcast', item);
    }
    return { success: true };
  }

  // --- Activity Log & Helpers ---

  logActivity(type, teamName, message, levelId = null) {
    const item = {
      id: 'log-' + crypto.randomBytes(3).toString('hex'),
      type,
      teamName,
      message,
      levelId,
      timestamp: Date.now()
    };
    this.state.activityLog.unshift(item);
    if (this.state.activityLog.length > 100) this.state.activityLog.pop();
  }

  triggerStateChange() {
    if (this.onStateChangeCallback) {
      this.onStateChangeCallback(this.getPublicState());
    }
  }

  getPublicState() {
    // Generate leaderboard sorted by score descending
    const leaderboard = Object.values(this.state.teams).map(t => ({
      id: t.id,
      name: t.name,
      score: t.score,
      currentLevel: t.currentLevel,
      solvedLevels: t.solvedLevels,
      strikes: t.strikes,
      trace: t.trace,
      disqualified: t.disqualified,
      completedVault: t.completedVault,
      members: t.members
    })).sort((a, b) => b.score - a.score);

    const onlinePlayerCount = Object.values(this.state.players).filter(p => p.isOnline).length;

    return {
      gameStatus: this.state.gameStatus,
      startTime: this.state.startTime,
      activeLevel: this.state.activeLevel,
      levelTimeLimitSeconds: this.state.levelTimeLimitSeconds,
      levelTimeRemaining: this.state.levelTimeRemaining,
      releasedLevels: this.state.releasedLevels,
      entryKeyRevealed: this.state.entryKeyRevealed,
      entryKey: this.state.entryKeyRevealed ? this.state.entryKey : null,
      leaderboard,
      onlinePlayerCount,
      firstBloods: this.state.firstBloods,
      plotTwist: this.state.plotTwist,
      scoringConfig: this.state.scoringConfig,
      lastSaved: this.state.lastSaved
    };
  }

  getSafePlayerState(playerId) {
    const player = this.state.players[playerId];
    if (!player) return null;

    const team = this.state.teams[player.teamId];
    if (!team) return null;

    // Filter levels for client view: only send details of accessible levels and strip baseFlags / answers
    const clientLevels = this.levelsData.levels.map(l => {
      const isAccessible = this.canTeamAccessLevel(team.id, l.number);
      const isSolved = team.solvedLevels.includes(l.number);

      const sanitized = {
        number: l.number,
        title: l.title,
        subtitle: l.subtitle,
        description: l.description,
        challengeType: l.challengeType,
        points: this.state.scoringConfig.flagPoints[l.number] || l.points,
        isAccessible,
        isSolved,
        levelKeyRequired: l.levelKey,
        hints: l.hints.map(h => ({
          id: h.id,
          cost: this.state.scoringConfig.hintCosts[h.id - 1] || h.cost,
          unlocked: (team.hintsUsed[l.number] || []).includes(h.id),
          text: (team.hintsUsed[l.number] || []).includes(h.id) ? h.text : null
        })),
        quiz: l.quiz.map((q, idx) => ({
          question: q.question,
          options: q.options,
          status: team.quizAnswers[l.number]?.[idx] || null
        }))
      };

      if (isAccessible || isSolved) {
        if (l.reconData) sanitized.reconData = l.reconData;
        if (l.sqlChallenge) sanitized.sqlChallenge = { simulatedQuery: l.sqlChallenge.simulatedQuery };
        if (l.cryptoChallenge) {
          sanitized.cryptoChallenge = {
            ciphertextHex: l.cryptoChallenge.ciphertextHex,
            morseCode: l.cryptoChallenge.morseCode
          };
        }
        if (l.malwareArtifacts) sanitized.malwareArtifacts = l.malwareArtifacts;
        if (l.ethicalHackerNote && isSolved) sanitized.ethicalHackerNote = l.ethicalHackerNote;
      }

      return sanitized;
    });

    return {
      player: {
        id: player.id,
        name: player.name,
        teamId: player.teamId,
        isOnline: player.isOnline
      },
      team: {
        id: team.id,
        name: team.name,
        score: team.score,
        currentLevel: team.currentLevel,
        solvedLevels: team.solvedLevels,
        evidenceFragments: team.evidenceFragments,
        strikes: team.strikes,
        streak: team.streak,
        trace: team.trace,
        isLocked: team.isLocked,
        lockUntil: team.lockUntil,
        disqualified: team.disqualified,
        completedVault: team.completedVault,
        members: team.members
      },
      levels: clientLevels,
      story: this.levelsData.story,
      publicState: this.getPublicState()
    };
  }

  getFullHostState() {
    return {
      publicState: this.getPublicState(),
      fullState: this.state,
      levelsData: this.levelsData
    };
  }

  exportCsv() {
    const rows = [
      ['Rank', 'Team Name', 'Score', 'Current Level', 'Solved Levels', 'Fragments', 'Strikes', 'Trace', 'Disqualified', 'Members']
    ];

    const sortedTeams = Object.values(this.state.teams).sort((a, b) => b.score - a.score);
    sortedTeams.forEach((t, index) => {
      rows.push([
        index + 1,
        `"${t.name.replace(/"/g, '""')}"`,
        t.score,
        t.currentLevel,
        `"${t.solvedLevels.join(', ')}"`,
        `"${t.evidenceFragments.join(', ')}"`,
        t.strikes,
        `${t.trace}%`,
        t.disqualified ? 'YES' : 'NO',
        `"${t.members.join('; ')}"`
      ]);
    });

    return rows.map(r => r.join(',')).join('\n');
  }
}

module.exports = StateManager;
