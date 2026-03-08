// WebXR VR Mode + HUD with passthrough, thumbstick rotation, auto-hide, cursor dot
(async function() {
  const vrBtn = document.getElementById('enter-vr-viewer');
  if (!vrBtn || !navigator.xr) return;

  // Check both VR and AR support (AR needed for passthrough)
  let vrSupported = false;
  let arSupported = false;
  try {
    vrSupported = await navigator.xr.isSessionSupported('immersive-vr');
    arSupported = await navigator.xr.isSessionSupported('immersive-ar');
  } catch (e) {}

  if (!vrSupported && !arSupported) return;
  vrBtn.style.display = 'block';

  const THREE = window.THREE;
  let xrSession = null;
  let hudGroup = null;
  let grabState = null;
  let controllerRays = [];
  let cursorDots = [];
  let activeGrabSources = new Set();
  let hudVisible = true;
  let hudTimer = null;
  let passthroughActive = false;
  let viewer = null;
  let sphereDragState = null;

  // Helpers
  function vec3FromXR(p) { return new THREE.Vector3(p.x, p.y, p.z); }
  function quatFromXR(o) { return new THREE.Quaternion(o.x, o.y, o.z, o.w); }

  vrBtn.addEventListener('click', () => enterXR(false));

  async function enterXR(wantPassthrough) {
    viewer = window.currentViewer;
    if (!viewer) return;

    // End existing session if any
    if (xrSession) {
      try { await xrSession.end(); } catch (e) {}
      xrSession = null;
    }

    // Always use immersive-ar if supported — toggle passthrough via sphere visibility
    const mode = arSupported ? 'immersive-ar' : 'immersive-vr';
    passthroughActive = wantPassthrough && arSupported;

    try {
      xrSession = await navigator.xr.requestSession(mode, {
        requiredFeatures: ['local-floor'],
        optionalFeatures: ['hand-tracking'],
      });

      // Always transparent background for immersive-ar
      viewer.scene.background = null;
      viewer.renderer.setClearColor(0x000000, 0);
      // Toggle sphere visibility for passthrough
      viewer.sphere.visible = !passthroughActive;

      viewer.renderer.xr.enabled = true;
      await viewer.renderer.xr.setSession(xrSession);

      // Create HUD + controller visuals
      if (!hudGroup) {
        hudGroup = createHUD();
        viewer.scene.add(hudGroup);
      }
      hudGroup.visible = true;
      showHUDTemporarily();

      if (controllerRays.length === 0) {
        createControllerVisuals(viewer.scene);
      }

      viewer.stopAnimate();
      viewer.renderer.setAnimationLoop((time, frame) => {
        if (frame) updateFrame(frame);
        viewer.renderer.render(viewer.scene, viewer.camera);
      });

      vrBtn.style.display = 'none';

      // Input events — trigger/pinch for grab + sphere drag
      xrSession.addEventListener('selectstart', onSelectStart);
      xrSession.addEventListener('selectend', onSelectEnd);
      xrSession.addEventListener('select', onSelect);

      xrSession.addEventListener('end', () => {
        viewer.renderer.xr.enabled = false;
        viewer.renderer.setAnimationLoop(null);
        if (hudGroup) { viewer.scene.remove(hudGroup); hudGroup = null; }
        controllerRays.forEach(r => viewer.scene.remove(r));
        cursorDots.forEach(d => viewer.scene.remove(d));
        controllerRays = [];
        cursorDots = [];
        activeGrabSources.clear();
        grabState = null;
        sphereDragState = null;
        xrSession = null;
        passthroughActive = false;
        viewer.sphere.visible = true;
        vrBtn.style.display = 'block';
        viewer.animate();
        if (hudTimer) clearTimeout(hudTimer);
      });

    } catch (e) {
      console.error('Failed to enter XR:', e);
    }
  }

  function onSelectStart(e) {
    showHUDTemporarily();

    const refSpace = viewer.renderer.xr.getReferenceSpace();
    const ray = getRayFromSource(e.inputSource, e.frame, refSpace);
    if (!ray) return;

    // Get camera (headset) position for orbit grab
    const xrCam = viewer.renderer.xr.getCamera(viewer.camera);
    const camPos = xrCam.position.clone();

    // Check HUD handle grab
    if (hudGroup && hudGroup.visible) {
      const rc = new THREE.Raycaster(ray.origin, ray.direction, 0, 5);
      const handleMeshes = [];
      hudGroup.traverse(c => { if (c.userData.isHandle) handleMeshes.push(c); });
      const hh = rc.intersectObjects(handleMeshes);
      if (hh.length > 0) {
        activeGrabSources.add(e.inputSource);
        const toPanel = hudGroup.position.clone().sub(camPos);
        grabState = {
          source: e.inputSource, target: hudGroup,
          initialRayDir: ray.direction.clone(),
          initialPanelDir: toPanel.clone().normalize(),
          panelDist: toPanel.length(),
          initialControllerDist: ray.origin.distanceTo(camPos),
        };
        return;
      }

      // Don't start sphere drag if hitting a button
      const btnHits = rc.intersectObjects(hudGroup.userData.buttons);
      if (btnHits.length > 0) return;
    }

    // Start sphere drag — trigger/pinch rotates the sphere
    if (viewer.sphere.visible) {
      sphereDragState = {
        source: e.inputSource,
        lastDir: ray.direction.clone(),
      };
      activeGrabSources.add(e.inputSource);
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
    // If trigger was used for grab/drag, don't fire click
    if (activeGrabSources.has(e.inputSource)) return;
    if (!hudGroup || !viewer) return;

    const refSpace = viewer.renderer.xr.getReferenceSpace();
    const ray = getRayFromSource(e.inputSource, e.frame, refSpace);
    if (!ray) return;

    const raycaster = new THREE.Raycaster(ray.origin, ray.direction, 0, 5);

    // Check button hits only if HUD is visible
    if (hudGroup.visible) {
      const hits = raycaster.intersectObjects(hudGroup.userData.buttons);
      if (hits.length > 0) {
        handleAction(hits[0].object.userData.action, hits[0].object);
        return;
      }
    }

    // Click on empty space toggles HUD visibility
    toggleHUD();
  }

  // --- HUD auto-hide ---
  function showHUDTemporarily() {
    if (!hudGroup) return;
    hudGroup.visible = true;
    if (hudTimer) clearTimeout(hudTimer);
    hudTimer = setTimeout(() => {
      if (hudGroup) hudGroup.visible = false;
    }, 5000);
  }

  function toggleHUD() {
    if (!hudGroup) return;
    if (hudGroup.visible) {
      hudGroup.visible = false;
      if (hudTimer) clearTimeout(hudTimer);
    } else {
      showHUDTemporarily();
    }
  }

  // --- Controller visuals (ray + cursor dot) ---
  function createControllerVisuals(scene) {
    for (let i = 0; i < 2; i++) {
      // Laser ray line
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 0, -3),
      ]);
      const mat = new THREE.LineBasicMaterial({ color: 0x4fc3f7, transparent: true, opacity: 0.6 });
      const line = new THREE.Line(geo, mat);
      line.visible = false;
      scene.add(line);
      controllerRays.push(line);

      // Cursor dot at end of ray
      const dotGeo = new THREE.RingGeometry(0.005, 0.012, 24);
      const dotMat = new THREE.MeshBasicMaterial({ color: 0x4fc3f7, side: THREE.DoubleSide, transparent: true, opacity: 0.9 });
      const dot = new THREE.Mesh(dotGeo, dotMat);
      dot.visible = false;
      scene.add(dot);
      cursorDots.push(dot);
    }
  }

  function getRayFromSource(source, frame, refSpace) {
    if (!source.targetRaySpace) return null;
    const pose = frame.getPose(source.targetRaySpace, refSpace);
    if (!pose) return null;
    return {
      origin: vec3FromXR(pose.transform.position),
      direction: new THREE.Vector3(0, 0, -1).applyQuaternion(quatFromXR(pose.transform.orientation)),
      pose,
    };
  }

  // --- Per-frame update ---
  function updateFrame(frame) {
    if (!viewer) return;
    const refSpace = viewer.renderer.xr.getReferenceSpace();

    // Update video seek bar
    if (hudGroup && viewer.video) {
      const seekBar = hudGroup.children.find(c => c.userData.isSeekBar);
      if (seekBar && viewer.video.duration) {
        seekBar.scale.x = Math.max(0.01, viewer.video.currentTime / viewer.video.duration);
        seekBar.position.x = -0.35 + (seekBar.scale.x * 0.35);
      }
    }

    let rayIdx = 0;
    for (const source of xrSession.inputSources) {
      if (source.targetRayMode !== 'tracked-pointer' && source.targetRayMode !== 'transient-pointer') continue;

      const ray = getRayFromSource(source, frame, refSpace);
      if (!ray) continue;

      // --- Thumbstick rotation (axes[2]=X, axes[3]=Y on Quest controllers) ---
      if (source.gamepad && source.gamepad.axes.length >= 4 && viewer.sphere.visible) {
        const thumbX = source.gamepad.axes[2];
        const thumbY = source.gamepad.axes[3];
        const deadzone = 0.15;
        if (Math.abs(thumbX) > deadzone || Math.abs(thumbY) > deadzone) {
          // Rotate the sphere (inverse = rotates the view)
          viewer.sphere.rotation.y += thumbX * 0.02;
          viewer.sphere.rotation.x += thumbY * 0.02;
          viewer.sphere.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, viewer.sphere.rotation.x));
        }
      }

      // --- Trigger/pinch drag to rotate sphere ---
      if (sphereDragState && sphereDragState.source === source && viewer.sphere.visible) {
        const curDir = ray.direction;
        const lastDir = sphereDragState.lastDir;
        const deltaY = Math.atan2(curDir.x, curDir.z) - Math.atan2(lastDir.x, lastDir.z);
        const deltaX = Math.asin(curDir.y) - Math.asin(lastDir.y);
        viewer.sphere.rotation.y -= deltaY;
        viewer.sphere.rotation.x += deltaX;
        viewer.sphere.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, viewer.sphere.rotation.x));
        sphereDragState.lastDir = curDir.clone();
      }

      // --- Update laser ray ---
      if (rayIdx < controllerRays.length) {
        const line = controllerRays[rayIdx];
        line.visible = true;
        line.position.copy(ray.origin);
        line.quaternion.copy(quatFromXR(ray.pose.transform.orientation));

        // --- Cursor dot: raycast to find intersection ---
        const dot = cursorDots[rayIdx];
        const raycaster = new THREE.Raycaster(ray.origin, ray.direction, 0, 5);

        // Gather all hittable objects
        const targets = [];
        if (hudGroup && hudGroup.visible) {
          targets.push(...hudGroup.children);
        }
        if (viewer.sphere.visible) {
          targets.push(viewer.sphere);
        }

        const hits = raycaster.intersectObjects(targets);
        if (hits.length > 0) {
          dot.visible = true;
          dot.position.copy(hits[0].point);
          // Orient dot to face the ray origin
          dot.lookAt(ray.origin);

          // Highlight button if hovering
          if (hudGroup && hudGroup.visible) {
            const btnHit = hits.find(h => h.object.userData.action);
            hudGroup.userData.buttons.forEach(b => {
              b.scale.set(1, 1, 1);
            });
            if (btnHit) {
              btnHit.object.scale.set(1.15, 1.15, 1);
            }
          }
        } else {
          dot.visible = false;
          // Fallback: place dot at max ray distance
          dot.visible = true;
          dot.position.copy(ray.origin).add(ray.direction.clone().multiplyScalar(3));
          dot.lookAt(ray.origin);
        }

        rayIdx++;
      }

      // --- Grab: orbit HUD around headset (Quest-style window movement) ---
      if (grabState && grabState.source === source) {
        const xrCam = viewer.renderer.xr.getCamera(viewer.camera);
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
            grabState.initialControllerDist = curControllerDist;
          }
        }

        const rotQuat = new THREE.Quaternion().setFromUnitVectors(grabState.initialRayDir, ray.direction);
        const newDir = grabState.initialPanelDir.clone().applyQuaternion(rotQuat);
        grabState.target.position.copy(camPos).add(newDir.multiplyScalar(adjustedDist));
        const dx = camPos.x - grabState.target.position.x;
        const dz = camPos.z - grabState.target.position.z;
        grabState.target.rotation.set(0, Math.atan2(dx, dz), 0);
      }
    }

    // Hide unused rays/dots
    for (let i = rayIdx; i < controllerRays.length; i++) {
      controllerRays[i].visible = false;
      cursorDots[i].visible = false;
    }
  }

  // --- Quest-style pill grab handle ---
  function createPillHandle(width, height) {
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

  // --- HUD creation ---
  function createHUD() {
    const group = new THREE.Group();
    group.position.set(0, 0.8, -1.5);

    // Background panel — frosted glass style
    const panelGeo = new THREE.PlaneGeometry(0.9, 0.15);
    const panelMat = new THREE.MeshBasicMaterial({ color: 0x1a1a24, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
    group.add(new THREE.Mesh(panelGeo, panelMat));

    // Bottom grab handle — Quest-style white pill
    const handle = createPillHandle(0.14, 0.016);
    handle.position.set(0, -0.11, 0.005);
    group.add(handle);

    // Buttons
    const buttonData = [];
    if (viewer.video) {
      buttonData.push({ label: 'Play', x: -0.3, action: 'play' });
      buttonData.push({ label: '<< 10s', x: -0.18, action: 'rewind' });
      buttonData.push({ label: '10s >>', x: -0.06, action: 'forward' });
    }
    if (arSupported) {
      buttonData.push({ label: 'Passthrough', x: 0.12, action: 'passthrough' });
    }
    buttonData.push({ label: 'Exit', x: 0.35, action: 'exit' });

    const buttons = [];
    for (const bd of buttonData) {
      const btn = createButton(bd.label, bd.x);
      btn.userData.action = bd.action;
      btn.userData.label = bd.label;
      group.add(btn);
      buttons.push(btn);
    }

    // Seek bar for video
    if (viewer.video) {
      const barBg = new THREE.Mesh(
        new THREE.PlaneGeometry(0.7, 0.015),
        new THREE.MeshBasicMaterial({ color: 0x333333 })
      );
      barBg.position.set(0, -0.045, 0.001);
      group.add(barBg);

      const barFill = new THREE.Mesh(
        new THREE.PlaneGeometry(0.7, 0.015),
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

  function createButton(label, x) {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 48;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#333';
    ctx.beginPath();
    ctx.roundRect(2, 2, 156, 44, 8);
    ctx.fill();
    ctx.fillStyle = '#e0e0e0';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 80, 24);

    const texture = new THREE.CanvasTexture(canvas);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.14, 0.05),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true })
    );
    mesh.position.set(x, 0, 0.005);
    return mesh;
  }

  function updateButton(btn, label) {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 48;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#333';
    ctx.beginPath();
    ctx.roundRect(2, 2, 156, 44, 8);
    ctx.fill();
    ctx.fillStyle = '#e0e0e0';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 80, 24);
    if (btn.material.map) btn.material.map.dispose();
    btn.material.map = new THREE.CanvasTexture(canvas);
    btn.userData.label = label;
  }

  // --- Actions ---
  function handleAction(action, btn) {
    switch (action) {
      case 'play':
        if (viewer.video.paused) {
          viewer.video.play();
          updateButton(btn, 'Pause');
        } else {
          viewer.video.pause();
          updateButton(btn, 'Play');
        }
        showHUDTemporarily();
        break;

      case 'rewind':
        if (viewer.video) viewer.video.currentTime = Math.max(0, viewer.video.currentTime - 10);
        showHUDTemporarily();
        break;

      case 'forward':
        if (viewer.video) viewer.video.currentTime = Math.min(viewer.video.duration, viewer.video.currentTime + 10);
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

  function togglePassthrough() {
    if (!viewer) return;
    passthroughActive = !passthroughActive;
    viewer.sphere.visible = !passthroughActive;
  }
})();
