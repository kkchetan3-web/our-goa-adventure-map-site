import { TRIP, STOPS } from "./trip-data.js";
import { initializeGoogleMap } from "./maps-loader.js";
import { buildMainRouteRequest, buildSingleLegRequest, routePathToCoordinates, formatDistance, formatDuration } from "./route-tools.js";
import { stopsForFinishScenario } from "./geo-formats.js";
import { makeGoogleMapsDirectionsUrl } from "./formatters.js";
import { buildNearbyRestaurantRequest, mergeNearbyRestaurants, MAX_RESTAURANTS_PER_STOP, PLACE_SEARCH_FIELDS } from "./places-tools.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const CATEGORY_CONFIG = {
  food: { label: "Restaurants & cafés", query: "restaurants and cafes", glyph: "F", color: "#d66c36" },
  shops: { label: "Shops & groceries", query: "shops, supermarkets and convenience stores", glyph: "S", color: "#5d8b3e" },
  fuel: { label: "Fuel & repairs", query: "petrol pumps, fuel stations and scooter repair shops", glyph: "P", color: "#237eae" },
  sights: { label: "Beaches & sights", query: "beaches, tourist attractions and viewpoints", glyph: "V", color: "#b45945" },
  stays: { label: "Hotels & stays", query: "hotels, guest houses and homestays", glyph: "H", color: "#8359a5" },
};
const MAX_PLACES_PER_CATEGORY = 12;

const state = {
  google: null,
  map: null,
  Place: null,
  Route: null,
  AdvancedMarkerElement: null,
  PinElement: null,
  InfoWindow: null,
  MapTypeId: null,
  routeLine: null,
  returnLine: null,
  stopMarkers: [],
  placeMarkers: [],
  placeResults: [],
  restaurantMarkers: [],
  restaurantResults: [],
  mainRoute: null,
  returnRoute: null,
  selectedMapType: "roadmap",
  finishScenario: "arpora",
  mapPromise: null,
  loadingPlaces: false,
  loadingRestaurants: false,
  loadingRoute: false,
  initialRestaurantScanDone: false,
  routeBounds: null,
  toastTimer: null,
  authFailed: false,
};

const ui = {
  map: $("#map"), mapEmpty: $("#map-empty"), panel: $("#map-panel"), panelToggle: $("#panel-toggle"),
  key: $("#maps-key"), keySetup: $("#key-setup"), keyStatus: $("#key-status"), connect: $("#connect-map"),
  routeStatus: $("#route-status"), routeMessage: $("#route-message"), drawRoute: $("#draw-route"),
  routeDistance: $("#route-distance"), routeDuration: $("#route-duration"), stopList: $("#stop-list"),
  finishScenario: $("#finish-scenario"), computedRoute: $("#computed-route"),
  placesStatus: $("#places-status"), placeResults: $("#place-results"), placeQuery: $("#place-query"),
  restaurantRadius: $("#restaurant-radius"), restaurantButton: $("#search-stop-restaurants"),
  restaurantStatus: $("#restaurant-status"), restaurantResults: $("#restaurant-stop-results"),
  toast: $("#toast"),
};

function makeNode(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = String(text);
  return element;
}

function setMapStatus(message, kind = "pending") {
  ui.routeStatus.className = `status-pill status-${kind}`;
  ui.routeStatus.replaceChildren(makeNode("i"), document.createTextNode(message));
}

function setKeyStatus(message, kind = "") {
  ui.keyStatus.textContent = message;
  ui.keyStatus.className = `helper-status${kind ? ` ${kind}` : ""}`;
}

function setRouteMessage(message, kind = "") {
  ui.routeMessage.textContent = message;
  ui.routeMessage.className = `route-message${kind ? ` ${kind}` : ""}`;
}

function showToast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add("show");
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => ui.toast.classList.remove("show"), 3300);
}

function revealPanel(focusKey = false) {
  ui.panel.classList.remove("is-collapsed");
  ui.panelToggle.setAttribute("aria-expanded", "true");
  ui.panelToggle.setAttribute("aria-label", "Hide map controls");
  if (focusKey) {
    ui.keySetup.open = true;
    setTimeout(() => ui.key.focus(), 100);
  }
}

