/**
 * brachistochrone-watch.ts
 *
 * Continuously computes and displays a brachistochrone (continuous burn)
 * transfer plan to a target celestial body.
 *
 * The algorithm iteratively solves for the intercept point by predicting
 * where the target will be at the estimated arrival time, then recomputing
 * the trip time from that new distance. Converges in ~5 iterations.
 *
 * Because you're cutting engines for periodic refills and the flip takes
 * an unknown amount of time, this polls every few seconds and recalculates
 * from scratch each time — correcting for any drift automatically.
 *
 * PRE-LAUNCH phase shows:
 *   - Optimal Earth/Mars alignment window countdown + trip time
 *   - Orbital burn point countdown (best moment in current orbit to start)
 *
 * Once sustained acceleration is detected (2 consecutive polls > 0.05 m/s²),
 * switches automatically to BURN phase.
 *
 * Usage:
 *   bun src/brachistochrone-watch.ts [targetBodyId] [--hold]
 *
 * Examples:
 *   bun src/brachistochrone-watch.ts mars
 *   bun src/brachistochrone-watch.ts mars --hold  # auto-hold heading via FC
 *
 * How to use the output:
 *   ACCELERATING (pre-flip) → point ship at BURN HEADING, fire engines
 *   DECELERATING (post-flip) → point ship at RETRO HEADING (opposite), fire engines
 *   Flip when the countdown reaches zero.
 *
 * Flight computer integration:
 *   When --hold flag is passed (or HOLD_HEADING env var is set), the script
 *   pushes the computed heading to the KSA flight computer every poll cycle
 *   so the ship automatically holds the correct attitude. The FC is set to
 *   Custom mode in the EclBody (ecliptic-inertial) frame.
 */

const BASE_URL = process.env.KROC_URL ?? "http://localhost:7887";
const TARGET_ID = Bun.argv[2] ?? "mars";
const HOLD_HEADING = Bun.argv.includes("--hold") || process.env.HOLD_HEADING === "1";
// const POLL_MS = 3000;
const POLL_MS = 250;
const MAX_ITERS = 12;
const CONVERGE_EPS = 0.0001; // 0.01% trip-time change → converged
const EARTH_ID = "earth";

// Alignment scan constants
const SCAN_STEP_SEC = 259200;       // 3 days  — coarse scan
const SCAN_WINDOW_SEC = 67392000;   // ~780 days — one synodic period
const REFRESH_STEP_SEC = 21600;     // 6 hours — fine refresh scan
const REFRESH_WINDOW_SEC = 2592000; // 30 days  — refresh window
const ALIGN_REFRESH_MS = 60000;     // re-scan every 60 s

// ── Types ────────────────────────────────────────────────────────────────────

type Phase = "pre" | "burn";

interface Vec3 { x: number; y: number; z: number; }

interface TelemetryData {
  simTimeSec: number;
  positionEcl: Vec3;
  velocityEcl: Vec3;
  accelerationBody: Vec3;
  accelerationMps2: number;
  totalMassKg: number;
  inertMassKg: number;
  propellantMassKg: number;
  twrCurrent: number;
  twrMax: number;
  maxAccelMps2: number;
}

interface BodyStateData {
  id: string;
  class: string;
  positionEcl: Vec3;
  velocityEcl: Vec3;
}

interface BodyPredictData {
  id: string;
  atSimTimeSec: number;
  positionEcl: Vec3;
  velocityEcl: Vec3;
}

interface KrocResponse<T> {
  status: "ok" | "error";
  data?: T;
  message?: string;
}

interface AlignmentWindow {
  depSimTimeSec: number;   // optimal departure sim time
  tripTimeSec: number;     // trip time at that window
  scannedAt: number;       // wall-clock ms when this was computed
}

interface FlightComputerState {
  attitudeMode: string;
  trackTarget: string;
  frame: string;
  errorRollDeg: number;
  errorYawDeg: number;
  errorPitchDeg: number;
}

