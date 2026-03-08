# 360 Viewer

A web-based 360° media viewer with WebXR support for Meta Quest 3 and other VR headsets. Browse, view, and explore Insta360 photos and videos in immersive VR with passthrough support.

## Features

- Browse 360° photos and videos from a local media folder
- Immersive WebXR viewer with VR/AR passthrough toggle
- Orbit-style grab rotation in VR
- HTTPS server with self-signed certificates (required for WebXR)
- Desktop app with one-click server management

## Project Structure

```
360-viewer/
├── server.js          # Express server entry point
├── src/               # Server-side source (config, routes, services)
├── views/             # EJS templates
├── public/            # Frontend assets (JS, CSS, images)
├── desktop/           # Tauri desktop app wrapper
│   ├── src/           # Launcher UI
│   ├── src-tauri/     # Rust backend + Tauri config
│   └── scripts/       # Build helper scripts
└── .github/workflows/ # CI/CD
```

## Quick Start (Server Only)

```bash
# Install dependencies
npm install

# Create .env from example
cp .env.example .env
# Edit .env and set MEDIA_ROOT to your 360° media folder

# Start the server
node server.js
```

Open `https://localhost:3443` in your browser (accept the self-signed certificate).

## Desktop App

The desktop app bundles the server with a native launcher UI — no need to install Node.js or use the terminal.

### Development

```bash
# Install server dependencies
npm install

# Set up the desktop app
cd desktop
npm install
npm run setup    # Downloads Node.js sidecar binary
npm run dev      # Launch in dev mode
```

### Building

Build for your current platform:
```bash
cd desktop
npm run build
```

Or target a specific platform:

```bash
cd desktop
npm run build:windows    # Windows x64 (.msi, .exe, portable zip)
npm run build:linux      # Linux x64 (.deb, .AppImage)
npm run build:mac-intel  # macOS Intel (.dmg)
npm run build:mac-arm    # macOS Apple Silicon (.dmg)
```

> **Note:** Cross-compilation requires the target's Rust toolchain installed (`rustup target add <triple>`) and you must be on the matching OS — Tauri cannot cross-compile across operating systems. Use the CI/CD workflow for multi-platform builds.

Installers are generated in `desktop/src-tauri/target/<target>/release/bundle/`.

## Releases

Tagged releases trigger GitHub Actions to build installers for:
- Windows (`.msi`, `.exe`, portable `.zip`)
- Linux (`.deb`, `.AppImage`)
- macOS Intel (`.dmg`)
- macOS Apple Silicon (`.dmg`)

Create a release:
```bash
git tag v1.0.0
git push origin v1.0.0
```

## VR Usage

1. Start the server (or use the desktop app) — it binds to `0.0.0.0` so it's accessible on your local network
2. Open `https://<your-pc-ip>:3443` on your Meta Quest 3 browser
3. Accept the self-signed certificate
4. Click "Enter VR" to launch the immersive viewer
5. Use the trigger to grab and rotate the view
6. Toggle passthrough with the passthrough button

## License

MIT
