const path = require('path');
const fs = require('fs');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// CLI argument parsing (for Tauri desktop app)
const argv = process.argv.slice(2);
function getArg(name) {
  const idx = argv.indexOf('--' + name);
  return idx !== -1 && argv[idx + 1] ? argv[idx + 1] : undefined;
}

const config = {
  mediaRoot: getArg('media-root') || process.env.MEDIA_ROOT,
  port: parseInt(getArg('port') || process.env.PORT, 10) || 3443,
  host: getArg('host') || process.env.HOST || '0.0.0.0',
  itemsPerPage: parseInt(process.env.ITEMS_PER_PAGE, 10) || 12,
  certsDir: getArg('certs-dir') || path.join(__dirname, '..', 'certs'),
  exportsDir: 'exports',
  ffmpegDir: 'ffmpeg',
  thumbsDir: 'ffmpeg/thumbs',
};

function validate() {
  if (!config.mediaRoot) {
    console.error('MEDIA_ROOT is not set. Use --media-root <path> or set MEDIA_ROOT in .env');
    process.exit(1);
  }
  const resolved = path.resolve(config.mediaRoot);
  if (!fs.existsSync(resolved)) {
    console.error(`MEDIA_ROOT does not exist: ${resolved}`);
    process.exit(1);
  }
  config.mediaRoot = resolved;
}

validate();

module.exports = config;