function togglePanel() {
  const collapsed = ui.panel.classList.toggle("is-collapsed");
  ui.panelToggle.setAttribute("aria-expanded", String(!collapsed));
  ui.panelToggle.setAttribute("aria-label", collapsed ? "Show map controls" : "Hide map controls");
}

function renderStopList() {
  ui.stopList.replaceChildren();
  STOPS.forEach((stop, index) => {
    const row = makeNode("li");
    const letter = makeNode("span", "stop-letter", String.fromCharCode(65 + index));
    const copy = makeNode("span", "stop-name", stop.name);
    const area = makeNode("span", "stop-area", stop.area);
    row.append(letter, copy, area);
    ui.stopList.append(row);
  });
}

function updateDirectionsLink() {
  ui.computedRoute.href = makeGoogleMapsDirectionsUrl(stopsForFinishScenario(STOPS, state.finishScenario));
  ui.computedRoute.textContent = state.finishScenario === "mapusa"
    ? "Open route plus separate Mapusa return in Google Maps ↗"
    : "Open the ordered route in Google Maps ↗";
}

function setLayerButtons(activeType) {
  $$("[data-map-type]").forEach((button) => button.classList.toggle("selected", button.dataset.mapType === activeType));
}

function setMapType(type) {
  state.selectedMapType = type;
  setLayerButtons(type);
  if (!state.map || !state.MapTypeId) {
    showToast("Connect Google Maps to change the map layer.");
    return;
  }
  const mapTypes = {
    roadmap: state.MapTypeId.ROADMAP,
    hybrid: state.MapTypeId.HYBRID,
    satellite: state.MapTypeId.SATELLITE,
    terrain: state.MapTypeId.TERRAIN,
  };
  state.map.setMapTypeId(mapTypes[type] ?? state.MapTypeId.ROADMAP);
}

function buildInfoContent(title, description, placeId, fallbackQuery = "") {
  const wrapper = makeNode("div", "place-info");
  wrapper.append(makeNode("strong", "", title));
  if (description) wrapper.append(makeNode("p", "", description));
  const link = makeNode("a", "", "Open in Google Maps ↗");
  link.href = placeId
    ? `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(placeId)}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(fallbackQuery || title)}`;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  wrapper.append(link);
  return wrapper;
}

function showStopInfo(stop, marker) {
  if (!state.InfoWindow) return;
  state.infoWindow ??= new state.InfoWindow();
  const text = [stop.area, stop.accessNote].filter(Boolean).join(" · ");
  state.infoWindow.setContent(buildInfoContent(stop.name, text, stop.placeId, `${stop.name}, Goa`));
  state.infoWindow.open({ map: state.map, anchor: marker, shouldFocus: false });
}

function clearStopMarkers() {
  state.stopMarkers.forEach((marker) => { marker.map = null; });
  state.stopMarkers = [];
}

function renderStopMarkers() {
  if (!state.map || !state.AdvancedMarkerElement || !state.PinElement) return;
  clearStopMarkers();
  STOPS.forEach((stop, index) => {
    const letter = String.fromCharCode(65 + index);
    const pin = new state.PinElement({
      glyphText: letter,
      background: index === STOPS.length - 1 ? "#d77840" : "#1e5947",
      borderColor: "#fffef9",
      glyphColor: "#ffffff",
      scale: 1.12,
    });
    const marker = new state.AdvancedMarkerElement({
      map: state.map,
      position: { lat: stop.lat, lng: stop.lng },
      title: `${letter} · ${stop.name}`,
      content: pin.element,
      gmpClickable: true,
    });
    marker.addEventListener("gmp-click", () => showStopInfo(stop, marker));
    state.stopMarkers.push(marker);
  });
}

