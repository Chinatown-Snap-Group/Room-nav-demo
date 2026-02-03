# Waypoint System Scripts

This folder contains four PlayCanvas scripts that split the waypoint pipeline into data loading, path building, camera motion, and flow coordination.

## Scripts

- `waypoint-fetcher.mjs`: Loads waypoints from URL or asset, then fires `waypoints:loaded`.
- `waypoint-path-builder.mjs`: Builds curve samples and fires `path:ready`.
- `camera-mover.mjs`: Moves the camera (linear or curve) and fires `camera:waypoint` / `camera:path:complete`.
- `flow-coordinator.mjs`: Listens for camera events and triggers UI callbacks or `ui:waypoint`.

## Event Flow

1. `waypoint-fetcher.mjs` loads and fires `waypoints:loaded`.
2. `waypoint-path-builder.mjs` listens and fires `path:ready`.
3. `camera-mover.mjs` listens and moves the camera, emitting waypoint events.
4. `flow-coordinator.mjs` listens and forwards to UI or fires `ui:waypoint`.

## Minimal Setup

- Attach `WaypointFetcher` and `WaypointPathBuilder` to a manager entity.
- Attach `CameraMover` to the camera (or set `Target Entity`).
- Attach `FlowCoordinator` to a manager entity and set UI script if needed.
