import { auth, db } from "./config.js";
import { getLandmarkById } from "./landmark-service.js";
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  applyAccessibilitySettings,
  hideAppLoader,
  installLoaderFailsafe,
  setLoaderText,
  showAppLoader,
} from "./app.js";

const AR_MODE = "location";

installLoaderFailsafe(15000);

const CONFIG = Object.freeze({
  geofenceRadiusM: 50,
  gpsPoorAccuracyM: 35,
  cameraConstraints: {
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1280 },
      height: { ideal: 720 }
    },
    audio: false
  }
});

const LOCATION_AR_CONFIG = {
  useReadableZoneAnchor: true,

  placement: {
    x: 0.65,
    y: 0.05,
    z: -5.5
  },

  card: {
    width: 4.4,
    height: 2.0,
    scale: 2.0
  },

  texture: {
    width: 1000,
    height: 700,
    titleSize: 52,
    headingSize: 40,
    bodySize: 30,
    padding: 46,
    radius: 42
  },

  billboard: {
    enabled: true,
    flip: false
  }
};

const AR_FONT_FAMILY = "Arial, Helvetica, sans-serif";

const GEOFENCE_M = CONFIG.geofenceRadiusM;
const GPS_POOR_ACCURACY_M = CONFIG.gpsPoorAccuracyM;

const LANDMARK_ID_ALIASES = {
  "st-columban": "columban",
  st_columban: "columban",
  "diocese-columban": "columban",
  diocese_columban: "columban",
  city_hall: "city-hall",
  spanish_gate: "spanish-gate",
  ulo_ng_apo: "ulo-ng-apo",
  marikit_park: "marikit-park",
  rizal_triangle: "rizal-triangle",
  gordon_college: "gordon-college"
};

const DOM = {};

const state = {
  arMode: AR_MODE,
  arVisible: false,
  captureBusy: false,
  location: null,
  cameraStream: null,
  distanceM: null,
  inRange: false,
  readableARPlaced: false,
  sceneReady: false,
  selectedLandmark: null,
  toastTimer: null,
  watchId: null,
  achievementUnlocked: false,
  miniMap: null,
  miniMapUserMarker: null,
  miniMapLandmarkMarker: null,
  miniMapRouteLine: null,
  miniMapRouteAbortController: null,
  miniMapAccuracyCircle: null,
  lastMiniMapUpdate: 0,
  lastMiniMapRouteKey: "",
  lastMiniMapRouteAt: 0,
  userHeading: 0,
  miniMapHeadingStarted: false
};

function cacheDOM() {
  DOM.video = document.getElementById("camVideo");
  DOM.sceneHost = document.getElementById("locationSceneHost");
  DOM.scene = document.getElementById("arScene");
  DOM.locationARContent = document.getElementById("locationBasedARContent");
  DOM.readableZoneARContent = document.getElementById("readableZoneARContent");
  DOM.gpsCamera = document.getElementById("gpsCamera");
  DOM.captureCanvas = document.getElementById("captureCanvas");
  DOM.hud = document.getElementById("hud");
  DOM.bottomBar = document.getElementById("bottomBar");
  DOM.navDestination = document.getElementById("navDestination");
  DOM.navEta = document.getElementById("navEta");
  DOM.navDistance = document.getElementById("navDistance");
  DOM.locationStatus = document.getElementById("locationStatus");
  DOM.gpsStatus = document.getElementById("gpsStatus");
  DOM.locationARStatus = document.getElementById("locationARStatus");
  DOM.captureBtn = document.getElementById("captureBtn");
  DOM.infoBtn = document.getElementById("infoBtn");
  DOM.ttsBtn = document.getElementById("ttsBtn");
  DOM.infoPanel = document.getElementById("infoPanel");
  DOM.panelName = document.getElementById("panelName");
  DOM.panelCat = document.getElementById("panelCat");
  DOM.panelDistance = document.getElementById("panelDistance");
  DOM.panelDesc = document.getElementById("panelDesc");
  DOM.panelMapLink = document.getElementById("panelMapLink");
  DOM.panelClose = document.getElementById("panelClose");
  DOM.toast = document.getElementById("toast");
  DOM.cameraMiniMapWrap = document.getElementById("cameraMiniMapWrap");
  DOM.cameraMiniMap = document.getElementById("cameraMiniMap");
  DOM.loadingScreen = document.getElementById("loadingScreen");
  DOM.loadingFill = document.getElementById("loadingFill");
  DOM.loadingText = document.getElementById("loadingText");
  DOM.loadStepCamera = document.getElementById("loadStepCamera");
  DOM.loadStepGps = document.getElementById("loadStepGps");
  DOM.loadStepAr = document.getElementById("loadStepAr");
  DOM.loadingStartBtn = document.getElementById("loadingStartBtn");
  DOM.missingSelection = document.getElementById("missingSelection");
  DOM.errScreen = document.getElementById("errScreen");
  DOM.errMsg = document.getElementById("errMsg");
  DOM.retryBtn = document.getElementById("retryBtn");
}

function normalizeLandmarkId(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const normalized = raw.toLowerCase().replace(/\s+/g, "-");
  return LANDMARK_ID_ALIASES[normalized] || normalized;
}

function getSelectedLandmarkId() {
  const params = new URLSearchParams(window.location.search);

  return normalizeLandmarkId(
    params.get("landmark") ||
      localStorage.getItem("selectedLandmarkId")
  );
}

function registerBillboardComponent() {
  if (!window.AFRAME) return;

  if (AFRAME.components["face-camera-y"]) {
    return;
  }

  AFRAME.registerComponent("face-camera-y", {
    schema: {
      enabled: { type: "boolean", default: true },
      flip: { type: "boolean", default: false }
    },

    tick: function () {
      if (!this.data.enabled) return;

      const cameraEl =
        document.getElementById("gpsCamera") ||
        document.querySelector("[camera]");

      if (!cameraEl || !cameraEl.object3D || !window.THREE) return;

      const cameraPosition = new THREE.Vector3();
      const entityPosition = new THREE.Vector3();

      cameraEl.object3D.getWorldPosition(cameraPosition);
      this.el.object3D.getWorldPosition(entityPosition);

      const dx = cameraPosition.x - entityPosition.x;
      const dz = cameraPosition.z - entityPosition.z;

      if (Math.abs(dx) < 0.0001 && Math.abs(dz) < 0.0001) return;

      const angle = Math.atan2(dx, dz);

      this.el.object3D.rotation.set(
        0,
        angle + (this.data.flip ? Math.PI : 0),
        0
      );
    }
  });

  console.log("[AR] face-camera-y billboard component registered.");
}

function logARCalibrationStatus() {
  console.log("[AR CALIBRATION] Billboard enabled on AR card root.");
  console.log("[AR CALIBRATION] Readable zone anchor:", LOCATION_AR_CONFIG.useReadableZoneAnchor);
  console.log("[AR DISPLAY] Using canvas texture panels for text.");
  console.log("[AR DISPLAY] Font:", AR_FONT_FAMILY);
  console.log("[AR DISPLAY] Placement:", LOCATION_AR_CONFIG.placement);
  console.log("[AR DISPLAY] Card:", LOCATION_AR_CONFIG.card);
  console.log("[AR DISPLAY] Texture:", LOCATION_AR_CONFIG.texture);
  console.log("[AR DISPLAY] Billboard:", LOCATION_AR_CONFIG.billboard);
  console.log("[AR TRANSFORM] Anchor controls position only.");
  console.log("[AR TRANSFORM] Billboard root controls rotation only.");
  console.log("[AR TRANSFORM] Card root controls scale only.");
  console.log("[AR TRANSFORM] Single plane controls physical dimensions only.");
  console.log("[AR TRANSFORM] look-at removed; using face-camera-y only.");
}