async function connectMap() {
  if (state.map) return true;
  if (state.mapPromise) return state.mapPromise;
  const key = ui.key.value.trim();
  if (!key) {
    revealPanel(true);
    setKeyStatus("Enter a restricted Google Maps browser key to load the real map.", "error");
    return false;
  }

  ui.connect.disabled = true;
  ui.connect.textContent = "Connecting…";
  setMapStatus("Connecting to Google Maps", "pending");
  setKeyStatus("Loading Google map, Routes and Places libraries…");
  state.authFailed = false;

  state.mapPromise = (async () => {
    const libraries = await initializeGoogleMap(ui.map, key, "DEMO_MAP_ID");
    Object.assign(state, libraries);
    state.google = globalThis.google.maps;
    state.mapTypeId = libraries.MapTypeId;
    state.infoWindow = new libraries.InfoWindow();
    if (state.authFailed) throw new Error("Google rejected the browser key. Check website referrers, enabled APIs and billing.");
    ui.mapEmpty.hidden = true;
    ui.keySetup.open = false;
    setKeyStatus("Google map connected. Your key is not saved by this page.", "success");
    setMapStatus("Google map ready · calculate the road", "live");
    renderStopMarkers();
    state.map.setMapTypeId(state.MapTypeId.ROADMAP);
    state.map.setCenter({ lat: 15.32, lng: 73.91 });
    state.map.setZoom(8);
    return true;
  })().catch((error) => {
    state.mapPromise = null;
    state.map = null;
    const message = error?.message || "Google Maps could not be loaded.";
    setMapStatus("Google map unavailable", "error");
    setKeyStatus(`${message} Check API restrictions, referrer, billing and connection.`, "error");
    setRouteMessage("No substitute map or straight-line road is shown. Correct the Google key setup and try again.", "error");
    return false;
  }).finally(() => {
    ui.connect.disabled = false;
    ui.connect.textContent = "Connect & draw";
  });
  return state.mapPromise;
}

function routeStatusText(result, scope) {
  const warnings = (result?.routes ?? []).flatMap((route) => route.warnings ?? []).filter(Boolean);
  const warningText = warnings.length ? ` Google warning: ${warnings.join(" · ")}` : "";
  if (result?.fallbackInfo) {
    const mode = result.fallbackInfo.routingMode || "alternate mode";
    return `Google reported a fallback (${mode}) for ${scope}; review the displayed road before relying on it.${warningText}`;
  }
  return `Fresh Google TWO_WHEELER road calculated for ${scope}; it is not certified to match an unrecorded route variant from the original link.${warningText}`;
}

function hideRouteLine(line) {
  if (line) line.setMap(null);
}

function clearRouteLines() {
  hideRouteLine(state.routeLine);
  hideRouteLine(state.returnLine);
  state.routeLine = null;
  state.returnLine = null;
  state.mainRoute = null;
  state.returnRoute = null;
}

function drawPolyline(route, style = {}) {
  const path = routePathToCoordinates(route?.path ?? []);
  if (path.length < 2) return null;
  return new state.google.Polyline({
    map: state.map,
    path,
    geodesic: false,
    strokeColor: style.color ?? "#087ca5",
    strokeOpacity: style.opacity ?? 0.96,
    strokeWeight: style.weight ?? 6,
    zIndex: style.zIndex ?? 5,
    icons: style.dashed ? [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 1, scale: 2 }, offset: "0", repeat: "12px" }] : undefined,
  });
}

function fitRouteOnMap(route) {
  if (!state.map || !route) return;
  state.routeBounds = route.viewport ?? null;
  if (route.viewport) {
    const mobile = window.matchMedia("(max-width: 780px)").matches;
    state.map.fitBounds(route.viewport, mobile
      ? { top: 75, right: 28, bottom: 100, left: 28 }
      : { top: 85, right: 45, bottom: 48, left: 425 });
    return;
  }
  const path = routePathToCoordinates(route.path ?? []);
  if (!path.length || !state.LatLngBounds) return;
  const bounds = new state.LatLngBounds();
  path.forEach((point) => bounds.extend(point));
  state.map.fitBounds(bounds, 70);
}

