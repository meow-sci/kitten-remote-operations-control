/**
 * brachistochrone-watch.tsx
 *
 * Brachistochrone (continuous-burn) transfer planner with an OpenTUI React interface.
 *
 * The algorithm iteratively solves for the intercept point by predicting where the
 * target will be at the estimated arrival time, then recomputing the trip time from
 * that new distance. Converges in ~5 iterations.
 *
 * PRE-LAUNCH phase shows:
 *   - Optimal alignment window countdown + trip time at that window
 *   - Orbital burn point: best moment in current orbit to start the burn
 *
 * Once sustained acceleration is detected (2 consecutive polls > 0.05 m/s²),
 * switches automatically to BURN phase.
 *
 * Usage:
 *   bun src/brachistochrone-watch.tsx [targetBodyId] [--hold]
 *
 * Examples:
 *   bun src/brachistochrone-watch.tsx mars
 *   bun src/brachistochrone-watch.tsx mars --hold   # auto-hold heading via FC
 *
 * ACCELERATING (pre-flip)  → point ship at shown BURN HEADING, fire engines
 * DECELERATING (post-flip) → point ship at shown RETRO HEADING, fire engines
 * Flip when the countdown reaches zero.
 *
 * --hold / HOLD_HEADING=1: auto-pushes heading to KSA flight computer (EclBody frame).
 */

import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import { useState, useEffect, useRef } from "react";

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL = process.env.KROC_URL ?? "http://localhost:7887";
const TARGET_ID = Bun.argv[2] ?? "mars";
const HOLD_HEADING = Bun.argv.includes("--hold") || process.env.HOLD_HEADING === "1";
const POLL_MS = 250;
const MAX_ITERS = 12;
const CONVERGE_EPS = 0.0001; // 0.01% trip-time change → converged
const EARTH_ID = "earth";

const SCAN_STEP_SEC    = 259200;    // 3 days   — coarse scan step
const SCAN_WINDOW_SEC  = 67392000;  // ~780 days — one synodic period
const REFRESH_STEP_SEC = 21600;     // 6 hours  — fine refresh step
const REFRESH_WINDOW_SEC = 2592000; // 30 days  — refresh window
const ALIGN_REFRESH_MS = 60000;     // re-scan every 60 s

// ── Color palette ─────────────────────────────────────────────────────────────

const C = {
  bg:        "#0d1117",
  headerBg:  "#161b22",
  border:    "#30363d",
  label:     "#8b949e",
  value:     "#e6edf3",
  accel:     "#3fb950", // green  — accelerating
  decel:     "#f78166", // orange — decelerating
  cyan:      "#58a6ff", // blue   — pre-launch / FC
  dim:       "#484f58",
  warn:      "#d29922",
  error:     "#f85149",
  title:     "#e6edf3",
};

// ── Types ─────────────────────────────────────────────────────────────────────

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
  depSimTimeSec: number; // optimal departure sim time
  tripTimeSec: number;   // trip time at that window
  scannedAt: number;     // wall-clock ms when computed
}

interface FlightComputerState {
  attitudeMode: string;
  trackTarget: string;
  frame: string;
  errorRollDeg: number;
  errorYawDeg: number;
  errorPitchDeg: number;
}

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

interface OrbitalBurnPoint {
  orbitRadiusM:    number;
  orbitSpeedMps:   number;
  orbitPeriodSec:  number;
  burnHeading:     Vec3;
  currentAngleDeg: number;
  timeToPointSec:  number;
}

interface ScanState {
  running:       boolean;
  progress:      number;  // 0..1
  nextRefreshMs: number;  // wall-clock ms of next scheduled refresh
}

// ── Vector math ───────────────────────────────────────────────────────────────