function applyARDisplayOverridesFromURL() {
  const params = new URLSearchParams(window.location.search);

  const overrideMap = [
    ["arX", ["placement", "x"]],
    ["arY", ["placement", "y"]],
    ["arZ", ["placement", "z"]],
    ["arScale", ["card", "scale"]],
    ["arW", ["card", "width"]],
    ["arH", ["card", "height"]]
  ];

  overrideMap.forEach(([paramName, path]) => {
    if (!params.has(paramName)) return;

    const rawValue = params.get(paramName);
    if (rawValue === null || rawValue.trim() === "") return;

    const value = Number(rawValue);

    if (!Number.isFinite(value)) return;

    const [section, key] = path;
    LOCATION_AR_CONFIG[section][key] = value;
  });

  console.log("[AR CONFIG] Final modular AR display config:", JSON.parse(JSON.stringify(LOCATION_AR_CONFIG)));
}

function isValidARLandmark(landmark) {
  return Boolean(
    landmark &&
      landmark.id &&
      landmark.name &&
      Number.isFinite(Number(landmark.lat)) &&
      Number.isFinite(Number(landmark.lng))
  );
}

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r;
  const dLng = (lng2 - lng1) * r;

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * r) *
      Math.cos(lat2 * r) *
      Math.sin(dLng / 2) ** 2;

  return R * 2 * Math.asin(Math.sqrt(a));
}

function formatDistance(metres) {
  if (!Number.isFinite(metres)) return "--";
  return metres < 1000
    ? `${Math.round(metres)} m`
    : `${(metres / 1000).toFixed(2)} km`;
}

function estimateWalkingTime(distanceM) {
  if (!Number.isFinite(distanceM)) return "--";
  const seconds = distanceM / 1.3;
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `${minutes} min`;
}

function limitARText(text, max = 180) {
  const value = String(text || "").trim();
  return value.length > max ? `${value.slice(0, max).trim()}...` : value;
}

function getLandmarkARInfoBullets(landmark) {
  if (!landmark) return [];

  if (Array.isArray(landmark.arInfo) && landmark.arInfo.length) {
    return landmark.arInfo
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .slice(0, 4);
  }

  const fallback = [];

  if (landmark.history) {
    fallback.push(limitARText(landmark.history, 120));
  }

  if (landmark.desc) {
    fallback.push(limitARText(landmark.desc, 120));
  }

  if (!fallback.length && landmark.description) {
    fallback.push(limitARText(landmark.description, 120));
  }

  return fallback.slice(0, 4);
}

function formatBulletText(items) {
  return items.map((item) => `• ${item}`).join("\n");
}

function createARInfoCardTexture(id, landmark) {
  const name = String(landmark?.name || "Landmark").toUpperCase();
  const bullets = getLandmarkARInfoBullets(landmark);
  const bulletText =
    formatBulletText(bullets) || "• Landmark information will appear here.";

  const {
    width,
    height,
    titleSize,
    headingSize,
    bodySize,
    padding,
    radius
  } = LOCATION_AR_CONFIG.texture;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.id = id;

  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  ctx.clearRect(0, 0, width, height);

  ctx.fillStyle = "#0A1628";
  roundCanvasRect(ctx, 0, 0, width, height, radius);
  ctx.fill();

  const titleBoxHeight = 135;

  ctx.fillStyle = "#FFFFFF";
  roundCanvasRect(ctx, padding, padding, width - padding * 2, titleBoxHeight, 32);
  ctx.fill();

  ctx.textBaseline = "top";
  ctx.textAlign = "center";
  ctx.fillStyle = "#0A1628";
  ctx.font = `900 ${titleSize}px ${AR_FONT_FAMILY}`;

  wrapCanvasText(
    ctx,
    name,
    width / 2,
    padding + 36,
    width - padding * 3,
    titleSize * 1.15,
    "center"
  );

  const infoTop = padding + titleBoxHeight + 44;

  ctx.textAlign = "left";
  ctx.fillStyle = "#DDEB9D";
  ctx.font = `900 ${headingSize}px ${AR_FONT_FAMILY}`;
  ctx.fillText("AR INFORMATION", padding, infoTop);

  ctx.fillStyle = "#FFFFFF";
  ctx.font = `800 ${bodySize}px ${AR_FONT_FAMILY}`;

  wrapCanvasText(
    ctx,
    bulletText,
    padding,
    infoTop + headingSize + 34,
    width - padding * 2,
    bodySize * 1.45,
    "left"
  );

  return canvas;
}

function roundCanvasRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);

  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight, align = "left") {
  const paragraphs = String(text || "").split("\n");

  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let line = "";

    for (const word of words) {
      const testLine = line ? `${line} ${word}` : word;
      const metrics = ctx.measureText(testLine);

      if (metrics.width > maxWidth && line) {
        ctx.fillText(line, x, y);
        line = word;
        y += lineHeight;
      } else {
        line = testLine;
      }
    }

    if (line) {
      ctx.fillText(line, x, y);
      y += lineHeight;
    }

    y += lineHeight * 0.16;
  }
}

function registerCanvasAsset(assetId, canvas) {
  const scene = document.getElementById("arScene");
  if (!scene || !canvas) return;

  let assets = scene.querySelector("a-assets");

  if (!assets) {
    assets = document.createElement("a-assets");
    scene.prepend(assets);
  }

  const existing = document.getElementById(assetId);
  if (existing) existing.remove();

  canvas.id = assetId;
  assets.appendChild(canvas);

  console.log("[AR TEXTURE] Registered canvas asset:", assetId);
}

function isGPSPoor() {
  return (
    Number.isFinite(state.location?.accuracy) &&
    state.location.accuracy > GPS_POOR_ACCURACY_M
  );
}

function showToast(message, duration = 2600) {
  if (!DOM.toast) return;

  DOM.toast.textContent = message;
  DOM.toast.classList.add("show");

  clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => {
    DOM.toast.classList.remove("show");
  }, duration);
}

function setLoadingProgress(percent, text) {
  if (DOM.loadingFill) {
    DOM.loadingFill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
  }

  if (DOM.loadingText && text) {
    DOM.loadingText.textContent = text;
  }

  if (text) {
    setLoaderText(text);
  }
}

function setLoadingStep(step, status) {
  const target = {
    camera: DOM.loadStepCamera,
    gps: DOM.loadStepGps,
    ar: DOM.loadStepAr
  }[step];

  if (!target) return;
  target.classList.remove("active", "done", "error");

  if (status === "loading") {
    target.classList.add("active");
  } else if (status === "done") {
    target.classList.add("done");
  } else if (status === "error") {
    target.classList.add("error");
  }
}

function hideLoadingScreen() {
  hideAppLoader(300);
}

function showLoadingScreen() {
  showAppLoader();
}

function showLoadingStartButton() {
  if (DOM.loadingStartBtn) {
    DOM.loadingStartBtn.style.display = "inline-flex";
  }
}

function hideLoadingStartButton() {
  if (DOM.loadingStartBtn) {
    DOM.loadingStartBtn.style.display = "none";
  }
}