function renderRouteMetrics() {
  if (!state.mainRoute) {
    ui.routeDistance.textContent = "—";
    ui.routeDuration.textContent = "—";
    return;
  }
  if (state.finishScenario === "mapusa" && state.returnRoute) {
    ui.routeDistance.textContent = formatDistance(Number(state.mainRoute.distanceMeters) + Number(state.returnRoute.distanceMeters));
    ui.routeDuration.textContent = formatDuration(Number(state.mainRoute.durationMillis) + Number(state.returnRoute.durationMillis));
  } else {
    ui.routeDistance.textContent = formatDistance(state.mainRoute.distanceMeters);
    ui.routeDuration.textContent = formatDuration(state.mainRoute.durationMillis);
  }
}

async function drawRoute() {
  if (state.loadingRoute) return;
  if (!(await connectMap())) return;
  state.loadingRoute = true;
  ui.drawRoute.disabled = true;
  ui.drawRoute.textContent = "Calculating Google road…";
  ui.routeDistance.textContent = "—";
  ui.routeDuration.textContent = "—";
  setRouteMessage("Requesting the supplied stop order from Google Routes in TWO_WHEELER mode…");
  setMapStatus("Calculating two-wheeler road", "pending");
  try {
    const result = await state.Route.computeRoutes(buildMainRouteRequest(STOPS, state.Place));
    if (!result?.routes?.length) throw new Error("Google Routes returned no two-wheeler route for the supplied stops.");
    clearRouteLines();
    state.mainRoute = result.routes[0];
    state.routeLine = drawPolyline(state.mainRoute, { color: "#087ca5", weight: 6, zIndex: 5 });
    if (!state.routeLine) throw new Error("Google returned no drawable road path. No straight-line substitute was drawn.");
    renderStopMarkers();
    fitRouteOnMap(state.mainRoute);
    const fallback = Boolean(result.fallbackInfo);

    if (state.finishScenario === "mapusa") {
      setRouteMessage("Five-stop road loaded. Calculating Arpora → Mapusa as a separate return leg…");
      try {
        const returnResult = await state.Route.computeRoutes(buildSingleLegRequest(STOPS.at(-1), STOPS[0], state.Place));
        if (!returnResult?.routes?.length) throw new Error("Google returned no separate Arpora → Mapusa return route.");
        state.returnRoute = returnResult.routes[0];
        state.returnLine = drawPolyline(state.returnRoute, { color: "#8559a6", weight: 5, dashed: true, opacity: .94, zIndex: 4 });
        if (!state.returnLine) throw new Error("Google returned no drawable road path for the return extension.");
        setRouteMessage(`${routeStatusText(result, "the five-stop supplied order")} The purple dashed line is the separately calculated Arpora → Mapusa return, not part of the original link. ${routeStatusText(returnResult, "the return leg")}`, result.fallbackInfo || returnResult.fallbackInfo ? "error" : "success");
        setMapStatus(result.fallbackInfo || returnResult.fallbackInfo ? "Google fallback reported" : "Google road marked · live", result.fallbackInfo || returnResult.fallbackInfo ? "error" : "live");
      } catch (error) {
        hideRouteLine(state.returnLine);
        state.returnLine = null;
        state.returnRoute = null;
        setRouteMessage(`The supplied five-stop road is marked. The separate Mapusa return was not available: ${error?.message || "no route returned"}.`, "error");
        setMapStatus("Main road marked · return unavailable", "error");
      }
    } else {
      setRouteMessage(routeStatusText(result, "the five-stop supplied order"), fallback ? "error" : "success");
      setMapStatus(fallback ? "Google fallback reported" : "Google road marked · live", fallback ? "error" : "live");
    }
    renderRouteMetrics();
    updateDirectionsLink();
    if (!state.initialRestaurantScanDone) {
      state.initialRestaurantScanDone = true;
      ui.drawRoute.innerHTML = '<span aria-hidden="true">●</span> Road marked · checking restaurants near A–E…';
      await waitForMapIdle();
      await searchRestaurantsAroundStops();
    }
  } catch (error) {
    clearRouteLines();
    renderRouteMetrics();
    setMapStatus("Google road unavailable", "error");
    setRouteMessage(`${error?.message || "Google route calculation failed."} Check Routes API access and the supplied place pins. No road was guessed.`, "error");
  } finally {
    state.loadingRoute = false;
    ui.drawRoute.disabled = false;
    ui.drawRoute.innerHTML = '<span aria-hidden="true">↗</span> Draw Google two-wheeler route';
  }
}

