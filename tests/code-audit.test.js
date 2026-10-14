const fs = require('fs');
const path = require('path');
const assert = require('assert');

function checkFileForForbiddenPatterns(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const violations = [];

  // Patterns that must NOT appear as active function calls
  // (We allow our safety override definitions in toast-modal.js where we redefine window.alert = function...)
  const isToastModalFile = filePath.endsWith('toast-modal.js');

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    // Skip comments
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
      return;
    }

    if (!isToastModalFile) {
      if (/\b(window\.)?alert\s*\(/.test(line)) {
        violations.push({ line: index + 1, text: line.trim(), pattern: 'alert()' });
      }
      if (/\b(window\.)?confirm\s*\(/.test(line)) {
        violations.push({ line: index + 1, text: line.trim(), pattern: 'confirm()' });
      }
      if (/\b(window\.)?prompt\s*\(/.test(line)) {
        violations.push({ line: index + 1, text: line.trim(), pattern: 'prompt()' });
      }
      if (/\bwindow\.close\s*\(/.test(line)) {
        violations.push({ line: index + 1, text: line.trim(), pattern: 'window.close()' });
      }
      if (/\bwindow\.open\s*\(/.test(line)) {
        violations.push({ line: index + 1, text: line.trim(), pattern: 'window.open()' });
      }
      if (/beforeunload/.test(line)) {
        violations.push({ line: index + 1, text: line.trim(), pattern: 'beforeunload' });
      }
    }
  });

  return violations;
}

function scanDirectory(dir, results = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== '.git') {
        scanDirectory(fullPath, results);
      }
    } else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.html'))) {
      const violations = checkFileForForbiddenPatterns(fullPath);
      if (violations.length > 0) {
        results.push({ file: fullPath, violations });
      }
    }
  }
  return results;
}

function runCodeAudit() {
  console.log('--- Running Stability & Anti-Popup Code Audit ---');
  const projectRoot = path.resolve(__dirname, '..');
  const results = [];
  scanDirectory(path.join(projectRoot, 'public'), results);

  ['server.js', 'stateManager.js'].forEach(file => {
    const fullPath = path.join(projectRoot, file);
    if (fs.existsSync(fullPath)) {
      const violations = checkFileForForbiddenPatterns(fullPath);
      if (violations.length > 0) {
        results.push({ file: fullPath, violations });
      }
    }
  });

  if (results.length > 0) {
    console.error('❌ FORBIDDEN POPUP / NAV PATTERNS DETECTED:');
    results.forEach(r => {
      console.error(`File: ${r.file}`);
      r.violations.forEach(v => console.error(`  Line ${v.line}: [${v.pattern}] -> ${v.text}`));
    });
    throw new Error('Forbidden popup / navigation patterns found in codebase!');
  } else {
    console.log('✅ Code Audit Passed: Zero native alert, confirm, prompt, window.close, or beforeunload popups found!');
  }
}

if (require.main === module) {
  runCodeAudit();
}

module.exports = { runCodeAudit };
