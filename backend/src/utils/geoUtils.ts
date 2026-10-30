/**
 * Haversine formula to calculate distance between two GPS coordinates.
 * Returns distance in kilometers.
 */
export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth's radius in km
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
      Math.cos(toRadians(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Calculate ETA in minutes based on distance and ambulance type.
 * Uses average speed with emergency adjustments.
 */
export function calculateETA(distanceKm: number, ambulanceType?: string): number {
  // Base speed in km/h with emergency priority
  // ALS/CCT have priority routing = faster
  const speedMap: Record<string, number> = {
    BLS: 45,    // Basic - city traffic with siren
    ALS: 55,    // Advanced - higher priority
    CCT: 55,    // Critical care - high priority
    NICU: 50,   // NICU
    BARIATRIC: 40, // Bariatric - slower
    DEFAULT: 45,
  };

  const speedKmh = speedMap[ambulanceType || 'DEFAULT'] || speedMap.DEFAULT;
  const timeHours = distanceKm / speedKmh;
  const timeMinutes = timeHours * 60;

  // Add 2 minute buffer for traffic signals, turns, etc.
  return Math.round(timeMinutes + 2);
}

/**
 * Generate a simple polyline between two points (intermediate waypoints).
 * In production this would call OSRM/Google Maps Directions API.
 */
export function generateSimplePolyline(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number,
  steps: number = 10
): Array<{ lat: number; lng: number }> {
  const points: Array<{ lat: number; lng: number }> = [];
  for (let i = 0; i <= steps; i++) {
    const fraction = i / steps;
    points.push({
      lat: startLat + (endLat - startLat) * fraction,
      lng: startLng + (endLng - startLng) * fraction,
    });
  }
  return points;
}

/**
 * Validate GPS coordinates.
 */
export function isValidCoordinate(lat: number, lng: number): boolean {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180 &&
    !isNaN(lat) &&
    !isNaN(lng)
  );
}

/**
 * Check if location data is stale (older than threshold).
 */
export function isLocationStale(timestamp: Date, thresholdMinutes: number = 10): boolean {
  const ageMs = Date.now() - timestamp.getTime();
  return ageMs > thresholdMinutes * 60 * 1000;
}

/**
 * Simple bounding box filter for pre-filtering ambulances.
 */
export function isWithinBoundingBox(
  ambulanceLat: number,
  ambulanceLng: number,
  targetLat: number,
  targetLng: number,
  radiusKm: number
): boolean {
  // Approximate 1 degree = 111 km
  const latDiff = radiusKm / 111;
  const lngDiff = radiusKm / (111 * Math.cos(toRadians(targetLat)));
  return (
    Math.abs(ambulanceLat - targetLat) <= latDiff &&
    Math.abs(ambulanceLng - targetLng) <= lngDiff
  );
}