function clearPlaceMarkers() {
  state.placeMarkers.forEach(({ marker }) => { marker.map = null; });
  state.placeMarkers = [];
}

function clearRestaurantMarkers() {
  state.restaurantMarkers.forEach(({ marker }) => { marker.map = null; });
  state.restaurantMarkers = [];
}

async function fetchRestaurantsForStop(stop, radiusMeters) {
  const response = await state.Place.searchNearby(buildNearbyRestaurantRequest(stop, radiusMeters));
  return (response?.places ?? []).map((place) => ({
    id: place.id,
    displayName: place.displayName || "Google Place",
    location: place.location,
    formattedAddress: place.formattedAddress,
    primaryType: place.primaryType,
    primaryTypeDisplayName: place.primaryTypeDisplayName,
  })).filter((place) => place.id && place.location);
}

function focusStopArea(stop, radiusMeters) {
  if (!state.map) return;
  state.map.panTo({ lat: stop.lat, lng: stop.lng });
  const zoom = radiusMeters <= 1000 ? 15 : radiusMeters <= 3000 ? 14 : radiusMeters <= 5000 ? 13 : 12;
  state.map.setZoom(zoom);
}

function renderRestaurantResults(restaurantPlaces, radiusMeters) {
  clearRestaurantMarkers();
  state.restaurantResults = restaurantPlaces;
  state.restaurantResults.forEach((place) => {
    const pin = new state.PinElement({ glyphText: "R", background: "#d66c36", borderColor: "#fff", glyphColor: "#fff", scale: .98 });
    const labels = place.nearStops.map((item) => String.fromCharCode(64 + item.stopOrder));
    const marker = new state.AdvancedMarkerElement({
      map: state.map,
      position: place.location,
      title: `${place.displayName || "Restaurant"} · near ${labels.join(", ")}`,
      content: pin.element,
      gmpClickable: true,
    });
    marker.addEventListener("gmp-click", () => showPlaceInfo(place, marker));
    state.restaurantMarkers.push({ marker, place });
  });

  ui.restaurantResults.replaceChildren();
  STOPS.forEach((stop) => {
    const stopOrder = stop.order;
    const letter = String.fromCharCode(64 + stopOrder);
    const matching = state.restaurantResults
      .flatMap((place) => place.nearStops.filter((near) => near.stopId === stop.id).map((near) => ({ place, near })))
      .sort((left, right) => left.near.distanceKm - right.near.distanceKm);
    const group = makeNode("section", "restaurant-stop-group");
    const header = makeNode("header");
    const titleBlock = makeNode("div");
    titleBlock.append(makeNode("strong", "", `${letter} · ${stop.name}`));
    const countLabel = matching.length >= MAX_RESTAURANTS_PER_STOP ? `${matching.length} max · may be more` : `${matching.length} shown`;
    const areaText = makeNode("small", "restaurant-area", `${stop.area} · ${countLabel}`);
    titleBlock.append(areaText);
    const focus = makeNode("button", "", "Show radius");
    focus.type = "button";
    focus.addEventListener("click", () => focusStopArea(stop, radiusMeters));
    header.append(titleBlock, focus);
    const list = makeNode("div", "restaurant-mini-list");
    if (!matching.length) {
      list.append(makeNode("p", "empty-result", "No matching restaurants/cafés returned in this radius. Try a larger radius."));
    } else {
      matching.forEach(({ place, near }) => {
        const row = makeNode("div", "restaurant-mini");
        const copy = makeNode("div");
        copy.append(makeNode("strong", "", place.displayName || "Google Place"));
        copy.append(makeNode("small", "", `${near.distanceKm.toFixed(1)} km · ${place.formattedAddress || place.primaryTypeDisplayName || "Google Places result"}`));
        const open = makeNode("button", "", "Show");
        open.type = "button";
        open.addEventListener("click", () => {
          state.map.panTo(place.location);
          state.map.setZoom(Math.max(state.map.getZoom?.() ?? 0, 15));
          const marker = state.restaurantMarkers.find((candidate) => candidate.place.id === place.id)?.marker;
          if (marker) showPlaceInfo(place, marker);
        });
        row.append(copy, open);
        list.append(row);
      });
    }
    group.append(header, list);
    ui.restaurantResults.append(group);
  });
}

