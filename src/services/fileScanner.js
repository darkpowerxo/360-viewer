const fs = require('fs').promises;
const path = require('path');
const { getFileType, isHiddenFile, isHiddenFolder } = require('../utils/fileTypes');

function extractMatchKey(filename) {
  const match = filename.match(/\w+_(\d{8}_\d{6})_\d{2}_(\d+)/);
  return match ? `${match[1]}_${match[2]}` : null;
}

async function scan(absPath) {
  const entries = await fs.readdir(absPath, { withFileTypes: true });

  const folders = [];
  const files = [];
  const insvKeys = new Set();
  const inspBasenames = new Set();

  // First pass: collect .insv keys and .insp basenames
  for (const entry of entries) {
    if (entry.isFile()) {
      const lower = entry.name.toLowerCase();
      if (lower.endsWith('.insv')) {
        const key = extractMatchKey(entry.name);
        if (key) insvKeys.add(key);
      }
      if (lower.endsWith('.insp')) {
        const base = path.basename(entry.name, path.extname(entry.name));
        const coreMatch = base.match(/\w+_(\d{8}_\d{6}_\d{2}_\d+)/);
        if (coreMatch) inspBasenames.add(coreMatch[1]);
      }
    }
  }

  // Second pass: filter and categorize
  for (const entry of entries) {
    const name = entry.name;
    const lower = name.toLowerCase();

    if (entry.isDirectory()) {
      if (!isHiddenFolder(name) && !name.startsWith('.')) {
        folders.push({ name, type: 'folder' });
      }
      continue;
    }

    // Skip hidden file patterns
    if (isHiddenFile(name)) continue;
    if (lower.endsWith('.lrv')) continue; // all .lrv hidden

    // Hide .dng when matching .insp exists
    if (lower.endsWith('.dng')) {
      const base = path.basename(name, path.extname(name));
      const coreMatch = base.match(/\w+_(\d{8}_\d{6}_\d{2}_\d+)/);
      if (coreMatch && inspBasenames.has(coreMatch[1])) continue;
    }

    const fileType = getFileType(name);
    if (fileType) {
      files.push({ name, type: fileType, mediaType: lower.endsWith('.insv') || lower.endsWith('.mp4') ? 'video' : 'photo' });
    }
  }

  // Sort: folders first alphabetical, then files by name (chronological)
  folders.sort((a, b) => a.name.localeCompare(b.name));
  files.sort((a, b) => a.name.localeCompare(b.name));

  return [...folders, ...files];
}

module.exports = { scan };
