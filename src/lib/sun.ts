/**
 * Sunrise and sunset, with no dependency and no network.
 *
 * This is the NOAA solar-position algorithm (the one behind NOAA's own
 * "Solar Calculator" spreadsheet, which is Meeus' *Astronomical Algorithms*
 * trimmed to the accuracy a calendar needs). It is good to roughly a minute for
 * ordinary latitudes, which is far more than a theme switch requires — we only
 * need to know which side of the horizon the sun is on.
 *
 * Everything here is pure: give it an instant and a coordinate, get Dates back.
 * No store, no React, no I/O — so it is safe to call from the persist `merge`
 * that runs before the app has mounted.
 */

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const MS_PER_MINUTE = 60_000;

/**
 * The "official" sunrise/sunset zenith. 90.833° rather than a flat 90° because
 * the sun is a disc, not a point (its upper limb clears the horizon ~16' before
 * its centre would) and the atmosphere refracts it into view ~34' early.
 */
const ZENITH = 90.833;

export interface SunTimes {
  sunrise: Date;
  sunset: Date;
  /**
   * `null` on an ordinary day. `"day"` means the sun never sets at this latitude
   * today (midnight sun), `"night"` that it never rises (polar night).
   */
  polar: "day" | "night" | null;
}

/** Julian Day for 00:00 UT on a Gregorian calendar date (Meeus, ch. 7). */
function julianDayUTC(year: number, month: number, day: number): number {
  let y = year;
  let m = month;
  // January and February are counted as months 13 and 14 of the previous year.
  if (m <= 2) {
    y -= 1;
    m += 12;
  }
  const a = Math.floor(y / 100);
  const b = 2 - a + Math.floor(a / 4);
  return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + day + b - 1524.5;
}

/**
 * Today's sunrise and sunset for `lat`/`lon`, where "today" is the LOCAL calendar
 * day containing `at`. Longitude is degrees east-positive (so Brisbane is +153,
 * New York is -74) — the same convention `navigator.geolocation` uses.
 */
export function sunTimes(at: Date, lat: number, lon: number): SunTimes {
  const year = at.getFullYear();
  const month = at.getMonth() + 1;
  const day = at.getDate();
  const midnight = new Date(year, month - 1, day, 0, 0, 0, 0);
  const nextMidnight = new Date(year, month - 1, day + 1, 0, 0, 0, 0);

  // tan(±90°) is Infinity, which would poison the hour angle. Nobody lives at the
  // pole itself, and a tenth of a degree is ~11 km, so clamping costs nothing.
  const latitude = Math.max(-89.9, Math.min(89.9, lat));

  // JS reports "minutes to ADD to local time to get UTC", so UTC+10 comes back as
  // -600. Read it at local NOON: that is the offset in force for the bulk of the
  // day, and it is the instant the algorithm is anchored on.
  const tzHours = -new Date(year, month - 1, day, 12, 0, 0, 0).getTimezoneOffset() / 60;

  // Julian centuries since J2000.0, evaluated at local noon.
  const jd = julianDayUTC(year, month, day) + 0.5 - tzHours / 24;
  const t = (jd - 2451545) / 36525;

  const meanLong = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
  const meanAnom = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const eccent = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const centre =
    Math.sin(meanAnom * RAD) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * meanAnom * RAD) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * meanAnom * RAD) * 0.000289;
  const trueLong = meanLong + centre;
  const omega = 125.04 - 1934.136 * t;
  const appLong = trueLong - 0.00569 - 0.00478 * Math.sin(omega * RAD);
  const meanObliq = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliq = meanObliq + 0.00256 * Math.cos(omega * RAD);
  const declination = DEG * Math.asin(Math.sin(obliq * RAD) * Math.sin(appLong * RAD));

  // Equation of time, in minutes: the gap between clock noon and true solar noon.
  const varY = Math.tan((obliq / 2) * RAD) ** 2;
  const eqTime =
    4 *
    DEG *
    (varY * Math.sin(2 * meanLong * RAD) -
      2 * eccent * Math.sin(meanAnom * RAD) +
      4 * eccent * varY * Math.sin(meanAnom * RAD) * Math.cos(2 * meanLong * RAD) -
      0.5 * varY * varY * Math.sin(4 * meanLong * RAD) -
      1.25 * eccent * eccent * Math.sin(2 * meanAnom * RAD));

  // Minutes after local midnight at which the sun crosses the meridian.
  const solarNoonMin = 720 - 4 * lon - eqTime + tzHours * 60;

  const cosHourAngle =
    Math.cos(ZENITH * RAD) / (Math.cos(latitude * RAD) * Math.cos(declination * RAD)) -
    Math.tan(latitude * RAD) * Math.tan(declination * RAD);

  // POLAR CASES. There is no hour angle to solve for: acos() of anything outside
  // [-1, 1] is NaN, and a NaN Date would silently poison every caller. Instead we
  // hand back a pair of local midnights that says the same thing in the language
  // callers already speak — `sunrise <= now < sunset` means daylight:
  //   midnight sun  -> sunrise = today 00:00, sunset = tomorrow 00:00 (always light)
  //   polar night   -> sunrise = tomorrow 00:00, sunset = today 00:00 (never light)
  // Either way the next "transition" a caller schedules against is the next local
  // midnight, when we re-evaluate and may well still be polar. `polar` is set so
  // the UI can say "the sun doesn't set here today" instead of printing a midnight.
  if (!Number.isFinite(cosHourAngle) || cosHourAngle >= 1) {
    return { sunrise: nextMidnight, sunset: midnight, polar: "night" };
  }
  if (cosHourAngle <= -1) {
    return { sunrise: midnight, sunset: nextMidnight, polar: "day" };
  }

  // Half the length of the day, in minutes (4 minutes per degree of rotation).
  const halfDayMin = 4 * DEG * Math.acos(cosHourAngle);

  // Adding minutes to the local-midnight instant is exact except on the one day a
  // year a DST jump lands between midnight and the event, where it can be an hour
  // out. A theme that turns dark an hour late twice a year is not worth carrying a
  // timezone database for.
  return {
    sunrise: new Date(midnight.getTime() + (solarNoonMin - halfDayMin) * MS_PER_MINUTE),
    sunset: new Date(midnight.getTime() + (solarNoonMin + halfDayMin) * MS_PER_MINUTE),
    polar: null,
  };
}