async function startCamera() {
  if (!DOM.video) return;

  if (DOM.video.srcObject && !DOM.video.paused) {
    setLoadingStep("camera", "done");
    return;
  }

  if (state.cameraStream) {
    DOM.video.srcObject = state.cameraStream;
  } else {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Camera access is not supported on this device.");
    }

    state.cameraStream = await navigator.mediaDevices.getUserMedia(
      CONFIG.cameraConstraints
    );
    DOM.video.srcObject = state.cameraStream;
  }

  DOM.video.muted = true;
  DOM.video.playsInline = true;
  DOM.video.setAttribute("playsinline", "");
  DOM.video.setAttribute("webkit-playsinline", "");
  await DOM.video.play();
  setLoadingStep("camera", "done");
}

function ensureCameraStillRunning() {
  if (!DOM.video) return;

  if (!DOM.video.srcObject && state.cameraStream) {
    DOM.video.srcObject = state.cameraStream;
  }

  if (DOM.video.srcObject && DOM.video.paused) {
    DOM.video.play().catch((error) => {
      console.warn("[CAMERA] Could not resume camera preview:", error);
    });
  }
}

function stopCamera() {
  if (state.cameraStream) {
    state.cameraStream.getTracks().forEach((track) => track.stop());
    state.cameraStream = null;
  }

  if (DOM.video) {
    DOM.video.pause();
    DOM.video.srcObject = null;
  }
}

function showMissingSelectionState() {
  hideLoadingScreen();
  DOM.missingSelection?.classList.add("show");
  DOM.hud?.classList.remove("active");
  DOM.bottomBar?.classList.remove("active");
  setCameraMiniMapVisible(false);
  clearMinimapRoute();
}

function showCameraError(message) {
  hideLoadingScreen();

  if (DOM.errMsg) {
    DOM.errMsg.textContent = message;
  }

  DOM.errScreen?.classList.add("show");
}

async function loadSelectedLandmarkFromFirestore(landmarkId = getSelectedLandmarkId()) {
  if (!landmarkId) {
    showToast("Please select a landmark first.");
    return null;
  }

  try {
    const landmark = await getLandmarkById(landmarkId);

    if (!isValidARLandmark(landmark)) {
      console.error("[LANDMARK] Invalid Firestore landmark:", landmark);
      showToast("Selected landmark data is incomplete.");
      return null;
    }

    localStorage.setItem("selectedLandmarkId", landmarkId);

    return {
      ...landmark,
      id: normalizeLandmarkId(landmark.id || landmarkId)
    };
  } catch (error) {
    console.error("[LANDMARK] Failed to load selected landmark:", error);
    showToast("Unable to load landmark data. Please try again.");
    return null;
  }
}

function updateStaticLandmarkUI() {
  const landmark = state.selectedLandmark;
  if (!landmark) return;

  const description =
    landmark.desc ||
    landmark.description ||
    landmark.history ||
    "Historical information will appear here.";

  if (DOM.navDestination) {
    DOM.navDestination.textContent = landmark.name || "KA-KALAKBAY AR";
  }

  if (DOM.panelName) {
    DOM.panelName.textContent = landmark.name || "Selected Landmark";
  }

  if (DOM.panelCat) {
    DOM.panelCat.textContent = landmark.category || "Landmark";
  }

  if (DOM.panelDesc) {
    DOM.panelDesc.textContent = description;
  }

  if (DOM.panelMapLink) {
    const lat = Number(landmark.lat);
    const lng = Number(landmark.lng);
    DOM.panelMapLink.href =
      `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}` +
      `#map=18/${lat}/${lng}`;
  }
}

function updateTopBarMetrics() {
  if (DOM.navDestination) {
    DOM.navDestination.textContent =
      state.selectedLandmark?.name || "KA-KALAKBAY AR";
  }

  if (DOM.navDistance) {
    DOM.navDistance.textContent = formatDistance(state.distanceM);
  }

  if (DOM.navEta) {
    DOM.navEta.textContent = estimateWalkingTime(state.distanceM);
  }

  if (DOM.locationStatus) {
    if (!state.location) {
      DOM.locationStatus.textContent = "Locating";
    } else if (isGPSPoor()) {
      DOM.locationStatus.textContent = "Weak GPS";
    } else {
      DOM.locationStatus.textContent = state.inRange
        ? "You are nearby"
        : "Move closer";
    }
  }

  if (DOM.panelDistance) {
    DOM.panelDistance.textContent = `Distance: ${formatDistance(
      state.distanceM
    )}`;
  }
}

function updateGPSAccuracyUI() {
  if (!state.location) return;

  const poor =
    Number.isFinite(state.location.accuracy) &&
    state.location.accuracy > GPS_POOR_ACCURACY_M;

  if (poor) {
    console.warn("[GPS] Poor accuracy:", state.location.accuracy);
  }

  if (DOM.gpsStatus) {
    DOM.gpsStatus.textContent = poor
      ? "GPS accuracy is weak"
      : "GPS ready";
  }
}

function buildLandmarkSpeechText() {
  const lm = state.selectedLandmark;

  if (!lm) {
    return "No landmark selected.";
  }

  const name = lm.name || "Selected landmark";
  const bullets = getLandmarkARInfoBullets(lm);

  if (!bullets.length) {
    return `${name}. No AR information is available for this landmark.`;
  }

  return `${name}. AR information. ${bullets.join(". ")}.`;
}

function stopLandmarkSpeech() {
  if (!("speechSynthesis" in window)) return;

  window.speechSynthesis.cancel();

  const btn = DOM.ttsBtn || document.getElementById("ttsBtn");
  btn?.classList.remove("is-speaking");
  btn?.setAttribute("aria-label", "Listen to landmark information");
}

function speakLandmarkInfo() {
  if (!("speechSynthesis" in window)) {
    showToast("Text-to-speech is not supported on this browser.");
    return;
  }

  const btn = DOM.ttsBtn || document.getElementById("ttsBtn");

  if (window.speechSynthesis.speaking) {
    stopLandmarkSpeech();
    return;
  }

  const text = buildLandmarkSpeechText();
  const utterance = new SpeechSynthesisUtterance(text);

  utterance.lang = "en-US";
  utterance.rate = 0.92;
  utterance.pitch = 1;
  utterance.volume = 1;

  utterance.onstart = () => {
    btn?.classList.add("is-speaking");
    btn?.setAttribute("aria-label", "Stop landmark narration");
  };

  utterance.onend = () => {
    btn?.classList.remove("is-speaking");
    btn?.setAttribute("aria-label", "Listen to landmark information");
  };

  utterance.onerror = () => {
    btn?.classList.remove("is-speaking");
    btn?.setAttribute("aria-label", "Listen to landmark information");
  };

  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

function showARSafetyModalIfNeeded() {
  const modal = document.getElementById("arSafetyModal");
  const acceptBtn = document.getElementById("acceptSafetyBtn");
  const dontShow = document.getElementById("dontShowSafetyAgain");

  if (!modal || !acceptBtn) return;

  const alreadySeen = localStorage.getItem("kk_ar_safety_seen") === "true";

  if (alreadySeen) return;

  modal.classList.add("show");
  modal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";

  acceptBtn.addEventListener(
    "click",
    () => {
      if (dontShow?.checked) {
        localStorage.setItem("kk_ar_safety_seen", "true");
      }

      modal.classList.remove("show");
      modal.setAttribute("aria-hidden", "true");
      document.body.style.overflow = "";
    },
    { once: true }
  );
}

function setCameraMiniMapVisible(isVisible) {
  const wrap = document.getElementById("cameraMiniMapWrap");
  if (!wrap) return;

  wrap.classList.toggle("is-hidden", !isVisible);
}

function initCameraMiniMap() {
  const mapEl = document.getElementById("cameraMiniMap");

  if (!mapEl) {
    console.warn("[CAMERA MINIMAP] Minimap element not found.");
    return;
  }

  if (!window.L) {
    console.warn("[CAMERA MINIMAP] Leaflet is not loaded.");
    return;
  }

  if (state.miniMap) {
    setTimeout(() => state.miniMap.invalidateSize(), 100);
    void updateMinimapOSRMRoute();
    return;
  }

  const fallbackLat = Number(state.selectedLandmark?.lat) || 14.838913747987208;
  const fallbackLng = Number(state.selectedLandmark?.lng) || 120.28433529417792;

  state.miniMap = L.map(mapEl, {
    zoomControl: false,
    attributionControl: false,
    dragging: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    boxZoom: false,
    keyboard: false,
    tap: false,
    touchZoom: false
  }).setView([fallbackLat, fallbackLng], 18);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    crossOrigin: true
  }).addTo(state.miniMap);

  const landmarkLat = Number(state.selectedLandmark?.lat);
  const landmarkLng = Number(state.selectedLandmark?.lng);

  if (Number.isFinite(landmarkLat) && Number.isFinite(landmarkLng)) {
    state.miniMapLandmarkMarker = L.marker([landmarkLat, landmarkLng], {
      icon: createMiniMapLandmarkIcon()
    }).addTo(state.miniMap);
  }

  setTimeout(() => {
    state.miniMap?.invalidateSize();
  }, 250);

  console.log("[CAMERA MINIMAP] Initialized.");
  void updateMinimapOSRMRoute();
}

