import { auth } from "./config.js";
import { sendPasswordResetEmail }
  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  applySettings,
  showToast,
  setLoading,
  hideAppLoader,
  installLoaderFailsafe,
  setLoaderText,
} from "./app.js";

applySettings();
installLoaderFailsafe(10000);
setLoaderText("Preparing account recovery");

window.addEventListener("load", () => {
  hideAppLoader(300);
});

const resetForm   = document.getElementById("reset-form");
const sendBtn     = document.getElementById("send-btn");
const errBanner   = document.getElementById("auth-err");
const formCard    = document.getElementById("form-card");
const successCard = document.getElementById("success-card");

resetForm.addEventListener("submit", async e => {
  e.preventDefault();
  errBanner.style.display = "none";
  document.getElementById("email-err").textContent = "";
  document.getElementById("email").classList.remove("err");

  const email = resetForm.email.value.trim();

  if (!email || !/\S+@\S+\.\S+/.test(email)) {
    document.getElementById("email-err").textContent = "Enter a valid email.";
    document.getElementById("email").classList.add("err");
    return;
  }

  setLoading(sendBtn, true);
  try {
    await sendPasswordResetEmail(auth, email);
    formCard.classList.add("hidden");
    successCard.classList.remove("hidden");
  } catch (err) {
    const msg =
      err.code === "auth/user-not-found" ? "No account found with this email." :
      err.message;
    errBanner.textContent    = msg;
    errBanner.style.display  = "block";
  } finally {
    setLoading(sendBtn, false);
  }
});