// ── Vector math ──────────────────────────────────────────────────────────────

function len(v: Vec3) { return Math.sqrt(v.x ** 2 + v.y ** 2 + v.z ** 2); }
function sub(a: Vec3, b: Vec3): Vec3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function dot(a: Vec3, b: Vec3): number { return a.x * b.x + a.y * b.y + a.z * b.z; }
function norm(v: Vec3): Vec3 {
  const l = len(v);
  if (l < 1e-30) return { x: 0, y: 0, z: 1 };
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

/** Ecliptic longitude + latitude of a direction vector (degrees). */
function eclipticAngles(v: Vec3): { lon: number; lat: number } {
  const u = norm(v);
  const lon = (Math.atan2(u.y, u.x) * 180 / Math.PI + 360) % 360;
  const lat = Math.asin(Math.max(-1, Math.min(1, u.z))) * 180 / Math.PI;
  return { lon, lat };
}

/** Signed angular separation between two ecliptic direction vectors (degrees). */
function angularSepDeg(posA: Vec3, posB: Vec3): number {
  const a = norm(posA);
  const b = norm(posB);
  const crossZ = a.x * b.y - a.y * b.x;
  const d = dot(a, b);
  return Math.atan2(crossZ, d) * 180 / Math.PI;
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function getTelemetry(): Promise<TelemetryData> {
  const res = await fetch(`${BASE_URL}/vehicle/telemetry`);
  const json: KrocResponse<TelemetryData> = await res.json() as KrocResponse<TelemetryData>;
  if (json.status !== "ok" || !json.data)
    throw new Error(`Telemetry error: ${json.message ?? "no data"}`);
  return json.data;
}

async function getBodyState(id: string): Promise<BodyStateData> {
  const res = await fetch(`${BASE_URL}/bodies/state/${id}`);
  const json: KrocResponse<BodyStateData> = await res.json() as KrocResponse<BodyStateData>;
  if (json.status !== "ok" || !json.data)
    throw new Error(`Body state error for '${id}': ${json.message ?? "no data"}`);
  return json.data;
}

async function predictBody(id: string, simTimeSec: number): Promise<BodyPredictData> {
  const res = await fetch(`${BASE_URL}/bodies/predict/${id}?simTimeSec=${simTimeSec}`);
  const json: KrocResponse<BodyPredictData> = await res.json() as KrocResponse<BodyPredictData>;
  if (json.status !== "ok" || !json.data)
    throw new Error(`Predict error for '${id}' at t=${simTimeSec}: ${json.message ?? "no data"}`);
  return json.data;
}

/**
 * Push a heading to the flight computer (Custom mode, EclBody frame).
 * Converts an ecliptic direction vector → euler angles (roll=0, yaw=lon, pitch=lat).
 */
async function setFcHeading(heading: Vec3): Promise<void> {
  const u = norm(heading);
  const yaw = Math.atan2(u.y, u.x);                    // ecliptic longitude (rad)
  const pitch = Math.asin(Math.max(-1, Math.min(1, u.z))); // ecliptic latitude (rad)
  await fetch(`${BASE_URL}/flight-computer/attitude`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roll: 0, yaw, pitch, frame: "EclBody" }),
  });
}

/** Read FC state for display. */
async function getFcState(): Promise<FlightComputerState | null> {
  try {
    const res = await fetch(`${BASE_URL}/flight-computer/state`);
    const json: KrocResponse<FlightComputerState> = await res.json() as KrocResponse<FlightComputerState>;
    if (json.status === "ok" && json.data) return json.data;
  } catch { /* non-fatal */ }
  return null;
}

// ── Core algorithm ────────────────────────────────────────────────────────────

interface BrachistochronePlan {
  tripTimeSec: number;
  flipTimeSec: number;
  arrivalSimTimeSec: number;
  interceptPos: Vec3;
  interceptVel: Vec3;
  burnHeading: Vec3;
  retroHeading: Vec3;
  iterations: number;
}

