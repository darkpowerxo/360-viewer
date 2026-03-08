const express = require('express');
const path = require('path');
const router = express.Router();
const config = require('../config');
const { safePath } = require('../utils/pathUtils');
const { getFileType } = require('../utils/fileTypes');
const { resolve } = require('../services/stitchResolver');

router.get('/*', async (req, res, next) => {
  try {
    const relPath = req.params[0] || '';
    safePath(config.mediaRoot, relPath);

    const fileName = path.basename(relPath);
    const parentPath = path.dirname(relPath).replace(/\\/g, '/');
    const fileType = getFileType(fileName) === 'video' ? 'video' : 'photo';

    const stitchInfo = await resolve(relPath);

    res.render('viewer', {
      title: fileName,
      fileName,
      filePath: relPath,
      parentPath: parentPath === '.' ? '' : parentPath,
      fileType,
      stitchStatus: stitchInfo.status,
      progress: stitchInfo.progress || 0,
    });
  } catch (err) {
    if (err.message === 'Path traversal detected') {
      return res.status(403).render('error', { title: '403', message: 'Access denied' });
    }
    next(err);
  }
});

module.exports = router;
