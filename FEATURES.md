# KROC

The game will run a HTTP server at http://127.0.0.1:7887

# KROC Feature Index

High-level overview of every HTTP endpoint exposed by the mod. For full request/response schemas see `kroc-spec.yml`.

| Method | Path                        | Feature module      | Description                                           |
|--------|-----------------------------|---------------------|-------------------------------------------------------|
| GET    | `/pong`                     | feat-ping           | Health-check endpoint; returns plain-text `"pong"`.   |
| GET    | `/vehicle/data/list`        | feat-vehicle-data   | Returns all vehicles in the current game system.      |
| GET    | `/vehicle/data/current`     | feat-vehicle-data   | Returns the currently player-controlled vehicle.      |
| POST   | `/vehicle/actions/ignite`   | feat-vehicle-data   | Sends a main-engine ignite command to a vehicle.      |
| POST   | `/vehicle/actions/shutdown` | feat-vehicle-data   | Sends a main-engine shutdown command to a vehicle.    |
| POST   | `/vehicle/actions/refill`   | feat-vehicle-data   | Refills all consumables on a vehicle.                 |
| GET    | `/vehicle/telemetry`        | feat-vehicle-data   | Full kinematic telemetry of the controlled vehicle.   |
| GET    | `/bodies/list`              | feat-bodies         | Lists all celestial bodies in the current system.     |
| GET    | `/bodies/state/{id}`        | feat-bodies         | Current ecliptic position/velocity of a body.         |
| GET    | `/bodies/predict/{id}`      | feat-bodies         | Predicted ecliptic state at a future sim time.        |
| GET    | `/flight-computer/state`    | feat-flight-computer| Current flight computer state (mode, target, errors). |
| POST   | `/flight-computer/attitude` | feat-flight-computer| Set custom attitude hold (euler angles in a frame).   |
| POST   | `/flight-computer/track`    | feat-flight-computer| Set a named tracking target (Prograde, etc.).         |