/**
 * Iteratively converges on the brachistochrone intercept point.
 *
 * The formula for a brachistochrone from rest over distance D at acceleration a:
 *   T = 2 * sqrt(D / a)   (accelerate for T/2, flip, decelerate for T/2)
 *
 * Because Mars moves, we iterate: estimate T, predict where Mars will be at
 * T0+T, recompute D and therefore T, repeat until T stabilises.
 *
 * Note: this treats the ship as starting from rest at its current position,
 * which is a simplification (it has orbital velocity). The continuous
 * recalculation every few seconds corrects for this implicitly.
 *
 * Optional overridePos / overrideT0 let callers compute a plan from a
 * hypothetical departure position (e.g. Earth at the alignment window).
 */
async function computePlan(
  ship: TelemetryData,
  accel: number,
  overridePos?: Vec3,
  overrideT0?: number,
): Promise<BrachistochronePlan> {
  const t0 = overrideT0 ?? ship.simTimeSec;
  const shipPos = overridePos ?? ship.positionEcl;

  // Seed trip time estimate from current distance to target
  const marsNow = await predictBody(TARGET_ID, t0);
  let tripTime = 2 * Math.sqrt(len(sub(marsNow.positionEcl, shipPos)) / accel);

  let interceptPos = marsNow.positionEcl;
  let interceptVel = marsNow.velocityEcl;
  let iters = 0;

  for (iters = 1; iters <= MAX_ITERS; iters++) {
    const tArrive = t0 + tripTime;
    const mars = await predictBody(TARGET_ID, tArrive);
    interceptPos = mars.positionEcl;
    interceptVel = mars.velocityEcl;

    const d = len(sub(interceptPos, shipPos));
    const newTrip = 2 * Math.sqrt(d / accel);
    const delta = Math.abs(newTrip - tripTime) / newTrip;

    tripTime = newTrip;
    if (delta < CONVERGE_EPS) break;
  }

  const heading = norm(sub(interceptPos, shipPos));
  const retro = { x: -heading.x, y: -heading.y, z: -heading.z };

  return {
    tripTimeSec: tripTime,
    flipTimeSec: t0 + tripTime / 2,
    arrivalSimTimeSec: t0 + tripTime,
    interceptPos,
    interceptVel,
    burnHeading: heading,
    retroHeading: retro,
    iterations: iters,
  };
}

// ── Alignment window scan ─────────────────────────────────────────────────────

/**
 * Fast 2-step brachistochrone estimate from `earthPos` at `t_dep` to the target.
 * Uses a cached Mars-at-t0 position for the seed distance to avoid an extra
 * API call per step. Returns the estimated trip time in seconds.
 */
async function fastBrachiEstimate(
  earthPos: Vec3,
  tDep: number,
  accel: number,
  marsT0Pos: Vec3,
): Promise<number> {
  const tSeed = 2 * Math.sqrt(len(sub(marsT0Pos, earthPos)) / accel);
  const marsAtArrival = await predictBody(TARGET_ID, tDep + tSeed);
  const d = len(sub(marsAtArrival.positionEcl, earthPos));
  return 2 * Math.sqrt(d / accel);
}

/**
 * Scan candidate departure times and find the one with minimum trip time.
 * `progressCb` receives a fraction 0..1 as the scan advances.
 * Set `coarse = true` for the full synodic-period startup scan;
 * `coarse = false` for the 30-day fine refresh scan.
 */
