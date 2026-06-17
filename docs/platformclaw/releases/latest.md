# PlatformClaw v2026.6.18

Date: 2026-06-18
Base OpenClaw: v2026.4.6

## Added

- Added a PlatformClaw product version surface for the Control UI sidebar.
- Added internal release notes that ship from the repository and Docker image through `docs/platformclaw/releases`.
- Added a version dialog in the Control UI so employees can open the current PlatformClaw release notes from the sidebar.

## Changed

- The sidebar version is now product-facing PlatformClaw metadata instead of only the OpenClaw compatibility version.
- The Gateway handshake keeps the existing OpenClaw-compatible `server.version` while adding product metadata for PlatformClaw-specific UI display.

## Fixed

- N/A

## Internal Notes

- Keep OpenClaw package, CLI, config, plugin SDK, and protocol compatibility identifiers unchanged unless a separate compatibility migration explicitly requires changing them.
