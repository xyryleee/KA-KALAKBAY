import {
  applySettings,
  initCarousel,
  hideAppLoader,
  installLoaderFailsafe,
  setLoaderText,
} from "./app.js";
import { redirectIfAuthed } from "./auth.js";

applySettings();
installLoaderFailsafe(10000);
setLoaderText("Preparing your Lakbay");
redirectIfAuthed("dashboard.html");
initCarousel("carousel");

window.addEventListener("load", () => {
  hideAppLoader(350);
});