async function scanAlignmentWindows(
  t0: number,
  accel: number,
  coarse: boolean,
  progressCb: (frac: number) => void,
): Promise<AlignmentWindow> {
  const step   = coarse ? SCAN_STEP_SEC   : REFRESH_STEP_SEC;
  const window = coarse ? SCAN_WINDOW_SEC : REFRESH_WINDOW_SEC;
  const steps  = Math.ceil(window / step);

  // Fetch seed positions in parallel (Mars at t0 used for fast estimate seed)
  const [marsT0] = await Promise.all([
    predictBody(TARGET_ID, t0),
    predictBody(EARTH_ID,  t0), // warm-up, result unused directly
  ]);
  const marsT0Pos = marsT0.positionEcl;

  let bestDep  = t0;
  let bestTrip = Infinity;

  for (let i = 0; i < steps; i++) {
    const tDep       = t0 + i * step;
    const earthAtDep = await predictBody(EARTH_ID, tDep);
    const tripTime   = await fastBrachiEstimate(earthAtDep.positionEcl, tDep, accel, marsT0Pos);

    if (tripTime < bestTrip) {
      bestTrip = tripTime;
      bestDep  = tDep;
    }

    progressCb((i + 1) / steps);
  }

  return {
    depSimTimeSec: bestDep,
    tripTimeSec:   bestTrip,
    scannedAt:     Date.now(),
  };
}

// ── Orbital burn point ────────────────────────────────────────────────────────

interface OrbitalBurnPoint {
  orbitRadiusM:    number;
  orbitSpeedMps:   number;
  orbitPeriodSec:  number;
  burnHeading:     Vec3;         // desired velocity direction at departure
  currentAngleDeg: number;       // angle between vel_rel and burnHeading
  timeToPointSec:  number;       // seconds until next burn-point pass this orbit
}

async function computeOrbitalBurnPoint(
  ship: TelemetryData,
  earth: BodyStateData,
  alignWindow: AlignmentWindow,
  accel: number,
): Promise<OrbitalBurnPoint> {
  // Relative state w.r.t. Earth
  const velRel = sub(ship.velocityEcl, earth.velocityEcl);
  const posRel = sub(ship.positionEcl, earth.positionEcl);

  const r      = len(posRel);
  const vOrb   = len(velRel);
  const period = (2 * Math.PI * r) / vOrb;

  // Burn heading: full convergent brachistochrone from Earth at alignment window
  const earthAtWindow = await predictBody(EARTH_ID, alignWindow.depSimTimeSec);
  const windowPlan    = await computePlan(
    ship,
    accel,
    earthAtWindow.positionEcl,
    alignWindow.depSimTimeSec,
  );
  const burnHeading = windowPlan.burnHeading;

  // Angle between current relative-velocity direction and desired heading
  const velDir   = norm(velRel);
  const cosA     = Math.max(-1, Math.min(1, dot(velDir, burnHeading)));
  const angleDeg = Math.acos(cosA) * 180 / Math.PI;
  const angleRad = angleDeg * Math.PI / 180;

  // Two candidate times within the orbit; take the sooner one
  const t1          = (angleRad                   / (2 * Math.PI)) * period;
  const t2          = ((2 * Math.PI - angleRad) / (2 * Math.PI)) * period;
  const timeToPoint = Math.min(t1, t2);

  return {
    orbitRadiusM:    r,
    orbitSpeedMps:   vOrb,
    orbitPeriodSec:  period,
    burnHeading,
    currentAngleDeg: angleDeg,
    timeToPointSec:  timeToPoint,
  };
}

// ── Formatting ────────────────────────────────────────────────────────────────

function fmtDur(seconds: number): string {
  const neg = seconds < 0;
  const s = Math.abs(seconds);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0 || d > 0) parts.push(`${h}h`);
  parts.push(`${String(m).padStart(2, "0")}m`);
  parts.push(`${String(sec).padStart(2, "0")}s`);
  return (neg ? "-" : "") + parts.join(" ");
}

function fmtNum(n: number, decimals = 2): string {
  if (Math.abs(n) >= 1e12) return (n / 1e12).toFixed(1) + " Tm";
  if (Math.abs(n) >= 1e9)  return (n / 1e9).toFixed(1)  + " Gm";
  if (Math.abs(n) >= 1e6)  return (n / 1e6).toFixed(1)  + " Mm";
  if (Math.abs(n) >= 1e3)  return (n / 1e3).toFixed(1)  + " km";
  return n.toFixed(decimals) + " m";
}