async function searchRestaurantsAroundStops() {
  if (state.loadingRestaurants) return;
  if (!(await connectMap())) return;
  state.loadingRestaurants = true;
  const radiusMeters = Math.max(500, Number(ui.restaurantRadius.value) || 5000);
  ui.restaurantButton.disabled = true;
  ui.restaurantButton.textContent = "Searching around A–E…";
  ui.restaurantStatus.className = "places-status";
  ui.restaurantStatus.textContent = `Searching restaurants and cafés within ${(radiusMeters / 1000).toFixed(radiusMeters % 1000 ? 1 : 0)} km of each stop. Google returns up to ${MAX_RESTAURANTS_PER_STOP} per stop area.`;
  try {
    const responses = await Promise.allSettled(STOPS.map(async (stop) => ({ stop, places: await fetchRestaurantsForStop(stop, radiusMeters) })));
    const successfulResults = [];
    let successCount = 0;
    let failureCount = 0;
    for (const result of responses) {
      if (result.status === "rejected") { failureCount += 1; continue; }
      successCount += 1;
      successfulResults.push(result.value);
    }
    const merged = mergeNearbyRestaurants(successfulResults);
    renderRestaurantResults(merged, radiusMeters);
    const total = merged.length;
    if (failureCount) {
      ui.restaurantStatus.className = "places-status error";
      ui.restaurantStatus.textContent = `${total} unique places marked around ${successCount} of 5 stops; ${failureCount} stop search(es) failed. Check Places API (New), billing and key restrictions.`;
    } else {
      ui.restaurantStatus.textContent = `${total} unique restaurants/cafés marked around all five stop pins, within ${(radiusMeters / 1000).toFixed(radiusMeters % 1000 ? 1 : 0)} km of each.`;
    }
  } catch (error) {
    ui.restaurantStatus.className = "places-status error";
    ui.restaurantStatus.textContent = `Nearby restaurant search failed: ${error?.message || "Check Places API (New), billing and key restrictions."}`;
  } finally {
    state.loadingRestaurants = false;
    ui.restaurantButton.disabled = false;
    ui.restaurantButton.textContent = "Mark restaurants around A–E";
  }
}

function showPlaceInfo(place, marker) {
  if (!state.InfoWindow || !state.map) return;
  state.infoWindow ??= new state.InfoWindow();
  const address = place.formattedAddress || place.primaryTypeDisplayName || "Address not returned";
  state.infoWindow.setContent(buildInfoContent(place.displayName || "Google Place", address, place.id, place.displayName));
  state.infoWindow.open({ map: state.map, anchor: marker, shouldFocus: false });
}

function categoryForPlace(place, fallback = "food") {
  fallback = place._displayCategory || fallback;
  const types = `${place.primaryType || ""} ${place.primaryTypeDisplayName || ""}`.toLowerCase();
  if (/restaurant|cafe|food|bar|bakery|meal/.test(types)) return "food";
  if (/store|shop|grocery|supermarket|market|shopping/.test(types)) return "shops";
  if (/gas|fuel|electric_vehicle_charging|car_repair|repair/.test(types)) return "fuel";
  if (/hotel|lodging|guest_house/.test(types)) return "stays";
  if (/tourist|beach|park|museum|viewpoint|attraction|landmark/.test(types)) return "sights";
  return fallback;
}