function createMiniMapUserIcon(heading = 0) {
  return L.divIcon({
    className: "",
    html: `
      <div
        class="camera-minimap-user-marker"
        style="transform: rotate(${Number(heading) || 0}deg);"
      ></div>
    `,
    iconSize: [22, 22],
    iconAnchor: [11, 11]
  });
}

function createMiniMapLandmarkIcon() {
  return L.divIcon({
    className: "",
    html: `<div class="camera-minimap-landmark-marker"></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11]
  });
}

function getMinimapRouteKey(userLocation, landmark) {
  if (!userLocation || !landmark) return "";

  const userLat = Number(userLocation.lat);
  const userLng = Number(userLocation.lng);
  const landmarkLat = Number(landmark.lat);
  const landmarkLng = Number(landmark.lng);

  if (
    !Number.isFinite(userLat) ||
    !Number.isFinite(userLng) ||
    !Number.isFinite(landmarkLat) ||
    !Number.isFinite(landmarkLng)
  ) {
    return "";
  }

  return [
    userLat.toFixed(5),
    userLng.toFixed(5),
    landmarkLat.toFixed(5),
    landmarkLng.toFixed(5)
  ].join(",");
}

async function fetchOSRMRoute(userLocation, landmark, profile = "foot", signal) {
  const userLat = Number(userLocation?.lat);
  const userLng = Number(userLocation?.lng);
  const landmarkLat = Number(landmark?.lat);
  const landmarkLng = Number(landmark?.lng);

  if (
    !Number.isFinite(userLat) ||
    !Number.isFinite(userLng) ||
    !Number.isFinite(landmarkLat) ||
    !Number.isFinite(landmarkLng)
  ) {
    throw new Error("Invalid route coordinates.");
  }

  const coordinates = `${userLng},${userLat};${landmarkLng},${landmarkLat}`;
  const url =
    `https://router.project-osrm.org/route/v1/${profile}/${coordinates}` +
    "?overview=full&geometries=geojson&steps=false";

  console.log("[MINIMAP OSRM] Fetching route:", {
    profile,
    user: { lat: userLat, lng: userLng },
    landmark: { lat: landmarkLat, lng: landmarkLng }
  });

  const response = await fetch(url, { signal });

  if (!response.ok) {
    throw new Error(`OSRM request failed: ${response.status}`);
  }

  const data = await response.json();

  if (data.code !== "Ok" || !data.routes?.length) {
    throw new Error(`OSRM returned no route: ${data.code || "unknown"}`);
  }

  const route = data.routes[0];

  if (!route.geometry?.coordinates?.length) {
    throw new Error("OSRM route has no geometry.");
  }

  return {
    distance: route.distance,
    duration: route.duration,
    coordinates: route.geometry.coordinates.map(([lng, lat]) => [lat, lng])
  };
}

function drawMinimapRoute(routeLatLngs, options = {}) {
  if (!state.miniMap || !window.L) return;

  if (state.miniMapRouteLine) {
    state.miniMap.removeLayer(state.miniMapRouteLine);
    state.miniMapRouteLine = null;
  }

  if (!Array.isArray(routeLatLngs) || routeLatLngs.length < 2) {
    console.warn("[MINIMAP OSRM] Not enough route points to draw.");
    return;
  }

  state.miniMapRouteLine = L.polyline(routeLatLngs, {
    color: options.color || "#00B4D8",
    weight: options.weight || 4,
    opacity: options.opacity || 0.95,
    lineCap: "round",
    lineJoin: "round"
  }).addTo(state.miniMap);

  try {
    const bounds = L.latLngBounds(routeLatLngs);
    state.miniMap.fitBounds(bounds, {
      padding: [18, 18],
      maxZoom: 18
    });
  } catch (error) {
    console.warn("[MINIMAP OSRM] Could not fit route bounds:", error);
  }
}

function drawMinimapStraightLineFallback(userLocation, landmark) {
  if (!state.miniMap || !window.L) return;

  const userLat = Number(userLocation?.lat);
  const userLng = Number(userLocation?.lng);
  const landmarkLat = Number(landmark?.lat);
  const landmarkLng = Number(landmark?.lng);

  if (
    !Number.isFinite(userLat) ||
    !Number.isFinite(userLng) ||
    !Number.isFinite(landmarkLat) ||
    !Number.isFinite(landmarkLng)
  ) {
    return;
  }

  const fallbackLine = [
    [userLat, userLng],
    [landmarkLat, landmarkLng]
  ];

  console.warn("[MINIMAP OSRM] Falling back to straight line.");

  drawMinimapRoute(fallbackLine, {
    color: "#DDEB9D",
    weight: 3,
    opacity: 0.75
  });
}

function clearMinimapRoute() {
  if (state.miniMapRouteLine && state.miniMap) {
    state.miniMap.removeLayer(state.miniMapRouteLine);
    state.miniMapRouteLine = null;
  }

  if (state.miniMapRouteAbortController) {
    state.miniMapRouteAbortController.abort();
    state.miniMapRouteAbortController = null;
  }

  state.lastMiniMapRouteKey = "";
}

async function updateMinimapOSRMRoute() {
  if (!state.miniMap || !state.location || !state.selectedLandmark) {
    clearMinimapRoute();
    return;
  }

  const routeKey = getMinimapRouteKey(state.location, state.selectedLandmark);

  if (!routeKey) {
    clearMinimapRoute();
    return;
  }

  const now = Date.now();
  const routeCooldownMs = 8000;

  if (
    state.lastMiniMapRouteKey === routeKey &&
    now - state.lastMiniMapRouteAt < routeCooldownMs
  ) {
    return;
  }

  state.lastMiniMapRouteKey = routeKey;
  state.lastMiniMapRouteAt = now;

  if (state.miniMapRouteAbortController) {
    state.miniMapRouteAbortController.abort();
  }

  state.miniMapRouteAbortController = new AbortController();

  try {
    let route;

    try {
      route = await fetchOSRMRoute(
        state.location,
        state.selectedLandmark,
        "foot",
        state.miniMapRouteAbortController.signal
      );
    } catch (footError) {
      if (footError.name === "AbortError") {
        throw footError;
      }

      console.warn("[MINIMAP OSRM] Foot route failed, trying driving:", footError);

      route = await fetchOSRMRoute(
        state.location,
        state.selectedLandmark,
        "driving",
        state.miniMapRouteAbortController.signal
      );
    }

    drawMinimapRoute(route.coordinates, {
      color: "#00B4D8",
      weight: 4,
      opacity: 0.95
    });

    console.log("[MINIMAP OSRM] Route drawn:", {
      distanceM: route.distance,
      durationS: route.duration,
      points: route.coordinates.length
    });
  } catch (error) {
    if (error.name === "AbortError") {
      console.log("[MINIMAP OSRM] Route request aborted.");
      return;
    }

    console.warn("[MINIMAP OSRM] Route failed, using fallback:", error);
    drawMinimapStraightLineFallback(state.location, state.selectedLandmark);
  }
}

function updateCameraMiniMap() {
  if (!state.miniMap || !state.selectedLandmark || !state.location) {
    clearMinimapRoute();
    return;
  }

  const now = Date.now();

  // Avoid excessive map updates.
  if (now - state.lastMiniMapUpdate < 800) return;
  state.lastMiniMapUpdate = now;

  const userLat = Number(state.location.lat);
  const userLng = Number(state.location.lng);
  const landmarkLat = Number(state.selectedLandmark.lat);
  const landmarkLng = Number(state.selectedLandmark.lng);

  if (
    !Number.isFinite(userLat) ||
    !Number.isFinite(userLng) ||
    !Number.isFinite(landmarkLat) ||
    !Number.isFinite(landmarkLng)
  ) {
    console.warn("[CAMERA MINIMAP] Invalid coordinates.", {
      userLat,
      userLng,
      landmarkLat,
      landmarkLng
    });
    clearMinimapRoute();
    return;
  }

  const userLatLng = [userLat, userLng];
  const landmarkLatLng = [landmarkLat, landmarkLng];

  if (!state.miniMapUserMarker) {
    state.miniMapUserMarker = L.marker(userLatLng, {
      icon: createMiniMapUserIcon(state.userHeading)
    }).addTo(state.miniMap);
  } else {
    state.miniMapUserMarker
      .setLatLng(userLatLng)
      .setIcon(createMiniMapUserIcon(state.userHeading));
  }

  if (!state.miniMapLandmarkMarker) {
    state.miniMapLandmarkMarker = L.marker(landmarkLatLng, {
      icon: createMiniMapLandmarkIcon()
    }).addTo(state.miniMap);
  } else {
    state.miniMapLandmarkMarker.setLatLng(landmarkLatLng);
  }

  if (state.miniMapAccuracyCircle) {
    state.miniMapAccuracyCircle.setLatLng(userLatLng);
    state.miniMapAccuracyCircle.setRadius(Number(state.location.accuracy) || 8);
  } else {
    state.miniMapAccuracyCircle = L.circle(userLatLng, {
      radius: Number(state.location.accuracy) || 8,
      color: "#27667B",
      weight: 1,
      fillColor: "#00B4D8",
      fillOpacity: 0.12
    }).addTo(state.miniMap);
  }

  const bounds = L.latLngBounds([userLatLng, landmarkLatLng]).pad(0.45);

  if (bounds.isValid() && !state.miniMapRouteLine) {
    state.miniMap.fitBounds(bounds, {
      animate: true,
      duration: 0.25,
      maxZoom: 18
    });
  } else if (!bounds.isValid()) {
    state.miniMap.setView(userLatLng, 18);
  }

  console.log("[CAMERA MINIMAP] Marker-only update.", {
    userLatLng,
    landmarkLatLng,
    accuracy: state.location.accuracy,
    distanceM: state.distanceM
  });

  void updateMinimapOSRMRoute();
}

function startMiniMapHeadingWatcher() {
  if (state.miniMapHeadingStarted) return;

  function handleOrientation(event) {
    const heading =
      event.webkitCompassHeading ||
      (event.alpha != null ? 360 - event.alpha : null);

    if (Number.isFinite(heading)) {
      state.userHeading = heading;
    }
  }

  try {
    window.addEventListener("deviceorientationabsolute", handleOrientation, true);
    window.addEventListener("deviceorientation", handleOrientation, true);
    state.miniMapHeadingStarted = true;
    console.log("[CAMERA MINIMAP] Heading watcher started.");
  } catch (error) {
    console.warn("[CAMERA MINIMAP] Heading watcher failed:", error);
  }
}

function updateLocationARAnchor(landmark) {
  const entity =
    DOM.locationARContent ||
    document.getElementById("locationBasedARContent");

  if (!entity || !landmark) return;

  const lat = Number(landmark.lat);
  const lng = Number(landmark.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    console.error("[LOCATION AR] Invalid landmark coordinates:", landmark);
    return;
  }

  entity.setAttribute(
    "gps-entity-place",
    `latitude: ${lat}; longitude: ${lng};`
  );

  entity.setAttribute("position", "0 0 0");
  entity.setAttribute("visible", "false");
  if (entity.object3D) {
    entity.object3D.visible = false;
    entity.object3D.scale.set(1, 1, 1);
  }

  console.log("[LOCATION AR] Anchor set:", {
    name: landmark.name,
    lat,
    lng,
    visible: entity.getAttribute("visible")
  });
}

function placeReadableZoneAR() {
  const entity = document.getElementById("readableZoneARContent");
  const cameraEl =
    document.getElementById("gpsCamera") ||
    document.querySelector("[camera]");

  if (!entity || !cameraEl || !cameraEl.object3D || !window.THREE) {
    console.warn("[AR PLACE] Cannot place readable AR.", {
      entity: Boolean(entity),
      cameraEl: Boolean(cameraEl),
      cameraObject: Boolean(cameraEl?.object3D),
      THREE: Boolean(window.THREE)
    });
    return false;
  }

  const cameraObject = cameraEl.object3D;
  cameraObject.updateMatrixWorld(true);

  const localOffset = new THREE.Vector3(
    LOCATION_AR_CONFIG.placement.x,
    LOCATION_AR_CONFIG.placement.y,
    LOCATION_AR_CONFIG.placement.z
  );

  const worldPosition = localOffset.clone();
  cameraObject.localToWorld(worldPosition);

  entity.object3D.position.copy(worldPosition);
  entity.object3D.rotation.set(0, 0, 0);
  entity.object3D.scale.set(1, 1, 1);
  entity.object3D.updateMatrixWorld(true);

  console.log("[AR PLACE] Readable AR placed using modular config:", {
    localOffset: {
      x: localOffset.x,
      y: localOffset.y,
      z: localOffset.z
    },
    worldPosition: {
      x: worldPosition.x,
      y: worldPosition.y,
      z: worldPosition.z
    },
    config: JSON.parse(JSON.stringify(LOCATION_AR_CONFIG))
  });

  return true;
}

function hideLocationBasedARContent() {
  const entity =
    DOM.locationARContent ||
    document.getElementById("locationBasedARContent");

  entity?.setAttribute("visible", "false");
  if (entity?.object3D) {
    entity.object3D.visible = false;
    entity.object3D.scale.set(1, 1, 1);
  }

  const readableEntity =
    DOM.readableZoneARContent ||
    document.getElementById("readableZoneARContent");

  readableEntity?.setAttribute("visible", "false");
  if (readableEntity?.object3D) {
    readableEntity.object3D.visible = false;
    readableEntity.object3D.scale.set(1, 1, 1);
  }

  const cameraFixedEntity = document.getElementById("cameraFixedARContent");
  cameraFixedEntity?.setAttribute("visible", "false");
  if (cameraFixedEntity?.object3D) {
    cameraFixedEntity.object3D.visible = false;
  }

  state.readableARPlaced = false;
}

function buildARContentInto(targetEntityId, landmark) {
  const entity = document.getElementById(targetEntityId);

  if (!entity || !landmark) {
    console.error("[AR BUILD] Missing AR target or landmark.", {
      targetEntityId,
      entityExists: Boolean(entity),
      landmarkExists: Boolean(landmark)
    });
    return;
  }

  const safeId = String(landmark.id || landmark.firestoreId || "landmark")
    .replace(/[^a-z0-9_-]/gi, "-");

  const targetSafeId = String(targetEntityId || "ar-target")
    .replace(/[^a-z0-9_-]/gi, "-");

  const cardAssetId = `ar-card-${targetSafeId}-${safeId}`;
  const cardCanvas = createARInfoCardTexture(cardAssetId, landmark);

  registerCanvasAsset(cardAssetId, cardCanvas);

  const { width, height, scale } = LOCATION_AR_CONFIG.card;

  entity.object3D?.scale.set(1, 1, 1);

  entity.innerHTML = `
    <a-entity
      id="${targetEntityId}BillboardRoot"
      position="0 0 0"
      rotation="0 0 0"
      face-camera-y="enabled: ${LOCATION_AR_CONFIG.billboard.enabled}; flip: ${LOCATION_AR_CONFIG.billboard.flip}"
    >
      <a-entity
        id="${targetEntityId}CardRoot"
        position="0 0 0"
        rotation="0 0 0"
        scale="${scale} ${scale} ${scale}"
      >
        <a-plane
          id="${targetEntityId}SingleCardPlane"
          position="0 0 0"
          width="${width}"
          height="${height}"
          material="src: #${cardAssetId}; transparent: true; side: double;"
        ></a-plane>
      </a-entity>
    </a-entity>
  `;

  requestAnimationFrame(() => {
    const cardRoot = document.getElementById(`${targetEntityId}CardRoot`);
    const cardPlane = document.getElementById(`${targetEntityId}SingleCardPlane`);

    console.log("[AR BUILD] Modular one-plane AR card built:", {
      targetEntityId,
      landmark: landmark.name,
      cardAssetId,
      cardScale: scale,
      planeWidth: width,
      planeHeight: height,
      cardRootScaleAttr: cardRoot?.getAttribute("scale"),
      cardRootObjectScale: {
        x: cardRoot?.object3D?.scale?.x,
        y: cardRoot?.object3D?.scale?.y,
        z: cardRoot?.object3D?.scale?.z
      },
      planeWidthAttr: cardPlane?.getAttribute("width"),
      planeHeightAttr: cardPlane?.getAttribute("height"),
      parentScale: {
        x: entity.object3D?.scale?.x,
        y: entity.object3D?.scale?.y,
        z: entity.object3D?.scale?.z
      },
      children: entity.children?.length || 0
    });
  });
}

function buildLocationARContent(landmark) {
  console.log("[AR BUILD] Building modular AR content into readableZoneARContent.");

  buildARContentInto("readableZoneARContent", landmark);
}

function showNavigationUI() {
  if (!DOM.locationARStatus) return;

  DOM.locationARStatus.dataset.state = "idle";

  if (!state.location) {
    DOM.locationARStatus.textContent = "Waiting for GPS to locate you.";
  } else if (isGPSPoor()) {
    DOM.locationARStatus.textContent =
      "GPS accuracy is weak. Move slowly or wait a moment.";
  } else {
    DOM.locationARStatus.textContent = "Move closer to unlock Location AR.";
  }

  if (DOM.captureBtn) {
    DOM.captureBtn.disabled = true;
  }
}

function showARReadyUI() {
  if (DOM.locationARStatus) {
    DOM.locationARStatus.dataset.state = "found";
    DOM.locationARStatus.textContent = "Location AR active. Capture your visit.";
  }

  if (DOM.captureBtn) {
    DOM.captureBtn.disabled = false;
  }
}

function updateLocationARVisibility() {
  const gpsEntity = document.getElementById("locationBasedARContent");
  const readableEntity = document.getElementById("readableZoneARContent");
  const cameraFixedEntity = document.getElementById("cameraFixedARContent");

  const canShow =
    Boolean(state.selectedLandmark) &&
    Boolean(state.location) &&
    state.inRange === true;

  gpsEntity?.setAttribute("visible", "false");
  cameraFixedEntity?.setAttribute("visible", "false");

  if (gpsEntity?.object3D) {
    gpsEntity.object3D.visible = false;
  }

  if (cameraFixedEntity?.object3D) {
    cameraFixedEntity.object3D.visible = false;
  }

  if (canShow) {
    if (!state.readableARPlaced) {
      const placed = placeReadableZoneAR();
      if (placed) state.readableARPlaced = true;
    }

    readableEntity?.setAttribute("visible", "true");
    if (readableEntity?.object3D) {
      readableEntity.object3D.visible = true;
      readableEntity.object3D.scale.set(1, 1, 1);
    }

    state.arVisible = true;
    showARReadyUI();
    unlockSelectedLandmark();
  } else {
    readableEntity?.setAttribute("visible", "false");

    if (readableEntity?.object3D) {
      readableEntity.object3D.visible = false;
    }

    state.readableARPlaced = false;
    state.arVisible = false;
    showNavigationUI();
  }

  console.log("[AR VISIBILITY] Modular AR status:", {
    canShow,
    selectedLandmark: Boolean(state.selectedLandmark),
    location: Boolean(state.location),
    inRange: state.inRange,
    readableExists: Boolean(readableEntity),
    readableVisibleAttr: readableEntity?.getAttribute("visible"),
    readableChildren: readableEntity?.children?.length || 0,
    readableParentScale: {
      x: readableEntity?.object3D?.scale?.x,
      y: readableEntity?.object3D?.scale?.y,
      z: readableEntity?.object3D?.scale?.z
    },
    readableARPlaced: state.readableARPlaced,
    arVisible: state.arVisible
  });
}

function updateGeofenceState() {
  const landmark = state.selectedLandmark;
  const location = state.location;

  if (!landmark || !location) return;

  const userLat = Number(location.lat);
  const userLng = Number(location.lng);
  const destLat = Number(landmark.lat);
  const destLng = Number(landmark.lng);

  if (
    !Number.isFinite(userLat) ||
    !Number.isFinite(userLng) ||
    !Number.isFinite(destLat) ||
    !Number.isFinite(destLng)
  ) {
    console.warn("[GPS] Invalid geofence coordinates.", {
      location,
      landmark
    });
    return;
  }

  const distanceM = haversine(userLat, userLng, destLat, destLng);

  state.distanceM = distanceM;
  state.inRange = distanceM <= GEOFENCE_M;

  updateTopBarMetrics();
  ensureCameraStillRunning();
  updateLocationARVisibility();

  console.log("[LOCATION AR] User location:", state.location);
  console.log("[LOCATION AR] Distance:", state.distanceM);
  console.log("[LOCATION AR] In range:", state.inRange);
}

async function markVisited(landmark) {
  if (!landmark?.id) return "skipped";

  const id = normalizeLandmarkId(landmark.id);
  localStorage.setItem("kk_last_unlocked", id);
  localStorage.setItem("kk_active_landmark", id);

  const user = auth.currentUser;

  if (!user) {
    console.log("[ACHIEVEMENT] No signed-in user. Progress was not saved.");
    return "skipped";
  }

  try {
    const progressRef = doc(db, "users", user.uid, "progress", "summary");
    const snap = await getDoc(progressRef);
    const data = snap.exists() ? snap.data() : {};
    const visited = Array.isArray(data.visitedLandmarks)
      ? data.visitedLandmarks.map(normalizeLandmarkId).filter(Boolean)
      : [];
    const visitedSet = new Set(visited);

    if (visitedSet.has(id)) {
      console.log("[ACHIEVEMENT] Already unlocked:", landmark.name);
      return "existing";
    }

    visitedSet.add(id);
    const updatedVisited = Array.from(visitedSet);
    const updatedXP = updatedVisited.length * 100;

    await setDoc(progressRef, {
      visitedLandmarks: updatedVisited,
      totalXP: updatedXP,
      updatedAt: serverTimestamp()
    }, { merge: true });

    console.log("[ACHIEVEMENT] Account-bound achievement unlocked:", landmark.name);
    return "saved";
  } catch (error) {
    console.warn("[ACHIEVEMENT] Account progress save failed:", error);
    return "error";
  }
}

async function unlockSelectedLandmark() {
  if (state.achievementUnlocked || !state.selectedLandmark) return;

  state.achievementUnlocked = true;
  const unlockStatus = await markVisited(state.selectedLandmark);

  if (unlockStatus === "saved") {
    showToast(`Achievement unlocked: ${state.selectedLandmark.name}`);
  } else if (unlockStatus === "existing") {
    showToast(`${state.selectedLandmark.name} already unlocked.`);
  } else if (unlockStatus === "skipped") {
    showToast("Sign in to save achievements.");
  } else {
    showToast("Unable to save achievement.");
  }
}

function startGPSWatcher() {
  if (state.watchId) return;

  if (!navigator.geolocation) {
    showToast("GPS is not supported on this device.");
    updateTopBarMetrics();
    hideLoadingScreen();
    return;
  }

  setLoadingStep("gps", "loading");
  setLoadingProgress(72, "Waiting for GPS permission...");

  state.watchId = navigator.geolocation.watchPosition(
    (position) => {
      state.location = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy
      };

      console.log("[LOCATION AR] User location:", state.location);
      setLoadingStep("gps", "done");
      updateGeofenceState();
      updateGPSAccuracyUI();
      updateCameraMiniMap();
      hideLoadingScreen();
    },
    (error) => {
      console.warn("[GPS] Error:", error);
      setLoadingStep("gps", "error");
      updateTopBarMetrics();
      showToast("Unable to access GPS. Please enable location services.");
      updateLocationARVisibility();
      hideLoadingScreen();
    },
    {
      enableHighAccuracy: true,
      maximumAge: 3000,
      timeout: 15000
    }
  );
}

function stopGPSWatcher() {
  if (!state.watchId) {
    clearMinimapRoute();
    return;
  }

  navigator.geolocation.clearWatch(state.watchId);
  state.watchId = null;
  clearMinimapRoute();
}

function waitForSceneThenStartGPS() {
  const scene = DOM.scene || document.getElementById("arScene");

  if (!scene) {
    console.error("[LOCATION AR] A-Frame scene not found.");
    showCameraError("AR scene could not be found. Please reload the page.");
    return;
  }

  const start = () => {
    if (state.sceneReady) return;

    console.log("[LOCATION AR] A-Frame scene loaded.");
    state.sceneReady = true;
    setLoadingStep("ar", "done");
    setLoadingProgress(90, "Waiting for GPS");
    startGPSWatcher();

    window.setTimeout(() => {
      if (!state.location) {
        hideLoadingScreen();
      }
    }, 1800);
  };

  if (scene.hasLoaded) {
    start();
  } else {
    scene.addEventListener("loaded", start, { once: true });
  }

  window.setTimeout(() => {
    if (!state.sceneReady) {
      console.warn("[LOCATION AR] Scene load event timed out. Starting GPS anyway.");
      start();
    }
  }, 4500);
}

function openInfoPanel() {
  DOM.infoPanel?.classList.add("open");
  DOM.infoPanel?.setAttribute("aria-hidden", "false");
}

function closeInfoPanel() {
  DOM.infoPanel?.classList.remove("open");
  DOM.infoPanel?.setAttribute("aria-hidden", "true");
}

function recenterReadableAR() {
  const placed = placeReadableZoneAR();

  if (placed) {
    state.readableARPlaced = true;
    showToast("AR recentered.");
  }
}

window.recenterReadableAR = recenterReadableAR;

function getCameraVideoElement() {
  return (
    document.querySelector("video") ||
    document.querySelector("video.a-canvas") ||
    document.querySelector("#arScene video")
  );
}

function getARCanvasElement() {
  const scene = document.getElementById("arScene");
  return (
    scene?.canvas ||
    document.querySelector("a-scene canvas") ||
    document.querySelector("canvas.a-canvas") ||
    document.querySelector("canvas")
  );
}

async function waitForFreshARFrame() {
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);

  const scene = document.getElementById("arScene");

  try {
    if (scene?.renderer && scene?.object3D && scene?.camera) {
      scene.renderer.render(scene.object3D, scene.camera);
    }
  } catch (error) {
    console.warn("[CAPTURE] Manual AR render failed:", error);
  }
}

