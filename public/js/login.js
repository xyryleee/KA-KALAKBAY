import { auth, gProvider } from "./config.js";
import {
  signInWithEmailAndPassword,
  signInWithPopup,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
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
setLoaderText("Checking your account");
redirectIfAuthed("dashboard.html");

window.addEventListener("load", () => {
  hideAppLoader(300);
});

const loginForm = document.getElementById("login-form");
const loginBtn  = document.getElementById("login-btn");
const googleBtn = document.getElementById("google-btn");
const errBanner = document.getElementById("auth-err");

function clearErrors() {
  ["email-err","pw-err"].forEach(id => { document.getElementById(id).textContent = ""; });
  document.getElementById("email").classList.remove("err");
  document.getElementById("pw").classList.remove("err");
  errBanner.style.display = "none";
}

function showBanner(msg) {
  errBanner.textContent = msg;
  errBanner.style.display = "block";
}

// ── Email / password ──────────────────────────────────
loginForm.addEventListener("submit", async e => {
  e.preventDefault();
  clearErrors();

  const email = loginForm.email.value.trim();
  const pw    = loginForm.pw.value;
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
  if (!valid) return;

  setLoading(loginBtn, true);
  try {
    await signInWithEmailAndPassword(auth, email, pw);
    showToast("Welcome back! 🎉");
    setTimeout(() => {
      showAppLoader("Taking you to your Lakbay");
      window.location.href = "dashboard.html";
    }, 700);
  } catch (err) {
    const msg =
      err.code === "auth/user-not-found"     ? "No account found with this email." :
      err.code === "auth/wrong-password"     ? "Incorrect password." :
      err.code === "auth/invalid-credential" ? "Invalid email or password." :
      err.code === "auth/too-many-requests"  ? "Too many attempts — try again later." :
      err.message;
    showBanner(msg);
  } finally {
    setLoading(loginBtn, false);
  }
});

// ── Google ────────────────────────────────────────────
googleBtn.addEventListener("click", async () => {
  setLoading(googleBtn, true);
  try {
    await signInWithPopup(auth, gProvider);
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
