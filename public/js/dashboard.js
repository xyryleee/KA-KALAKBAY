import { auth, db } from "./config.js";
import { onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  doc, updateDoc, getDoc, serverTimestamp, setDoc,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  applyAccessibilitySettings, applySettings, showToast, setLoading,
  toggleDark, toggleCB, isDark, isCB,
  hideAppLoader, showAppLoader, installLoaderFailsafe, setLoaderText,
} from "./app.js";
import { APO_FACTS } from "./apo-facts.js";
import { getAllLandmarks } from "./landmark-service.js";

applySettings();
applyAccessibilitySettings();
installLoaderFailsafe(10000);
setLoaderText("Loading your Lakbay");

let AR_LANDMARKS = [];
let AR_LANDMARK_BY_ID = new Map();
const LANDMARK_ID_ALIASES = {
  "diocese-columban": "columban",
  diocese_columban: "columban",
  "st-columban": "columban",
  st_columban: "columban",
  columban: "columban",
  ulo_ng_apo: "ulo-ng-apo",
  marikit_park: "marikit-park",
  rizal_triangle: "rizal-triangle",
  city_hall: "city-hall",
  gordon_college: "gordon-college",
  spanish_gate: "spanish-gate"
};

function normalizeLandmarkId(raw) {
  if (!raw) return null;
  const cleaned = String(raw).trim().toLowerCase();
  const underscored = cleaned.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const hyphenated = underscored.replace(/_/g, "-");
  return LANDMARK_ID_ALIASES[cleaned] || LANDMARK_ID_ALIASES[underscored] || LANDMARK_ID_ALIASES[hyphenated] || hyphenated;
}

function getLandmarkImage(landmark) {
  return landmark?.image || "";
}

function setDashboardLandmarks(landmarks) {
  AR_LANDMARKS = Array.isArray(landmarks) ? landmarks : [];
  AR_LANDMARK_BY_ID = new Map(
    AR_LANDMARKS.map((lm) => [normalizeLandmarkId(lm.id), lm])
  );
}

async function loadLandmarksForDashboard() {
  try {
    const landmarks = await getAllLandmarks();
    setDashboardLandmarks(landmarks);
  } catch (error) {
    console.error("[LANDMARKS] Failed to load from Firestore:", error);
    setDashboardLandmarks([]);
    showToast?.("Unable to load landmarks from Firestore.");
  }
}

setDashboardLandmarks([]);

function getFactOfTheDay() {
  if (!Array.isArray(APO_FACTS) || APO_FACTS.length === 0) {
    return null;
  }

  const today = new Date();
  const seed = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
  return APO_FACTS[seed % APO_FACTS.length];
}

function renderApoFactOfTheDay() {
  const fact = getFactOfTheDay();
  const card = document.getElementById("apoFactCard");
  const category = document.getElementById("apoFactCategory");
  const title = document.getElementById("apoFactTitle");
  const text = document.getElementById("apoFactText");

  if (!card || !fact) return;

  if (category) category.textContent = fact.category || "Fact";
  if (title) title.textContent = fact.title || "Apo's Fact of the Day";
  if (text) text.textContent = fact.text || "";

  card.dataset.relatedLandmarkId = fact.relatedLandmarkId || "";
}

function getArLandmark(idOrLandmark) {
  if (typeof idOrLandmark === "object" && idOrLandmark?.id) {
    return AR_LANDMARK_BY_ID.get(normalizeLandmarkId(idOrLandmark.id)) || null;
  }
  return AR_LANDMARK_BY_ID.get(normalizeLandmarkId(idOrLandmark)) || null;
}

window.openARForLandmark = function openARForLandmark(idOrLandmark) {
  const landmark = getArLandmark(idOrLandmark);
  if (!landmark) {
    showToast("Please choose a landmark first.");
    window.openLandmarkSelection?.();
    return;
  }
  localStorage.setItem("selectedLandmarkId", landmark.id);
  localStorage.removeItem("selectedLandmark");
  showAppLoader("Opening AR camera");
  window.location.href = "camera.html";
};