function drawVideoCover(ctx, video, canvasWidth, canvasHeight) {
  const videoWidth = video.videoWidth || canvasWidth;
  const videoHeight = video.videoHeight || canvasHeight;
  const videoRatio = videoWidth / videoHeight;
  const canvasRatio = canvasWidth / canvasHeight;

  let drawWidth;
  let drawHeight;
  let offsetX;
  let offsetY;

  if (videoRatio > canvasRatio) {
    drawHeight = canvasHeight;
    drawWidth = canvasHeight * videoRatio;
    offsetX = (canvasWidth - drawWidth) / 2;
    offsetY = 0;
  } else {
    drawWidth = canvasWidth;
    drawHeight = canvasWidth / videoRatio;
    offsetX = 0;
    offsetY = (canvasHeight - drawHeight) / 2;
  }

  ctx.drawImage(video, offsetX, offsetY, drawWidth, drawHeight);
}

function drawCaptureOverlay(ctx, width, height) {
  const landmarkName = state.selectedLandmark?.name || "KA-KALAKBAY";
  const distance = Number.isFinite(state.distanceM)
    ? formatDistance(state.distanceM)
    : "--";
  const boxHeight = 118;
  const y = height - boxHeight;

  ctx.save();

  ctx.fillStyle = "rgba(10, 22, 40, 0.82)";
  ctx.fillRect(0, y, width, boxHeight);

  ctx.fillStyle = "#FFFFFF";
  ctx.font = "800 24px Arial, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(landmarkName, 24, y + 24);

  ctx.fillStyle = "#DDEB9D";
  ctx.font = "700 17px Arial, sans-serif";
  ctx.fillText(`${distance} away - Location AR active`, 24, y + 66);

  ctx.restore();
}

