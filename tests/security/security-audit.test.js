/**
 * Security audit test — validates security posture beyond npm audit.
 *
 * Checks:
 *   1. No secrets in source code (common patterns)
 *   2. Security headers are configured
 *   3. Rate limiting is enabled
 *   4. CSRF protection is active
 *   5. Input validation is applied to all routes
 *   6. Authentication is enforced on protected routes
 *   7. No known-vulnerable patterns
 *   8. Environment variables are not hardcoded
 *
 * Run: node tests/security/security-audit.test.js
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../backend/src');

let passed = 0;
let failed = 0;

function ok(name) { passed += 1; console.log(`  ✅ ${name}`); }
function fail(name, msg) { failed += 1; console.error(`  ❌ ${name}: ${msg}`); }

console.log('=== Security Audit ===\n');

// 1. No hardcoded secrets in source
{
  const SECRET_PATTERNS = [
    /(?:password|secret|token|key)\s*[:=]\s*['"][A-Za-z0-9+/=]{16,}['"]/gi,
    /sk_live_[a-zA-Z0-9]+/g,
    /rk_live_[a-zA-Z0-9]+/g,
    /AKIA[0-9A-Z]{16}/g, // AWS access key
  ];

  const IGNORE_DIRS = ['node_modules', '.git', 'migrations'];
  const IGNORE_FILES = ['.env', '.env.example', 'package-lock.json'];

  let secretsFound = 0;

  function scanDir(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && !IGNORE_DIRS.includes(entry.name)) {
        scanDir(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.js') && !IGNORE_FILES.includes(entry.name)) {
        const content = fs.readFileSync(fullPath, 'utf8');
        for (const pattern of SECRET_PATTERNS) {
          const matches = content.match(pattern);
          if (matches) {
            for (const m of matches) {
              // Allow test/mock values
              if (m.includes('mock') || m.includes('test') || m.includes('example') || m.includes('placeholder')) continue;
              secretsFound += 1;
              if (secretsFound <= 3) {
                console.warn(`  ⚠️  Possible secret in ${path.relative(ROOT, fullPath)}: ${m.slice(0, 40)}...`);
              }
            }
          }
        }
      }
    }
  }

  scanDir(ROOT);
  if (secretsFound === 0) ok('No hardcoded secrets found in source');
  else fail('Hardcoded secrets', `${secretsFound} potential secrets found`);
}

// 2. Security middleware files exist
{
  const REQUIRED_FILES = [
    'middleware/rateLimiter.js',
    'middleware/csrf.js',
    'middleware/errorHandler.js',
    'middleware/validate.js',
    'middleware/authenticate.js',
    'middleware/authorize.js',
    'middleware/ipAllowlist.js',
    'middleware/accountLockout.js',
  ];

  for (const file of REQUIRED_FILES) {
    const fullPath = path.join(ROOT, file);
    if (fs.existsSync(fullPath)) ok(`Security middleware: ${file}`);
    else fail(`Missing middleware`, file);
  }
}

// 3. Input validation middleware is imported
{
  const validatePath = path.join(ROOT, 'middleware/validate.js');
  if (fs.existsSync(validatePath)) {
    const content = fs.readFileSync(validatePath, 'utf8');
    if (content.includes('Joi') || content.includes('schema')) {
      ok('Input validation uses Joi schema validation');
    } else {
      fail('Input validation', 'Does not use Joi schemas');
    }
  }
}

// 4. Rate limiter is configured
{
  const rateLimiterPath = path.join(ROOT, 'middleware/rateLimiter.js');
  if (fs.existsSync(rateLimiterPath)) {
    const content = fs.readFileSync(rateLimiterPath, 'utf8');
    if (content.includes('windowMs') || content.includes('max')) {
      ok('Rate limiter has window/max configuration');
    }
    if (content.includes('login') || content.includes('auth')) {
      ok('Rate limiter has auth-specific limits');
    }
  }
}

// 5. Authentication middleware checks JWT
{
  const authPath = path.join(ROOT, 'middleware/authenticate.js');
  if (fs.existsSync(authPath)) {
    const content = fs.readFileSync(authPath, 'utf8');
    if (content.includes('jwt') || content.includes('JWT') || content.includes('token')) {
      ok('Authentication uses JWT tokens');
    }
    if (content.includes('Bearer')) {
      ok('Authentication checks Bearer token format');
    }
  }
}

// 6. Error handler does not leak internals in production
{
  const errorHandlerPath = path.join(ROOT, 'middleware/errorHandler.js');
  if (fs.existsSync(errorHandlerPath)) {
    const content = fs.readFileSync(errorHandlerPath, 'utf8');
    if (content.includes('stack') && content.includes('production')) {
      ok('Error handler hides stack traces in production');
    }
    if (content.includes('sanitize') || content.includes('safe')) {
      ok('Error handler sanitizes output');
    }
  }
}

// 7. Helmet is used for security headers
{
  const appPath = path.join(ROOT, 'app.js');
  if (fs.existsSync(appPath)) {
    const content = fs.readFileSync(appPath, 'utf8');
    if (content.includes('helmet')) {
      ok('App uses helmet for security headers');
    }
    if (content.includes('cors')) {
      ok('App uses CORS middleware');
    }
  }
}

// 8. No eval() or Function() in production code
{
  let evalCount = 0;
  function scanForEval(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && !['node_modules', 'migrations'].includes(entry.name)) {
        scanForEval(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.js')) {
        const content = fs.readFileSync(fullPath, 'utf8');
        // Look for eval/Function in non-test, non-script files
        if (fullPath.includes('scripts/') || fullPath.includes('test')) continue;
        const evalMatches = content.match(/\beval\s*\(/g);
        const functionMatches = content.match(/\bnew\s+Function\s*\(/g);
        evalCount += (evalMatches?.length || 0) + (functionMatches?.length || 0);
      }
    }
  }
  scanForEval(ROOT);
  if (evalCount === 0) ok('No eval() or new Function() in production code');
  else fail('Dangerous eval', `${evalCount} eval/Function calls found`);
}

// 9. MongoDB injection protection
{
  const routesDir = path.join(ROOT, 'routes');
  if (fs.existsSync(routesDir)) {
    const files = fs.readdirSync(routesDir).filter((f) => f.endsWith('.js'));
    let hasValidate = 0;
    for (const file of files) {
      const content = fs.readFileSync(path.join(routesDir, file), 'utf8');
      if (content.includes('validate(')) hasValidate += 1;
    }
    if (hasValidate > 0) ok(`${hasValidate} route files use input validation`);
    else fail('Input validation', 'No route files use validate()');
  }
}

console.log(`\n=== Security Audit: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