window.openOSMForLandmark = function openOSMForLandmark(idOrLandmark) {
  const landmark = getArLandmark(idOrLandmark);
  if (!landmark) return;
  window.open(
    `https://www.openstreetmap.org/?mlat=${landmark.lat}&mlon=${landmark.lng}#map=18/${landmark.lat}/${landmark.lng}`,
    "_blank",
    "noopener"
  );
};

function renderLandmarkSelection() {
  const list = document.getElementById("landmarkSelectionList");
  if (!list) return;

  list.innerHTML = "";
  AR_LANDMARKS.forEach((landmark) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "landmark-pick-card";
    card.setAttribute("aria-label", `Visit ${landmark.name} in AR`);

    const image = document.createElement("img");
    image.src = getLandmarkImage(landmark);
    image.alt = landmark.name;

    const copy = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = landmark.name;
    const details = document.createElement("span");
    details.textContent = `${landmark.category || "Landmark"} - ${isVisited(landmark.id) ? "Visited" : "Not visited"}`;
    const action = document.createElement("em");
    action.textContent = "Visit in AR";

    copy.append(name, details, action);
    card.append(image, copy);
    card.addEventListener("click", () => openARForLandmark(landmark));
    list.appendChild(card);
  });
}

window.openLandmarkSelection = function openLandmarkSelection() {
  renderLandmarkSelection();
  const modal = document.getElementById("landmarkSelectionModal");
  modal?.classList.add("show");
  modal?.setAttribute("aria-hidden", "false");
};

window.closeLandmarkSelection = function closeLandmarkSelection() {
  const modal = document.getElementById("landmarkSelectionModal");
  modal?.classList.remove("show");
  modal?.setAttribute("aria-hidden", "true");
};

document.getElementById("landmarkSelectionClose")?.addEventListener("click", closeLandmarkSelection);
document.getElementById("landmarkSelectionModal")?.addEventListener("click", (event) => {
  if (event.target.id === "landmarkSelectionModal") closeLandmarkSelection();
});

let currentUser = null;

/* ── State: visited IDs fetched from Firestore ── */
let visitedIds  = new Set();
let totalXP     = 0;

/* ════════════════════════════════════════════════
   AUTH GUARD
════════════════════════════════════════════════ */
onAuthStateChanged(auth, async user => {
  if (!user) {
    showAppLoader("Redirecting to sign in");
    window.location.href = "login.html";
    return;
  }

  try {
    setLoaderText("Loading landmarks");
    currentUser = user;
    console.log(`[DASH] Logged in: ${user.email}`);

    initProfile(user);
    renderApoFactOfTheDay();

    await loadLandmarksForDashboard();

    setLoaderText("Loading achievements");
    await loadAchievements();     // Fetch from Firestore

    updateStats();
    renderAchievements();
    renderJourney();

    setLoaderText("Preparing maps");
    setTimeout(initMaps, 100);
  } finally {
    hideAppLoader(450);
    window.setTimeout(applyDashboardRevealAnimations, 500);
  }
});

/* ════════════════════════════════════════════════
   FIRESTORE — LOAD ACCOUNT PROGRESS
════════════════════════════════════════════════ */
async function loadAchievements() {
  visitedIds.clear();
  totalXP = 0;

  if (!currentUser) return;

  try {
    const progressRef = doc(db, "users", currentUser.uid, "progress", "summary");
    const snap = await getDoc(progressRef);

    if (!snap.exists()) {
      console.log("[DASH] No account progress found yet.");
      return;
    }

    const data = snap.data();
    const visited = Array.isArray(data.visitedLandmarks)
      ? data.visitedLandmarks
      : [];

    visited.forEach((id) => {
      visitedIds.add(normalizeLandmarkId(id));
    });

    totalXP = Number(data.totalXP) || visitedIds.size * 100;

    console.log(`[DASH] Account progress loaded: ${visitedIds.size}/${AR_LANDMARKS.length} visited, ${totalXP} XP`);
  } catch (err) {
    console.error("[DASH] Failed to load account progress:", err.message);
  }
}

