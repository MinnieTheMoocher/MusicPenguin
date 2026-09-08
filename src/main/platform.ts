/**
 * Host-platform helpers for the Electron main process.
 *
 * Keep platform checks in one place so platform-specific integrations do not
 * each have to know the raw Node.js platform identifiers.
 */
export const HOST_PLATFORM = process.platform;

export const IS_LINUX = HOST_PLATFORM === "linux";
export const IS_MACOS = HOST_PLATFORM === "darwin";
export const IS_WINDOWS = HOST_PLATFORM === "win32";

