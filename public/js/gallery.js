// VR Immersive File Browser + Inline 360° Viewer
import * as THREE from 'three';

(async function() {
  const vrBtn = document.getElementById('enter-vr-browse');
  if (!vrBtn || !navigator.xr) return;

  // Only activate on browse pages
  if (!window.__BROWSE_DATA__) return;

  let vrSupported = false;
  let arSupported = false;
  try {
    vrSupported = await navigator.xr.isSessionSupported('immersive-vr');
    arSupported = await navigator.xr.isSessionSupported('immersive-ar');
  } catch (e) {}
  if (!vrSupported && !arSupported) return;
  vrBtn.style.display = 'block';

  // --- State ---
  let xrSession = null;
  let renderer, scene, camera;
  let panelGroup = null;
  let controllerRays = [], cursorDots = [];
  let currentPath = window.__BROWSE_DATA__.currentPath || '';
  let currentPage = window.__BROWSE_DATA__.page || 1;
  let totalPages = window.__BROWSE_DATA__.totalPages || 1;
  let cardMeshes = [], navButtons = [];
  let grabState = null;
  let activeGrabSources = new Set();

  // Viewer state
  let viewerMode = false;
  let viewerSphere = null;
  let viewerHUD = null;
  let viewerVideo = null;
  let viewerItem = null;
  let hudTimer = null;
  let hudVisible = true;
  let passthroughActive = false;
  let progressMesh = null;
  let pollInterval = null;
  let envSphere = null;
  let isTogglingPassthrough = false;
  let sphereDragState = null;
  let viewerPassthrough = false; // separate from browse passthrough — only set by viewer HUD toggle

  // Side panel state
  let sidePanelButtons = [];
  let rootFolders = [];

  // Layout
  const COLS = 4, ROWS = 3;
  const CARD_W = 0.28, CARD_H = 0.22, GAP = 0.03;
  const PANEL_W = COLS * (CARD_W + GAP) + GAP;
  const PANEL_H = ROWS * (CARD_H + GAP) + GAP + 0.2;
  const SIDE_W = 0.38;

  const vec3 = (p) => new THREE.Vector3(p.x, p.y, p.z);
  const quat = (o) => new THREE.Quaternion(o.x, o.y, o.z, o.w);

  // Cached background texture (null = not loaded yet, false = no background.jpg found)
  let bgTexture = null;

  function createEnvSphere() {
    const envGeo = new THREE.SphereGeometry(30, 32, 16);
    envGeo.scale(-1, 1, 1);
    const mat = new THREE.MeshBasicMaterial({ color: 0x0a0a12 });
    const sphere = new THREE.Mesh(envGeo, mat);

    // Try loading background.jpg from media root
    if (bgTexture === null) {
      new THREE.TextureLoader().load('/media/background.jpg', (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        bgTexture = tex;
        mat.map = tex;
        mat.color.set(0xffffff);
        mat.needsUpdate = true;
      }, undefined, () => {
        bgTexture = false; // not found
      });
    } else if (bgTexture) {
      mat.map = bgTexture;
      mat.color.set(0xffffff);
    }

    return sphere;
  }

  // Default to passthrough (immersive-ar) if supported
  vrBtn.addEventListener('click', () => enterVR(arSupported));

  // ========================
  // VR SESSION
  // ========================
  async function enterVR(wantPassthrough) {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(70, 1, 0.01, 1100);
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;

    // Always use immersive-ar if supported — passthrough toggle is done via env sphere
    const mode = arSupported ? 'immersive-ar' : 'immersive-vr';
    passthroughActive = wantPassthrough && arSupported;

    // Always transparent background for immersive-ar
    scene.background = null;
    renderer.setClearColor(0x000000, 0);

    if (!passthroughActive) {
      envSphere = createEnvSphere();
      scene.add(envSphere);
    } else {
      envSphere = null;
    }

    try {
      xrSession = await navigator.xr.requestSession(mode, {
        requiredFeatures: ['local-floor'],
        optionalFeatures: ['hand-tracking'],
      });
      await renderer.xr.setSession(xrSession);

      createControllerVisuals();

      // Rebuild the correct mode after session start
      if (viewerMode && viewerItem) {
        await rebuildViewer(viewerItem);
      } else {
        panelGroup = new THREE.Group();
        panelGroup.position.set(0, 1.3, -2.0);
        scene.add(panelGroup);
        await loadBrowseData(currentPath, currentPage);
        await buildSidePanel();
      }

      xrSession.addEventListener('selectstart', onSelectStart);
      xrSession.addEventListener('selectend', onSelectEnd);
      xrSession.addEventListener('select', onSelect);

      renderer.setAnimationLoop((time, frame) => {
        if (frame) updateFrame(frame);
        renderer.render(scene, camera);
      });

      // Hide 2D page
      vrBtn.style.display = 'none';
      document.querySelector('header').style.display = 'none';
      document.querySelector('main').style.display = 'none';

      xrSession.addEventListener('end', onSessionEnd);
    } catch (e) {
      console.error('VR browse failed:', e);
      if (renderer) renderer.dispose();
    }
  }

  function onSessionEnd() {
    if (isTogglingPassthrough) return;
    renderer.setAnimationLoop(null);
    renderer.dispose();
    controllerRays.forEach(r => { if (r.parent) r.parent.remove(r); });
    cursorDots.forEach(d => { if (d.parent) d.parent.remove(d); });
    controllerRays = []; cursorDots = [];
    activeGrabSources.clear();
    grabState = null;
    xrSession = null;
    renderer = scene = camera = panelGroup = null;
    cardMeshes = []; navButtons = [];
    sidePanelButtons = [];
    envSphere = null;
    if (hudTimer) clearTimeout(hudTimer);

    // Clean up viewer resources
    cleanupViewerResources();
    viewerMode = false;
    viewerItem = null;
    passthroughActive = false;

    vrBtn.style.display = 'block';
    document.querySelector('header').style.display = '';
    document.querySelector('main').style.display = '';
  }

  function cleanupViewerResources() {
    if (viewerSphere) {
      if (viewerSphere.material.map) viewerSphere.material.map.dispose();
      viewerSphere.material.dispose();
      viewerSphere.geometry.dispose();
      viewerSphere = null;
    }
    if (viewerVideo) {
      viewerVideo.pause();
      viewerVideo.removeAttribute('src');
      viewerVideo.load();
      viewerVideo.remove();
      viewerVideo = null;
    }
    if (viewerHUD) {
      viewerHUD.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (obj.material.map) obj.material.map.dispose();
          obj.material.dispose();
        }
      });
      viewerHUD = null;
    }
    if (progressMesh) {
      if (progressMesh.parent) progressMesh.parent.remove(progressMesh);
      if (progressMesh.material.map) progressMesh.material.map.dispose();
      progressMesh.material.dispose();
      progressMesh.geometry.dispose();
      progressMesh = null;
    }
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
  }

  // ========================
  // SIDE PANEL (Settings + Folders)
  // ========================
  async function buildSidePanel() {
    sidePanelButtons = [];

    // Fetch root folders if not cached
    if (rootFolders.length === 0) {
      try {
        const data = await (await fetch('/api/browse')).json();
        rootFolders = data.items.filter(i => i.type === 'folder');
      } catch (e) {
        console.error('Failed to load root folders:', e);
      }
    }

    const sideGroup = new THREE.Group();
    // Position to the left of main panel
    sideGroup.position.set(-PANEL_W / 2 - GAP * 2 - SIDE_W / 2, 0, 0);

    const totalH = PANEL_H + 0.04;

    // Background — frosted glass style
    sideGroup.add(new THREE.Mesh(
      new THREE.PlaneGeometry(SIDE_W + 0.04, totalH),
      new THREE.MeshBasicMaterial({ color: 0x1a1a24, transparent: true, opacity: 0.88, side: THREE.DoubleSide })
    ));
    const border = new THREE.Mesh(
      new THREE.PlaneGeometry(SIDE_W + 0.05, totalH + 0.01),
      new THREE.MeshBasicMaterial({ color: 0x333344, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
    );
    border.position.z = -0.001;
    sideGroup.add(border);

    let yPos = totalH / 2 - 0.06;

    // --- Settings header ---
    sideGroup.add(textLabel('Settings', 0, yPos, SIDE_W - 0.04, 0.05, '#4fc3f7', 18));
    yPos -= 0.07;

    // Passthrough toggle
    const ptLabel = passthroughActive ? 'Passthrough: ON' : 'Passthrough: OFF';
    const ptBtn = sideTextButton(ptLabel, 0, yPos, SIDE_W - 0.06, 0.055);
    ptBtn.userData.sideAction = 'togglePassthrough';
    sideGroup.add(ptBtn);
    sidePanelButtons.push(ptBtn);
    yPos -= 0.09;

    // --- Folders header ---
    sideGroup.add(textLabel('Folders', 0, yPos, SIDE_W - 0.04, 0.05, '#4fc3f7', 18));
    yPos -= 0.06;

    // Home button
    const homeBtn = sideTextButton('Home', 0, yPos, SIDE_W - 0.06, 0.045);
    homeBtn.userData.sideAction = 'navigateFolder';
    homeBtn.userData.folderPath = '';
    sideGroup.add(homeBtn);
    sidePanelButtons.push(homeBtn);
    yPos -= 0.055;

    // Root folder buttons
    for (const folder of rootFolders) {
      if (yPos < -totalH / 2 + 0.04) break; // Don't overflow
      const btn = sideTextButton(folder.name, 0, yPos, SIDE_W - 0.06, 0.045);
      btn.userData.sideAction = 'navigateFolder';
      btn.userData.folderPath = folder.browsePath;
      sideGroup.add(btn);
      sidePanelButtons.push(btn);
      yPos -= 0.055;
    }

    // Exit button at bottom of sidebar
    const exitY = -totalH / 2 + 0.04;
    const exitBtn = sideTextButton('Exit VR', 0, exitY, SIDE_W - 0.06, 0.055);
    exitBtn.userData.sideAction = 'exit';
    sideGroup.add(exitBtn);
    sidePanelButtons.push(exitBtn);

    // Add as child of panelGroup so it moves together
    panelGroup.add(sideGroup);
  }

  function sideTextButton(text, x, y, w, h) {
    const s = 3;
    const c = document.createElement('canvas');
    c.width = Math.round(w * 512 * s);
    c.height = Math.round(h * 512 * s);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#1e1e28';
    ctx.beginPath();
    ctx.roundRect(4, 4, c.width - 8, c.height - 8, 8 * s);
    ctx.fill();
    ctx.fillStyle = '#d0d0d0';
    ctx.font = `${13 * s}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, c.width / 2, c.height / 2);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true })
    );
    mesh.position.set(x, y, 0.004);
    mesh.userData.isSideButton = true;
    return mesh;
  }

  // ========================
  // INLINE VIEWER
  // ========================
  async function openMedia(item) {
    const relPath = item.relPath;
    const mediaType = item.mediaType;

    try {
      const resp = await fetch(`/api/stitch-status/${relPath}`);
      const data = await resp.json();

      if (data.status === 'converting') {
        panelGroup.visible = false;
        showProgress(data.progress || 0);
        pollInterval = setInterval(async () => {
          try {
            const r = await fetch(`/api/stitch-status/${relPath}`);
            const d = await r.json();
            updateProgress(d.progress || 0);
            if (d.status === 'ready') {
              clearInterval(pollInterval);
              pollInterval = null;
              if (progressMesh && progressMesh.parent) progressMesh.parent.remove(progressMesh);
              progressMesh = null;
              await loadMediaIntoViewer(relPath, mediaType);
            }
          } catch (e) { console.error('Poll error:', e); }
        }, 2000);
      } else {
        panelGroup.visible = false;
        await loadMediaIntoViewer(relPath, mediaType);
      }

      viewerMode = true;
      viewerItem = item;
    } catch (e) {
      console.error('Failed to open media:', e);
    }
  }

  async function loadMediaIntoViewer(relPath, mediaType) {
    const mediaUrl = `/media/${relPath}`;

    const geo = new THREE.SphereGeometry(500, 64, 32);
    geo.scale(-1, 1, 1);

    if (mediaType === 'video') {
      viewerVideo = document.createElement('video');
      viewerVideo.crossOrigin = 'anonymous';
      viewerVideo.playsInline = true;
      viewerVideo.src = mediaUrl;
      viewerVideo.style.display = 'none';
      document.body.appendChild(viewerVideo);

      const texture = new THREE.VideoTexture(viewerVideo);
      texture.colorSpace = THREE.SRGBColorSpace;
      viewerSphere = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: texture }));
    } else {
      const texture = await new Promise((resolve, reject) => {
        new THREE.TextureLoader().load(mediaUrl, resolve, undefined, reject);
      });
      texture.colorSpace = THREE.SRGBColorSpace;
      viewerSphere = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: texture }));
    }

    if (viewerPassthrough) {
      viewerSphere.visible = false;
    }

    // Hide environment sphere so it doesn't block the viewer sphere
    if (envSphere) envSphere.visible = false;

    scene.add(viewerSphere);

    // Create viewer HUD
    viewerHUD = createViewerHUD(mediaType === 'video');
    scene.add(viewerHUD);
    showHUDTemporarily();

    if (mediaType === 'video') {
      viewerVideo.play().catch(() => {});
    }
  }

  async function rebuildViewer(item) {
    await loadMediaIntoViewer(item.relPath, item.mediaType);
    if (viewerPassthrough && viewerSphere) {
      viewerSphere.visible = false;
    }
  }

  function closeMedia() {
    if (viewerSphere && scene) scene.remove(viewerSphere);
    if (viewerHUD && scene) scene.remove(viewerHUD);
    cleanupViewerResources();

    viewerMode = false;
    viewerItem = null;
    viewerPassthrough = false;
    if (hudTimer) { clearTimeout(hudTimer); hudTimer = null; }

    // Restore environment sphere
    if (envSphere) envSphere.visible = true;

    // Show browse panel again
    if (!panelGroup) {
      panelGroup = new THREE.Group();
      panelGroup.position.set(0, 1.3, -2.0);
      scene.add(panelGroup);
      loadBrowseData(currentPath, currentPage);
      buildSidePanel();
    } else {
      panelGroup.visible = true;
    }
  }

  // --- Progress display ---
  function showProgress(pct) {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 128;
    drawProgressCanvas(c, pct);
    progressMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1.0, 0.25),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true })
    );
    progressMesh.position.set(0, 1.3, -2.0);
    scene.add(progressMesh);
  }

  function updateProgress(pct) {
    if (!progressMesh) return;
    const c = document.createElement('canvas');
    c.width = 512; c.height = 128;
    drawProgressCanvas(c, pct);
    if (progressMesh.material.map) progressMesh.material.map.dispose();
    progressMesh.material.map = new THREE.CanvasTexture(c);
  }

  function drawProgressCanvas(canvas, pct) {
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#111115';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#e0e0e0';
    ctx.font = 'bold 28px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`Converting... ${Math.round(pct)}%`, canvas.width / 2, 40);
    ctx.fillStyle = '#333';
    ctx.fillRect(50, 75, canvas.width - 100, 20);
    ctx.fillStyle = '#4fc3f7';
    ctx.fillRect(50, 75, (canvas.width - 100) * (pct / 100), 20);
  }

  // ========================
  // VIEWER HUD
  // ========================
  function createViewerHUD(isVideo) {
    const group = new THREE.Group();
    group.position.set(0, 0.8, -1.5);

    const panelW = isVideo ? 1.0 : 0.7;
    group.add(new THREE.Mesh(
      new THREE.PlaneGeometry(panelW, 0.15),
      new THREE.MeshBasicMaterial({ color: 0x1a1a24, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
    ));

    // Bottom grab handle — Quest-style white pill
    const handle = createPillHandle(0.14, 0.016);
    handle.position.set(0, -0.11, 0.005);
    group.add(handle);

    const buttonData = [];
    buttonData.push({ label: 'Back', x: -panelW / 2 + 0.1, action: 'back' });
    if (isVideo) {
      buttonData.push({ label: 'Play', x: -0.14, action: 'play' });
      buttonData.push({ label: '<< 10s', x: -0.01, action: 'rewind' });
      buttonData.push({ label: '10s >>', x: 0.12, action: 'forward' });
    }
    if (arSupported) {
      buttonData.push({ label: 'Passthrough', x: isVideo ? 0.28 : 0.05, action: 'passthrough' });
    }
    buttonData.push({ label: 'Exit', x: panelW / 2 - 0.1, action: 'exit' });

    const buttons = [];
    for (const bd of buttonData) {
      const btn = createCanvasButton(bd.label, bd.x);
      btn.userData.action = bd.action;
      btn.userData.label = bd.label;
      group.add(btn);
      buttons.push(btn);
    }

    if (isVideo) {
      const barBg = new THREE.Mesh(
        new THREE.PlaneGeometry(0.8, 0.015),
        new THREE.MeshBasicMaterial({ color: 0x333333 })
      );
      barBg.position.set(0, -0.045, 0.001);
      group.add(barBg);

      const barFill = new THREE.Mesh(
        new THREE.PlaneGeometry(0.8, 0.015),
        new THREE.MeshBasicMaterial({ color: 0x4fc3f7 })
      );
      barFill.position.set(0, -0.045, 0.002);
      barFill.scale.x = 0.01;
      barFill.userData.isSeekBar = true;
      group.add(barFill);
    }

    group.userData.buttons = buttons;
    return group;
  }

  function createCanvasButton(label, x) {
    const canvas = document.createElement('canvas');
    canvas.width = 160; canvas.height = 48;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#333';
    ctx.beginPath(); ctx.roundRect(2, 2, 156, 44, 8); ctx.fill();
    ctx.fillStyle = '#e0e0e0';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, 80, 24);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.14, 0.05),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true })
    );
    mesh.position.set(x, 0, 0.005);
    return mesh;
  }

  function updateCanvasButton(btn, label) {
    const canvas = document.createElement('canvas');
    canvas.width = 160; canvas.height = 48;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#333';
    ctx.beginPath(); ctx.roundRect(2, 2, 156, 44, 8); ctx.fill();
    ctx.fillStyle = '#e0e0e0';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, 80, 24);
    if (btn.material.map) btn.material.map.dispose();
    btn.material.map = new THREE.CanvasTexture(canvas);
    btn.userData.label = label;
  }

  // --- HUD auto-hide ---
  function showHUDTemporarily() {
    if (!viewerHUD) return;
    viewerHUD.visible = true;
    hudVisible = true;
    if (hudTimer) clearTimeout(hudTimer);
    hudTimer = setTimeout(() => {
      if (viewerHUD) { viewerHUD.visible = false; hudVisible = false; }
    }, 5000);
  }

  function toggleViewerHUD() {
    if (!viewerHUD) return;
    if (viewerHUD.visible) {
      viewerHUD.visible = false;
      hudVisible = false;
      if (hudTimer) clearTimeout(hudTimer);
    } else {
      showHUDTemporarily();
    }
  }

  // --- Viewer actions ---
  function handleViewerAction(action, btn) {
    switch (action) {
      case 'back':
        closeMedia();
        break;
      case 'play':
        if (viewerVideo) {
          if (viewerVideo.paused) {
            viewerVideo.play();
            updateCanvasButton(btn, 'Pause');
          } else {
            viewerVideo.pause();
            updateCanvasButton(btn, 'Play');
          }
        }
        showHUDTemporarily();
        break;
      case 'rewind':
        if (viewerVideo) viewerVideo.currentTime = Math.max(0, viewerVideo.currentTime - 10);
        showHUDTemporarily();
        break;
      case 'forward':
        if (viewerVideo) viewerVideo.currentTime = Math.min(viewerVideo.duration, viewerVideo.currentTime + 10);
        showHUDTemporarily();
        break;
      case 'passthrough':
        togglePassthrough();
        break;
      case 'exit':
        if (xrSession) xrSession.end();
        break;
    }
  }

  // --- Side panel actions ---
  function handleSideAction(action, btn) {
    switch (action) {
      case 'togglePassthrough':
        togglePassthrough();
        break;
      case 'navigateFolder':
        loadBrowseData(btn.userData.folderPath, 1);
        break;
      case 'exit':
        if (xrSession) xrSession.end();
        break;
    }
  }

  // --- Passthrough toggle (instant — no session restart) ---
  function togglePassthrough() {
    passthroughActive = !passthroughActive;

    if (viewerMode) {
      // In viewer mode: toggle sphere visibility
      viewerPassthrough = !viewerPassthrough;
      if (viewerSphere) viewerSphere.visible = !viewerPassthrough;
    }

    if (passthroughActive) {
      // Remove dark env sphere — passthrough shows through
      if (envSphere) {
        scene.remove(envSphere);
        envSphere.geometry.dispose();
        envSphere.material.dispose();
        envSphere = null;
      }
    } else {
      // Add env sphere to cover passthrough
      if (!envSphere) {
        envSphere = createEnvSphere();
        scene.add(envSphere);
      }
      // Hide env sphere if viewing 360° content (viewer sphere covers everything)
      if (viewerMode && viewerSphere && viewerSphere.visible) {
        envSphere.visible = false;
      }
    }

    // Update sidebar toggle button label
    updatePassthroughButtonLabel();
  }

  function updatePassthroughButtonLabel() {
    const ptBtn = sidePanelButtons.find(b => b.userData.sideAction === 'togglePassthrough');
    if (ptBtn) {
      updateCanvasButton(ptBtn, passthroughActive ? 'Passthrough: ON' : 'Passthrough: OFF');
    }
  }

  // ========================
  // BROWSE API
  // ========================
  async function loadBrowseData(path, page) {
    const url = path ? `/api/browse/${path}?page=${page}` : `/api/browse?page=${page}`;
    const data = await (await fetch(url)).json();
    currentPath = data.currentPath;
    currentPage = data.page;
    totalPages = data.totalPages;
    rebuildPanel(data.items);
  }

  // ========================
  // BROWSE PANEL
  // ========================
  function rebuildPanel(items) {
    // Remove only non-side-panel children (keep side panel)
    const toRemove = [];
    panelGroup.children.forEach(c => {
      // Side panel group has no userData.isMainPanel, but we can't tag it yet
      // Instead, rebuild by removing all children and re-adding side panel
    });
    // Actually: just clear everything and rebuild side panel too
    while (panelGroup.children.length) {
      const c = panelGroup.children[0];
      panelGroup.remove(c);
      c.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (obj.material.map) obj.material.map.dispose();
          obj.material.dispose();
        }
      });
    }
    cardMeshes = [];
    navButtons = [];
    sidePanelButtons = [];

    // Background — frosted glass style
    const bg = new THREE.Mesh(
      new THREE.PlaneGeometry(PANEL_W + 0.04, PANEL_H + 0.04),
      new THREE.MeshBasicMaterial({ color: 0x1a1a24, transparent: true, opacity: 0.88, side: THREE.DoubleSide })
    );
    panelGroup.add(bg);

    const border = new THREE.Mesh(
      new THREE.PlaneGeometry(PANEL_W + 0.05, PANEL_H + 0.05),
      new THREE.MeshBasicMaterial({ color: 0x333344, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
    );
    border.position.z = -0.001;
    panelGroup.add(border);

    // Bottom grab handle — Quest-style white pill
    const handle = createPillHandle(0.18, 0.018);
    handle.position.set(0, -PANEL_H / 2 - 0.055, 0.005);
    panelGroup.add(handle);

    const headerY = PANEL_H / 2 - 0.06;

    // Back button
    if (currentPath) {
      const btn = textButton('< Back', -PANEL_W / 2 + 0.13, headerY, 0.2, 0.06);
      btn.userData.navAction = 'back';
      panelGroup.add(btn);
      navButtons.push(btn);
    }

    // Path title
    panelGroup.add(textLabel(currentPath || 'Home', 0.05, headerY, PANEL_W * 0.55, 0.06, '#4fc3f7', 20));

    // Cards grid
    const gridStartX = -((COLS - 1) * (CARD_W + GAP)) / 2;
    const gridStartY = headerY - 0.13;

    for (let i = 0; i < items.length && i < COLS * ROWS; i++) {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const x = gridStartX + col * (CARD_W + GAP);
      const y = gridStartY - row * (CARD_H + GAP);
      const card = buildCard(items[i], x, y);
      panelGroup.add(card);
      cardMeshes.push(card);
    }

    // Pagination footer
    const footerY = -PANEL_H / 2 + 0.06;
    if (currentPage > 1) {
      const btn = textButton('< Prev', -0.22, footerY, 0.16, 0.05);
      btn.userData.navAction = 'prev';
      panelGroup.add(btn);
      navButtons.push(btn);
    }
    panelGroup.add(textLabel(`Page ${currentPage} / ${totalPages}`, 0, footerY, 0.28, 0.05, '#666', 15));
    if (currentPage < totalPages) {
      const btn = textButton('Next >', 0.22, footerY, 0.16, 0.05);
      btn.userData.navAction = 'next';
      panelGroup.add(btn);
      navButtons.push(btn);
    }

    // Rebuild side panel
    buildSidePanel();
  }

  function buildCard(item, x, y) {
    const group = new THREE.Group();
    group.position.set(x, y, 0.004);

    group.add(new THREE.Mesh(
      new THREE.PlaneGeometry(CARD_W, CARD_H),
      new THREE.MeshBasicMaterial({ color: 0x1a1a22 })
    ));

    const thumbH = CARD_H - 0.045;
    const thumbY = 0.022;

    if (item.type === 'folder') {
      const c = document.createElement('canvas');
      c.width = 160; c.height = 160;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#1a1a22';
      ctx.fillRect(0, 0, 160, 160);
      ctx.fillStyle = '#4fc3f7';
      ctx.beginPath();
      ctx.moveTo(30, 50); ctx.lineTo(70, 50); ctx.lineTo(78, 40); ctx.lineTo(30, 40);
      ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.roundRect(22, 50, 116, 70, 6); ctx.fill();
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(CARD_W - 0.02, thumbH),
        new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c) })
      );
      mesh.position.set(0, thumbY, 0.001);
      group.add(mesh);
    } else {
      const thumbMat = new THREE.MeshBasicMaterial({ color: 0x222228 });
      const thumb = new THREE.Mesh(new THREE.PlaneGeometry(CARD_W - 0.02, thumbH), thumbMat);
      thumb.position.set(0, thumbY, 0.001);
      group.add(thumb);

      if (item.thumbUrl) {
        new THREE.TextureLoader().load(item.thumbUrl, tex => {
          tex.colorSpace = THREE.SRGBColorSpace;
          thumbMat.dispose();
          thumb.material = new THREE.MeshBasicMaterial({ map: tex });
        });
      }

      if (item.mediaType === 'video') {
        const bc = document.createElement('canvas');
        bc.width = 48; bc.height = 48;
        const bx = bc.getContext('2d');
        bx.fillStyle = 'rgba(0,0,0,0.7)';
        bx.beginPath(); bx.arc(24, 24, 20, 0, Math.PI * 2); bx.fill();
        bx.fillStyle = '#fff';
        bx.beginPath(); bx.moveTo(18, 12); bx.lineTo(18, 36); bx.lineTo(36, 24); bx.closePath(); bx.fill();
        const badge = new THREE.Mesh(
          new THREE.PlaneGeometry(0.04, 0.04),
          new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(bc), transparent: true })
        );
        badge.position.set(CARD_W / 2 - 0.035, thumbY - thumbH / 2 + 0.035, 0.002);
        group.add(badge);
      }
    }

    const name = item.name.length > 26 ? item.name.substring(0, 24) + '..' : item.name;
    group.add(textLabel(name, 0, -CARD_H / 2 + 0.018, CARD_W - 0.01, 0.035, '#999', 12));

    group.userData.item = item;
    group.userData.isCard = true;
    return group;
  }

  // ========================
  // Quest-style pill grab handle
  // ========================
  function createPillHandle(width, height) {
    // White rounded pill shape using canvas texture
    const s = 4;
    const c = document.createElement('canvas');
    c.width = Math.round(width * 512 * s);
    c.height = Math.round(height * 512 * s);
    const ctx = c.getContext('2d');
    const r = c.height / 2;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.beginPath();
    ctx.roundRect(4, 4, c.width - 8, c.height - 8, r);
    ctx.fill();
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(width, height),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true })
    );
    mesh.userData.isHandle = true;
    return mesh;
  }

  // ========================
  // TEXT HELPERS
  // ========================
  function textLabel(text, x, y, w, h, color, fontSize) {
    const s = 3;
    const c = document.createElement('canvas');
    c.width = Math.round(w * 512 * s); c.height = Math.round(h * 512 * s);
    const ctx = c.getContext('2d');
    ctx.fillStyle = color || '#fff';
    ctx.font = `${(fontSize || 16) * s}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, c.width / 2, c.height / 2);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true })
    );
    mesh.position.set(x, y, 0.003);
    return mesh;
  }

  function textButton(text, x, y, w, h) {
    const s = 3;
    const c = document.createElement('canvas');
    c.width = Math.round(w * 512 * s); c.height = Math.round(h * 512 * s);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#282833';
    ctx.beginPath(); ctx.roundRect(4, 4, c.width - 8, c.height - 8, 10 * s); ctx.fill();
    ctx.fillStyle = '#4fc3f7';
    ctx.font = `bold ${14 * s}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, c.width / 2, c.height / 2);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true })
    );
    mesh.position.set(x, y, 0.004);
    mesh.userData.isButton = true;
    return mesh;
  }

  // ========================
  // CONTROLLER VISUALS
  // ========================
  function createControllerVisuals() {
    for (let i = 0; i < 2; i++) {
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -4)]),
        new THREE.LineBasicMaterial({ color: 0x4fc3f7, transparent: true, opacity: 0.5 })
      );
      line.visible = false;
      scene.add(line);
      controllerRays.push(line);

      const dot = new THREE.Mesh(
        new THREE.RingGeometry(0.006, 0.013, 24),
        new THREE.MeshBasicMaterial({ color: 0x4fc3f7, side: THREE.DoubleSide })
      );
      dot.visible = false;
      scene.add(dot);
      cursorDots.push(dot);
    }
  }

  function getRay(source, frame) {
    if (!source.targetRaySpace) return null;
    const refSpace = renderer.xr.getReferenceSpace();
    const pose = frame.getPose(source.targetRaySpace, refSpace);
    if (!pose) return null;
    return {
      origin: vec3(pose.transform.position),
      direction: new THREE.Vector3(0, 0, -1).applyQuaternion(quat(pose.transform.orientation)),
      pose,
    };
  }

  // ========================
  // SELECT / GRAB (trigger + pinch)
  // ========================

  function onSelectStart(e) {
    if (viewerMode) showHUDTemporarily();

    const ray = getRay(e.inputSource, e.frame);
    if (!ray) return;

    // Get camera (headset) position for orbit grab
    const camPos = camera.position.clone();
    renderer.xr.getCamera(camera);
    camPos.copy(camera.position);

    // In viewer mode: check HUD handle first, then sphere drag
    if (viewerMode) {
      // Check HUD handle grab
      if (viewerHUD && viewerHUD.visible) {
        const rc = new THREE.Raycaster(ray.origin, ray.direction, 0, 5);
        const handleMeshes = [];
        viewerHUD.traverse(c => { if (c.userData.isHandle) handleMeshes.push(c); });
        const hh = rc.intersectObjects(handleMeshes);
        if (hh.length > 0) {
          activeGrabSources.add(e.inputSource);
          const toPanel = viewerHUD.position.clone().sub(camPos);
          grabState = {
            source: e.inputSource, target: viewerHUD,
            initialRayDir: ray.direction.clone(),
            initialPanelDir: toPanel.clone().normalize(),
            panelDist: toPanel.length(),
            initialControllerDist: ray.origin.distanceTo(camPos),
          };
          return;
        }

        // Check if hitting a HUD button — don't start sphere drag
        const btnHits = rc.intersectObjects(viewerHUD.userData.buttons);
        if (btnHits.length > 0) return;
      }

      // Start sphere drag — trigger/pinch on the sphere rotates it
      if (viewerSphere && viewerSphere.visible) {
        sphereDragState = {
          source: e.inputSource,
          lastDir: ray.direction.clone(),
        };
        activeGrabSources.add(e.inputSource);
      }
      return;
    }

    // Browse mode: check panel handle grab
    if (!panelGroup || !panelGroup.visible) return;

    const rc = new THREE.Raycaster(ray.origin, ray.direction, 0, 5);
    const handleMeshes = [];
    panelGroup.traverse(c => { if (c.userData.isHandle) handleMeshes.push(c); });
    const hh = rc.intersectObjects(handleMeshes);

    if (hh.length > 0) {
      activeGrabSources.add(e.inputSource);
      const toPanel = panelGroup.position.clone().sub(camPos);
      grabState = {
        source: e.inputSource, target: panelGroup,
        initialRayDir: ray.direction.clone(),
        initialPanelDir: toPanel.clone().normalize(),
        panelDist: toPanel.length(),
        initialControllerDist: ray.origin.distanceTo(camPos),
      };
    }
  }

  function onSelectEnd(e) {
    if (grabState && grabState.source === e.inputSource) {
      grabState = null;
    }
    if (sphereDragState && sphereDragState.source === e.inputSource) {
      sphereDragState = null;
    }
    activeGrabSources.delete(e.inputSource);
  }

  function onSelect(e) {
    // If this trigger press was used for grabbing, don't fire a click
    if (activeGrabSources.has(e.inputSource)) return;

    const ray = getRay(e.inputSource, e.frame);
    if (!ray) return;
    const rc = new THREE.Raycaster(ray.origin, ray.direction, 0, 5);

    if (viewerMode) {
      // --- Viewer mode clicks ---
      if (viewerHUD && viewerHUD.visible) {
        const hits = rc.intersectObjects(viewerHUD.userData.buttons);
        if (hits.length > 0) {
          handleViewerAction(hits[0].object.userData.action, hits[0].object);
          return;
        }
      }
      toggleViewerHUD();
      return;
    }

    // --- Browse mode clicks ---
    if (!panelGroup || !panelGroup.visible) return;

    // Side panel buttons
    const sideHits = rc.intersectObjects(sidePanelButtons, true);
    if (sideHits.length > 0) {
      const btn = sideHits[0].object;
      if (btn.userData.sideAction) {
        handleSideAction(btn.userData.sideAction, btn);
        return;
      }
    }

    // Nav buttons
    const navHits = rc.intersectObjects(navButtons);
    if (navHits.length > 0) {
      const act = navHits[0].object.userData.navAction;
      if (act === 'back') {
        const parts = currentPath.split('/').filter(Boolean);
        parts.pop();
        loadBrowseData(parts.join('/'), 1);
      } else if (act === 'prev') loadBrowseData(currentPath, currentPage - 1);
      else if (act === 'next') loadBrowseData(currentPath, currentPage + 1);
      return;
    }

    // Card clicks
    const cardChildren = [];
    cardMeshes.forEach(card => card.traverse(ch => {
      if (ch.isMesh) { ch.userData._parentCard = card; cardChildren.push(ch); }
    }));
    const cardHits = rc.intersectObjects(cardChildren);
    if (cardHits.length > 0) {
      const card = cardHits[0].object.userData._parentCard;
      if (!card?.userData.item) return;
      const item = card.userData.item;
      if (item.type === 'folder') {
        loadBrowseData(item.browsePath, 1);
      } else if (item.viewUrl) {
        openMedia(item);
      }
    }
  }

  // ========================
  // PER-FRAME UPDATE
  // ========================
  function updateFrame(frame) {
    const refSpace = renderer.xr.getReferenceSpace();

    // Update video seek bar
    if (viewerMode && viewerHUD && viewerVideo) {
      const seekBar = viewerHUD.children.find(c => c.userData.isSeekBar);
      if (seekBar && viewerVideo.duration) {
        seekBar.scale.x = Math.max(0.01, viewerVideo.currentTime / viewerVideo.duration);
        seekBar.position.x = -0.4 + (seekBar.scale.x * 0.4);
      }
    }

    let rayIdx = 0;
    for (const source of xrSession.inputSources) {
      if (source.targetRayMode !== 'tracked-pointer' && source.targetRayMode !== 'transient-pointer') continue;
      const ray = getRay(source, frame);
      if (!ray) continue;

      // --- Thumbstick rotation (viewer mode only) ---
      if (viewerMode && viewerSphere && viewerSphere.visible && source.gamepad && source.gamepad.axes.length >= 4) {
        const thumbX = source.gamepad.axes[2];
        const thumbY = source.gamepad.axes[3];
        const deadzone = 0.15;
        if (Math.abs(thumbX) > deadzone || Math.abs(thumbY) > deadzone) {
          viewerSphere.rotation.y += thumbX * 0.02;
          viewerSphere.rotation.x += thumbY * 0.02;
          viewerSphere.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, viewerSphere.rotation.x));
        }
      }

      // --- Trigger/pinch drag to rotate sphere ---
      if (sphereDragState && sphereDragState.source === source && viewerSphere && viewerSphere.visible) {
        const curDir = ray.direction;
        const lastDir = sphereDragState.lastDir;
        // Compute angular difference between last and current ray direction
        const deltaY = Math.atan2(curDir.x, curDir.z) - Math.atan2(lastDir.x, lastDir.z);
        const deltaX = Math.asin(curDir.y) - Math.asin(lastDir.y);
        viewerSphere.rotation.y -= deltaY;
        viewerSphere.rotation.x += deltaX;
        viewerSphere.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, viewerSphere.rotation.x));
        sphereDragState.lastDir = curDir.clone();
      }

      // --- Laser ray ---
      if (rayIdx < controllerRays.length) {
        const line = controllerRays[rayIdx];
        line.visible = true;
        line.position.copy(ray.origin);
        line.quaternion.copy(quat(ray.pose.transform.orientation));

        // --- Cursor dot ---
        const dot = cursorDots[rayIdx];
        const rc = new THREE.Raycaster(ray.origin, ray.direction, 0, 5);

        // Gather raycast targets based on mode
        const targets = [];
        if (viewerMode) {
          if (viewerHUD && viewerHUD.visible) viewerHUD.traverse(ch => { if (ch.isMesh) targets.push(ch); });
          if (viewerSphere && viewerSphere.visible) targets.push(viewerSphere);
        } else {
          if (panelGroup && panelGroup.visible) panelGroup.traverse(ch => { if (ch.isMesh) targets.push(ch); });
        }

        const hits = rc.intersectObjects(targets);
        if (hits.length > 0) {
          dot.visible = true;
          dot.position.copy(hits[0].point);
          dot.lookAt(ray.origin);
        } else {
          dot.visible = true;
          dot.position.copy(ray.origin).add(ray.direction.clone().multiplyScalar(4));
          dot.lookAt(ray.origin);
        }

        // --- Hover highlight ---
        if (viewerMode) {
          if (viewerHUD && viewerHUD.visible) {
            viewerHUD.userData.buttons.forEach(b => b.scale.set(1, 1, 1));
            const btnHit = hits.find(h => h.object.userData.action);
            if (btnHit) btnHit.object.scale.set(1.15, 1.15, 1);
          }
        } else {
          cardMeshes.forEach(c => c.scale.set(1, 1, 1));
          navButtons.forEach(b => b.scale.set(1, 1, 1));
          sidePanelButtons.forEach(b => b.scale.set(1, 1, 1));

          const hoverTargets = [...navButtons, ...sidePanelButtons];
          cardMeshes.forEach(card => card.traverse(ch => {
            if (ch.isMesh) { ch.userData._parentCard = card; hoverTargets.push(ch); }
          }));
          const hoverHits = rc.intersectObjects(hoverTargets);
          if (hoverHits.length > 0) {
            const obj = hoverHits[0].object;
            if (obj.userData._parentCard) obj.userData._parentCard.scale.set(1.06, 1.06, 1);
            else if (obj.userData.isButton || obj.userData.isSideButton) obj.scale.set(1.1, 1.1, 1);
          }
        }

        rayIdx++;
      }

      // --- Grab: orbit panel around headset (Quest-style window movement) ---
      if (grabState && grabState.source === source) {
        const xrCam = renderer.xr.getCamera(camera);
        const camPos = xrCam.position.clone();

        // Controller distance from headset adjusts panel depth
        const curControllerDist = ray.origin.distanceTo(camPos);
        const distDelta = (curControllerDist - grabState.initialControllerDist) * 2.5;
        const adjustedDist = Math.max(0.5, Math.min(6, grabState.panelDist + distDelta));

        // Thumbstick Y also adjusts distance
        if (source.gamepad && source.gamepad.axes.length >= 4) {
          const thumbY = source.gamepad.axes[3];
          if (Math.abs(thumbY) > 0.15) {
            grabState.panelDist = Math.max(0.5, Math.min(6, grabState.panelDist + thumbY * 0.02));
            grabState.initialControllerDist = curControllerDist; // reset baseline
          }
        }

        // Compute rotation from initial ray direction to current ray direction
        const rotQuat = new THREE.Quaternion().setFromUnitVectors(grabState.initialRayDir, ray.direction);
        const newDir = grabState.initialPanelDir.clone().applyQuaternion(rotQuat);
        // Place panel at camera + rotated direction * adjusted distance
        grabState.target.position.copy(camPos).add(newDir.multiplyScalar(adjustedDist));
        // Face the user: only rotate around Y axis so panel stays upright
        const dx = camPos.x - grabState.target.position.x;
        const dz = camPos.z - grabState.target.position.z;
        grabState.target.rotation.set(0, Math.atan2(dx, dz), 0);
      }
    }

    for (let i = rayIdx; i < controllerRays.length; i++) {
      controllerRays[i].visible = false;
      cursorDots[i].visible = false;
    }
  }
})();
