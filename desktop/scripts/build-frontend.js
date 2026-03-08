import esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';

const dist = 'dist';
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

// Bundle main.js (resolves npm imports)
await esbuild.build({
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'esm',
  outfile: path.join(dist, 'main.js'),
  minify: process.argv.includes('--minify'),
});

// Copy static files
fs.copyFileSync('src/index.html', path.join(dist, 'index.html'));
fs.copyFileSync('src/styles.css', path.join(dist, 'styles.css'));

console.log('Frontend built into dist/');
