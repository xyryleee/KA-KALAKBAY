import { auth, db } from "./config.js";
import { getLandmarkById } from "./landmark-service.js";
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
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
  heightY: 1.6,
  baseScale: 1.15,
  billboardFlip: false,
  useReadableZoneAnchor: true,
  rightOffset: 1.6,
  forwardDistance: 4.5,
  verticalOffset: 0.2
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
  ulo_ng_apo: "ulo-ng-apo"
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
  achievementUnlocked: false
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
  DOM.infoPanel = document.getElementById("infoPanel");
  DOM.panelName = document.getElementById("panelName");
  DOM.panelCat = document.getElementById("panelCat");
  DOM.panelDistance = document.getElementById("panelDistance");
  DOM.panelDesc = document.getElementById("panelDesc");
  DOM.panelMapLink = document.getElementById("panelMapLink");
  DOM.panelClose = document.getElementById("panelClose");
  DOM.toast = document.getElementById("toast");
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
  console.log("[AR CALIBRATION] Billboard enabled on AR content root.");
  console.log("[AR CALIBRATION] Readable zone anchor:", LOCATION_AR_CONFIG.useReadableZoneAnchor);
  console.log("[AR DISPLAY] Using canvas texture panels for text.");
  console.log("[AR DISPLAY] Font:", AR_FONT_FAMILY);
  console.log("[AR DISPLAY] Scale:", LOCATION_AR_CONFIG.baseScale);
  console.log("[AR DISPLAY] Height:", LOCATION_AR_CONFIG.heightY);
  console.log("[AR DISPLAY] Billboard flip:", LOCATION_AR_CONFIG.billboardFlip);
  console.log("[AR DISPLAY] Right offset:", LOCATION_AR_CONFIG.rightOffset);
  console.log("[AR DISPLAY] Forward distance:", LOCATION_AR_CONFIG.forwardDistance);
  console.log("[AR TRANSFORM] Anchor controls position only.");
  console.log("[AR TRANSFORM] Billboard root controls rotation only.");
  console.log("[AR TRANSFORM] Card root controls scale only.");
  console.log("[AR TRANSFORM] Planes have fixed dimensions only.");
  console.log("[AR TRANSFORM] look-at removed; using face-camera-y only.");
}

