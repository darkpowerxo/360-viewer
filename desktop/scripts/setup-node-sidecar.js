import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import https from 'https';
import { createUnzip } from 'zlib';
import { pipeline } from 'stream/promises';
import { createWriteStream, createReadStream } from 'fs';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

const NODE_VERSION = '22.14.0'; // LTS

// Support --target <triple> argument, otherwise detect from host
const targetArg = process.argv.indexOf('--target');
const targetTriple = targetArg !== -1 && process.argv[targetArg + 1]
  ? process.argv[targetArg + 1]
  : execSync('rustc --print host-tuple').toString().trim();
const isWindows = targetTriple.includes('windows');
const ext = isWindows ? '.exe' : '';

const platformMap = {
  'x86_64-pc-windows-msvc': { platform: 'win', arch: 'x64' },
  'x86_64-unknown-linux-gnu': { platform: 'linux', arch: 'x64' },
  'aarch64-unknown-linux-gnu': { platform: 'linux', arch: 'arm64' },
  'aarch64-apple-darwin': { platform: 'darwin', arch: 'arm64' },
  'x86_64-apple-darwin': { platform: 'darwin', arch: 'x64' },
};

const info = platformMap[targetTriple];
if (!info) {
  console.error(`Unsupported target: ${targetTriple}`);
  process.exit(1);
}

const binDir = path.join('src-tauri', 'binaries');
fs.mkdirSync(binDir, { recursive: true });

const destName = `node-${targetTriple}${ext}`;
const destPath = path.join(binDir, destName);

if (fs.existsSync(destPath)) {
  console.log(`Node.js sidecar already exists: ${destPath}`);
  process.exit(0);
}

function download(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        download(res.headers.location).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      resolve(res);
    }).on('error', reject);
  });
}

async function setupWindows() {
  const zipName = `node-v${NODE_VERSION}-win-${info.arch}.zip`;
  const url = `https://nodejs.org/dist/v${NODE_VERSION}/${zipName}`;
  const tmpDir = path.join(tmpdir(), `node-${randomUUID()}`);
  const tmpZip = tmpDir + '.zip';

  console.log(`Downloading ${url}...`);
  const res = await download(url);
  await pipeline(res, createWriteStream(tmpZip));
  console.log('Download complete. Extracting node.exe...');

  // Extract the full zip, then copy just node.exe
  fs.mkdirSync(tmpDir, { recursive: true });
  execSync(
    `powershell -Command "Expand-Archive -Path '${tmpZip.replace(/'/g, "''")}' -DestinationPath '${tmpDir.replace(/'/g, "''")}' -Force"`,
    { stdio: 'inherit' }
  );

  const extractedNode = path.join(tmpDir, `node-v${NODE_VERSION}-win-${info.arch}`, 'node.exe');
  fs.copyFileSync(extractedNode, destPath);

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.unlinkSync(tmpZip);
}

async function setupUnix() {
  const tarName = `node-v${NODE_VERSION}-${info.platform}-${info.arch}.tar.gz`;
  const url = `https://nodejs.org/dist/v${NODE_VERSION}/${tarName}`;
  const tmpTar = path.join(tmpdir(), `node-${randomUUID()}.tar.gz`);

  console.log(`Downloading ${url}...`);
  const res = await download(url);
  await pipeline(res, createWriteStream(tmpTar));
  console.log('Download complete. Extracting node binary...');

  const innerPath = `node-v${NODE_VERSION}-${info.platform}-${info.arch}/bin/node`;
  execSync(`tar -xzf "${tmpTar}" -C "${tmpdir()}" "${innerPath}"`, { stdio: 'inherit' });
  fs.copyFileSync(path.join(tmpdir(), innerPath), destPath);
  fs.chmodSync(destPath, 0o755);
  fs.unlinkSync(tmpTar);
}

try {
  if (isWindows) {
    await setupWindows();
  } else {
    await setupUnix();
  }
  console.log(`Node.js ${NODE_VERSION} sidecar ready: ${destPath}`);
} catch (e) {
  console.error('Failed to setup Node.js sidecar:', e.message);
  process.exit(1);
}