function renderPlaceResults(places, fallbackCategory = "food") {
  clearPlaceMarkers();
  ui.placeResults.replaceChildren();
  state.placeResults = places;
  if (!places.length) {
    ui.placeResults.append(makeNode("p", "empty-result", "No matching Google Places were returned in this map area. Try a broader query, or pan/zoom and search again; no result is not proof a business is closed."));
    return;
  }
  places.forEach((place, index) => {
    const category = categoryForPlace(place, fallbackCategory);
    const config = CATEGORY_CONFIG[category] ?? CATEGORY_CONFIG.food;
    let marker = null;
    if (place.location && state.AdvancedMarkerElement && state.PinElement) {
      const pin = new state.PinElement({ glyphText: config.glyph, background: config.color, borderColor: "#ffffff", glyphColor: "#ffffff", scale: .98 });
      marker = new state.AdvancedMarkerElement({
        map: state.map,
        position: place.location,
        title: place.displayName || "Google Place",
        content: pin.element,
        gmpClickable: true,
      });
      marker.addEventListener("gmp-click", () => showPlaceInfo(place, marker));
      state.placeMarkers.push({ marker, place });
    }

    const card = makeNode("article", "place-card");
    const badge = makeNode("span", "place-pin-badge", config.glyph);
    badge.style.backgroundColor = config.color;
    const copy = makeNode("div", "place-copy");
    copy.append(makeNode("strong", "", place.displayName || `Google Place ${index + 1}`));
    copy.append(makeNode("small", "", place.formattedAddress || place.primaryTypeDisplayName || config.label));
    const open = makeNode("button", "place-open", "Show pin");
    open.type = "button";
    open.addEventListener("click", () => {
      if (!place.location) return;
      state.map.panTo(place.location);
      if ((state.map.getZoom?.() ?? 0) < 14) state.map.setZoom(14);
      if (marker) showPlaceInfo(place, marker);
    });
    card.append(badge, copy, open);
    ui.placeResults.append(card);
  });
}

function waitForMapIdle(maxWait = 1800) {
  if (!state.map || !state.google?.event?.addListenerOnce) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, maxWait);
    state.google.event.addListenerOnce(state.map, "idle", finish);
  });
}

function getVisibleBounds() {
  const bounds = state.map?.getBounds?.();
  return bounds || state.routeBounds || undefined;
}

async function searchText(query, fallbackCategory = "food", maxResultCount = MAX_PLACES_PER_CATEGORY) {
  const request = {
    textQuery: query,
    fields: PLACE_SEARCH_FIELDS,
    maxResultCount,
    language: "en",
    region: "IN",
  };
  const bounds = getVisibleBounds();
  if (bounds) request.locationRestriction = bounds;
  else request.locationBias = state.map.getCenter();
  const response = await state.Place.searchByText(request);
  return (response?.places ?? []).map((place) => ({
    id: place.id,
    displayName: place.displayName,
    location: place.location,
    formattedAddress: place.formattedAddress,
    primaryType: place.primaryType,
    primaryTypeDisplayName: place.primaryTypeDisplayName,
    _displayCategory: fallbackCategory,
  }));
}

async function searchCategory(category) {
  if (state.loadingPlaces) return;
  if (!(await connectMap())) return;
  state.loadingPlaces = true;
  ui.placesStatus.className = "places-status";
  ui.placeResults.replaceChildren();
  try {
    if (category === "all") {
      const categories = Object.entries(CATEGORY_CONFIG);
      ui.placesStatus.textContent = `Searching five Google Places categories in the visible map area (up to ${MAX_PLACES_PER_CATEGORY} per category)…`;
      const results = await Promise.allSettled(categories.map(([key, config]) => searchText(config.query, key)));
      const merged = new Map();
      let failures = 0;
      results.forEach((result) => {
        if (result.status === "rejected") { failures += 1; return; }
        result.value.forEach((place) => {
          if (place.id && !merged.has(place.id)) merged.set(place.id, place);
        });
      });
      const places = [...merged.values()];
      ui.placesStatus.textContent = failures
        ? `${places.length} unique Google Places marked; ${failures} category search(es) failed. Try one category or retry.`
        : `${places.length} unique Google Places marked around the visible route area.`;
      renderPlaceResults(places, "food");
    } else {
      const config = CATEGORY_CONFIG[category];
      if (!config) return;
      ui.placeQuery.value = config.query;
      ui.placesStatus.textContent = `Searching ${config.label.toLowerCase()} in the visible map area…`;
      const places = await searchText(config.query, category);
      ui.placesStatus.textContent = `${places.length} Google result(s) marked for ${config.label.toLowerCase()}.`;
      renderPlaceResults(places, category);
    }
  } catch (error) {
    ui.placesStatus.className = "places-status error";
    ui.placesStatus.textContent = `Google Places search failed: ${error?.message || "Check Places API (New), key restrictions and billing."}`;
    ui.placeResults.replaceChildren();
  } finally {
    state.loadingPlaces = false;
  }
}

