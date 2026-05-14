// ═══════════════════════════════════════════════════
// KA-KALAKBAY — Shared App Utilities
// ⚠️  Auth logic lives in auth.js — not here
// ═══════════════════════════════════════════════════

/* ─── TOAST ──────────────────────────────────────── */
export function showToast(msg, type = "success") {
  let el = document.getElementById("toast");
  if (!el) {
    el = Object.assign(document.createElement("div"), { id: "toast" });
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className   = `toast show${type === "error" ? " error" : ""}`;
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 3200);
}

/* ─── SETTINGS (dark / colorblind) ──────────────── */
export function applySettings() {
  if (localStorage.getItem("kk_dark") === "1")
    document.documentElement.classList.add("dark");
  if (localStorage.getItem("kk_cb")   === "1")
    document.documentElement.classList.add("cb");
}

export function setLoaderText(message = "Loading KA-KALAKBAY") {
  const text = document.getElementById("appLoaderText");
  if (text) text.textContent = message;
}

export function showAppLoader(message = "Loading KA-KALAKBAY") {
  setLoaderText(message);

  const loader = document.getElementById("appLoader");
  if (!loader) return;

  loader.classList.remove("is-hidden");
  loader.setAttribute("aria-hidden", "false");
}

export function hideAppLoader(delay = 250) {
  const loader = document.getElementById("appLoader");
  if (!loader) return;

  window.setTimeout(() => {
    loader.classList.add("is-hidden");
    loader.setAttribute("aria-hidden", "true");
  }, delay);
}

export function installLoaderFailsafe(timeout = 10000) {
  window.setTimeout(() => {
    const loader = document.getElementById("appLoader");
    if (loader && !loader.classList.contains("is-hidden")) {
      console.warn("[LOADER] Failsafe triggered.");
      hideAppLoader(0);
    }
  }, timeout);
}

export function toggleDark() {
  const on = localStorage.getItem("kk_dark") === "1";
  localStorage.setItem("kk_dark", on ? "0" : "1");
  document.documentElement.classList.toggle("dark", !on);
  return !on;
}

export function toggleCB() {
  const on = localStorage.getItem("kk_cb") === "1";
  localStorage.setItem("kk_cb", on ? "0" : "1");
  document.documentElement.classList.toggle("cb", !on);
  return !on;
}

export const isDark = () => localStorage.getItem("kk_dark") === "1";
export const isCB   = () => localStorage.getItem("kk_cb")   === "1";

/* ─── PROGRESS STORE (localStorage) ─────────────── */
const PROG_KEY = "kk_progress";

export function getProgress() {
  try { return JSON.parse(localStorage.getItem(PROG_KEY)) || { visited: [], xp: 0 }; }
  catch { return { visited: [], xp: 0 }; }
}

export function saveProgress(data) {
  localStorage.setItem(PROG_KEY, JSON.stringify(data));
}

export function markVisited(id, xpGain = 100) {
  const p = getProgress();
  if (!p.visited.includes(id)) {
    p.visited.push(id);
    p.xp += xpGain;
    saveProgress(p);
    return true; // newly visited
  }
  return false;
}

export function resetProgress() {
  saveProgress({ visited: [], xp: 0 });
}

export function isVisited(id) {
  return getProgress().visited.includes(id);
}

/* ─── LANDMARK CATALOGUE ─────────────────────────── */
export const LANDMARKS = [
  {
    id:    "spanish-gate",
    name:  "Spanish Gate",
    category: "Historical Landmark",
    desc:  "Built during the Spanish colonial era, this iconic stone arch once guarded the main entrance to a military reservation. A symbol of Olongapo's rich history.",
    color: "#0090AD",
    img:   "assets/images/spanish-gate.jpg",
    thumb: "assets/images/spanish-gate.jpg",
  },
  {
    id:    "ulo-ng-apo",
    name:  "Ulo ng Apo Monument",
    category: "Monument",
    desc:  "The massive stone head sculpture that gave Olongapo City its name—legend says a Spaniard saw a large stone head ('Ulo ng Apo') in the river.",
    color: "#27667B",
    img:   "assets/images/ulo-ng-apo.jpg",
    thumb: "assets/images/ulo-ng-apo.jpg",
  },
  {
    id:    "city-hall",
    name:  "Olongapo City Hall",
    category: "Government Building",
    desc:  "The seat of local government for Olongapo City. An imposing structure representing civic pride and public service for over five decades.",
    color: "#00B4D8",
    img:   "assets/images/city-hall.jpg",
    thumb: "assets/images/city-hall.jpg",
  },
  {
    id:    "rizal-triangle",
    name:  "Rizal Triangle Park",
    category: "Park & Recreation",
    desc:  "A vibrant public plaza and green space dedicated to José Rizal. Popular for community gatherings, morning jogs, and cultural events.",
    color: "#A0C878",
    img:   "assets/images/rizal-triangle.jpg",
    thumb: "assets/images/rizal-triangle.jpg",
  },
  {
    id:    "gordon-college",
    name:  "Gordon College",
    category: "Education",
    desc:  "The premier public higher-education institution of Olongapo City, offering quality education and serving as a beacon of learning in Zambales.",
    color: "#DDEB9D",
    img:   "assets/images/gordon-college.jpg",
    thumb: "assets/images/gordon-college.jpg",
  },
  {
    id:    "marikit-park",
    name:  "Marikit Park",
    category: "Nature",
    desc:  "A scenic waterfront park along the banks of Olongapo River, offering lush greenery and a peaceful escape in the heart of the city.",
    color: "#4CAF50",
    img:   "assets/images/marikit-park.jpg",
    thumb: "assets/images/marikit-park.jpg",
  },
  {
    id:    "diocese-columban",
    name:  "Diocese of St. Columban",
    category: "Religious Site",
    desc:  "The Catholic cathedral and diocese center for Olongapo, a stunning piece of religious architecture with deep roots in the community.",
    color: "#9C6B4E",
    img:   "assets/images/columban.jpg",
    thumb: "assets/images/columban.jpg",
  },
];

/* ─── CAROUSEL INIT ───────────────────────────────── */
export function initCarousel(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  const track   = container.querySelector(".car-track");
  const slides  = container.querySelectorAll(".car-slide");
  const dots    = container.querySelectorAll(".car-dot");
  const prevBtn = container.querySelector(".car-prev");
  const nextBtn = container.querySelector(".car-next");
  const total   = slides.length;
  if (!track || total === 0) return;

  let current = 0, timer;

  function goTo(n) {
    current = ((n % total) + total) % total;
    track.style.transform = `translateX(-${current * 100}%)`;
    dots.forEach((d, i) => d.classList.toggle("active", i === current));
  }
  function restart() {
    clearInterval(timer);
    timer = setInterval(() => goTo(current + 1), 4500);
  }
  prevBtn?.addEventListener("click", () => { goTo(current - 1); restart(); });
  nextBtn?.addEventListener("click", () => { goTo(current + 1); restart(); });
  dots.forEach((d, i) => d.addEventListener("click", () => { goTo(i); restart(); }));
  restart();
}

/* ─── BUTTON LOADING STATE ───────────────────────── */
export function setLoading(btn, loading) {
  btn.disabled = loading;
  if (loading) {
    btn._orig    = btn.innerHTML;
    btn.innerHTML = `<svg class="spin" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>`;
  } else {
    btn.innerHTML = btn._orig ?? btn.innerHTML;
  }
}