function len(v: Vec3) { return Math.sqrt(v.x ** 2 + v.y ** 2 + v.z ** 2); }

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function norm(v: Vec3): Vec3 {
  const l = len(v);
  if (l < 1e-30) return { x: 0, y: 0, z: 1 };
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

function eclipticAngles(v: Vec3): { lon: number; lat: number } {
  const u = norm(v);
  const lon = (Math.atan2(u.y, u.x) * 180 / Math.PI + 360) % 360;
  const lat = Math.asin(Math.max(-1, Math.min(1, u.z))) * 180 / Math.PI;
  return { lon, lat };
}

function angularSepDeg(posA: Vec3, posB: Vec3): number {
  const a = norm(posA);
  const b = norm(posB);
  const crossZ = a.x * b.y - a.y * b.x;
  return Math.atan2(crossZ, dot(a, b)) * 180 / Math.PI;
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────

async function getTelemetry(): Promise<TelemetryData> {
  const res = await fetch(`${BASE_URL}/vehicle/telemetry`);
  const json = await res.json() as KrocResponse<TelemetryData>;
  if (json.status !== "ok" || !json.data)
    throw new Error(`Telemetry: ${json.message ?? "no data"}`);
  return json.data;
}

async function getBodyState(id: string): Promise<BodyStateData> {
  const res = await fetch(`${BASE_URL}/bodies/state/${id}`);
  const json = await res.json() as KrocResponse<BodyStateData>;
  if (json.status !== "ok" || !json.data)
    throw new Error(`Body state '${id}': ${json.message ?? "no data"}`);
  return json.data;
}

async function predictBody(id: string, simTimeSec: number): Promise<BodyPredictData> {
  const res = await fetch(`${BASE_URL}/bodies/predict/${id}?simTimeSec=${simTimeSec}`);
  const json = await res.json() as KrocResponse<BodyPredictData>;
  if (json.status !== "ok" || !json.data)
    throw new Error(`Predict '${id}' t=${simTimeSec}: ${json.message ?? "no data"}`);
  return json.data;
}

async function setFcHeading(heading: Vec3): Promise<void> {
  const u = norm(heading);
  const yaw   = Math.atan2(u.y, u.x);
  const pitch = Math.asin(Math.max(-1, Math.min(1, u.z)));
  await fetch(`${BASE_URL}/flight-computer/attitude`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roll: 0, yaw, pitch, frame: "EclBody" }),
  });
}

async function getFcState(): Promise<FlightComputerState | null> {
  try {
    const res = await fetch(`${BASE_URL}/flight-computer/state`);
    const json = await res.json() as KrocResponse<FlightComputerState>;
    if (json.status === "ok" && json.data) return json.data;
  } catch { /* non-fatal */ }
  return null;
}

// ── Algorithm ─────────────────────────────────────────────────────────────────

/**
 * Iteratively converges on the brachistochrone intercept point.
 *
 * Formula: T = 2 * sqrt(D / a) — accelerate T/2, flip, decelerate T/2.
 * Because the target moves, we iterate: estimate T, predict where the target
 * will be at arrival, recompute D→T, repeat until T stabilises.
 *
 * overridePos / overrideT0 allow computing a hypothetical plan from a future
 * departure position (e.g. Earth at the alignment window).
 */
async function computePlan(
  ship: TelemetryData,
  accel: number,
  overridePos?: Vec3,
  overrideT0?: number,
): Promise<BrachistochronePlan> {
  const t0      = overrideT0 ?? ship.simTimeSec;
  const shipPos = overridePos ?? ship.positionEcl;

  const targetNow = await predictBody(TARGET_ID, t0);
  let tripTime    = 2 * Math.sqrt(len(sub(targetNow.positionEcl, shipPos)) / accel);
  let interceptPos = targetNow.positionEcl;
  let interceptVel = targetNow.velocityEcl;
  let iters = 0;

  for (iters = 1; iters <= MAX_ITERS; iters++) {
    const target = await predictBody(TARGET_ID, t0 + tripTime);
    interceptPos  = target.positionEcl;
    interceptVel  = target.velocityEcl;
    const d       = len(sub(interceptPos, shipPos));
    const newTrip = 2 * Math.sqrt(d / accel);
    const delta   = Math.abs(newTrip - tripTime) / newTrip;
    tripTime = newTrip;
    if (delta < CONVERGE_EPS) break;
  }

  const heading = norm(sub(interceptPos, shipPos));
  return {
    tripTimeSec:       tripTime,
    flipTimeSec:       t0 + tripTime / 2,
    arrivalSimTimeSec: t0 + tripTime,
    interceptPos,
    interceptVel,
    burnHeading:  heading,
    retroHeading: { x: -heading.x, y: -heading.y, z: -heading.z },
    iterations:   iters,
  };
}

