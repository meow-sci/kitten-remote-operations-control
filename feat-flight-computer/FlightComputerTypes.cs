namespace KROC.FeatFlightComputer;

/// <summary>Request body for setting a custom attitude hold.</summary>
public record SetAttitudeRequest(
    /// <summary>Euler roll in radians (around forward axis).</summary>
    double Roll,
    /// <summary>Euler yaw in radians (ecliptic longitude for EclBody frame).</summary>
    double Yaw,
    /// <summary>Euler pitch in radians (ecliptic latitude for EclBody frame).</summary>
    double Pitch,
    /// <summary>
    /// Reference frame for the euler angles.
    /// Valid values: EclBody, EnuBody, Lvlh, VlfBody, BurnBody, Dock.
    /// Defaults to EclBody if omitted or null.
    /// </summary>
    string? Frame
);

/// <summary>Request body for setting a named tracking target (e.g. Prograde).</summary>
public record SetTrackTargetRequest(
    /// <summary>
    /// Named tracking target. Valid values: None, Custom, Forward, Backward,
    /// Up, Down, Ahead, Behind, RadialOut, RadialIn, Prograde, Retrograde,
    /// Normal, AntiNormal, Outward, Inward, PositiveDv, NegativeDv,
    /// Toward, Away, Antivel, Align.
    /// </summary>
    string Target
);

/// <summary>Flight computer state returned by the GET endpoint.</summary>
public record FlightComputerStateData(
    string AttitudeMode,
    string TrackTarget,
    string Frame,
    string RollMode,
    string BurnMode,
    string Profile,
    double CustomRollRad,
    double CustomYawRad,
    double CustomPitchRad,
    double ErrorRollDeg,
    double ErrorYawDeg,
    double ErrorPitchDeg,
    double AngleDeadbandDeg,
    double RateLimitDegPerSec
);
