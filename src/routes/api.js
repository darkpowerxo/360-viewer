const express = require('express');
const router = express.Router();
const config = require('../config');
const { safePath } = require('../utils/pathUtils');
const { resolve } = require('../services/stitchResolver');
const { scan } = require('../services/fileScanner');

router.get('/stitch-status/*', async (req, res) => {
  try {
    const relPath = req.params[0] || '';
    safePath(config.mediaRoot, relPath);

    const result = await resolve(relPath);
    res.json({
      status: result.status,
      progress: result.progress || 0,
      mediaUrl: result.status === 'ready' ? `/media/${relPath}` : null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// JSON browse API for VR file browser
router.get('/browse', (req, res) => browsePath(req, res, ''));
router.get('/browse/*', (req, res) => browsePath(req, res, req.params[0] || ''));

async function browsePath(req, res, relPath) {
  try {
    relPath = relPath.replace(/\/+$/, '');
    const absPath = safePath(config.mediaRoot, relPath);
    const page = parseInt(req.query.page) || 1;

    const allItems = await scan(absPath);
    const totalPages = Math.max(1, Math.ceil(allItems.length / config.itemsPerPage));
    const clampedPage = Math.max(1, Math.min(page, totalPages));
    const start = (clampedPage - 1) * config.itemsPerPage;
    const pageItems = allItems.slice(start, start + config.itemsPerPage);

    const items = pageItems.map(item => ({
      name: item.name,
      type: item.type,
      mediaType: item.mediaType || null,
      relPath: relPath ? `${relPath}/${item.name}` : item.name,
      thumbUrl: item.type !== 'folder'
        ? `/thumb/${relPath ? relPath + '/' : ''}${item.name}`
        : null,
      viewUrl: item.type === 'folder'
        ? null
        : `/view/${relPath ? relPath + '/' : ''}${item.name}`,
      browsePath: item.type === 'folder'
        ? (relPath ? `${relPath}/${item.name}` : item.name)
        : null,
    }));

    res.json({ items, currentPath: relPath, page: clampedPage, totalPages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Siblings API for prev/next navigation in viewer
router.get('/siblings/*', async (req, res) => {
  try {
    const relPath = (req.params[0] || '').replace(/\/+$/, '');
    const fileName = require('path').basename(relPath);
    const dirPath = require('path').dirname(relPath).replace(/\\/g, '/');
    const parentRel = dirPath === '.' ? '' : dirPath;
    const absDir = safePath(config.mediaRoot, parentRel);

    const allItems = await scan(absDir);
    // Only media files (not folders)
    const mediaItems = allItems.filter(i => i.type !== 'folder');
    const idx = mediaItems.findIndex(i => i.name === fileName);

    const toViewItem = (item) => ({
      name: item.name,
      relPath: parentRel ? `${parentRel}/${item.name}` : item.name,
      viewUrl: `/view/${parentRel ? parentRel + '/' : ''}${item.name}`,
    });

    res.json({
      prev: idx > 0 ? toViewItem(mediaItems[idx - 1]) : null,
      next: idx >= 0 && idx < mediaItems.length - 1 ? toViewItem(mediaItems[idx + 1]) : null,
      current: idx + 1,
      total: mediaItems.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