/* ════════════════════════════════════════════════
   FIRESTORE — SAVE ACCOUNT ACHIEVEMENT
════════════════════════════════════════════════ */
async function saveAchievement(lm) {
  if (!currentUser || !lm?.id) return;

  const normalizedId = normalizeLandmarkId(lm.id);
  const progressRef = doc(db, "users", currentUser.uid, "progress", "summary");

  try {
    if (visitedIds.has(normalizedId)) {
      console.log("[DASH] Achievement already saved:", lm.name);
      return;
    }

    visitedIds.add(normalizedId);
    totalXP = visitedIds.size * 100;

    await setDoc(progressRef, {
      visitedLandmarks: Array.from(visitedIds),
      totalXP,
      updatedAt: serverTimestamp()
    }, { merge: true });

    console.log(`[DASH] Account achievement saved: ${lm.name}`);

    updateStats();
    updateAchievementStats();
    renderAchievements();
    renderJourney();
  } catch (err) {
    console.error("[DASH] Save account achievement error:", err.message);
  }
}

/* ════════════════════════════════════════════════
   STATS HELPERS
════════════════════════════════════════════════ */
function isVisited(id) {
  const normalized = normalizeLandmarkId(id);
  return (
    visitedIds.has(normalized) ||
    (normalized === "columban" && (visitedIds.has("st-columban") || visitedIds.has("diocese-columban")))
  );
}

function getVisitedCount() {
  return AR_LANDMARKS.filter((lm) => isVisited(lm.id)).length;
}

function updateStats() {
  const total   = AR_LANDMARKS.length;
  const visited = getVisitedCount();
  const pct     = total ? Math.round(visited / total * 100) : 0;

  document.getElementById("stat-visited").textContent = `${visited}/${total} VISITED`;
  document.getElementById("stat-pct").textContent     = pct + "%";
  document.getElementById("prog-fill").style.width    = pct + "%";
  document.getElementById("stat-xp").textContent      = totalXP;
}

function updateAchievementStats() {
  const total   = AR_LANDMARKS.length;
  const visited = getVisitedCount();
  const pct     = total ? Math.round(visited / total * 100) : 0;
  document.getElementById("ach-stat-visited").textContent = `${visited}/${total} VISITED`;
  document.getElementById("ach-stat-pct").textContent     = pct + "%";
  document.getElementById("ach-prog-fill").style.width    = pct + "%";
}

/* ════════════════════════════════════════════════
   JOURNEY CARDS (Home tab — recently visited)
════════════════════════════════════════════════ */
function renderJourney() {
  const visited = AR_LANDMARKS.filter(lm => isVisited(lm.id));
  const grid = document.getElementById("journey-cards");

  if (!grid) return;

  if (visited.length === 0) {
    grid.innerHTML = `
      <button
        type="button"
        class="journey-empty-state"
        aria-label="Start your Lakbay by choosing a landmark"
        data-open-landmark-selection
      >
        <div class="journey-empty-pin" aria-hidden="true">
          <svg viewBox="0 0 220 300" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M110 292C110 292 26 150 26 88C26 41.6 63.6 4 110 4C156.4 4 194 41.6 194 88C194 150 110 292 110 292Z"
              fill="#FFFFFF"
              stroke="#27667B"
              stroke-width="8"
            />
            <circle cx="110" cy="80" r="48" fill="#DDEB9D"/>
            <path
              d="M30 132C55 114 83 116 111 130C136 142 146 125 164 129C176 132 185 142 190 155L110 292L30 132Z"
              fill="#7ED957"
            />
          </svg>
        </div>

        <div class="journey-empty-copy">
          <p>You have yet to visit a landmark</p>
          <strong>START YOUR LAKBAY HERE!</strong>
        </div>
      </button>
    `;

    const emptyButton = grid.querySelector(".journey-empty-state");
    emptyButton?.addEventListener("click", () => {
      window.openLandmarkSelection?.();
    });

    return;
  }

  grid.innerHTML = visited.slice(0, 4).map(lm => {
    return `
      <div class="j-card-visited">
      <img src="${getLandmarkImage(lm)}" alt="${lm.name}"/>
      <div class="j-card-lbl">${lm.name}</div>
    </div>
    `;
  }).join("");
}