function fmtVec(v: Vec3, decimals = 4): string {
  return `[${v.x.toFixed(decimals)}, ${v.y.toFixed(decimals)}, ${v.z.toFixed(decimals)}]`;
}

function fmtMass(kg: number): string {
  if (kg >= 1e6) return (kg / 1e6).toFixed(2) + " t (×10⁶)";
  if (kg >= 1e3) return (kg / 1e3).toFixed(2) + " t";
  return kg.toFixed(1) + " kg";
}

// ── Scan state ────────────────────────────────────────────────────────────────

interface ScanState {
  running:       boolean;
  progress:      number;  // 0..1
  nextRefreshMs: number;  // wall-clock ms when next refresh is due
}

function buildScanLine(s: ScanState): string {
  const BAR = 20;
  if (s.running) {
    const filled = Math.round(s.progress * BAR);
    const bar    = "#".repeat(filled) + ".".repeat(BAR - filled);
    const pct    = Math.round(s.progress * 100);
    return `Scanning: [${bar}] ${pct}%`;
  }
  const secsUntil = Math.max(0, Math.round((s.nextRefreshMs - Date.now()) / 1000));
  const bar = "#".repeat(BAR);
  return `Scanning: [${bar}] done  (next refresh ${secsUntil}s)`;
}

// ── Display ───────────────────────────────────────────────────────────────────

let flipTimeSec: number | null = null; // persists across polls

