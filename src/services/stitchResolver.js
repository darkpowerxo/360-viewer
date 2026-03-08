const fs = require('fs');
const path = require('path');
const config = require('../config');
const { needsStitching, getStitchedExtension } = require('../utils/fileTypes');
const { activeJobs, stitchPhoto, stitchVideo } = require('./ffmpegService');

function getStitchedName(filename) {
  const ext = getStitchedExtension(filename);
  if (!ext) return null;
  return path.basename(filename, path.extname(filename)) + ext;
}

function findStitched(relPath) {
  const stitchedName = getStitchedName(path.basename(relPath));
  if (!stitchedName) return null;

  const relDir = path.dirname(relPath);

  // Check exports/ (both mirrored and flat)
  const exportsMirrored = path.join(config.mediaRoot, config.exportsDir, relDir, stitchedName);
  if (fs.existsSync(exportsMirrored)) return exportsMirrored;

  const exportsFlat = path.join(config.mediaRoot, config.exportsDir, stitchedName);
  if (fs.existsSync(exportsFlat)) return exportsFlat;

  // Check ffmpeg/ (both mirrored and flat)
  const ffmpegMirrored = path.join(config.mediaRoot, config.ffmpegDir, relDir, stitchedName);
  if (fs.existsSync(ffmpegMirrored)) return ffmpegMirrored;

  const ffmpegFlat = path.join(config.mediaRoot, config.ffmpegDir, stitchedName);
  if (fs.existsSync(ffmpegFlat)) return ffmpegFlat;

  return null;
}

async function resolve(relPath) {
  if (!needsStitching(path.basename(relPath))) {
    const absPath = path.join(config.mediaRoot, relPath);
    return { status: 'ready', outputPath: absPath };
  }

  // Check for existing stitched file
  const existing = findStitched(relPath);
  if (existing) {
    return { status: 'ready', outputPath: existing };
  }

  // Check if conversion already running
  if (activeJobs.has(relPath)) {
    const job = activeJobs.get(relPath);
    return { status: 'converting', progress: job.progress || 0 };
  }

  // Start conversion
  const inputPath = path.join(config.mediaRoot, relPath);
  const stitchedName = getStitchedName(path.basename(relPath));
  const relDir = path.dirname(relPath);
  const outputPath = path.join(config.mediaRoot, config.ffmpegDir, relDir, stitchedName);

  const isVideo = relPath.toLowerCase().endsWith('.insv');
  const job = { progress: 0, process: null };
  activeJobs.set(relPath, job);

  const convertFn = isVideo
    ? stitchVideo(inputPath, outputPath, relPath)
    : stitchPhoto(inputPath, outputPath);

  convertFn
    .then(() => {
      activeJobs.delete(relPath);
    })
    .catch(err => {
      console.error(`Stitch failed for ${relPath}:`, err.message);
      activeJobs.delete(relPath);
    });

  return { status: 'converting', progress: 0 };
}

module.exports = { resolve, findStitched };