function flashCaptureScreen() {
  const flash = document.createElement("div");
  flash.setAttribute("aria-hidden", "true");
  Object.assign(flash.style, {
    position: "fixed",
    inset: "0",
    zIndex: "10000",
    background: "#FFFFFF",
    opacity: "0.85",
    pointerEvents: "none",
    transition: "opacity 220ms ease"
  });

  document.body.appendChild(flash);

  requestAnimationFrame(() => {
    flash.style.opacity = "0";
  });

  window.setTimeout(() => {
    flash.remove();
  }, 260);
}

async function captureCurrentARView() {
  await waitForFreshARFrame();

  const video = getCameraVideoElement();
  const arCanvas = getARCanvasElement();
  const width = window.innerWidth;
  const height = window.innerHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const outputCanvas = document.createElement("canvas");

  outputCanvas.width = Math.round(width * dpr);
  outputCanvas.height = Math.round(height * dpr);

  const ctx = outputCanvas.getContext("2d", {
    alpha: false,
    willReadFrequently: true
  });

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  if (video && video.readyState >= 2) {
    drawVideoCover(ctx, video, width, height);
  } else {
    console.warn("[CAPTURE] Video not ready. Using fallback background.");
    ctx.fillStyle = "#0A1628";
    ctx.fillRect(0, 0, width, height);
  }

  if (arCanvas) {
    try {
      ctx.drawImage(arCanvas, 0, 0, width, height);
      console.log("[CAPTURE] AR canvas drawn into capture.");
    } catch (error) {
      console.warn("[CAPTURE] Failed to draw AR canvas:", error);
    }
  } else {
    console.warn("[CAPTURE] AR canvas not found.");
  }

  drawCaptureOverlay(ctx, width, height);

  return outputCanvas.toDataURL("image/png");
}

