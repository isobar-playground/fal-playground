// Lazily loads the OpenCV.js WASM runtime on first use. The bundle is ~13MB,
// so it must never be eagerly imported into the main app bundle -- only
// gridSplit.ts touches this module, and only once the user actually runs the
// Grid Split tool.

import type cvModuleType from "@techstark/opencv-js";

export type OpenCv = typeof cvModuleType;

let cvPromise: Promise<OpenCv> | null = null;

export function loadOpenCv(): Promise<OpenCv> {
  if (!cvPromise) {
    cvPromise = import("@techstark/opencv-js").then(async (mod) => {
      // Webpack's CJS interop for a dynamic import() doesn't always populate
      // `.default` -- fall back to the namespace object itself when it doesn't.
      const cvModule = (mod.default ?? mod) as OpenCv & { Mat?: unknown; onRuntimeInitialized?: () => void };
      if (cvModule.Mat) return cvModule;
      await new Promise<void>((resolve) => {
        cvModule.onRuntimeInitialized = () => resolve();
      });
      return cvModule;
    });
  }
  return cvPromise;
}
