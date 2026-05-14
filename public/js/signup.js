import { auth, db, gProvider } from "./config.js";
import {
  createUserWithEmailAndPassword,
  signInWithPopup,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, setDoc, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  applySettings,
  showToast,
  setLoading,
  hideAppLoader,
  showAppLoader,
  installLoaderFailsafe,
  setLoaderText,
} from "./app.js";
import { redirectIfAuthed } from "./auth.js";

applySettings();
installLoaderFailsafe(10000);
setLoaderText("Preparing sign up");
redirectIfAuthed("dashboard.html");

window.addEventListener("load", () => {
  hideAppLoader(300);
});

const signupForm = document.getElementById("signup-form");
const signupBtn  = document.getElementById("signup-btn");
const googleBtn  = document.getElementById("google-btn");
const errBanner  = document.getElementById("auth-err");
const termsInput = document.getElementById("terms");
const termsErr = document.getElementById("terms-err");
const termsModal = document.getElementById("termsModal");
const openTermsBtn = document.getElementById("openTermsBtn");
const closeTermsBtn = document.getElementById("closeTermsBtn");
const acceptTermsBtn = document.getElementById("acceptTermsBtn");

function clearErrors() {
  ["email-err", "pw-err", "pw2-err", "terms-err"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = "";
  });

  ["email", "pw", "pw2"].forEach(id => {
    document.getElementById(id)?.classList.remove("err");
  });

  termsInput?.classList.remove("err");
  errBanner.style.display = "none";
}

function showBanner(msg) {
  errBanner.textContent = msg;
  errBanner.style.display = "block";
}

async function createUserDoc(user) {
  try {
    await setDoc(doc(db, "users", user.uid), {
      uid:        user.uid,
      email:      user.email,
      createdAt:  serverTimestamp(),
      preferences:{ darkMode: false, colorblindMode: false },
    }, { merge: true });

    await setDoc(doc(db, "users", user.uid, "progress", "summary"), {
      visitedLandmarks: [],
      totalXP: 0,
      updatedAt: serverTimestamp()
    }, { merge: true });
  } catch { /* non-critical */ }
}

// ── Email / password ──────────────────────────────────
signupForm.addEventListener("submit", async e => {
  e.preventDefault();
  clearErrors();

  const email = signupForm.email.value.trim();
  const pw    = signupForm.pw.value;
  const pw2   = signupForm.pw2.value;
  let valid   = true;

  if (!email || !/\S+@\S+\.\S+/.test(email)) {
    document.getElementById("email-err").textContent = "Enter a valid email.";
    document.getElementById("email").classList.add("err");
    valid = false;
  }
  if (!pw || pw.length < 6) {
    document.getElementById("pw-err").textContent = "Password must be ≥ 6 characters.";
    document.getElementById("pw").classList.add("err");
    valid = false;
  }
  if (pw !== pw2) {
    document.getElementById("pw2-err").textContent = "Passwords don't match.";
    document.getElementById("pw2").classList.add("err");
    valid = false;
  }
  if (!termsInput?.checked) {
    if (termsErr) {
      termsErr.textContent = "You must agree to the Terms and Conditions before signing up.";
    }
    termsInput?.classList.add("err");
    valid = false;
  }
  if (!valid) return;

  setLoading(signupBtn, true);
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pw);
    await createUserDoc(cred.user);
    showToast("Account created! Welcome 🎉");
    setTimeout(() => {
      showAppLoader("Taking you to your Lakbay");
      window.location.href = "dashboard.html";
    }, 700);
  } catch (err) {
    const msg =
      err.code === "auth/email-already-in-use" ? "This email is already registered." :
      err.code === "auth/weak-password"        ? "Password is too weak." :
      err.message;
    showBanner(msg);
  } finally {
    setLoading(signupBtn, false);
  }
});

function openTermsModal() {
  termsModal?.classList.add("show");
  termsModal?.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function closeTermsModal() {
  termsModal?.classList.remove("show");
  termsModal?.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

openTermsBtn?.addEventListener("click", (event) => {
  event.preventDefault();
  openTermsModal();
});
closeTermsBtn?.addEventListener("click", closeTermsModal);

document.querySelectorAll("[data-close-terms]").forEach((el) => {
  el.addEventListener("click", closeTermsModal);
});

acceptTermsBtn?.addEventListener("click", () => {
  if (termsInput) termsInput.checked = true;
  if (termsErr) termsErr.textContent = "";
  termsInput?.classList.remove("err");
  closeTermsModal();
});

termsInput?.addEventListener("change", () => {
  if (!termsInput.checked) return;
  if (termsErr) termsErr.textContent = "";
  termsInput.classList.remove("err");
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && termsModal?.classList.contains("show")) {
    closeTermsModal();
  }
});

// ── Google ────────────────────────────────────────────
googleBtn.addEventListener("click", async () => {
  setLoading(googleBtn, true);
  try {
    const cred = await signInWithPopup(auth, gProvider);
    await createUserDoc(cred.user);
    showToast("Signed in with Google! 🎉");
    setTimeout(() => {
      showAppLoader("Taking you to your Lakbay");
      window.location.href = "dashboard.html";
    }, 700);
  } catch (err) {
    showBanner(err.message);
  } finally {
    setLoading(googleBtn, false);
  }
});
