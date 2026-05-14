// ═══════════════════════════════════════════════════
// KA-KALAKBAY — Auth Integration (UI helpers only)
// ⚠️  Core auth logic is NOT modified here.
//     This file only wires Firebase auth state
//     to UI helpers used across pages.
// ═══════════════════════════════════════════════════
import { auth } from "./config.js";
import { onAuthStateChanged, signOut }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// ── Guard: redirect to login if not authenticated ──
export function requireAuth(redirectTo = "login.html") {
  return new Promise(resolve => {
    onAuthStateChanged(auth, user => {
      if (!user) { window.location.href = redirectTo; return; }
      resolve(user);
    });
  });
}

// ── Guard: redirect away if already authenticated ──
export function redirectIfAuthed(to = "dashboard.html") {
  onAuthStateChanged(auth, user => {
    if (user) window.location.href = to;
  });
}

// ── Observe auth state and call cb(user|null) ──────
export function onAuth(cb) {
  return onAuthStateChanged(auth, cb);
}

// ── Sign out helper ────────────────────────────────
export async function signOutUser() {
  await signOut(auth);
}

// ── Get current user (sync snapshot) ──────────────
export function currentUser() {
  return auth.currentUser;
}
