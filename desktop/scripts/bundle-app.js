import fs from 'fs';
import path from 'path';

const srcApp = path.resolve('..');
const destApp = path.join('src-tauri', 'resources', 'app');

// Clean and recreate
fs.rmSync(destApp, { recursive: true, force: true });
fs.mkdirSync(destApp, { recursive: true });

const items = ['server.js', 'package.json', 'src', 'views', 'public', 'node_modules'];

for (const item of items) {
  const src = path.join(srcApp, item);
  const dest = path.join(destApp, item);
  if (!fs.existsSync(src)) {
    console.warn(`Warning: ${src} not found, skipping`);
    continue;
  }
  fs.cpSync(src, dest, { recursive: true });
  console.log(`Copied ${item}`);
}

// Don't copy .env — config comes from CLI args at runtime
console.log('Express app bundled into src-tauri/resources/app/');
