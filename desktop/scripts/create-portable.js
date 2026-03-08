import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { createWriteStream } from 'fs';
import archiver from 'archiver';

// Detect or accept target triple
const targetArg = process.argv.indexOf('--target');
const targetTriple = targetArg !== -1 && process.argv[targetArg + 1]
  ? process.argv[targetArg + 1]
  : execSync('rustc --print host-tuple').toString().trim();

const isWindows = targetTriple.includes('windows');
if (!isWindows) {
  console.log('Portable zip is only supported for Windows targets.');
  process.exit(0);
}

// Paths — the binary in target/release/ uses the Cargo package name
const releaseDir = path.join('src-tauri', 'target', targetTriple, 'release');
const cargoBinName = 'insta360-viewer-desktop.exe'; // matches Cargo.toml [package].name
const friendlyExeName = '360 Viewer.exe';           // name used inside the zip
const sidecarName = `node-${targetTriple}.exe`;
const resourcesDir = path.join(releaseDir, 'resources');

// Verify build output exists
const exePath = path.join(releaseDir, cargoBinName);
if (!fs.existsSync(exePath)) {
  console.error(`Build output not found: ${exePath}`);
  console.error('Run "npm run build:windows" first.');
  process.exit(1);
}

// Output zip
const outDir = path.join('src-tauri', 'target', targetTriple, 'release', 'bundle', 'portable');
fs.mkdirSync(outDir, { recursive: true });
const zipPath = path.join(outDir, '360-Viewer-portable-x64.zip');

const output = createWriteStream(zipPath);
const archive = archiver('zip', { zlib: { level: 9 } });

archive.pipe(output);

// Add main executable (rename to friendly name inside zip)
archive.file(exePath, { name: friendlyExeName });

// Add sidecar
const sidecarPath = path.join(releaseDir, sidecarName);
if (fs.existsSync(sidecarPath)) {
  archive.file(sidecarPath, { name: sidecarName });
} else {
  console.warn(`Warning: sidecar not found at ${sidecarPath}`);
}

// Add resources directory
if (fs.existsSync(resourcesDir)) {
  archive.directory(resourcesDir, 'resources');
} else {
  console.warn(`Warning: resources not found at ${resourcesDir}`);
}

// Add WebView2Loader.dll if present
const webview2 = path.join(releaseDir, 'WebView2Loader.dll');
if (fs.existsSync(webview2)) {
  archive.file(webview2, { name: 'WebView2Loader.dll' });
}

await new Promise((resolve, reject) => {
  output.on('close', resolve);
  archive.on('error', reject);
  archive.finalize();
});
console.log(`Portable zip created: ${zipPath} (${archive.pointer()} bytes)`);
