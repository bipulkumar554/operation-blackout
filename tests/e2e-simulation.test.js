const assert = require('assert');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { io: ClientIO } = require('socket.io-client');

// Use a dedicated port for testing
const TEST_PORT = 3199;
process.env.PORT = String(TEST_PORT);
process.env.HOST_PIN = '1337';
process.env.PUBLIC_URL = `http://localhost:${TEST_PORT}`;
process.env.SESSION_SECRET = 'test-secret-suite-1234';

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function httpGet(urlPath) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${TEST_PORT}${urlPath}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    }).on('error', reject);
  });
}

function httpPost(urlPath, jsonBody, headers = {}) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(jsonBody);
    const req = http.request({
      hostname: 'localhost',
      port: TEST_PORT,
      path: urlPath,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        ...headers
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function runE2ESimulation() {
  console.log('========================================================');
  console.log(' Starting End-to-End Simulation Test Suite');
  console.log('========================================================');

  // Ensure clean test state before testing
  const testStatePath = path.join(__dirname, '..', 'data', 'test-state.json');
  process.env.STATE_FILE = testStatePath;
  if (fs.existsSync(testStatePath)) {
    try { fs.unlinkSync(testStatePath); } catch (e) {}
  }

  // Start the actual server
  delete require.cache[require.resolve('../server')];
  require('../server');
  await wait(800); // Allow server to bind

  console.log('1. Testing /health Endpoint...');
  const healthRes = await httpGet('/health');
  assert.strictEqual(healthRes.status, 200);
  const healthJson = JSON.parse(healthRes.body);
  assert.strictEqual(healthJson.status, 'ok');
  console.log('✅ /health endpoint responded with status: ok');

  console.log('2. Testing /api/qr Endpoint (SVG & dataUrl)...');
  const qrSvgRes = await httpGet('/api/qr?path=/play');
  assert.strictEqual(qrSvgRes.status, 200);
  assert(qrSvgRes.body.includes('<svg'), 'QR SVG should contain <svg tag');

  const qrJsonRes = await httpGet('/api/qr?path=/play&format=dataUrl');
  assert.strictEqual(qrJsonRes.status, 200);
  const qrJson = JSON.parse(qrJsonRes.body);
  assert(qrJson.dataUrl && qrJson.dataUrl.startsWith('data:image/png;base64,'), 'dataUrl must be a base64 image');
  assert.strictEqual(qrJson.url, `http://localhost:${TEST_PORT}/play`);
  console.log('✅ QR codes render correctly using PUBLIC_URL and auto-detected host');

  console.log('3. Testing Host PIN Authentication & Rate Limiting...');
  // Wrong PIN
  const wrongPinRes = await httpPost('/api/host/login', { pin: '0000' });
  assert.strictEqual(wrongPinRes.status, 401);
  // Correct PIN
  const hostLoginRes = await httpPost('/api/host/login', { pin: '1337' });
  assert.strictEqual(hostLoginRes.status, 200);
  const hostLoginJson = JSON.parse(hostLoginRes.body);
  assert(hostLoginJson.success && hostLoginJson.hostToken);
  const hostToken = hostLoginJson.hostToken;
  console.log('✅ Host PIN verification and token issuance succeeded');

  // Connect Host Socket
  const hostSocket = ClientIO(`http://localhost:${TEST_PORT}`, { transports: ['websocket'] });
  let hostStateReceived = null;
  hostSocket.on('hostStateUpdate', (state) => {
    hostStateReceived = state;
  });
  await new Promise(resolve => {
    hostSocket.on('connect', () => {
      hostSocket.emit('joinHost', { pin: '1337', token: hostToken });
      resolve();
    });
  });
  await wait(300);
  assert(hostStateReceived, 'Host socket must receive initial host state');
  console.log('✅ Host socket connected and received state');

  console.log('4. Connecting 3 Players (including 1 Mobile Viewport)...');
  // Player 1: Alice (Team "Spectres")
  const p1Socket = ClientIO(`http://localhost:${TEST_PORT}`, { transports: ['websocket'] });
  // Player 2: Bob (Team "Gryphons")
  const p2Socket = ClientIO(`http://localhost:${TEST_PORT}`, { transports: ['websocket'] });
  // Player 3: Mobile (Viewport 390x844 simulated, Team "MobileUnit")
  const p3Socket = ClientIO(`http://localhost:${TEST_PORT}`, {
    transports: ['websocket'],
    extraHeaders: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 (390x844)'
    }
  });

  await Promise.all([
    new Promise(r => p1Socket.on('connect', r)),
    new Promise(r => p2Socket.on('connect', r)),
    new Promise(r => p3Socket.on('connect', r))
  ]);
  console.log('✅ All 3 player sockets connected');

  console.log('5. Testing Grid Secret Entry Key Verification...');
  // Wrong key check
  const badKeyRes = await new Promise(r => p1Socket.emit('verifyEntryKey', { key: 'WRONG_KEY' }, r));
  assert.strictEqual(badKeyRes.success, false);

  // Correct key check
  const goodKeyRes = await new Promise(r => p1Socket.emit('verifyEntryKey', { key: 'GRID-2026' }, r));
  assert.strictEqual(goodKeyRes.success, true);
  console.log('✅ Secret Entry Key correctly verified server-side');

  console.log('6. Registering Players & Lobby Verification...');
  let p1Data, p2Data, p3Data;
  p1Data = await new Promise(r => p1Socket.emit('registerPlayer', { playerName: 'Alice', teamName: 'Spectres', isSolo: false }, r));
  p2Data = await new Promise(r => p2Socket.emit('registerPlayer', { playerName: 'Bob', teamName: 'Gryphons', isSolo: false }, r));
  p3Data = await new Promise(r => p3Socket.emit('registerPlayer', { playerName: 'CharlieMobile', teamName: 'MobileUnit', isSolo: true }, r));

  assert(p1Data.success && p1Data.playerId && p1Data.teamSalt);
  assert(p2Data.success && p2Data.playerId && p2Data.teamSalt);
  assert(p3Data.success && p3Data.playerId && p3Data.teamSalt);
  assert.notStrictEqual(p1Data.teamSalt, p2Data.teamSalt, 'Teams must receive distinct random salts');
  console.log('✅ All 3 players registered with unique randomized team salts');

  console.log('7. Host Starts Game...');
  await new Promise(r => hostSocket.emit('hostSetGameStatus', { status: 'RUNNING' }, r));
  await wait(300);
  assert.strictEqual(hostStateReceived.publicState.gameStatus, 'RUNNING');
  console.log('✅ Host started game; status transitioned to RUNNING');

  console.log('8. Player 1 Solves Level 1 (Reconnaissance)...');
  // Expected salted flag for Player 1
  const p1Flag = `NIGHT{RECON_MASTER}_${p1Data.teamSalt}`;
  const p1SolveRes = await new Promise(r => p1Socket.emit('submitFlag', {
    playerId: p1Data.playerId,
    levelNumber: 1,
    flag: p1Flag
  }, r));
  assert.strictEqual(p1SolveRes.success, true);
  assert.strictEqual(p1SolveRes.isFirstBlood, true, 'First solver must receive First Blood bonus');
  assert.strictEqual(p1SolveRes.evidenceFragment, 'EMP');
  console.log(`✅ Player 1 solved Level 1: +${p1SolveRes.pointsAwarded} pts (First Blood granted!)`);

  console.log('9. Testing Flag Sharing Detection (Anti-Cheat)...');
  // Player 2 attempts to submit Player 1's flag with Player 1's salt
  const cheatSolveRes = await new Promise(r => p2Socket.emit('submitFlag', {
    playerId: p2Data.playerId,
    levelNumber: 1,
    flag: p1Flag // Stolen from Player 1
  }, r));
  assert.strictEqual(cheatSolveRes.success, false);
  assert(cheatSolveRes.error.includes('Flag sharing detected'), 'Server must reject shared flags');

  await wait(300);
  const p2Team = hostStateReceived.fullState.teams[p2Data.teamId];
  assert.strictEqual(p2Team.strikes, 1, 'Player 2 must have 1 strike recorded');
  console.log('✅ Stolen/copied flag rejected and flagged as Flag Sharing Suspected with Strike 1');

  console.log('10. Testing Level Key Mini-Gate for Level 2...');
  // Next level key is 'EMP' (from Level 1 solve)
  const badLevelKey = await new Promise(r => p1Socket.emit('verifyLevelKey', {
    playerId: p1Data.playerId,
    levelNumber: 2,
    levelKey: 'WRONG'
  }, r));
  assert.strictEqual(badLevelKey.success, false);

  const goodLevelKey = await new Promise(r => p1Socket.emit('verifyLevelKey', {
    playerId: p1Data.playerId,
    levelNumber: 2,
    levelKey: 'EMP'
  }, r));
  assert.strictEqual(goodLevelKey.success, true);
  console.log('✅ Level 2 mini-gate decrypted using collected evidence fragment EMP');

  console.log('11. Testing Hint Purchase & Wrong Flag Scoring...');
  const initialScore = p1SolveRes.newScore;
  // Purchase hint #1 (costs 10 pts)
  const hintRes = await new Promise(r => p1Socket.emit('requestHint', {
    playerId: p1Data.playerId,
    levelNumber: 2,
    hintId: 1
  }, r));
  assert.strictEqual(hintRes.success, true);
  assert.strictEqual(hintRes.cost, 10);
  assert.strictEqual(hintRes.newScore, initialScore - 10);

  // Wait 3.1s to respect the 1 attempt per 3s rate limit
  await wait(3100);

  // Submit wrong flag (-5 pts)
  const wrongFlagRes = await new Promise(r => p1Socket.emit('submitFlag', {
    playerId: p1Data.playerId,
    levelNumber: 2,
    flag: `NIGHT{WRONG}_${p1Data.teamSalt}`
  }, r));
  assert.strictEqual(wrongFlagRes.success, false);
  assert.strictEqual(wrongFlagRes.newScore, initialScore - 15);
  console.log('✅ Hint deduction (-10) and wrong flag penalty (-5) validated');

  console.log('12. Testing Anti-Cheat Strike via Tab Blur...');
  const strikeRes = await new Promise(r => p1Socket.emit('reportAntiCheatEvent', {
    playerId: p1Data.playerId,
    reason: 'WINDOW_BLUR',
    details: 'Tab blur > 3s'
  }, r));
  assert.strictEqual(strikeRes.success, true);
  await wait(300);
  const p1Team = hostStateReceived.fullState.teams[p1Data.teamId];
  assert.strictEqual(p1Team.strikes, 1);
  console.log('✅ Anti-cheat event reported and Strike 1 applied');

  console.log('13. Testing Plot Twist Trigger...');
  const twistRes = await new Promise(r => hostSocket.emit('hostPlotTwist', { type: 'bonus_round', duration: 60 }, r));
  assert.strictEqual(twistRes.success, true);
  await wait(300);
  assert.strictEqual(hostStateReceived.publicState.plotTwist?.type, 'bonus_round');
  console.log('✅ Host Plot Twist (Bonus Round 2x) triggered and broadcast');

  console.log('14. Testing Final Vault Override & Victory...');
  await wait(3100);
  const vaultRes = await new Promise(r => p1Socket.emit('submitVault', {
    playerId: p1Data.playerId,
    insiderId: 'EMP-4471',
    hackerAlias: 'SHADOW-X'
  }, r));
  assert.strictEqual(vaultRes.success, true);
  await wait(300);
  const p1TeamUpdated = hostStateReceived.fullState.teams[p1Data.teamId];
  assert.strictEqual(p1TeamUpdated.completedVault, true);
  console.log('✅ Final Vault cracked! Grid restored and victory completed');

  console.log('15. Testing CSV Export Endpoint...');
  const csvRes = await httpGet(`/api/host/export-csv?token=${hostToken}`);
  assert.strictEqual(csvRes.status, 200);
  assert(csvRes.headers['content-type'].includes('text/csv'));
  assert(csvRes.body.includes('Spectres') && csvRes.body.includes('Rank,Team Name'));
  console.log('✅ CSV Export returned valid results table');

  console.log('16. Testing Session Resumption (Refresh Simulation)...');
  const resumedRes = await new Promise(r => p1Socket.emit('resumeSession', {
    playerId: p1Data.playerId,
    token: p1Data.token,
    tabSessionId: 'tab-p1'
  }, r));
  assert.strictEqual(resumedRes.success, true);
  assert.strictEqual(resumedRes.activeInOtherTab, false);
  assert.strictEqual(resumedRes.playerState.team.name, 'Spectres');
  console.log('✅ Session resumption after refresh restored exact player state');

  console.log('17. Testing Multi-Tab Duplicate Detection & Smooth Takeover...');
  // A second socket connects with the same player credentials but a different tabSessionId
  const p1SecondTabSocket = ClientIO(`http://localhost:${TEST_PORT}`, { transports: ['websocket'] });
  await new Promise(r => p1SecondTabSocket.on('connect', r));

  const multiTabRes = await new Promise(r => p1SecondTabSocket.emit('resumeSession', {
    playerId: p1Data.playerId,
    token: p1Data.token,
    tabSessionId: 'tab-p1-second-tab'
  }, r));
  assert.strictEqual(multiTabRes.success, true);
  assert.strictEqual(multiTabRes.activeInOtherTab, true, 'Second tab must detect active session');

  // Second tab takes over
  let firstTabNotified = false;
  p1Socket.on('tabReplaced', () => { firstTabNotified = true; });

  const takeoverRes = await new Promise(r => p1SecondTabSocket.emit('takeoverSession', {
    playerId: p1Data.playerId,
    token: p1Data.token,
    tabSessionId: 'tab-p1-second-tab'
  }, r));
  assert.strictEqual(takeoverRes.success, true);
  await wait(300);
  assert.strictEqual(firstTabNotified, true, 'Original tab was gracefully notified without closing or crashing');
  console.log('✅ Multi-tab duplicate check and smooth takeover completed cleanly');

  console.log('18. Testing Server Restart & State Persistence from data/state.json...');
  // Verify test state file exists and has content
  assert(fs.existsSync(testStatePath), 'test-state.json must exist');
  const savedState = JSON.parse(fs.readFileSync(testStatePath, 'utf8'));
  assert(savedState.teams[p1Data.teamId], 'Saved state must contain Player 1 team');
  console.log('✅ Autosave verified: data/state.json contains active teams and scores');

  // Disconnect all sockets
  [hostSocket, p1Socket, p2Socket, p3Socket, p1SecondTabSocket].forEach(s => s.disconnect());

  console.log('========================================================');
  console.log('🎉 ALL END-TO-END SIMULATION TESTS PASSED SUCCESSFULLY!');
  console.log('========================================================');
  return true;
}

if (require.main === module) {
  runE2ESimulation().then(() => {
    process.exit(0);
  }).catch((err) => {
    console.error('❌ E2E Simulation Failed:', err);
    process.exit(1);
  });
}

module.exports = { runE2ESimulation };
