const express = require('express');
const fs = require('fs');
const router = express.Router();
const config = require('../config');
const { safePath } = require('../utils/pathUtils');
const { getThumbnail } = require('../services/thumbnailService');

router.get('/*', async (req, res, next) => {
  try {
    const relPath = req.params[0] || '';
    safePath(config.mediaRoot, relPath); // validate

    const thumbPath = await getThumbnail(relPath);

    if (!thumbPath || !fs.existsSync(thumbPath)) {
      return res.status(404).send('Thumbnail not available');
    }

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=604800');
    fs.createReadStream(thumbPath).pipe(res);
  } catch (err) {
    if (err.message === 'Path traversal detected') {
      return res.status(403).send('Access denied');
    }
    // If thumbnail generation fails, send a placeholder
    console.error('Thumbnail error:', err.message);
    res.status(500).send('Thumbnail generation failed');
  }
});

module.exports = router;