/* ════════════════════════════════════════════════
   ACHIEVEMENTS LIST
   Renders from Firestore data (visitedIds Set).
   Not visited → grayscale | Visited → full colour
════════════════════════════════════════════════ */
function renderAchievements() {
  const list = document.getElementById("landmark-list");
  list.innerHTML = "";

  AR_LANDMARKS.forEach((lm, i) => {
    const visited = isVisited(lm.id);
    const item = document.createElement("div");
    item.className  = `ach-item${visited ? " visited" : ""}`;
    item.dataset.id = lm.id;
    item.setAttribute("aria-label", `${lm.name} — ${visited ? "Visited" : "Not visited"}`);

    item.innerHTML = `
      <img class="ach-thumb"
           src="${getLandmarkImage(lm)}"
           alt="${lm.name}"/>
      <div class="ach-info">
        <div class="ach-name">${lm.name}</div>
        <div class="ach-cat">${lm.category || ''}</div>
        <div class="ach-badge">+100 XP</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0;">
        <span class="ach-check" aria-hidden="true">✅</span>
        <button class="visit-ar-btn" data-id="${lm.id}"
                style="font-size:.65rem;padding:4px 10px;
                       background:var(--cyan);color:#fff;
                       border:none;border-radius:99px;cursor:pointer;
                       white-space:nowrap;line-height:1.4;"
                aria-label="Visit ${lm.name} in AR">
          Visit
        </button>
      </div>`;

    const thumb = item.querySelector(".ach-thumb");
    if (thumb) thumb.src = getLandmarkImage(lm);

    const badge = item.querySelector(".ach-badge");
    if (badge) badge.textContent = visited ? "Visited +100 XP" : "Not visited";

    const visitBtn = item.querySelector(".visit-ar-btn");
    visitBtn.textContent = "Visit in AR";
    visitBtn.classList.add("visit-ar-btn");
    visitBtn.setAttribute("aria-label", `Visit ${lm.name} in AR`);
    visitBtn.addEventListener("click", e => {
      e.stopPropagation();
      openARForLandmark(lm);
    });

    item.addEventListener("click", () => openARForLandmark(lm));

    list.appendChild(item);
  });

  updateAchievementStats();
}

function applyDashboardRevealAnimations(scope = document) {
  const selectors = [
    ".greeting-band",
    ".apo-fact-title",
    "#apoFactCard",
    "#tab-home .stat-card",
    "#tab-home [data-section='journey']",
    "#journey-cards",
    "#map-mini",
    "#landmark-list",

    "#tab-profile > div > div:first-child",
    "#tab-profile > div > h3",
    "#tab-profile .profile-card",
    "#tab-profile .settings-section",
    "#tab-profile .settings-section h2",
    "#tab-profile .settings-row",
    "#tab-profile .sw-row",
    "#tab-profile .profile-section",
    "#tab-profile .settings-card",
    "#tab-profile .reset-section",
    "#tab-profile .signout-section",
    "#tab-profile #reset-btn",
    "#tab-profile #signout-btn"
  ];

  const elements = selectors
    .flatMap((selector) => Array.from(scope.querySelectorAll(selector)))
    .filter(Boolean);

  const uniqueElements = [...new Set(elements)].filter((el) => {
    const panel = el.closest(".tab-panel");
    return !panel || panel.classList.contains("active");
  });

  uniqueElements.forEach((el, index) => {
    el.classList.remove("reveal-up");
    el.style.animationDelay = `${Math.min(index * 0.06, 0.42)}s`;

    requestAnimationFrame(() => {
      el.classList.add("reveal-up");
    });
  });
}

