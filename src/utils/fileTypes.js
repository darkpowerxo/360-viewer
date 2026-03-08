const PHOTO_EXTENSIONS = ['.insp', '.jpg', '.jpeg', '.dng'];
const VIDEO_EXTENSIONS = ['.insv', '.mp4'];
const HIDDEN_EXTENSIONS = ['.lrv', '.lrv.pb', '.trim_thumbnail.bin'];
const HIDDEN_FOLDERS = ['misc', 'exports', 'ffmpeg', 'insta360-viewer'];

function getFileType(filename) {
  const lower = filename.toLowerCase();
  if (PHOTO_EXTENSIONS.some(ext => lower.endsWith(ext))) return 'photo';
  if (VIDEO_EXTENSIONS.some(ext => lower.endsWith(ext))) return 'video';
  return null;
}

function needsStitching(filename) {
  const lower = filename.toLowerCase();
  return lower.endsWith('.insp') || lower.endsWith('.insv');
}

function getStitchedExtension(filename) {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.insp')) return '.jpg';
  if (lower.endsWith('.insv')) return '.mp4';
  return null;
}

function isHiddenFile(filename) {
  const lower = filename.toLowerCase();
  return HIDDEN_EXTENSIONS.some(ext => lower.endsWith(ext));
}

function isHiddenFolder(name) {
  return HIDDEN_FOLDERS.includes(name.toLowerCase());
}

module.exports = {
  PHOTO_EXTENSIONS, VIDEO_EXTENSIONS, HIDDEN_EXTENSIONS, HIDDEN_FOLDERS,
  getFileType, needsStitching, getStitchedExtension, isHiddenFile, isHiddenFolder,
};
