const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const config = require('../config');
const { safePath } = require('../utils/pathUtils');
const { resolve } = require('../services/stitchResolver');

router.get('/*', async (req, res, next) => {
  try {
    const relPath = req.params[0] || '';
    safePath(config.mediaRoot, relPath); // validate

    const result = await resolve(relPath);

    if (result.status === 'converting') {
      return res.status(202).json({ status: 'converting', progress: result.progress });
    }

    if (result.status !== 'ready' || !result.outputPath) {
      return res.status(404).json({ error: 'File not found' });
    }

    const filePath = result.outputPath;
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const ext = path.extname(filePath).toLowerCase();
    const isVideo = ['.mp4', '.webm'].includes(ext);

    if (isVideo) {
      // Stream video with Range support
      const stat = fs.statSync(filePath);
      const range = req.headers.range;

      if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
        const chunkSize = end - start + 1;

        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunkSize,
          'Content-Type': 'video/mp4',
        });
        fs.createReadStream(filePath, { start, end }).pipe(res);
      } else {
        res.writeHead(200, {
          'Content-Length': stat.size,
          'Content-Type': 'video/mp4',
          'Accept-Ranges': 'bytes',
        });
        fs.createReadStream(filePath).pipe(res);
      }
    } else {
      const mimeTypes = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };
      const contentType = mimeTypes[ext] || 'application/octet-stream';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      fs.createReadStream(filePath).pipe(res);
    }
  } catch (err) {
    if (err.message === 'Path traversal detected') {
      return res.status(403).json({ error: 'Access denied' });
    }
    next(err);
  }
});

module.exports = router;