async function searchCustomPlaces(query) {
  if (!query.trim() || state.loadingPlaces) return;
  if (!(await connectMap())) return;
  state.loadingPlaces = true;
  ui.placesStatus.className = "places-status";
  ui.placesStatus.textContent = `Searching “${query.trim()}” in the visible Google map area…`;
  ui.placeResults.replaceChildren();
  try {
    const places = await searchText(query.trim(), "food", MAX_PLACES_PER_CATEGORY);
    ui.placesStatus.textContent = `${places.length} Google result(s) marked for “${query.trim()}”.`;
    renderPlaceResults(places, "food");
  } catch (error) {
    ui.placesStatus.className = "places-status error";
    ui.placesStatus.textContent = `Google Places search failed: ${error?.message || "Check Places API (New), key restrictions and billing."}`;
  } finally {
    state.loadingPlaces = false;
  }
}

function focusWholeRoute() {
  if (!state.map) {
    revealPanel(true);
    showToast("Connect Google Maps and draw the route first.");
    return;
  }
  if (state.mainRoute) {
    fitRouteOnMap(state.mainRoute);
  } else {
    state.map.setCenter({ lat: 15.32, lng: 73.91 });
    state.map.setZoom(8);
  }
}

function setFinishScenario() {
  state.finishScenario = ui.finishScenario.value;
  updateDirectionsLink();
  if (state.mainRoute) {
    if (state.finishScenario === "arpora") {
      hideRouteLine(state.returnLine);
      state.returnLine = null;
      state.returnRoute = null;
      renderRouteMetrics();
      setRouteMessage("The supplied route ends at Arpora; the separate Mapusa return is excluded.", "success");
    } else {
      setRouteMessage("Click “Draw Google two-wheeler route” to add the separate Arpora → Mapusa road extension.");
      renderRouteMetrics();
    }
  }
}

function registerEvents() {
  ui.connect.addEventListener("click", async () => { if (await connectMap()) await drawRoute(); });
  ui.drawRoute.addEventListener("click", () => void drawRoute());
  $("#show-route").addEventListener("click", () => { revealPanel(); void drawRoute(); });
  $("#fit-route").addEventListener("click", focusWholeRoute);
  $("#panel-toggle").addEventListener("click", togglePanel);
  $("#panel-close").addEventListener("click", togglePanel);
  $("#empty-open-controls").addEventListener("click", () => revealPanel(true));
  ui.finishScenario.addEventListener("change", setFinishScenario);
  ui.key.addEventListener("keydown", (event) => { if (event.key === "Enter") void (async () => { if (await connectMap()) await drawRoute(); })(); });

  $$('[data-map-type]').forEach((button) => button.addEventListener("click", () => setMapType(button.dataset.mapType)));
  $$('[data-category]').forEach((button) => button.addEventListener("click", () => void searchCategory(button.dataset.category)));
  ui.restaurantButton.addEventListener("click", () => void searchRestaurantsAroundStops());
  $("#place-search-form").addEventListener("submit", (event) => {
    event.preventDefault();
    void searchCustomPlaces(ui.placeQuery.value);
  });

  window.gm_authFailure = () => {
    state.authFailed = true;
    setMapStatus("Google key rejected", "error");
    setKeyStatus("Google rejected this key. Check website referrers, enabled APIs and billing.", "error");
    setRouteMessage("Google authorization failed. No substitute map or road was loaded.", "error");
  };
}

function boot() {
  document.title = `${TRIP.title} — Road & Places Map`;
  renderStopList();
  updateDirectionsLink();
  setLayerButtons(state.selectedMapType);
  registerEvents();
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

boot();
