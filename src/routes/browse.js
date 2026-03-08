const express = require('express');
const router = express.Router();
const config = require('../config');
const { safePath } = require('../utils/pathUtils');
const { scan } = require('../services/fileScanner');
const { getFileType } = require('../utils/fileTypes');

function buildBreadcrumbs(relPath) {
  const crumbs = [{ name: 'Home', path: '' }];
  if (!relPath) return crumbs;
  const parts = relPath.split('/').filter(Boolean);
  let accum = '';
  for (const part of parts) {
    accum = accum ? `${accum}/${part}` : part;
    crumbs.push({ name: part, path: accum });
  }
  return crumbs;
}

router.get('/*', async (req, res, next) => {
  try {
    // Express wildcard: req.params[0] or empty string
    const relPath = (req.params[0] || '').replace(/\/+$/, '');
    const absPath = safePath(config.mediaRoot, relPath);
    const page = parseInt(req.query.page) || 1;

    const allItems = await scan(absPath);
    const totalPages = Math.max(1, Math.ceil(allItems.length / config.itemsPerPage));
    const clampedPage = Math.max(1, Math.min(page, totalPages));
    const start = (clampedPage - 1) * config.itemsPerPage;
    const pageItems = allItems.slice(start, start + config.itemsPerPage);

    // Enrich items with paths for templates
    const items = pageItems.map(item => ({
      ...item,
      relPath: relPath ? `${relPath}/${item.name}` : item.name,
      browseUrl: item.type === 'folder'
        ? `/browse/${relPath ? relPath + '/' : ''}${item.name}/`
        : `/view/${relPath ? relPath + '/' : ''}${item.name}`,
      thumbUrl: item.type !== 'folder'
        ? `/thumb/${relPath ? relPath + '/' : ''}${item.name}`
        : null,
    }));

    res.render('browse', {
      title: relPath || 'Home',
      items,
      breadcrumbs: buildBreadcrumbs(relPath),
      currentPath: relPath,
      page: clampedPage,
      totalPages,
    });
  } catch (err) {
    if (err.message === 'Path traversal detected') {
      return res.status(403).render('error', { title: '403', message: 'Access denied' });
    }
    next(err);
  }
});

module.exports = router;