/** Is the sun above the horizon at `at`, for this coordinate? */
export function isDaylight(at: Date, lat: number, lon: number): boolean {
  const { sunrise, sunset } = sunTimes(at, lat, lon);
  const now = at.getTime();
  return now >= sunrise.getTime() && now < sunset.getTime();
}

/**
 * The next instant the sun crosses the horizon after `at` — i.e. the next moment
 * `isDaylight` would flip. Callers schedule against this rather than polling.
 */
export function nextSunTransition(at: Date, lat: number, lon: number): Date {
  const now = at.getTime();
  const today = sunTimes(at, lat, lon);
  if (now < today.sunrise.getTime()) return today.sunrise;
  if (now < today.sunset.getTime()) return today.sunset;

  // Past both of today's edges: the next one is tomorrow's sunrise. Ask at
  // tomorrow's local noon so the calendar-day rollover is unambiguous.
  const tomorrow = sunTimes(new Date(at.getFullYear(), at.getMonth(), at.getDate() + 1, 12, 0, 0, 0), lat, lon);
  if (tomorrow.sunrise.getTime() > now) return tomorrow.sunrise;

  // Belt and braces: never hand back a moment in the past, or a caller that
  // schedules a timer against it spins.
  return new Date(now + 60 * MS_PER_MINUTE);
}

/**
 * Approximate coordinates for the common IANA time zones — enough to put the app
 * within a few minutes of the real sunrise without asking anyone for permission
 * to anything. Each entry is [latitude, longitude] of the zone's namesake city.
 *
 * This is deliberately a short list of populous zones rather than a full tzdb
 * mirror: anything missing falls through to the offset guess below, and anyone
 * who wants it exact can set a location in Settings.
 */
