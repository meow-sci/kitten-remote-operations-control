namespace KROC.FeatBodies;

public record BodiesListItem(string Id, string Class, double MeanRadiusM);

public record BodyStateData(
    string Id,
    string Class,
    Vec3 PositionEcl,
    Vec3 VelocityEcl);

public record BodyPredictData(
    string Id,
    double AtSimTimeSec,
    Vec3 PositionEcl,
    Vec3 VelocityEcl);

/// <summary>Ecliptic-frame 3-vector, components in metres or m/s.</summary>
public record Vec3(double X, double Y, double Z);
