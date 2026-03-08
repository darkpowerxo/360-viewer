const path = require('path');

function safePath(mediaRoot, userPath) {
  const normalized = path.normalize(userPath || '').replace(/\\/g, '/');
  const resolved = path.resolve(mediaRoot, normalized);
  const base = path.resolve(mediaRoot);
  if (!resolved.startsWith(base)) {
    throw new Error('Path traversal detected');
  }
  return resolved;
}

function relativeToMedia(mediaRoot, absPath) {
  return path.relative(mediaRoot, absPath).replace(/\\/g, '/');
}

module.exports = { safePath, relativeToMedia };
