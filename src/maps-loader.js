let mapsLoadPromise = null;

export function loadGoogleMaps(apiKey) {
  if (!apiKey || !String(apiKey).trim()) return Promise.reject(new Error("Enter a restricted Google Maps Platform browser key first."));
  if (globalThis.google?.maps?.importLibrary) return Promise.resolve(globalThis.google.maps);
  if (mapsLoadPromise) return mapsLoadPromise;

  mapsLoadPromise = new Promise((resolve, reject) => {
    const callbackName = "__ourGoaGoogleMapsReady";
    const oldScript = document.querySelector('script[data-our-goa-google-maps="true"]');
    if (oldScript) oldScript.remove();

    let settled = false;
    let timeoutId;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      try { delete globalThis[callbackName]; } catch { globalThis[callbackName] = undefined; }
      if (error) {
        mapsLoadPromise = null;
        reject(error);
      } else {
        resolve(globalThis.google.maps);
      }
    };

    globalThis[callbackName] = () => finish(null);
    const script = document.createElement("script");
    script.dataset.ourGoaGoogleMaps = "true";
    script.async = true;
    script.defer = true;
    const params = new URLSearchParams({
      key: String(apiKey).trim(),
      v: "weekly",
      loading: "async",
      callback: callbackName,
      language: "en",
      region: "IN",
    });
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.onerror = () => finish(new Error("Google Maps JavaScript API could not be loaded. Check the key, enabled APIs, referrer restriction, billing and network access."));
    document.head.append(script);
    timeoutId = setTimeout(() => finish(new Error("Google Maps did not finish loading. Check key restrictions, APIs, billing and connectivity.")), 25000);
  });
  return mapsLoadPromise;
}

export async function initializeGoogleMap(mapElement, apiKey, mapId = "DEMO_MAP_ID") {
  await loadGoogleMaps(apiKey);
  const [mapsLib, placesLib, routesLib, markerLib] = await Promise.all([
    google.maps.importLibrary("maps"),
    google.maps.importLibrary("places"),
    google.maps.importLibrary("routes"),
    google.maps.importLibrary("marker"),
  ]);
  const map = new mapsLib.Map(mapElement, {
    center: { lat: 15.35, lng: 73.95 },
    zoom: 8,
    mapId: mapId || "DEMO_MAP_ID",
    mapTypeId: "roadmap",
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
    clickableIcons: true,
    gestureHandling: "greedy",
  });
  return {
    map,
    Place: placesLib.Place,
    Route: routesLib.Route,
    AdvancedMarkerElement: markerLib.AdvancedMarkerElement,
    PinElement: markerLib.PinElement,
    InfoWindow: mapsLib.InfoWindow,
    LatLngBounds: google.maps.LatLngBounds,
    Polyline: google.maps.Polyline,
    MapTypeId: google.maps.MapTypeId,
  };
}