/* ════════════════════════════════════════════════
   TAB SYSTEM
════════════════════════════════════════════════ */
const TITLES = { home:"KA-KALAKBAY", achievements:"ACHIEVEMENTS", maps:"MAPS", profile:"PROFILE" };
window.switchTab = function(tab) {
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
  document.getElementById(`tab-${tab}`)?.classList.add("active");
  document.querySelectorAll(".bnav-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  document.getElementById("tab-title").textContent = TITLES[tab] || "KA-KALAKBAY";

  if (tab === "achievements") {
    loadAchievements().then(() => {
      renderAchievements();
      updateAchievementStats();
      applyDashboardRevealAnimations();
    });
  }

  if (tab === "home") {
    updateStats();
    renderJourney();
    applyDashboardRevealAnimations();
    invalidateDashboardMaps();
  }

  if (tab === "maps") {
    setTimeout(() => {
      initMainMap();
      invalidateDashboardMaps();
      applyDashboardRevealAnimations();
    }, 50);
  }

  if (tab === "profile") {
    requestAnimationFrame(() => {
      applyDashboardRevealAnimations(document.getElementById("tab-profile") || document);
    });
  }
};

document.querySelectorAll("[data-switch-tab], .bnav-btn[data-tab]").forEach((button) => {
  button.addEventListener("click", () => {
    window.switchTab(button.dataset.switchTab || button.dataset.tab);
  });
});

document.querySelector("[data-open-landmark-selection]")?.addEventListener("click", () => {
  window.openLandmarkSelection?.();
});

/* ════════════════════════════════════════════════
   PROFILE
════════════════════════════════════════════════ */
function initProfile(user) {
  const name     = user.displayName || "Ka-Lakbay";
  const email    = user.email || "";
  document.getElementById("user-avatar").textContent = name.charAt(0).toUpperCase();
  document.getElementById("user-name").textContent   = name;
  document.getElementById("user-email").textContent  = email;
  document.getElementById("dark-sw").checked = isDark();
  document.getElementById("cb-sw").checked   = isCB();
}

document.getElementById("dark-sw").addEventListener("change", async () => {
  const on = toggleDark();
  if (currentUser) try { await updateDoc(doc(db,"users",currentUser.uid),{"preferences.darkMode":on}); } catch{}
});
document.getElementById("cb-sw").addEventListener("change", async () => {
  const on = toggleCB();
  if (currentUser) try { await updateDoc(doc(db,"users",currentUser.uid),{"preferences.colorblindMode":on}); } catch{}
});

function initAccessibilitySettingsUI() {
  const largeTextToggle = document.getElementById("largeTextToggle");
  const highContrastToggle = document.getElementById("highContrastToggle");
  const reducedMotionToggle = document.getElementById("reducedMotionToggle");

  if (largeTextToggle) {
    largeTextToggle.checked = localStorage.getItem("kk_large_text") === "true";
    largeTextToggle.addEventListener("change", () => {
      localStorage.setItem("kk_large_text", String(largeTextToggle.checked));
      applyAccessibilitySettings();
    });
  }

  if (highContrastToggle) {
    highContrastToggle.checked = localStorage.getItem("kk_high_contrast") === "true";
    highContrastToggle.addEventListener("change", () => {
      localStorage.setItem("kk_high_contrast", String(highContrastToggle.checked));
      applyAccessibilitySettings();
    });
  }

  if (reducedMotionToggle) {
    reducedMotionToggle.checked = localStorage.getItem("kk_reduced_motion") === "true";
    reducedMotionToggle.addEventListener("change", () => {
      localStorage.setItem("kk_reduced_motion", String(reducedMotionToggle.checked));
      applyAccessibilitySettings();
    });
  }
}

initAccessibilitySettingsUI();

/* ════════════════════════════════════════════════
   RESET ACCOUNT PROGRESS
════════════════════════════════════════════════ */
document.getElementById("reset-btn").addEventListener("click", async () => {
  if (!currentUser) return;

  if (!confirm("Reset all progress? This cannot be undone.")) return;

  const progressRef = doc(db, "users", currentUser.uid, "progress", "summary");

  try {
    await setDoc(progressRef, {
      visitedLandmarks: [],
      totalXP: 0,
      updatedAt: serverTimestamp()
    }, { merge: true });

    visitedIds.clear();
    totalXP = 0;

    updateStats();
    updateAchievementStats();
    renderAchievements();
    renderJourney();

    showToast("Progress reset!");
    console.log("[DASH] Account progress reset.");
  } catch (err) {
    console.error("[DASH] Reset progress error:", err.message);
    showToast("Unable to reset progress.", "error");
  }
});

/* ════════════════════════════════════════════════
   SIGN OUT
════════════════════════════════════════════════ */
function openSignoutModal() {
  const modal = document.getElementById("signoutModal");
  modal?.classList.add("show");
  modal?.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closeSignoutModal() {
  const modal = document.getElementById("signoutModal");
  modal?.classList.remove("show");
  modal?.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

document.getElementById("signout-btn")?.addEventListener("click", () => {
  openSignoutModal();
});

document.getElementById("cancelSignoutBtn")?.addEventListener("click", closeSignoutModal);

document.querySelectorAll("[data-close-signout]").forEach((el) => {
  el.addEventListener("click", closeSignoutModal);
});

document.getElementById("confirmSignoutBtn")?.addEventListener("click", async () => {
  const btn = document.getElementById("confirmSignoutBtn");
  setLoading(btn, true);

  try {
    await signOut(auth);
    showAppLoader("Signing out");
    window.location.href = "index.html";
  } catch (err) {
    showToast(err.message, "error");
    setLoading(btn, false);
    closeSignoutModal();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeSignoutModal();
  }
});

/* ════════════════════════════════════════════════
   LEAFLET MAP
════════════════════════════════════════════════ */
let mapMain=null, mapMini=null;

function debounce(fn, delay = 150) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function getMapLandmarks() {
  return AR_LANDMARKS
    .filter((lm) => Number.isFinite(Number(lm.lat)) && Number.isFinite(Number(lm.lng)))
    .map((lm) => ({
      id: lm.id,
      name: lm.name,
      lat: Number(lm.lat),
      lng: Number(lm.lng),
      cat: lm.category,
      image: lm.image || ""
    }));
}

function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function createLandmarkPinIcon(landmark) {
  const image = escapeHTML(landmark.image || "assets/images/default-landmark.jpg");
  const name = escapeHTML(landmark.name || "Landmark");

  return L.divIcon({
    className: "landmark-photo-pin",
    html: `
      <div class="landmark-photo-pin__bubble">
        <img src="${image}" alt="${name}" />
      </div>
      <div class="landmark-photo-pin__tip"></div>
    `,
    iconSize: [54, 66],
    iconAnchor: [27, 66],
    popupAnchor: [0, -62]
  });
}

function buildLeafletMap(containerId,zoom,mini) {
  const el=document.getElementById(containerId);
  if(!el||el._leaflet_id) return null;
  const map=L.map(containerId,{zoomControl:!mini,scrollWheelZoom:!mini}).setView([14.8295,120.2830],zoom);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{attribution:'© <a href="https://openstreetmap.org/copyright">OSM</a>',maxZoom:18}).addTo(map);
  getMapLandmarks().forEach(lm=>{
    const visited=visitedIds.has(lm.id);
    const m=L.marker([lm.lat,lm.lng], {
      icon: createLandmarkPinIcon(lm),
      title: lm.name
    }).addTo(map);
    m.on("click", () => {
      document.querySelectorAll(".landmark-photo-pin").forEach((el) => {
        el.classList.remove("is-active");
      });
      const markerEl = m.getElement();
      if (markerEl) markerEl.classList.add("is-active");
    });
    if(!mini){
      m.bindPopup(`<div class="lm-popup-name">${lm.name}</div>
        <div class="lm-popup-cat">${lm.cat}</div>
        <div class="lm-popup-xp">${visited?"✅ Visited · +100 XP":"🔵 Not yet visited"}</div>`);
    } else {
      m.bindTooltip(lm.name,{permanent:false,direction:"top"});
    }
  });
  setTimeout(() => map.invalidateSize(), 100);
  return map;
}
function initMaps()    { if(!mapMini) mapMini=buildLeafletMap("map-mini",14,true); }
function initMainMap() {
  if(!mapMain) mapMain=buildLeafletMap("map-main",15,false);
  setTimeout(() => {
    if (mapMain) mapMain.invalidateSize();
  }, 150);
}

function invalidateDashboardMaps() {
  setTimeout(() => {
    mapMini?.invalidateSize?.();
    mapMain?.invalidateSize?.();
  }, 150);
}

window.addEventListener("resize", debounce(() => {
  mapMini?.invalidateSize?.();
  mapMain?.invalidateSize?.();
}, 180));