function printPlan(ship: TelemetryData, plan: BrachistochronePlan, accel: number, accelIsLive: boolean, fcState: FlightComputerState | null): void {
  // Update flip time if it's still in the future (don't reset a past flip)
  if (flipTimeSec === null || plan.flipTimeSec > ship.simTimeSec) {
    flipTimeSec = plan.flipTimeSec;
  }

  const now = ship.simTimeSec;
  const remainingTotal = plan.arrivalSimTimeSec - now;
  const timeToFlip = flipTimeSec - now;
  const postFlip = timeToFlip < 0;

  const phase = postFlip ? "DECELERATING ← POST-FLIP" : "ACCELERATING → PRE-FLIP";
  const activeHeading = postFlip ? plan.retroHeading : plan.burnHeading;
  const headingLabel = postFlip ? "RETRO HEADING" : "BURN HEADING ";
  const { lon, lat } = eclipticAngles(activeHeading);

  const distToIntercept = len(sub(plan.interceptPos, ship.positionEcl));
  const relVelToMars = len(sub(ship.velocityEcl, plan.interceptVel));

  // Clear console and print dashboard
  process.stdout.write("\x1Bc"); // ANSI clear screen
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log(`║  BRACHISTOCHRONE PLANNER → ${TARGET_ID.toUpperCase().padEnd(28)} ║`);
  console.log("╠══════════════════════════════════════════════════════════╣");
  console.log(`║  Phase:      ${phase.padEnd(44)} ║`);
  console.log("╠══════════════════════════════════════════════════════════╣");
  console.log("║  BURN COMMAND                                            ║");
  console.log(`║  ${headingLabel}: ${fmtVec(activeHeading).padEnd(43)} ║`);
  console.log(`║  Ecl longitude: ${lon.toFixed(2).padStart(8)}°   latitude: ${lat.toFixed(2).padStart(7)}°        ║`);
  console.log("╠══════════════════════════════════════════════════════════╣");
  console.log("║  TIMING                                                  ║");
  if (!postFlip) {
    console.log(`║  Flip in:    ${fmtDur(timeToFlip).padEnd(44)} ║`);
    console.log(`║  Arrival in: ${fmtDur(remainingTotal).padEnd(44)} ║`);
  } else {
    console.log(`║  Flipped:    ${fmtDur(-timeToFlip).padEnd(38)} ago ║`);
    console.log(`║  Arrival in: ${fmtDur(remainingTotal).padEnd(44)} ║`);
  }
  console.log(`║  Trip total: ${fmtDur(plan.tripTimeSec).padEnd(44)} ║`);
  console.log("╠══════════════════════════════════════════════════════════╣");
  console.log("║  INTERCEPT                                               ║");
  console.log(`║  Distance to intercept: ${fmtNum(distToIntercept).padEnd(33)} ║`);
  console.log(`║  Rel velocity at intercept: ${(relVelToMars / 1000).toFixed(2).padStart(10)} km/s            ║`);
  console.log("╠══════════════════════════════════════════════════════════╣");
  console.log("║  SHIP STATE                                              ║");
  console.log(`║  Total mass:    ${fmtMass(ship.totalMassKg).padEnd(41)} ║`);
  console.log(`║  Propellant:    ${fmtMass(ship.propellantMassKg).padEnd(41)} ║`);
  console.log(`║  Accel (plan):  ${(accel.toFixed(3) + " m/s²" + (accelIsLive ? "" : " (fallback)")).padEnd(41)} ║`);
  console.log(`║  TWR (current): ${ship.twrCurrent.toFixed(3).padEnd(41)} ║`);
  console.log(`║  TWR (max):     ${ship.twrMax.toFixed(3).padEnd(41)} ║`);
  console.log(`║  Converg iters: ${String(plan.iterations).padEnd(41)} ║`);
  if (HOLD_HEADING && fcState) {
    const errTotal = Math.sqrt(fcState.errorRollDeg ** 2 + fcState.errorYawDeg ** 2 + fcState.errorPitchDeg ** 2);
    console.log("╠══════════════════════════════════════════════════════════╣");
    console.log("║  FLIGHT COMPUTER (auto-hold)                             ║");
    console.log(`║  Mode: ${(fcState.attitudeMode + " / " + fcState.trackTarget).padEnd(50)} ║`);
    console.log(`║  Frame: ${fcState.frame.padEnd(49)} ║`);
    console.log(`║  Att error: ${(errTotal.toFixed(2) + "°").padEnd(45)} ║`);
  } else if (HOLD_HEADING) {
    console.log("╠══════════════════════════════════════════════════════════╣");
    console.log("║  FLIGHT COMPUTER (auto-hold)  — reading state...         ║");
  }
  console.log("╠══════════════════════════════════════════════════════════╣");
  console.log(`║  Sim time: ${now.toFixed(0).padEnd(46)} ║`);
  console.log(`║  Polling every ${POLL_MS / 1000}s   [Ctrl-C to stop]${" ".repeat(21)} ║`);
  console.log("╚══════════════════════════════════════════════════════════╝");
}

