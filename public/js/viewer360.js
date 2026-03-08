// 360 Viewer - Three.js equirectangular sphere with mouse/touch controls
(function() {
  let viewer = null;

  window.initViewer = function(mediaUrl, fileType) {
    const container = document.getElementById('viewer-container');
    viewer = new Viewer360(container, mediaUrl, fileType);
    window.currentViewer = viewer;
  };

  class Viewer360 {
    constructor(container, mediaUrl, type) {
      this.container = container;
      this.type = type;
      this.lon = 0;
      this.lat = 0;
      this.fov = 75;
      this.isInteracting = false;
      this.pointerX = 0;
      this.pointerY = 0;
      this.pointerLon = 0;
      this.pointerLat = 0;
      this.pinchDist = 0;

      const THREE = window.THREE;
      this.THREE = THREE;

      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(this.fov, window.innerWidth / window.innerHeight, 0.1, 1100);
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      this.renderer.setPixelRatio(window.devicePixelRatio);
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      this.renderer.xr.enabled = false;
      container.appendChild(this.renderer.domElement);

      // Sphere
      const geometry = new THREE.SphereGeometry(500, 64, 32);
      geometry.scale(-1, 1, 1);

      if (type === 'video') {
        this.video = document.getElementById('video-source');
        this.video.src = mediaUrl;
        this.video.crossOrigin = 'anonymous';
        this.video.load();
        const texture = new THREE.VideoTexture(this.video);
        texture.colorSpace = THREE.SRGBColorSpace;
        this.material = new THREE.MeshBasicMaterial({ map: texture });
      } else {
        const texture = new THREE.TextureLoader().load(mediaUrl);
        texture.colorSpace = THREE.SRGBColorSpace;
        this.material = new THREE.MeshBasicMaterial({ map: texture });
      }

      this.sphere = new THREE.Mesh(geometry, this.material);
      this.scene.add(this.sphere);

      this.setupControls();
      this.animate();
      this.setupResize();

      if (type === 'video') {
        this.setupVideoControls();
      }
    }

    setupControls() {
      const el = this.renderer.domElement;

      el.addEventListener('pointerdown', e => {
        this.isInteracting = true;
        this.pointerX = e.clientX;
        this.pointerY = e.clientY;
        this.pointerLon = this.lon;
        this.pointerLat = this.lat;
        el.setPointerCapture(e.pointerId);
      });

      el.addEventListener('pointermove', e => {
        if (!this.isInteracting) return;
        this.lon = (this.pointerX - e.clientX) * 0.2 + this.pointerLon;
        this.lat = (e.clientY - this.pointerY) * 0.2 + this.pointerLat;
        this.lat = Math.max(-85, Math.min(85, this.lat));
      });

      el.addEventListener('pointerup', e => {
        this.isInteracting = false;
        el.releasePointerCapture(e.pointerId);
      });

      // Zoom with scroll
      el.addEventListener('wheel', e => {
        e.preventDefault();
        this.fov = Math.max(30, Math.min(120, this.fov + e.deltaY * 0.05));
        this.camera.fov = this.fov;
        this.camera.updateProjectionMatrix();
      }, { passive: false });

      // Pinch zoom for touch
      el.addEventListener('touchstart', e => {
        if (e.touches.length === 2) {
          this.pinchDist = Math.hypot(
            e.touches[0].clientX - e.touches[1].clientX,
            e.touches[0].clientY - e.touches[1].clientY
          );
        }
      });

      el.addEventListener('touchmove', e => {
        if (e.touches.length === 2) {
          const dist = Math.hypot(
            e.touches[0].clientX - e.touches[1].clientX,
            e.touches[0].clientY - e.touches[1].clientY
          );
          const delta = this.pinchDist - dist;
          this.fov = Math.max(30, Math.min(120, this.fov + delta * 0.1));
          this.camera.fov = this.fov;
          this.camera.updateProjectionMatrix();
          this.pinchDist = dist;
        }
      });
    }

    setupResize() {
      window.addEventListener('resize', () => {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
      });
    }

    setupVideoControls() {
      const controls = document.getElementById('video-controls');
      const playBtn = document.getElementById('play-pause-btn');
      const seekBar = document.getElementById('seek-bar');
      const timeDisplay = document.getElementById('time-display');

      if (!controls) return;
      controls.style.display = 'flex';

      playBtn.addEventListener('click', () => {
        if (this.video.paused) {
          this.video.play();
          playBtn.textContent = 'Pause';
        } else {
          this.video.pause();
          playBtn.textContent = 'Play';
        }
      });

      this.video.addEventListener('timeupdate', () => {
        if (!seekBar._dragging) {
          seekBar.value = (this.video.currentTime / this.video.duration) * 100 || 0;
        }
        timeDisplay.textContent = formatTime(this.video.currentTime) + ' / ' + formatTime(this.video.duration);
      });

      seekBar.addEventListener('mousedown', () => seekBar._dragging = true);
      seekBar.addEventListener('touchstart', () => seekBar._dragging = true);
      seekBar.addEventListener('input', () => {
        this.video.currentTime = (seekBar.value / 100) * this.video.duration;
      });
      seekBar.addEventListener('mouseup', () => seekBar._dragging = false);
      seekBar.addEventListener('touchend', () => seekBar._dragging = false);

      function formatTime(s) {
        if (!s || isNaN(s)) return '0:00';
        const m = Math.floor(s / 60);
        const sec = Math.floor(s % 60);
        return m + ':' + (sec < 10 ? '0' : '') + sec;
      }
    }

    animate() {
      if (this.renderer.xr.isPresenting) return;
      this._animId = requestAnimationFrame(() => this.animate());
      this.updateCamera();
      this.renderer.render(this.scene, this.camera);
    }

    stopAnimate() {
      if (this._animId) cancelAnimationFrame(this._animId);
    }

    updateCamera() {
      const THREE = this.THREE;
      const phi = THREE.MathUtils.degToRad(90 - this.lat);
      const theta = THREE.MathUtils.degToRad(this.lon);
      const target = new THREE.Vector3(
        500 * Math.sin(phi) * Math.cos(theta),
        500 * Math.cos(phi),
        500 * Math.sin(phi) * Math.sin(theta)
      );
      this.camera.lookAt(target);
    }
  }
})();
