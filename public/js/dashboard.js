import { auth, db } from "./config.js";
import { onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  collection, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc,
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
  if (!raw) return "";
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
let visitedIds = new Set();
let completedQuizIds = new Set();
let totalXP = 0;
let quizXP = 0;
let quizzesByLandmarkId = {};
let quizzesLoaded = false;

function normalizeQuizRecord(quizId, data = {}) {
  const landmarkId = normalizeLandmarkId(data.landmarkId || quizId);

  if (!landmarkId) {
    return null;
  }

  const choices = Array.isArray(data.choices)
    ? data.choices.map((choice) => String(choice || "").trim()).filter(Boolean)
    : [];
  const question = String(data.question || "").trim();
  const answer = String(data.answer || "").trim();

  if (!question || !answer || choices.length === 0) {
    return null;
  }

  return {
    id: landmarkId,
    landmarkId,
    landmarkName: data.landmarkName || "",
    question,
    choices,
    answer,
    xpReward: Number(data.xpReward) || 50,
    active: data.active !== false
  };
}

async function loadAchievementQuizzes() {
  if (quizzesLoaded) return;

  quizzesByLandmarkId = {};

  try {
    const snapshot = await getDocs(collection(db, "quizzes"));

    snapshot.docs.forEach((item) => {
      const quiz = normalizeQuizRecord(item.id, item.data());

      if (quiz?.active) {
        quizzesByLandmarkId[quiz.landmarkId] = quiz;
      }
    });

    quizzesLoaded = true;
    console.log("[QUIZ LOAD] Loaded quizzes from Firestore:", quizzesByLandmarkId);
    console.log("[QUIZ LOAD] Quiz count:", Object.keys(quizzesByLandmarkId || {}).length);
  } catch (error) {
    quizzesByLandmarkId = {};
    quizzesLoaded = true;
    console.error("[QUIZ LOAD] Failed to load quizzes from Firestore:", error);
    console.log("[QUIZ LOAD] Quiz count:", Object.keys(quizzesByLandmarkId || {}).length);
    showToast?.("Quiz unavailable. Please try again later.");
  }
}

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
    await Promise.all([
      loadAchievements(),
      loadAchievementQuizzes()
    ]);

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
  completedQuizIds.clear();
  totalXP = 0;
  quizXP = 0;

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

    const completedQuizzes = Array.isArray(data.completedQuizzes)
      ? data.completedQuizzes.map(normalizeLandmarkId).filter(Boolean)
      : [];
    completedQuizIds = new Set(completedQuizzes);
    quizXP = Number(data.quizXP) || 0;

    const storedTotalXP = Number(data.totalXP);
    totalXP = Number.isFinite(storedTotalXP)
      ? storedTotalXP
      : visitedIds.size * 100 + quizXP;

    console.log(`[DASH] Account progress loaded: ${visitedIds.size}/${AR_LANDMARKS.length} visited, ${completedQuizIds.size} quizzes, ${totalXP} XP`);
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
    const snap = await getDoc(progressRef);
    const data = snap.exists() ? snap.data() : {};
    const visited = Array.isArray(data.visitedLandmarks)
      ? data.visitedLandmarks.map(normalizeLandmarkId).filter(Boolean)
      : Array.from(visitedIds);
    const visitedSet = new Set(visited);

    if (visitedSet.has(normalizedId)) {
      console.log("[DASH] Achievement already saved:", lm.name);
      return;
    }

    visitedSet.add(normalizedId);
    const updatedVisited = Array.from(visitedSet);
    const storedQuizXP = Number(data.quizXP) || quizXP || 0;
    const storedTotalXP = Number(data.totalXP);
    const currentTotalXP = Number.isFinite(storedTotalXP)
      ? storedTotalXP
      : visited.length * 100 + storedQuizXP;
    const visitReward = Number(lm.xp) || 100;

    visitedIds = new Set(updatedVisited);
    quizXP = storedQuizXP;
    totalXP = currentTotalXP + visitReward;

    await setDoc(progressRef, {
      visitedLandmarks: updatedVisited,
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

function getQuizForLandmark(landmarkId) {
  const id = normalizeLandmarkId(landmarkId);
  const quiz = quizzesByLandmarkId[id] || null;
  console.log("[QUIZ LOOKUP]", { landmarkId: id, quizExists: Boolean(quiz) });
  return quiz;
}

function isQuizCompleted(landmarkId) {
  return completedQuizIds.has(normalizeLandmarkId(landmarkId));
}

async function awardQuizXP(landmarkId, quiz) {
  const user = auth.currentUser;
  const id = normalizeLandmarkId(landmarkId);
  const reward = Number(quiz?.xpReward) || 50;

  console.log("[QUIZ XP] Attempting award:", { landmarkId: id, reward });

  if (!user) {
    showToast?.("Sign in to save quiz XP.");
    return "skipped";
  }

  try {
    const progressRef = doc(db, "users", user.uid, "progress", "summary");
    const snap = await getDoc(progressRef);
    const data = snap.exists() ? snap.data() : {};
    const visited = Array.isArray(data.visitedLandmarks)
      ? data.visitedLandmarks.map(normalizeLandmarkId).filter(Boolean)
      : [];

    if (!visited.includes(id)) {
      showToast?.("Visit this landmark in AR first to unlock the quiz.");
      return "locked";
    }

    const completed = Array.isArray(data.completedQuizzes)
      ? data.completedQuizzes.map(normalizeLandmarkId).filter(Boolean)
      : [];

    if (completed.includes(id)) {
      completedQuizIds.add(id);
      console.log("[QUIZ XP] Already completed:", id);
      showToast?.("Quiz already completed. XP already claimed.");
      return "existing";
    }

    const currentQuizXP = Number(data.quizXP) || 0;
    const storedTotalXP = Number(data.totalXP);
    const currentTotalXP = Number.isFinite(storedTotalXP)
      ? storedTotalXP
      : visited.length * 100 + currentQuizXP;
    const updatedCompleted = Array.from(new Set([...completed, id]));
    const updatedQuizXP = currentQuizXP + reward;
    const updatedTotalXP = currentTotalXP + reward;

    await setDoc(progressRef, {
      completedQuizzes: updatedCompleted,
      quizXP: updatedQuizXP,
      totalXP: updatedTotalXP,
      updatedAt: serverTimestamp()
    }, { merge: true });

    completedQuizIds = new Set(updatedCompleted);
    quizXP = updatedQuizXP;
    totalXP = updatedTotalXP;

    console.log("[QUIZ XP] Awarded:", { landmarkId: id, reward });
    console.log("[QUIZ XP] Progress updated.");
    showToast?.(`Correct! +${reward} XP earned.`);
    return "saved";
  } catch (error) {
    console.error("[QUIZ XP] Failed to update progress:", error);
    showToast?.("Unable to save quiz XP.");
    return "error";
  }
}

function openAchievementQuiz(landmarkId, landmarkName, visited = isVisited(landmarkId)) {
  const normalizedId = normalizeLandmarkId(landmarkId);
  const quiz = getQuizForLandmark(normalizedId);

  if (!quiz) {
    console.warn("[ACHIEVEMENT QUIZ] No quiz found for:", landmarkId);
    showToast?.("Quiz unavailable.");
    return;
  }

  if (!visited) {
    showToast?.("Visit this landmark in AR first to unlock the quiz.");
    return;
  }

  if (isQuizCompleted(normalizedId)) {
    showToast?.("Quiz already completed. XP already claimed.");
    return;
  }

  const modal = document.getElementById("achievementQuizModal");
  const title = document.getElementById("achievementQuizTitle");
  const helper = document.getElementById("achievementQuizHelper");
  const question = document.getElementById("achievementQuizQuestion");
  const choices = document.getElementById("achievementQuizChoices");
  const feedback = document.getElementById("achievementQuizFeedback");

  if (!modal || !title || !helper || !question || !choices || !feedback) {
    console.error("[ACHIEVEMENT QUIZ] Quiz modal elements are missing.");
    return;
  }

  title.textContent = `${landmarkName || "Landmark"} Quiz`;
  helper.textContent = "Answer one quick question based on what you learned from this landmark.";

  question.textContent = quiz.question;
  choices.innerHTML = "";
  feedback.textContent = "";

  quiz.choices.forEach((choice) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "achievement-quiz-choice-btn";
    btn.textContent = choice;

    btn.addEventListener("click", () => {
      handleAchievementQuizAnswer(choice, quiz, normalizedId);
    });

    choices.appendChild(btn);
  });

  modal.classList.add("show");
  modal.setAttribute("aria-hidden", "false");
  document.body.classList.add("quiz-open");

  setTimeout(() => {
    choices.querySelector("button")?.focus();
  }, 50);
}

async function handleAchievementQuizAnswer(choice, quiz, landmarkId) {
  const answer = quiz?.answer || "";
  const reward = Number(quiz?.xpReward) || 50;
  const isCorrect = choice === answer;
  const choices = document.getElementById("achievementQuizChoices");
  const feedback = document.getElementById("achievementQuizFeedback");

  choices?.querySelectorAll("button").forEach((btn) => {
    btn.disabled = true;

    if (btn.textContent === answer) {
      btn.classList.add("correct");
    }

    if (btn.textContent === choice && !isCorrect) {
      btn.classList.add("wrong");
    }
  });

  if (feedback) {
    feedback.textContent = isCorrect
      ? `Correct! Saving +${reward} XP...`
      : `Almost! The correct answer is: ${answer}`;
  }

  if (!isCorrect) {
    return;
  }

  const status = await awardQuizXP(landmarkId, quiz);

  if (feedback) {
    if (status === "saved") {
      feedback.textContent = `Correct! +${reward} XP earned.`;
    } else if (status === "existing") {
      feedback.textContent = "Quiz already completed. XP already claimed.";
    } else if (status === "locked") {
      feedback.textContent = "Visit this landmark in AR first to unlock the quiz.";
    } else {
      feedback.textContent = "Correct, but XP could not be saved. Please try again.";
    }
  }

  if (status === "saved" || status === "existing") {
    updateStats();
    renderAchievements();
  }
}

function closeAchievementQuiz() {
  const modal = document.getElementById("achievementQuizModal");

  modal?.classList.remove("show");
  modal?.setAttribute("aria-hidden", "true");
  document.body.classList.remove("quiz-open");
}

function bindAchievementQuizButtons() {
  document.querySelectorAll("[data-quiz-landmark-id]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const landmarkId = button.dataset.quizLandmarkId;
      const landmarkName = button.dataset.quizLandmarkName || "Landmark";
      const isVisited = button.dataset.quizVisited === "true";
      const isCompleted = button.dataset.quizCompleted === "true";
      const quiz = getQuizForLandmark(landmarkId);

      if (!quiz) {
        console.log("[ACHIEVEMENT QUIZ] No quiz available for:", landmarkId);

        if (typeof showToast === "function") {
          showToast("No quiz is available for this landmark.");
        }

        return;
      }

      if (isCompleted) {
        showToast?.("Quiz already completed. XP already claimed.");
        return;
      }

      if (!isVisited || button.disabled) {
        console.log("[ACHIEVEMENT QUIZ] Quiz locked until visited:", landmarkId);

        if (typeof showToast === "function") {
          showToast("Visit this landmark in AR first to unlock the quiz.");
        } else {
          alert("Visit this landmark in AR first to unlock the quiz.");
        }

        return;
      }

      openAchievementQuiz(landmarkId, landmarkName, true);
    });
  });
}

