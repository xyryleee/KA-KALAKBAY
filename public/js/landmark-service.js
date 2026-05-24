import { db } from "./config.js";
import {
  collection,
  getDocs,
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

export async function getAllLandmarks() {
  const snapshot = await getDocs(collection(db, "landmarks"));

  return snapshot.docs.map((item) => {
    const data = item.data();

    return normalizeLandmark({
      firestoreId: item.id,
      ...data
    });
  });
}

export async function getLandmarkById(landmarkId) {
  if (!landmarkId) return null;

  const ref = doc(db, "landmarks", landmarkId);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    return null;
  }

  return normalizeLandmark({
    firestoreId: snap.id,
    ...snap.data()
  });
}

export function normalizeLandmark(data = {}) {
  const arInfo = Array.isArray(data.arInfo)
    ? data.arInfo.map((item) => String(item || "").trim()).filter(Boolean)
    : [];

  return {
    id: data.id || data.firestoreId,
    firestoreId: data.firestoreId || data.id,
    name: data.name || "",
    category: data.category || "",
    color: data.color || "#27667B",
    icon: data.icon || "",
    desc: data.desc || data.description || "",
    description: data.description || data.desc || "",
    history: data.history || data.desc || data.description || "",
    arInfo,
    image: data.image || "",
    lat: Number(data.lat),
    lng: Number(data.lng),
    visited: Boolean(data.visited),
    xp: Number(data.xp || 100),
    _notified: Boolean(data._notified)
  };
}