const TZ_COORDS: Record<string, [number, number]> = {
  "Australia/Brisbane": [-27.47, 153.03],
  "Australia/Sydney": [-33.87, 151.21],
  "Australia/Melbourne": [-37.81, 144.96],
  "Australia/Adelaide": [-34.93, 138.6],
  "Australia/Perth": [-31.95, 115.86],
  "Australia/Hobart": [-42.88, 147.33],
  "Australia/Darwin": [-12.46, 130.84],
  "Pacific/Auckland": [-36.85, 174.76],
  "Pacific/Fiji": [-18.14, 178.44],
  "Pacific/Port_Moresby": [-9.44, 147.18],
  "Pacific/Honolulu": [21.31, -157.86],
  "Asia/Tokyo": [35.68, 139.69],
  "Asia/Seoul": [37.57, 126.98],
  "Asia/Shanghai": [31.23, 121.47],
  "Asia/Taipei": [25.03, 121.57],
  "Asia/Hong_Kong": [22.32, 114.17],
  "Asia/Manila": [14.6, 120.98],
  "Asia/Singapore": [1.35, 103.82],
  "Asia/Kuala_Lumpur": [3.14, 101.69],
  "Asia/Jakarta": [-6.21, 106.85],
  "Asia/Bangkok": [13.76, 100.5],
  "Asia/Ho_Chi_Minh": [10.82, 106.63],
  "Asia/Dhaka": [23.81, 90.41],
  "Asia/Kathmandu": [27.72, 85.32],
  "Asia/Kolkata": [22.57, 88.36],
  "Asia/Calcutta": [22.57, 88.36],
  "Asia/Colombo": [6.93, 79.86],
  "Asia/Karachi": [24.86, 67.01],
  "Asia/Dubai": [25.2, 55.27],
  "Asia/Tehran": [35.69, 51.39],
  "Asia/Riyadh": [24.71, 46.68],
  "Asia/Jerusalem": [31.78, 35.22],
  "Asia/Istanbul": [41.01, 28.98],
  "Europe/Istanbul": [41.01, 28.98],
  "Europe/Moscow": [55.76, 37.62],
  "Europe/Kyiv": [50.45, 30.52],
  "Europe/Kiev": [50.45, 30.52],
  "Europe/Bucharest": [44.43, 26.1],
  "Europe/Athens": [37.98, 23.73],
  "Europe/Helsinki": [60.17, 24.94],
  "Europe/Stockholm": [59.33, 18.07],
  "Europe/Oslo": [59.91, 10.75],
  "Europe/Copenhagen": [55.68, 12.57],
  "Europe/Warsaw": [52.23, 21.01],
  "Europe/Prague": [50.08, 14.44],
  "Europe/Vienna": [48.21, 16.37],
  "Europe/Berlin": [52.52, 13.4],
  "Europe/Zurich": [47.38, 8.54],
  "Europe/Rome": [41.9, 12.5],
  "Europe/Amsterdam": [52.37, 4.9],
  "Europe/Brussels": [50.85, 4.35],
  "Europe/Paris": [48.86, 2.35],
  "Europe/Madrid": [40.42, -3.7],
  "Europe/Lisbon": [38.72, -9.14],
  "Europe/Dublin": [53.35, -6.26],
  "Europe/London": [51.51, -0.13],
  "Atlantic/Reykjavik": [64.15, -21.94],
  "Africa/Cairo": [30.04, 31.24],
  "Africa/Nairobi": [-1.29, 36.82],
  "Africa/Lagos": [6.52, 3.38],
  "Africa/Accra": [5.6, -0.19],
  "Africa/Johannesburg": [-26.2, 28.05],
  "America/Sao_Paulo": [-23.55, -46.63],
  "America/Argentina/Buenos_Aires": [-34.6, -58.38],
  "America/Santiago": [-33.45, -70.67],
  "America/Lima": [-12.05, -77.04],
  "America/Bogota": [4.71, -74.07],
  "America/Mexico_City": [19.43, -99.13],
  "America/St_Johns": [47.56, -52.71],
  "America/Halifax": [44.65, -63.57],
  "America/Toronto": [43.65, -79.38],
  "America/New_York": [40.71, -74.01],
  "America/Detroit": [42.33, -83.05],
  "America/Chicago": [41.88, -87.63],
  "America/Winnipeg": [49.9, -97.14],
  "America/Denver": [39.74, -104.99],
  "America/Edmonton": [53.55, -113.49],
  "America/Phoenix": [33.45, -112.07],
  "America/Los_Angeles": [34.05, -118.24],
  "America/Vancouver": [49.28, -123.12],
  "America/Anchorage": [61.22, -149.9],
};

/** "Australia/Brisbane" -> "Brisbane"; "America/Argentina/Buenos_Aires" -> "Buenos Aires". */
function cityFromZone(zone: string): string {
  const last = zone.split("/").pop() ?? zone;
  return last.replace(/_/g, " ");
}

export interface TimezoneGuess {
  lat: number;
  lon: number;
  /** Human label for Settings, e.g. "Brisbane". */
  label: string;
  /** The IANA zone we read, or "" if the platform wouldn't say. */
  zone: string;
  /** True when we fell back to the offset guess rather than the lookup table. */
  approximate: boolean;
}

/**
 * Where the machine thinks it is, from its IANA time zone alone. This is the
 * zero-permission default for auto-sun mode: no prompt, no network, and it
 * follows you when you change your clock's zone.
 */
export function locationForTimezone(now: Date = new Date()): TimezoneGuess {
  let zone = "";
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    zone = "";
  }

  const hit = TZ_COORDS[zone];
  if (hit) return { lat: hit[0], lon: hit[1], label: cityFromZone(zone), zone, approximate: false };

  // Unknown zone. Put ourselves on the meridian that matches the machine's current
  // UTC offset (the earth turns 15° an hour) at latitude 0. Being on the equator
  // makes this an EQUINOX-ACCURATE guess and nothing more: it yields roughly 06:00
  // sunrise and 18:00 sunset all year round. That is a sane day/night split
  // anywhere, but it will be an hour or two out at high latitudes in midsummer or
  // midwinter — which is exactly why Settings offers "Use my location" and a
  // latitude/longitude box.
  const lon = (-now.getTimezoneOffset() / 60) * 15;
  return { lat: 0, lon, label: zone ? cityFromZone(zone) : "your time zone", zone, approximate: true };
}