function buildCaptureFilename() {
  const landmarkId = normalizeLandmarkId(state.selectedLandmark?.id) || "landmark";
  const timestamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-");

  return `ka-kalakbay-${landmarkId}-${timestamp}.png`;
}

function downloadCapture(dataUrl, filename) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function handleCapture() {
  if (state.captureBusy) return;

  if (!state.selectedLandmark) {
    showToast("No landmark selected.");
    return;
  }

  if (!state.inRange) {
    showToast("Move closer to the landmark before capturing.");
    return;
  }

  const arEntity = document.getElementById("readableZoneARContent");
  state.captureBusy = true;
  DOM.captureBtn?.classList.add("is-capturing");

  console.log("[CAPTURE] Video element:", getCameraVideoElement());
  console.log("[CAPTURE] AR canvas element:", getARCanvasElement());
  console.log("[CAPTURE] AR visible:", arEntity?.getAttribute("visible"));
  console.log("[CAPTURE] Scene canvas:", document.getElementById("arScene")?.canvas);
  console.log("[CAPTURE] Starting capture:", {
    inRange: state.inRange,
    arVisible: arEntity?.getAttribute("visible"),
    video: getCameraVideoElement(),
    canvas: getARCanvasElement()
  });

  try {
    flashCaptureScreen();
    const dataUrl = await captureCurrentARView();
    downloadCapture(dataUrl, buildCaptureFilename());
    showToast("AR capture saved to your device!");
    await unlockSelectedLandmark();
  } catch (error) {
    console.error("[CAPTURE] Failed:", error);
    showToast("Unable to capture AR moment.");
  } finally {
    state.captureBusy = false;
    DOM.captureBtn?.classList.remove("is-capturing");
  }
}