async function fastBrachiEstimate(
  earthPos: Vec3,
  tDep: number,
  accel: number,
  targetT0Pos: Vec3,
): Promise<number> {
  const tSeed        = 2 * Math.sqrt(len(sub(targetT0Pos, earthPos)) / accel);
  const targetArrival = await predictBody(TARGET_ID, tDep + tSeed);
  return 2 * Math.sqrt(len(sub(targetArrival.positionEcl, earthPos)) / accel);
}

/**
 * Scan departure times over one synodic period (coarse) or 30 days (fine)
 * and return the window with the shortest brachistochrone trip time.
 * progressCb receives a fraction 0..1 as the scan advances.
 */
async function scanAlignmentWindows(
  t0: number,
  accel: number,
  coarse: boolean,
  progressCb: (frac: number) => void,
): Promise<AlignmentWindow> {
  const step   = coarse ? SCAN_STEP_SEC    : REFRESH_STEP_SEC;
  const window = coarse ? SCAN_WINDOW_SEC  : REFRESH_WINDOW_SEC;
  const steps  = Math.ceil(window / step);

  const [targetT0] = await Promise.all([
    predictBody(TARGET_ID, t0),
    predictBody(EARTH_ID,  t0), // warm-up
  ]);
  const targetT0Pos = targetT0.positionEcl;

  let bestDep = t0, bestTrip = Infinity;

  for (let i = 0; i < steps; i++) {
    const tDep       = t0 + i * step;
    const earthAtDep = await predictBody(EARTH_ID, tDep);
    const tripTime   = await fastBrachiEstimate(earthAtDep.positionEcl, tDep, accel, targetT0Pos);
    if (tripTime < bestTrip) { bestTrip = tripTime; bestDep = tDep; }
    progressCb((i + 1) / steps);
  }

  return { depSimTimeSec: bestDep, tripTimeSec: bestTrip, scannedAt: Date.now() };
}

async function computeOrbitalBurnPoint(
  ship: TelemetryData,
  earth: BodyStateData,
  alignWindow: AlignmentWindow,
  accel: number,
): Promise<OrbitalBurnPoint> {
  const velRel = sub(ship.velocityEcl, earth.velocityEcl);
  const posRel = sub(ship.positionEcl, earth.positionEcl);
  const r      = len(posRel);
  const vOrb   = len(velRel);
  const period = (2 * Math.PI * r) / vOrb;

  const earthAtWindow = await predictBody(EARTH_ID, alignWindow.depSimTimeSec);
  const windowPlan    = await computePlan(ship, accel, earthAtWindow.positionEcl, alignWindow.depSimTimeSec);
  const burnHeading   = windowPlan.burnHeading;

  const velDir   = norm(velRel);
  const cosA     = Math.max(-1, Math.min(1, dot(velDir, burnHeading)));
  const angleDeg = Math.acos(cosA) * 180 / Math.PI;
  const angleRad = angleDeg * Math.PI / 180;

  const t1 = (angleRad               / (2 * Math.PI)) * period;
  const t2 = ((2 * Math.PI - angleRad) / (2 * Math.PI)) * period;

  return {
    orbitRadiusM:    r,
    orbitSpeedMps:   vOrb,
    orbitPeriodSec:  period,
    burnHeading,
    currentAngleDeg: angleDeg,
    timeToPointSec:  Math.min(t1, t2),
  };
}

// ── Formatting ────────────────────────────────────────────────────────────────

