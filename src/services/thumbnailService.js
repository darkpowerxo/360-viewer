const fs = require('fs');
const path = require('path');
const config = require('../config');
const { needsStitching } = require('../utils/fileTypes');
const { generateThumbnail } = require('./ffmpegService');
const { findStitched } = require('./stitchResolver');

const pendingThumbs = new Map();

async function getThumbnail(relPath) {
  const thumbPath = path.join(config.mediaRoot, config.thumbsDir, relPath + '.thumb.jpg');

  if (fs.existsSync(thumbPath)) return thumbPath;

  // Avoid duplicate generation
  if (pendingThumbs.has(relPath)) {
    return pendingThumbs.get(relPath);
  }

  const promise = (async () => {
    try {
      const filename = path.basename(relPath);
      const lower = filename.toLowerCase();
      const isVideo = lower.endsWith('.insv') || lower.endsWith('.mp4');
      const requiresStitch = needsStitching(filename);

      let inputPath;
      if (requiresStitch) {
        // Try to use stitched version for better thumbnail
        const stitched = findStitched(relPath);
        if (stitched) {
          inputPath = stitched;
          await generateThumbnail(inputPath, thumbPath, { isVideo, needsStitching: false });
        } else {
          inputPath = path.join(config.mediaRoot, relPath);
          await generateThumbnail(inputPath, thumbPath, { isVideo, needsStitching: true });
        }
      } else {
        inputPath = path.join(config.mediaRoot, relPath);
        await generateThumbnail(inputPath, thumbPath, { isVideo, needsStitching: false });
      }

      return thumbPath;
    } finally {
      pendingThumbs.delete(relPath);
    }
  })();

  pendingThumbs.set(relPath, promise);
  return promise;
}

module.exports = { getThumbnail };