function printPreLaunch(
  ship: TelemetryData,
  earth: BodyStateData,
  mars: BodyStateData,
  alignWindow: AlignmentWindow | null,
  burnPoint: OrbitalBurnPoint | null,
  scanState: ScanState,
): void {
  const now = ship.simTimeSec;

  // Angular separation Earth-Mars (from Sun, absolute value)
  const sepDeg      = Math.abs(angularSepDeg(earth.positionEcl, mars.positionEcl));
  const earthMarsDist = len(sub(mars.positionEcl, earth.positionEcl));

  process.stdout.write("\x1Bc");
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log(`║  BRACHISTOCHRONE PLANNER → ${TARGET_ID.toUpperCase().padEnd(28)} ║`);
  console.log("╠══════════════════════════════════════════════════════════╣");
  console.log(`║  Phase:      ${"PRE-LAUNCH".padEnd(44)} ║`);
  console.log("╠══════════════════════════════════════════════════════════╣");
  console.log("║  ALIGNMENT WINDOW                                        ║");
  console.log(`║  Earth-Mars sep:   ${(sepDeg.toFixed(1) + "°").padEnd(38)} ║`);
  console.log(`║  Earth-Mars dist:  ${fmtNum(earthMarsDist).padEnd(38)} ║`);

  if (alignWindow !== null) {
    const timeToWindow = alignWindow.depSimTimeSec - now;
    console.log(`║  Time to window:   ${fmtDur(timeToWindow).padEnd(38)} ║`);
    console.log(`║  Trip at window:   ${fmtDur(alignWindow.tripTimeSec).padEnd(38)} ║`);
  } else {
    console.log(`║  Time to window:   ${"scanning...".padEnd(38)} ║`);
    console.log(`║  Trip at window:   ${"scanning...".padEnd(38)} ║`);
  }

  console.log("╠══════════════════════════════════════════════════════════╣");
  console.log("║  ORBITAL BURN POINT (for alignment window departure)     ║");

  if (burnPoint !== null) {
    const { lon: bhLon, lat: bhLat } = eclipticAngles(burnPoint.burnHeading);
    console.log(`║  Orbit radius:    ${fmtNum(burnPoint.orbitRadiusM).padEnd(39)} ║`);
    console.log(`║  Orbital period:  ${fmtDur(burnPoint.orbitPeriodSec).padEnd(39)} ║`);
    console.log(`║  Burn heading:    lon ${bhLon.toFixed(1).padStart(7)}°  lat ${bhLat.toFixed(1).padStart(6)}°        ║`);
    console.log(`║  Vel alignment:   ${(burnPoint.currentAngleDeg.toFixed(1) + "° off").padEnd(39)} ║`);
    console.log(`║  Time to burn:    ${fmtDur(burnPoint.timeToPointSec).padEnd(39)} ║`);
  } else {
    console.log(`║  ${"(computing orbit data...)".padEnd(55)} ║`);
    console.log(`║  ${"".padEnd(55)} ║`);
    console.log(`║  ${"".padEnd(55)} ║`);
    console.log(`║  ${"".padEnd(55)} ║`);
    console.log(`║  ${"".padEnd(55)} ║`);
  }

  console.log("╠══════════════════════════════════════════════════════════╣");
  console.log("║  NOTE: Wait for alignment window, then time your orbit.  ║");
  console.log(`║  ${buildScanLine(scanState).padEnd(55)} ║`);
  console.log("╠══════════════════════════════════════════════════════════╣");
  const simStr = now.toFixed(0);
  console.log(`║  Sim time: ${simStr.padEnd(20)}  Polling every ${POLL_MS / 1000}s [Ctrl-C stop] ║`);
  console.log("╚══════════════════════════════════════════════════════════╝");
}

// ── Progress display during startup scan ──────────────────────────────────────

function printScanProgress(frac: number): void {
  const BAR    = 40;
  const filled = Math.round(frac * BAR);
  const bar    = "#".repeat(filled) + ".".repeat(BAR - filled);
  const pct    = Math.round(frac * 100);
  process.stdout.write(`\r  Scanning alignment windows... [${bar}] ${pct}%  `);
}

// ── Main loop ─────────────────────────────────────────────────────────────────