function fmtDur(seconds: number): string {
  const neg = seconds < 0;
  const s   = Math.abs(seconds);
  const d   = Math.floor(s / 86400);
  const h   = Math.floor((s % 86400) / 3600);
  const m   = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const parts: string[] = [];
  if (d > 0)      parts.push(`${d}d`);
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

function fmtVec(v: Vec3): string {
  return `[${v.x.toFixed(4)}, ${v.y.toFixed(4)}, ${v.z.toFixed(4)}]`;
}

function fmtMass(kg: number): string {
  if (kg >= 1e6) return (kg / 1e6).toFixed(2) + " Mt";
  if (kg >= 1e3) return (kg / 1e3).toFixed(2) + " t";
  return kg.toFixed(1) + " kg";
}

// ── Shared UI helpers ─────────────────────────────────────────────────────────

/** One label + value line, label in muted colour, value in bright (or custom). */
function Row({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <text>
      <span fg={C.label}>{label} </span>
      <span fg={valueColor ?? C.value}>{value}</span>
    </text>
  );
}

/** Section box with a titled rounded border. */
function Section({
  title,
  accentColor,
  children,
  flexGrow,
}: {
  title: string;
  accentColor?: string;
  children: React.ReactNode;
  flexGrow?: number;
}) {
  return (
    <box
      border
      borderStyle="rounded"
      borderColor={accentColor ?? C.border}
      title={` ${title} `}
      titleAlignment="left"
      padding={1}
      flexDirection="column"
      gap={1}
      flexGrow={flexGrow}
    >
      {children}
    </box>
  );
}

// ── BURN PHASE components ─────────────────────────────────────────────────────

function BurnCommandSection({ heading, postFlip }: { heading: Vec3; postFlip: boolean }) {
  const { lon, lat } = eclipticAngles(heading);
  const accent = postFlip ? C.decel : C.accel;
  const label  = postFlip ? "RETRO HEADING" : "BURN HEADING";
  return (
    <Section title={label} accentColor={accent}>
      <text fg={accent}><strong>{fmtVec(heading)}</strong></text>
      <text>
        <span fg={C.label}>Lon </span>
        <span fg={C.value}>{lon.toFixed(2)}°</span>
        {"   "}
        <span fg={C.label}>Lat </span>
        <span fg={C.value}>{lat.toFixed(2)}°</span>
      </text>
    </Section>
  );
}

function TimingSection({
  ship,
  plan,
  flipTimeSec,
  postFlip,
}: {
  ship: TelemetryData;
  plan: BrachistochronePlan;
  flipTimeSec: number | null;
  postFlip: boolean;
}) {
  const now           = ship.simTimeSec;
  const effectiveFlip = flipTimeSec ?? plan.flipTimeSec;
  const timeToFlip    = effectiveFlip - now;
  const remaining     = plan.arrivalSimTimeSec - now;
  return (
    <Section title="TIMING">
      {!postFlip ? (
        <Row
          label="Flip in:"
          value={fmtDur(timeToFlip)}
          valueColor={timeToFlip < 3600 ? C.warn : C.value}
        />
      ) : (
        <Row label="Flipped:" value={fmtDur(-timeToFlip) + " ago"} valueColor={C.decel} />
      )}
      <Row label="Arrival:" value={fmtDur(remaining)} />
      <Row label="Trip total:" value={fmtDur(plan.tripTimeSec)} valueColor={C.dim} />
    </Section>
  );
}

function InterceptSection({ ship, plan }: { ship: TelemetryData; plan: BrachistochronePlan }) {
  const dist   = len(sub(plan.interceptPos, ship.positionEcl));
  const relVel = len(sub(ship.velocityEcl, plan.interceptVel));
  return (
    <Section title="INTERCEPT">
      <Row label="Distance:" value={fmtNum(dist)} />
      <Row label="Rel vel:" value={(relVel / 1000).toFixed(2) + " km/s"} />
    </Section>
  );
}

function ShipStateSection({
  ship,
  plan,
  accel,
  accelIsLive,
}: {
  ship: TelemetryData;
  plan: BrachistochronePlan;
  accel: number;
  accelIsLive: boolean;
}) {
  return (
    <Section title="SHIP STATE">
      <Row label="Total mass:" value={fmtMass(ship.totalMassKg)} />
      <Row label="Propellant:" value={fmtMass(ship.propellantMassKg)} />
      <Row
        label="Accel (plan):"
        value={accel.toFixed(3) + " m/s²" + (accelIsLive ? "" : " (fb)")}
        valueColor={accelIsLive ? C.value : C.warn}
      />
      <Row label="TWR cur/max:" value={`${ship.twrCurrent.toFixed(3)} / ${ship.twrMax.toFixed(3)}`} />
      <Row label="Conv iters:" value={String(plan.iterations)} valueColor={C.dim} />
    </Section>
  );
}

function FcSection({ fcState }: { fcState: FlightComputerState | null }) {
  if (!fcState) {
    return (
      <Section title="FLIGHT COMPUTER" accentColor={C.cyan}>
        <text fg={C.dim}>reading state…</text>
      </Section>
    );
  }
  const errTotal = Math.sqrt(
    fcState.errorRollDeg ** 2 + fcState.errorYawDeg ** 2 + fcState.errorPitchDeg ** 2,
  );
  return (
    <Section title="FLIGHT COMPUTER" accentColor={C.cyan}>
      <Row label="Mode:" value={`${fcState.attitudeMode} / ${fcState.trackTarget}`} />
      <Row label="Frame:" value={fcState.frame} />
      <Row
        label="Att error:"
        value={errTotal.toFixed(2) + "°"}
        valueColor={errTotal > 5 ? C.warn : C.accel}
      />
    </Section>
  );
}

function BurnPanel({
  ship,
  plan,
  flipTimeSec,
  postFlip,
  accel,
  accelIsLive,
  fcState,
}: {
  ship: TelemetryData;
  plan: BrachistochronePlan;
  flipTimeSec: number | null;
  postFlip: boolean;
  accel: number;
  accelIsLive: boolean;
  fcState: FlightComputerState | null;
}) {
  const activeHeading = postFlip ? plan.retroHeading : plan.burnHeading;
  return (
    <box flexDirection="row" flexGrow={1} gap={1} padding={1}>
      <box flexDirection="column" flexGrow={1} gap={1}>
        <BurnCommandSection heading={activeHeading} postFlip={postFlip} />
        <TimingSection ship={ship} plan={plan} flipTimeSec={flipTimeSec} postFlip={postFlip} />
        <InterceptSection ship={ship} plan={plan} />
      </box>
      <box flexDirection="column" flexGrow={1} gap={1}>
        <ShipStateSection ship={ship} plan={plan} accel={accel} accelIsLive={accelIsLive} />
        {HOLD_HEADING && <FcSection fcState={fcState} />}
      </box>
    </box>
  );
}

// ── PRE-LAUNCH components ─────────────────────────────────────────────────────

function AlignmentWindowSection({
  ship,
  earth,
  mars,
  alignWindow,
}: {
  ship: TelemetryData;
  earth: BodyStateData;
  mars: BodyStateData;
  alignWindow: AlignmentWindow | null;
}) {
  const now           = ship.simTimeSec;
  const sepDeg        = Math.abs(angularSepDeg(earth.positionEcl, mars.positionEcl));
  const earthMarsDist = len(sub(mars.positionEcl, earth.positionEcl));
  return (
    <Section title="ALIGNMENT WINDOW" accentColor={C.cyan} flexGrow={1}>
      <Row label="Earth-target sep:" value={sepDeg.toFixed(1) + "°"} />
      <Row label="Earth-target dist:" value={fmtNum(earthMarsDist)} />
      {alignWindow ? (
        <>
          <Row
            label="Time to window:"
            value={fmtDur(alignWindow.depSimTimeSec - now)}
            valueColor={C.accel}
          />
          <Row label="Trip at window:" value={fmtDur(alignWindow.tripTimeSec)} />
        </>
      ) : (
        <>
          <Row label="Time to window:" value="scanning…" valueColor={C.dim} />
          <Row label="Trip at window:" value="scanning…" valueColor={C.dim} />
        </>
      )}
    </Section>
  );
}

function OrbitalBurnSection({ burnPoint }: { burnPoint: OrbitalBurnPoint | null }) {
  if (!burnPoint) {
    return (
      <Section title="ORBITAL BURN POINT" flexGrow={1}>
        <text fg={C.dim}>computing orbit data…</text>
      </Section>
    );
  }
  const { lon: bhLon, lat: bhLat } = eclipticAngles(burnPoint.burnHeading);
  return (
    <Section title="ORBITAL BURN POINT" flexGrow={1}>
      <Row label="Orbit radius:" value={fmtNum(burnPoint.orbitRadiusM)} />
      <Row label="Orbital period:" value={fmtDur(burnPoint.orbitPeriodSec)} />
      <Row
        label="Burn heading:"
        value={`lon ${bhLon.toFixed(1)}°  lat ${bhLat.toFixed(1)}°`}
        valueColor={C.accel}
      />
      <Row
        label="Vel alignment:"
        value={burnPoint.currentAngleDeg.toFixed(1) + "° off"}
        valueColor={burnPoint.currentAngleDeg > 30 ? C.warn : C.accel}
      />
      <Row label="Time to burn:" value={fmtDur(burnPoint.timeToPointSec)} valueColor={C.accel} />
    </Section>
  );
}

function ScanStatusSection({ scanState }: { scanState: ScanState }) {
  const BAR    = 28;
  const filled = Math.round(scanState.progress * BAR);
  const bar    = "█".repeat(filled) + "░".repeat(BAR - filled);
  const pct    = Math.round(scanState.progress * 100);
  const secsUntil = Math.max(0, Math.round((scanState.nextRefreshMs - Date.now()) / 1000));
  return (
    <box
      border
      borderStyle="rounded"
      borderColor={C.border}
      title=" ALIGNMENT SCAN "
      titleAlignment="left"
      paddingX={1}
      paddingY={1}
      flexDirection="row"
      alignItems="center"
      gap={2}
    >
      {scanState.running ? (
        <text>
          <span fg={C.cyan}>[{bar}]</span>
          {"  "}
          <span fg={C.value}>{pct}%</span>
          {"  "}
          <span fg={C.dim}>scanning…</span>
        </text>
      ) : (
        <text>
          <span fg={C.accel}>[{bar}]</span>
          {"  "}
          <span fg={C.dim}>done — next refresh in </span>
          <span fg={C.value}>{secsUntil}s</span>
        </text>
      )}
    </box>
  );
}

function PreLaunchPanel({
  ship,
  earth,
  mars,
  alignWindow,
  burnPoint,
  scanState,
}: {
  ship: TelemetryData;
  earth: BodyStateData;
  mars: BodyStateData;
  alignWindow: AlignmentWindow | null;
  burnPoint: OrbitalBurnPoint | null;
  scanState: ScanState;
}) {
  return (
    <box flexDirection="column" flexGrow={1} gap={1} padding={1}>
      <box flexDirection="row" gap={1} flexGrow={1}>
        <AlignmentWindowSection ship={ship} earth={earth} mars={mars} alignWindow={alignWindow} />
        <OrbitalBurnSection burnPoint={burnPoint} />
      </box>
      <ScanStatusSection scanState={scanState} />
      <text fg={C.dim} paddingX={1}>
        Wait for the alignment window, then fire at the orbital burn point.
      </text>
    </box>
  );
}

// ── Chrome ────────────────────────────────────────────────────────────────────

function HeaderBar({
  phase,
  postFlip,
  accel,
  accelIsLive,
}: {
  phase: Phase;
  postFlip: boolean;
  accel: number;
  accelIsLive: boolean;
}) {
  const phaseLabel =
    phase === "pre" ? "PRE-LAUNCH" :
    postFlip        ? "DECELERATING ← POST-FLIP" :
                      "ACCELERATING → PRE-FLIP";
  const phaseColor =
    phase === "pre" ? C.cyan  :
    postFlip        ? C.decel :
                      C.accel;
  return (
    <box
      backgroundColor={C.headerBg}
      flexDirection="row"
      justifyContent="space-between"
      alignItems="center"
      paddingX={2}
      paddingY={1}
    >
      <text fg={C.title}>
        <strong>BRACHISTOCHRONE PLANNER</strong>
        {"  ›  TARGET: "}
        <span fg={C.cyan}>{TARGET_ID.toUpperCase()}</span>
      </text>
      <text fg={phaseColor}><strong>{phaseLabel}</strong></text>
      <text fg={accelIsLive ? C.accel : C.warn}>
        {accel.toFixed(3)} m/s²
        {accelIsLive ? "" : " (fallback)"}
      </text>
    </box>
  );
}

function FooterBar({
  telemetry,
  error,
}: {
  telemetry: TelemetryData | null;
  error: string | null;
}) {
  return (
    <box
      backgroundColor={C.headerBg}
      flexDirection="row"
      justifyContent="space-between"
      alignItems="center"
      paddingX={2}
      paddingY={1}
    >
      {error ? (
        <text fg={C.error}>⚠  {error}</text>
      ) : telemetry ? (
        <text fg={C.dim}>
          {"Sim "}
          <span fg={C.value}>{telemetry.simTimeSec.toFixed(0)}</span>
          {"   Poll "}
          <span fg={C.value}>{POLL_MS}ms</span>
        </text>
      ) : (
        <text fg={C.dim}>Connecting to KROC…</text>
      )}
      <text fg={C.dim}>ESC to quit</text>
    </box>
  );
}

function StartupScreen({ scanState }: { scanState: ScanState }) {
  const BAR    = 36;
  const filled = Math.round(scanState.progress * BAR);
  const bar    = "█".repeat(filled) + "░".repeat(BAR - filled);
  const pct    = Math.round(scanState.progress * 100);
  return (
    <box flexDirection="column" flexGrow={1} justifyContent="center" alignItems="center" gap={2}>
      <text fg={C.cyan}>
        <strong>◆ BRACHISTOCHRONE PLANNER</strong>
        {"  "}
        <span fg={C.dim}>TARGET: {TARGET_ID.toUpperCase()}</span>
      </text>
      <text fg={C.dim}>Scanning alignment windows over one synodic period (~780 days)…</text>
      <text>
        <span fg={C.cyan}>[{bar}]</span>
        {"  "}
        <span fg={C.value}>{pct}%</span>
      </text>
    </box>
  );
}

// ── Root app ──────────────────────────────────────────────────────────────────

function App() {
  const renderer  = useRenderer();
  const { width, height } = useTerminalDimensions();

  // Refs: mutable state read/written across async poll iterations without
  // triggering re-renders, but always reflect the latest value when React renders.
  const flipTimeRef       = useRef<number | null>(null);
  const lastAccelRef      = useRef(5.0);
  const accelHighCountRef = useRef(0);
  const phaseRef          = useRef<Phase>("pre");
  const alignWindowRef    = useRef<AlignmentWindow | null>(null);

  // Display state
  const [phase, setPhaseState]           = useState<Phase>("pre");
  const [telemetry, setTelemetry]        = useState<TelemetryData | null>(null);
  const [plan, setPlan]                  = useState<BrachistochronePlan | null>(null);
  const [accel, setAccel]                = useState(5.0);
  const [accelIsLive, setAccelIsLive]    = useState(false);
  const [earthState, setEarthState]      = useState<BodyStateData | null>(null);
  const [marsState, setMarsState]        = useState<BodyStateData | null>(null);
  const [alignWindow, setAlignWindowState] = useState<AlignmentWindow | null>(null);
  const [burnPoint, setBurnPoint]        = useState<OrbitalBurnPoint | null>(null);
  const [scanState, setScanState]        = useState<ScanState>({ running: true, progress: 0, nextRefreshMs: 0 });
  const [fcState, setFcState]            = useState<FlightComputerState | null>(null);
  const [error, setError]                = useState<string | null>(null);
  const [startupDone, setStartupDone]    = useState(false);

  // Helpers that keep ref + state in sync
  const setPhase = (p: Phase) => { phaseRef.current = p; setPhaseState(p); };
  const setAlignWindow = (w: AlignmentWindow | null) => {
    alignWindowRef.current = w;
    setAlignWindowState(w);
  };

  // ESC to quit
  useKeyboard((key) => {
    if (key.name === "escape") renderer.destroy();
  });

  // ── Startup coarse scan ────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const seedShip = await getTelemetry();
        if (cancelled) return;
        const t0     = seedShip.simTimeSec;
        const accel0 = seedShip.maxAccelMps2 > 0.001 ? seedShip.maxAccelMps2 : 5.0;
        lastAccelRef.current = accel0;

        const win = await scanAlignmentWindows(t0, accel0, true, (frac) => {
          if (!cancelled) setScanState(s => ({ ...s, progress: frac }));
        });
        if (!cancelled) {
          setAlignWindow(win);
          setScanState({ running: false, progress: 1, nextRefreshMs: Date.now() + ALIGN_REFRESH_MS });
          setStartupDone(true);
        }
      } catch {
        if (!cancelled) {
          setScanState({ running: false, progress: 0, nextRefreshMs: Date.now() + ALIGN_REFRESH_MS });
          setStartupDone(true); // proceed even if scan failed
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Background alignment refresh (every 60 s after startup) ───────────────
  useEffect(() => {
    if (!startupDone) return;
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout>;

    const scheduleRefresh = () => {
      timeoutId = setTimeout(async () => {
        if (cancelled) return;
        try {
          const refShip = await getTelemetry();
          if (cancelled) return;
          const accelR = refShip.maxAccelMps2 > 0.001 ? refShip.maxAccelMps2 : lastAccelRef.current;
          setScanState({ running: true, progress: 0, nextRefreshMs: 0 });

          const win = await scanAlignmentWindows(refShip.simTimeSec, accelR, false, (frac) => {
            if (!cancelled) setScanState(s => ({ ...s, progress: frac }));
          });
          if (!cancelled) {
            setAlignWindow(win);
            setScanState({ running: false, progress: 1, nextRefreshMs: Date.now() + ALIGN_REFRESH_MS });
          }
        } catch {
          if (!cancelled)
            setScanState(s => ({ ...s, running: false, nextRefreshMs: Date.now() + ALIGN_REFRESH_MS }));
        }
        if (!cancelled) scheduleRefresh();
      }, ALIGN_REFRESH_MS);
    };

    scheduleRefresh();
    return () => { cancelled = true; clearTimeout(timeoutId); };
  }, [startupDone]);

  // ── Main polling loop ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!startupDone) return;
    let cancelled = false;

    const run = async () => {
      if (cancelled) return;
      try {
        const ship   = await getTelemetry();
        if (cancelled) return;

        const isLive       = ship.maxAccelMps2 > 0.001;
        const currentAccel = isLive ? ship.maxAccelMps2 : lastAccelRef.current;
        if (isLive) lastAccelRef.current = currentAccel;

        setTelemetry(ship);
        setAccel(currentAccel);
        setAccelIsLive(isLive);
        setError(null);

        // Phase transition: 2 consecutive high-accel polls → BURN
        if (phaseRef.current === "pre") {
          if (ship.accelerationMps2 > 0.05) {
            accelHighCountRef.current++;
            if (accelHighCountRef.current >= 2) setPhase("burn");
          } else {
            accelHighCountRef.current = 0;
          }
        }

        if (phaseRef.current === "burn") {
          const p = await computePlan(ship, currentAccel);
          if (cancelled) return;

          // Preserve the flip time — once we're past it, don't reset it
          if (flipTimeRef.current === null || p.flipTimeSec > ship.simTimeSec) {
            flipTimeRef.current = p.flipTimeSec;
          }
          setPlan(p);

          if (HOLD_HEADING) {
            const postFlipLocal = (flipTimeRef.current ?? p.flipTimeSec) < ship.simTimeSec;
            await setFcHeading(postFlipLocal ? p.retroHeading : p.burnHeading);
            if (cancelled) return;
            setFcState(await getFcState());
          }
        } else {
          const [earth, mars] = await Promise.all([
            getBodyState(EARTH_ID),
            getBodyState(TARGET_ID),
          ]);
          if (cancelled) return;
          setEarthState(earth);
          setMarsState(mars);

          if (alignWindowRef.current !== null) {
            try {
              const bp = await computeOrbitalBurnPoint(ship, earth, alignWindowRef.current, currentAccel);
              if (!cancelled) setBurnPoint(bp);
            } catch { /* non-fatal */ }
          }
        }
      } catch (err: unknown) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    };

    run();
    const intervalId = setInterval(run, POLL_MS);
    return () => { cancelled = true; clearInterval(intervalId); };
  }, [startupDone]);

  // Derived: is the flip already in the past?
  const postFlip =
    flipTimeRef.current !== null && telemetry !== null
      ? flipTimeRef.current < telemetry.simTimeSec
      : false;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <box
      flexDirection="column"
      width={width}
      height={height}
      backgroundColor={C.bg}
    >
      {!startupDone ? (
        <StartupScreen scanState={scanState} />
      ) : (
        <>
          <HeaderBar phase={phase} postFlip={postFlip} accel={accel} accelIsLive={accelIsLive} />

          {phase === "burn" && plan && telemetry ? (
            <BurnPanel
              ship={telemetry}
              plan={plan}
              flipTimeSec={flipTimeRef.current}
              postFlip={postFlip}
              accel={accel}
              accelIsLive={accelIsLive}
              fcState={fcState}
            />
          ) : telemetry && earthState && marsState ? (
            <PreLaunchPanel
              ship={telemetry}
              earth={earthState}
              mars={marsState}
              alignWindow={alignWindow}
              burnPoint={burnPoint}
              scanState={scanState}
            />
          ) : (
            <box flexDirection="column" flexGrow={1} justifyContent="center" alignItems="center">
              <text fg={C.dim}>Loading vehicle and planet data…</text>
            </box>
          )}

          <FooterBar telemetry={telemetry} error={error} />
        </>
      )}
    </box>
  );
}

// ── Entry ─────────────────────────────────────────────────────────────────────

const renderer = await createCliRenderer();

process.on("uncaughtException", (err) => {
  renderer.destroy();
  console.error("Uncaught error:", err);
  process.exit(1);
});

createRoot(renderer).render(<App />);