function applyReadableARPlacementFromURL() {
  const params = new URLSearchParams(window.location.search);

  const right = Number(params.get("rightOffset"));
  const forward = Number(params.get("forwardDistance"));
  const height = Number(params.get("arHeight"));

  if (Number.isFinite(right)) {
    LOCATION_AR_CONFIG.rightOffset = right;
  }

  if (Number.isFinite(forward)) {
    LOCATION_AR_CONFIG.forwardDistance = forward;
  }

  if (Number.isFinite(height)) {
    LOCATION_AR_CONFIG.heightY = height;
  }

  console.log("[READABLE AR CONFIG]", LOCATION_AR_CONFIG);
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

function createTextTexture(id, options = {}) {
  const {
    width = 1024,
    height = 512,
    background = "#ffffff",
    title = "",
    body = "",
    titleColor = "#0A1628",
    bodyColor = "#0A1628",
    titleSize = 64,
    bodySize = 42,
    titleWeight = 900,
    bodyWeight = 800,
    padding = 56,
    radius = 40,
    align = "left"
  } = options;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.id = id;

  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  ctx.clearRect(0, 0, width, height);

  ctx.fillStyle = background;
  roundCanvasRect(ctx, 0, 0, width, height, radius);
  ctx.fill();

  ctx.textBaseline = "top";
  ctx.textAlign = align;

  const textX = align === "center" ? width / 2 : padding;

  if (title) {
    ctx.fillStyle = titleColor;
    ctx.font = `${titleWeight} ${titleSize}px ${AR_FONT_FAMILY}`;
    ctx.fillText(title, textX, padding);
  }

  if (body) {
    ctx.fillStyle = bodyColor;
    ctx.font = `${bodyWeight} ${bodySize}px ${AR_FONT_FAMILY}`;

    const bodyY = title ? padding + titleSize + 32 : padding;
    wrapCanvasText(
      ctx,
      body,
      textX,
      bodyY,
      width - padding * 2,
      bodySize * 1.35,
      align
    );
  }

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
  const words = String(text || "").split(/\s+/);
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

  entity.setAttribute("position", `0 ${LOCATION_AR_CONFIG.heightY} 0`);

  console.log("[LOCATION AR] Anchor set:", {
    name: landmark.name,
    lat,
    lng,
    heightY: LOCATION_AR_CONFIG.heightY
  });
}

function placeReadableZoneARToRight() {
  const entity = document.getElementById("readableZoneARContent");
  const cameraEl =
    document.getElementById("gpsCamera") ||
    document.querySelector("[camera]");

  if (!entity || !cameraEl || !cameraEl.object3D || !window.THREE) {
    console.warn("[READABLE AR] Cannot place readable AR yet.");
    return false;
  }

  const cameraObject = cameraEl.object3D;

  cameraObject.updateMatrixWorld(true);

  const localOffset = new THREE.Vector3(
    LOCATION_AR_CONFIG.rightOffset,
    LOCATION_AR_CONFIG.heightY + LOCATION_AR_CONFIG.verticalOffset,
    -LOCATION_AR_CONFIG.forwardDistance
  );

  const targetPosition = localOffset.clone();
  cameraObject.localToWorld(targetPosition);

  entity.object3D.position.copy(targetPosition);
  entity.object3D.rotation.set(0, 0, 0);
  entity.object3D.updateMatrixWorld(true);

  console.log("[READABLE AR] Placed using camera local offset:", {
    localOffset: {
      x: localOffset.x,
      y: localOffset.y,
      z: localOffset.z
    },
    worldPosition: {
      x: targetPosition.x,
      y: targetPosition.y,
      z: targetPosition.z
    },
    rightOffset: LOCATION_AR_CONFIG.rightOffset,
    forwardDistance: LOCATION_AR_CONFIG.forwardDistance,
    heightY: LOCATION_AR_CONFIG.heightY,
    verticalOffset: LOCATION_AR_CONFIG.verticalOffset
  });

  return true;
}

function hideLocationBasedARContent() {
  const entity =
    DOM.locationARContent ||
    document.getElementById("locationBasedARContent");

  entity?.setAttribute("visible", "false");

  const readableEntity =
    DOM.readableZoneARContent ||
    document.getElementById("readableZoneARContent");

  readableEntity?.setAttribute("visible", "false");
  state.readableARPlaced = false;
}

function buildARContentInto(targetEntityId, landmark) {
  const entity = document.getElementById(targetEntityId);

  if (!entity || !landmark) return;

  const name = landmark.name || "Landmark";
  const image = landmark.image || "assets/images/default-landmark.jpg";

  const history = limitARText(
    landmark.history ||
      landmark.desc ||
      landmark.description ||
      "Historical information will appear here.",
    170
  );

  const description = limitARText(
    landmark.description ||
      landmark.desc ||
      landmark.history ||
      "Explore this landmark through KA-KALAKBAY.",
    210
  );

  const safeId = String(landmark.id || "landmark").replace(/[^a-z0-9_-]/gi, "-");
  const targetSafeId = String(targetEntityId || "ar-target").replace(
    /[^a-z0-9_-]/gi,
    "-"
  );

  const titleAssetId = `ar-title-${targetSafeId}-${safeId}`;
  const historyAssetId = `ar-history-${targetSafeId}-${safeId}`;
  const descAssetId = `ar-desc-${targetSafeId}-${safeId}`;

  const titleCanvas = createTextTexture(titleAssetId, {
    width: 1200,
    height: 220,
    background: "#FFFFFF",
    body: name.toUpperCase(),
    bodyColor: "#0A1628",
    bodySize: 70,
    bodyWeight: 900,
    padding: 48,
    radius: 40,
    align: "center"
  });

  const historyCanvas = createTextTexture(historyAssetId, {
    width: 900,
    height: 820,
    background: "#DDEB9D",
    title: "HISTORY",
    body: history,
    titleColor: "#0A1628",
    bodyColor: "#0A1628",
    titleSize: 58,
    bodySize: 42,
    padding: 58,
    radius: 44,
    align: "center"
  });

  const descCanvas = createTextTexture(descAssetId, {
    width: 1200,
    height: 300,
    background: "#0A1628",
    body: description,
    bodyColor: "#FFFFFF",
    bodySize: 42,
    padding: 54,
    radius: 40,
    align: "center"
  });

  registerCanvasAsset(titleAssetId, titleCanvas);
  registerCanvasAsset(historyAssetId, historyCanvas);
  registerCanvasAsset(descAssetId, descCanvas);

  entity.innerHTML = `
    <a-entity
      id="${targetEntityId}BillboardRoot"
      position="0 0 0"
      rotation="0 0 0"
      face-camera-y="enabled: true; flip: ${LOCATION_AR_CONFIG.billboardFlip}"
    >
      <a-entity
        id="${targetEntityId}CardRoot"
        position="0 0 0"
        rotation="0 0 0"
        scale="${LOCATION_AR_CONFIG.baseScale} ${LOCATION_AR_CONFIG.baseScale} ${LOCATION_AR_CONFIG.baseScale}"
      >
        <!-- ROW 1: LANDMARK NAME -->
        <a-plane
          position="0 1.55 0"
          width="3.6"
          height="0.65"
          material="src: #${titleAssetId}; transparent: true; side: double;"
        ></a-plane>

        <!-- ROW 2 LEFT: GALLERY CARD BACKGROUND -->
        <a-plane
          position="-0.95 0.45 0"
          width="1.7"
          height="1.55"
          color="#27667B"
          material="opacity: 0.98; transparent: true; side: double;"
        ></a-plane>

        <!-- ROW 2 LEFT: IMAGE -->
        <a-plane
          position="-0.95 0.35 0.06"
          width="1.35"
          height="0.95"
          material="src: url(${image}); transparent: true; side: double;"
        ></a-plane>

        <!-- ROW 2 RIGHT: HISTORY -->
        <a-plane
          position="0.95 0.45 0"
          width="1.7"
          height="1.55"
          material="src: #${historyAssetId}; transparent: true; side: double;"
        ></a-plane>

        <!-- ROW 3: DESCRIPTION -->
        <a-plane
          position="0 -0.85 0"
          width="3.6"
          height="0.9"
          material="src: #${descAssetId}; transparent: true; side: double;"
        ></a-plane>
      </a-entity>
    </a-entity>
  `;

  console.log("[AR DISPLAY] Built readable canvas-texture AR content:", {
    targetEntityId,
    name,
    image,
    history,
    description
  });
  console.log("[AR DISPLAY] Fixed base scale:", LOCATION_AR_CONFIG.baseScale);
  console.log("[AR DISPLAY] No distance-based scaling active.");
  console.log("[AR DISPLAY] Target anchor controls position:", targetEntityId);
  console.log("[AR DISPLAY] Billboard root controls rotation.");
  console.log("[AR DISPLAY] Card root controls scale.");
}

function buildLocationARContent(landmark) {
  if (LOCATION_AR_CONFIG.useReadableZoneAnchor) {
    buildARContentInto("readableZoneARContent", landmark);
    return;
  }

  buildARContentInto("locationBasedARContent", landmark);
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
  const gpsEntity =
    DOM.locationARContent ||
    document.getElementById("locationBasedARContent");
  const readableEntity =
    DOM.readableZoneARContent ||
    document.getElementById("readableZoneARContent");

  if (!gpsEntity && !readableEntity) return;

  const canShow =
    Boolean(state.selectedLandmark) &&
    Boolean(state.location) &&
    state.inRange === true;

  if (LOCATION_AR_CONFIG.useReadableZoneAnchor) {
    gpsEntity?.setAttribute("visible", "false");

    if (canShow) {
      if (!state.readableARPlaced) {
        const placed = placeReadableZoneARToRight();

        if (placed) {
          state.readableARPlaced = true;
        }
      }

      readableEntity?.setAttribute("visible", "true");
    } else {
      readableEntity?.setAttribute("visible", "false");
      state.readableARPlaced = false;
    }

    state.arVisible = canShow;

    if (canShow) {
      showARReadyUI();
      unlockSelectedLandmark();
    } else {
      showNavigationUI();
    }

    console.log("[READABLE AR] Visibility:", {
      canShow,
      placed: state.readableARPlaced,
      distanceM: state.distanceM
    });

    return;
  }

  gpsEntity?.setAttribute("visible", canShow ? "true" : "false");
  readableEntity?.setAttribute("visible", "false");
  state.arVisible = canShow;

  if (canShow) {
    showARReadyUI();
    unlockSelectedLandmark();
  } else {
    showNavigationUI();
  }

  console.log("[LOCATION AR] Visibility:", {
    canShow,
    inRange: state.inRange,
    distanceM: state.distanceM
  });
  console.log("[AR DISPLAY] Distance:", state.distanceM);
  console.log("[AR DISPLAY] Fallback GPS anchor controls position.");
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
  if (!state.watchId) return;

  navigator.geolocation.clearWatch(state.watchId);
  state.watchId = null;
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
  if (!LOCATION_AR_CONFIG.useReadableZoneAnchor) return;

  const placed = placeReadableZoneARToRight();

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

  const arEntity = LOCATION_AR_CONFIG.useReadableZoneAnchor
    ? document.getElementById("readableZoneARContent")
    : document.getElementById("locationBasedARContent");
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
  stopGPSWatcher();
  stopCamera();
  window.history.back();
}

function bindEvents() {
  document.querySelectorAll("[data-action='back']").forEach((button) => {
    button.addEventListener("click", goBack);
  });

  document.querySelectorAll(".back-btn, .missing-back").forEach((link) => {
    link.addEventListener("click", stopGPSWatcher);
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
  DOM.retryBtn?.addEventListener("click", () => window.location.reload());
  DOM.loadingStartBtn?.addEventListener("click", () => {
    hideLoadingStartButton();
    waitForSceneThenStartGPS();
  });

  window.addEventListener("beforeunload", stopGPSWatcher);
  window.addEventListener("beforeunload", stopCamera);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) return;
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
    registerBillboardComponent();
    applyReadableARPlacementFromURL();
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

    buildLocationARContent(state.selectedLandmark);
    updateLocationARAnchor(state.selectedLandmark);

    DOM.hud?.classList.add("active");
    DOM.bottomBar?.classList.add("active");

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
