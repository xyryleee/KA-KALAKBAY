function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(),
      "Content-Type": "application/json"
    }
  });
}

function parseCoordinate(value, name, min, max) {
  const num = Number(value);

  if (!Number.isFinite(num) || num < min || num > max) {
    throw new Error(`Invalid ${name}`);
  }

  return num;
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders()
      });
    }

    if (request.method !== "GET") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    try {
      const url = new URL(request.url);

      if (url.pathname !== "/route") {
        return jsonResponse({ error: "Not found" }, 404);
      }

      const userLat = parseCoordinate(url.searchParams.get("userLat"), "userLat", -90, 90);
      const userLng = parseCoordinate(url.searchParams.get("userLng"), "userLng", -180, 180);
      const destLat = parseCoordinate(url.searchParams.get("destLat"), "destLat", -90, 90);
      const destLng = parseCoordinate(url.searchParams.get("destLng"), "destLng", -180, 180);

      // OSRM uses lng,lat order.
      const osrmUrl =
        "https://router.project-osrm.org/route/v1/foot/" +
        `${userLng},${userLat};${destLng},${destLat}` +
        "?overview=full&geometries=geojson&steps=true";

      const osrmResponse = await fetch(osrmUrl, {
        headers: {
          "User-Agent": "KA-KALAKBAY/1.0"
        }
      });

      if (!osrmResponse.ok) {
        const details = await osrmResponse.text();

        return jsonResponse(
          {
            error: "OSRM request failed",
            status: osrmResponse.status,
            details
          },
          502
        );
      }

      const data = await osrmResponse.json();
      return jsonResponse(data);
    } catch (error) {
      return jsonResponse(
        {
          error: error.message || "Route request failed"
        },
        400
      );
    }
  }
};
