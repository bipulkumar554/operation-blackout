const { testCrypto } = require('./crypto.test');
const { runCodeAudit } = require('./code-audit.test');
const { runE2ESimulation } = require('./e2e-simulation.test');

async function main() {
  console.log('############################################################');
  console.log(' OPERATION BLACKOUT - COMPREHENSIVE AUTOMATED TEST RUNNER');
  console.log('############################################################\n');

  const testResults = [];

  // Test 1: Layered Cryptography
  try {
    testCrypto();
    testResults.push({ name: 'Layered Cryptography (Hex->B64->Caesar)', status: 'PASS' });
  } catch (err) {
    console.error(err);
    testResults.push({ name: 'Layered Cryptography (Hex->B64->Caesar)', status: 'FAIL', error: err.message });
  }

  // Test 2: Code Audit (Zero Alert/Confirm/Prompt/Close/Open/BeforeUnload)
  try {
    runCodeAudit();
    testResults.push({ name: 'Zero Popups / Zero Window.Close Audit', status: 'PASS' });
  } catch (err) {
    console.error(err);
    testResults.push({ name: 'Zero Popups / Zero Window.Close Audit', status: 'FAIL', error: err.message });
  }

  // Test 3: Full End-to-End Multi-Client Simulation
  try {
    await runE2ESimulation();
    testResults.push({ name: 'End-to-End Simulation (3 Players, Host, QR, Anti-Cheat, Vault)', status: 'PASS' });
  } catch (err) {
    console.error(err);
    testResults.push({ name: 'End-to-End Simulation (3 Players, Host, QR, Anti-Cheat, Vault)', status: 'FAIL', error: err.message });
  }

  console.log('\n============================================================');
  console.log('                 FINAL TEST SUMMARY TABLE                   ');
  console.log('============================================================');
  console.table(testResults);

  const hasFailures = testResults.some(t => t.status === 'FAIL');
  if (hasFailures) {
    console.error('\n❌ SOME TESTS FAILED. PLEASE REVIEW LOGS.');
    process.exit(1);
  } else {
    console.log('\n✅ ALL TEST SUITES PASSED FLAWLESSLY! READY FOR DEPLOYMENT.');
    process.exit(0);
  }
}

main();
