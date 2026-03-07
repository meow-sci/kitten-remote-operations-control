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