function goBack() {
  stopLandmarkSpeech();
  stopGPSWatcher();
  stopCamera();
  window.history.back();
}

function bindEvents() {
  document.querySelectorAll("[data-action='back'], .back-btn, .missing-back").forEach((button) => {
    button.addEventListener("click", goBack);
  });

  let infoLongPressTimer = null;
  let infoLongPressTriggered = false;

  DOM.infoBtn?.addEventListener("pointerdown", () => {
    infoLongPressTriggered = false;
    window.clearTimeout(infoLongPressTimer);
    infoLongPressTimer = window.setTimeout(() => {
      infoLongPressTriggered = true;
      recenterReadableAR();
    }, 650);
  });

  DOM.infoBtn?.addEventListener("pointerup", () => {
    window.clearTimeout(infoLongPressTimer);
    infoLongPressTimer = null;
  });

  DOM.infoBtn?.addEventListener("pointercancel", () => {
    window.clearTimeout(infoLongPressTimer);
    infoLongPressTimer = null;
  });

  DOM.infoBtn?.addEventListener("pointerleave", () => {
    window.clearTimeout(infoLongPressTimer);
    infoLongPressTimer = null;
  });

  DOM.infoBtn?.addEventListener("click", (event) => {
    if (infoLongPressTriggered) {
      event.preventDefault();
      infoLongPressTriggered = false;
      return;
    }

    openInfoPanel();
  });
  DOM.panelClose?.addEventListener("click", closeInfoPanel);
  DOM.captureBtn?.addEventListener("click", handleCapture);
  DOM.ttsBtn?.addEventListener("click", speakLandmarkInfo);
  DOM.cameraMiniMapWrap?.addEventListener("click", () => {
    showToast("Mini map shows your location and the landmark.");
  });
  DOM.retryBtn?.addEventListener("click", () => window.location.reload());
  DOM.loadingStartBtn?.addEventListener("click", () => {
    hideLoadingStartButton();
    waitForSceneThenStartGPS();
  });

  window.addEventListener("beforeunload", stopGPSWatcher);
  window.addEventListener("beforeunload", stopCamera);
  window.addEventListener("beforeunload", stopLandmarkSpeech);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopLandmarkSpeech();
      return;
    }

    updateTopBarMetrics();
  });
}

function logARScriptStatus() {
  console.log("[AR LOAD] AFRAME:", window.AFRAME ? "loaded" : "missing");
  console.log("[AR LOAD] THREEx:", window.THREEx ? "loaded" : "missing");

  if (window.AFRAME?.components) {
    console.log("[AR LOAD] gps-camera component:", AFRAME.components["gps-camera"]);
    console.log(
      "[AR LOAD] gps-entity-place component:",
      AFRAME.components["gps-entity-place"]
    );
  }
}

async function initCameraPage() {
  try {
    showAppLoader("Loading selected landmark");

    cacheDOM();
    applyAccessibilitySettings();
    registerBillboardComponent();
    applyARDisplayOverridesFromURL();
    logARCalibrationStatus();
    console.log("[AR MODE]", "Coordinate-based AR");

    logARScriptStatus();
    bindEvents();

    setLoadingStep("camera", "loading");
    setLoadingStep("gps", "idle");
    setLoadingStep("ar", "idle");
    setLoadingProgress(18, "Loading selected landmark");

    const selectedId = getSelectedLandmarkId();

    if (!selectedId) {
      showMissingSelectionState();
      showToast("Please select a landmark first.");
      return;
    }

    state.selectedLandmark = await loadSelectedLandmarkFromFirestore(selectedId);

    if (!state.selectedLandmark) {
      showMissingSelectionState();
      showToast("Please select a landmark first.");
      return;
    }

    console.log("[LOCATION AR] Selected landmark:", state.selectedLandmark);

    if (!window.AFRAME) {
      showCameraError("A-Frame did not load. Check your connection and reload.");
      return;
    }

    setLoadingProgress(42, "Preparing location AR");
    updateStaticLandmarkUI();
    updateTopBarMetrics();
    showARSafetyModalIfNeeded();

    buildLocationARContent(state.selectedLandmark);
    state.readableARPlaced = false;
    updateLocationARAnchor(state.selectedLandmark);
    updateLocationARVisibility();

    DOM.hud?.classList.add("active");
    DOM.bottomBar?.classList.add("active");

    setCameraMiniMapVisible(Boolean(state.selectedLandmark));
    initCameraMiniMap();
    startMiniMapHeadingWatcher();
    updateCameraMiniMap();

    showNavigationUI();

    hideLoadingStartButton();

    setLoadingProgress(62, "Starting AR camera");
    await startCamera();
    waitForSceneThenStartGPS();
  } catch (error) {
    console.error("[CAMERA INIT] Failed:", error);
    showCameraError("Unable to start AR camera. Please allow permissions and try again.");
  }
}

document.addEventListener("DOMContentLoaded", initCameraPage);