document
  .getElementById("closeAchievementQuizBtn")
  ?.addEventListener("click", closeAchievementQuiz);

document.getElementById("achievementQuizModal")?.addEventListener("click", (event) => {
  if (event.target.id === "achievementQuizModal") {
    closeAchievementQuiz();
  }
});

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
    const quizLandmarkId = normalizeLandmarkId(lm.id);
    const quiz = getQuizForLandmark(quizLandmarkId);
    const hasQuiz = Boolean(quiz);
    const quizCompleted = isQuizCompleted(quizLandmarkId);
    const visitStatusLabel = visited ? "Visited" : "Not Visited";
    const visitStatusClass = visited ? "visited" : "not-visited";
    const safeQuizLandmarkId = escapeHTML(quizLandmarkId);
    const safeQuizLandmarkName = escapeHTML(lm.name || "Landmark");
    const quizButtonLabel = quizCompleted ? "Quiz Completed" : "Take Quiz";
    const quizButtonClass = [
      "achievement-action-btn",
      "achievement-quiz-btn",
      visited ? "" : "is-locked",
      quizCompleted ? "is-completed" : ""
    ].filter(Boolean).join(" ");
    const quizButtonAttrs = !visited
      ? ` disabled aria-disabled="true" title="Visit this landmark in AR first to unlock the quiz."`
      : quizCompleted
        ? ` disabled aria-disabled="true" title="Quiz already completed. XP already claimed."`
        : "";
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
        <span class="achievement-visit-status ${visitStatusClass}">
          ${visitStatusLabel}
        </span>
        <div class="ach-badge">+100 XP</div>
      </div>
      <div class="ach-actions achievement-card-actions">
        <span class="ach-check" aria-hidden="true">✅</span>
        ${hasQuiz ? `
          <button
            type="button"
            class="${quizButtonClass}"
            data-quiz-landmark-id="${safeQuizLandmarkId}"
            data-quiz-landmark-name="${safeQuizLandmarkName}"
            data-quiz-visited="${visited ? "true" : "false"}"
            data-quiz-completed="${quizCompleted ? "true" : "false"}"${quizButtonAttrs}>
            ${quizButtonLabel}
          </button>
        ` : ""}
        <button class="visit-ar-btn" type="button" data-id="${lm.id}"
                aria-label="Visit ${lm.name} in AR">
          Visit in AR
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

    item.querySelector(".achievement-card-actions")?.addEventListener("click", (e) => {
      e.stopPropagation();
    });

    item.addEventListener("click", () => openARForLandmark(lm));

    list.appendChild(item);
  });

  updateAchievementStats();
  bindAchievementQuizButtons();
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
    Promise.all([
      loadAchievements(),
      loadAchievementQuizzes()
    ]).then(() => {
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
      completedQuizzes: [],
      quizXP: 0,
      totalXP: 0,
      updatedAt: serverTimestamp()
    }, { merge: true });

    visitedIds.clear();
    completedQuizIds.clear();
    quizXP = 0;
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
    closeAchievementQuiz();
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
