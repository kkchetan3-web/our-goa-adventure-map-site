export function formatDateLong(isoDate) {
  const date = new Date(`${isoDate}T12:00:00+05:30`);
  return new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" }).format(date);
}

export function formatTime(value) {
  if (!value) return "Not set";
  const [hours, minutes] = value.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return value;
  return new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" }).format(new Date(Date.UTC(2020, 0, 1, hours - 5, minutes - 30)));
}

export function safeText(value, fallback = "Not available") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export function makeGoogleMapsDirectionsUrl(stops) {
  const params = new URLSearchParams({ api: "1", travelmode: "two-wheeler" });
  const toValue = (stop) => stop.placeId ? `place_id:${stop.placeId}` : `${stop.lat},${stop.lng}`;
  params.set("origin", toValue(stops[0]));
  params.set("destination", toValue(stops.at(-1)));
  if (stops.length > 2) params.set("waypoints", stops.slice(1, -1).map(toValue).join("|"));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
