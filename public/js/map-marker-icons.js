function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function createLandmarkPinIcon(landmark) {
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