async function poll(): Promise<void> {
  let lastAccel      = 5.0;
  let phase: Phase   = "pre";
  let accelHighCount = 0;

  let alignWindow: AlignmentWindow | null = null;
  let scanState: ScanState = { running: true, progress: 0, nextRefreshMs: 0 };

  // ── Startup scan ──────────────────────────────────────────────────────────
  console.log(`\n  Starting brachistochrone planner for target: ${TARGET_ID}`);
  console.log("  Scanning alignment windows over ~780 days (one synodic period)...");

  try {
    const seedShip = await getTelemetry();
    const t0       = seedShip.simTimeSec;
    const accel0   = seedShip.maxAccelMps2 > 0.001 ? seedShip.maxAccelMps2 : 5.0;

    alignWindow = await scanAlignmentWindows(t0, accel0, /* coarse */ true, (frac) => {
      scanState.progress = frac;
      printScanProgress(frac);
    });

    process.stdout.write("\n");
    console.log(
      `  → Best window: depart in ${fmtDur(alignWindow.depSimTimeSec - t0)}, ` +
      `trip ${fmtDur(alignWindow.tripTimeSec)}\n`,
    );
    scanState = { running: false, progress: 1, nextRefreshMs: Date.now() + ALIGN_REFRESH_MS };
  } catch (err: any) {
    process.stdout.write("\n");
    console.warn(`  [WARN] Alignment scan failed: ${err?.message ?? err}`);
    scanState = { running: false, progress: 0, nextRefreshMs: Date.now() + ALIGN_REFRESH_MS };
  }

  // ── Background 60-second alignment refresh ────────────────────────────────
  const scheduleRefresh = () => {
    setTimeout(async () => {
      try {
        const refShip = await getTelemetry();
        const t0r     = refShip.simTimeSec;
        const accelR  = refShip.maxAccelMps2 > 0.001 ? refShip.maxAccelMps2 : lastAccel;

        scanState = { running: true, progress: 0, nextRefreshMs: 0 };

        alignWindow = await scanAlignmentWindows(t0r, accelR, /* coarse */ false, (frac) => {
          scanState.progress = frac;
        });
        scanState = { running: false, progress: 1, nextRefreshMs: Date.now() + ALIGN_REFRESH_MS };
      } catch {
        scanState = { running: false, progress: 0, nextRefreshMs: Date.now() + ALIGN_REFRESH_MS };
      }
      scheduleRefresh();
    }, ALIGN_REFRESH_MS);
  };
  scheduleRefresh();

  // ── Polling loop ──────────────────────────────────────────────────────────
  const run = async () => {
    try {
      const ship = await getTelemetry();

      // Determine planning accel: maxAccelMps2 from telemetry > last known
      let accel: number;
      const accelIsLive = ship.maxAccelMps2 > 0.001;
      if (accelIsLive) {
        accel = ship.maxAccelMps2;
        lastAccel = accel;
      } else {
        accel = lastAccel; // no engines configured — hold last known
      }

      // Phase transition: switch to burn after 2 consecutive high-accel polls
      if (phase === "pre") {
        if (ship.accelerationMps2 > 0.05) {
          accelHighCount++;
          if (accelHighCount >= 2) {
            phase = "burn";
          }
        } else {
          accelHighCount = 0;
        }
      }

      if (phase === "burn") {
        // ── BURN phase ─────────────────────────────────────────────────────
        const plan = await computePlan(ship, accel);

        // Push heading to flight computer if --hold is active
        let fcState: FlightComputerState | null = null;
        if (HOLD_HEADING) {
          const timeToFlipLocal = (flipTimeSec ?? plan.flipTimeSec) - ship.simTimeSec;
          const postFlipLocal = timeToFlipLocal < 0;
          const activeHeading = postFlipLocal ? plan.retroHeading : plan.burnHeading;
          await setFcHeading(activeHeading);
          fcState = await getFcState();
        }

        printPlan(ship, plan, accel, accelIsLive, fcState);
      } else {
        // ── PRE-LAUNCH phase ───────────────────────────────────────────────
        const [earth, marsState] = await Promise.all([
          getBodyState(EARTH_ID),
          getBodyState(TARGET_ID),
        ]);

        let burnPoint: OrbitalBurnPoint | null = null;
        if (alignWindow !== null) {
          try {
            burnPoint = await computeOrbitalBurnPoint(ship, earth, alignWindow, accel);
          } catch {
            // non-fatal — display without burn point
          }
        }

        printPreLaunch(ship, earth, marsState, alignWindow, burnPoint, scanState);
      }
    } catch (err: any) {
      process.stdout.write("\x1Bc");
      console.error(`[ERROR] ${err?.message ?? err}`);
      console.log(`Retrying in ${POLL_MS / 1000}s…  (is KSA running with KROC loaded?)`);
    }
  };

  await run();
  setInterval(run, POLL_MS);
}

await poll();
