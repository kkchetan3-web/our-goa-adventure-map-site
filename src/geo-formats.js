const escXml = (value = "") => String(value)
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&apos;");

export function stopsForFinishScenario(stops, finishScenario = "arpora") {
  const result = stops.map((stop, index) => ({ ...stop, exportOrder: index + 1 }));
  if (finishScenario === "mapusa") {
    const start = stops.find((stop) => stop.id === "mapusa") ?? stops[0];
    result.push({
      ...start,
      id: "mapusa-return",
      name: "Mapusa (return extension)",
      shortName: "Mapusa return",
      role: "return",
      exportOrder: result.length + 1,
      note: "Optional finish scenario only; this return is not part of the supplied Google Maps link.",
    });
  }
  return result;
}

export function toStopsGeoJSON(stops, finishScenario = "arpora") {
  return {
    type: "FeatureCollection",
    name: `OUR GOA waypoint points — finish ${finishScenario}`,
    metadata: {
      routeOrder: "Waypoint order only; no road geometry is included.",
      coordinateSource: "Coordinates supplied for the trip waypoints.",
      finishScenario,
    },
    features: stopsForFinishScenario(stops, finishScenario).map((stop) => ({
      type: "Feature",
      properties: {
        id: stop.id,
        name: stop.name,
        stopOrder: stop.exportOrder,
        role: stop.role,
        placeId: stop.placeId ?? null,
        coordinateSource: "User-supplied route waypoint coordinate",
        geometryNote: "Point only. This is not a road-following route line.",
      },
      geometry: {
        type: "Point",
        coordinates: [stop.lng, stop.lat],
      },
    })),
  };
}

export function toStopsKML(stops, finishScenario = "arpora") {
  const points = stopsForFinishScenario(stops, finishScenario).map((stop) => `
    <Placemark>
      <name>${escXml(`${stop.exportOrder}. ${stop.name}`)}</name>
      <description>${escXml("Waypoint point only; no road geometry is included.")}</description>
      <Point><coordinates>${stop.lng},${stop.lat},0</coordinates></Point>
    </Placemark>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escXml(`OUR GOA waypoint points — ${finishScenario} finish`)}</name>
    <description>${escXml("Stop points and order only. No route LineString is present.")}</description>${points}
  </Document>
</kml>`;
}

export function toStopsGPX(stops, finishScenario = "arpora") {
  const waypoints = stopsForFinishScenario(stops, finishScenario).map((stop) => `
  <wpt lat="${stop.lat}" lon="${stop.lng}">
    <name>${escXml(`${stop.exportOrder}. ${stop.name}`)}</name>
    <desc>${escXml("Waypoint point only; no road geometry is included.")}</desc>
    <type>${escXml(stop.role ?? "stop")}</type>
  </wpt>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="OUR GOA — THE ADVENTURE MAP" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>${escXml(`OUR GOA waypoint points — ${finishScenario} finish`)}</name><desc>${escXml("Stop points and order only. This file contains no track or road route.")}</desc></metadata>${waypoints}
</gpx>`;
}

function coordinatesFromText(text) {
  return String(text ?? "").trim().split(/\s+/).filter(Boolean).map((pair) => {
    const [lng, lat, altitude] = pair.split(",").map(Number);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return [lng, lat, Number.isFinite(altitude) ? altitude : 0];
  }).filter(Boolean);
}

export function parseGeoJSON(text) {
  const data = typeof text === "string" ? JSON.parse(text) : text;
  const features = data?.type === "FeatureCollection" ? data.features : data?.type === "Feature" ? [data] : [];
  if (!Array.isArray(features)) throw new Error("GeoJSON has no feature list.");
  return features.filter((f) => f?.geometry?.type && f.geometry.coordinates).map((feature, index) => ({
    type: "Feature",
    properties: { ...(feature.properties ?? {}), name: feature.properties?.name ?? `Imported feature ${index + 1}` },
    geometry: feature.geometry,
  }));
}

export function parseKML(text) {
  if (typeof DOMParser === "undefined") throw new Error("KML import requires a browser with XML parsing support.");
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("The KML file could not be parsed.");
  return [...doc.querySelectorAll("Placemark")].flatMap((placemark, index) => {
    const name = placemark.querySelector("name")?.textContent?.trim() || `Imported placemark ${index + 1}`;
    const description = placemark.querySelector("description")?.textContent?.trim() || "";
    const pointText = placemark.querySelector("Point coordinates")?.textContent;
    const lineText = placemark.querySelector("LineString coordinates")?.textContent;
    const polygonText = placemark.querySelector("Polygon outerBoundaryIs LinearRing coordinates")?.textContent;
    if (pointText) {
      const coords = coordinatesFromText(pointText);
      return coords.length ? [{ type: "Feature", properties: { name, description }, geometry: { type: "Point", coordinates: coords[0] } }] : [];
    }
    if (lineText) {
      const coords = coordinatesFromText(lineText);
      return coords.length > 1 ? [{ type: "Feature", properties: { name, description }, geometry: { type: "LineString", coordinates: coords } }] : [];
    }
    if (polygonText) {
      const coords = coordinatesFromText(polygonText);
      return coords.length > 2 ? [{ type: "Feature", properties: { name, description }, geometry: { type: "LineString", coordinates: coords } }] : [];
    }
    return [];
  });
}

export function parseGPX(text) {
  if (typeof DOMParser === "undefined") throw new Error("GPX import requires a browser with XML parsing support.");
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("The GPX file could not be parsed.");
  const features = [];
  for (const [index, node] of [...doc.querySelectorAll("wpt")].entries()) {
    const lat = Number(node.getAttribute("lat"));
    const lng = Number(node.getAttribute("lon"));
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    features.push({ type: "Feature", properties: { name: node.querySelector("name")?.textContent?.trim() || `Waypoint ${index + 1}` }, geometry: { type: "Point", coordinates: [lng, lat] } });
  }
  for (const [index, node] of [...doc.querySelectorAll("trkseg, rte")].entries()) {
    const pointNodes = node.matches("rte") ? [...node.querySelectorAll("rtept")] : [...node.querySelectorAll("trkpt")];
    const coordinates = pointNodes.map((point) => [Number(point.getAttribute("lon")), Number(point.getAttribute("lat"))]).filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));
    if (coordinates.length > 1) {
      const parent = node.closest("trk, rte");
      features.push({ type: "Feature", properties: { name: parent?.querySelector("name")?.textContent?.trim() || `Imported track ${index + 1}` }, geometry: { type: "LineString", coordinates } });
    }
  }
  return features;
}
