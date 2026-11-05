/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Capacitor } from '@capacitor/core';
import {
  BarcodeScanner as MLKitBarcodeScanner,
  BarcodeFormat as MLKitBarcodeFormat,
  LensFacing as MLKitLensFacing,
  Resolution as MLKitResolution,
  GoogleBarcodeScannerModuleInstallState,
} from '@capacitor-mlkit/barcode-scanning';
import {
  BarcodeDetector as PonyfillBarcodeDetector,
  type BarcodeFormat as WebDetectorFormat,
} from 'barcode-detector/ponyfill';
import * as zxingNs from '@zxing/library';

const zxingPkg: typeof zxingNs = (zxingNs as any).default || zxingNs;

const {
  MultiFormatOneDReader,
  QRCodeReader,
  DataMatrixReader,
  PDF417Reader,
  BarcodeFormat: ZXingBarcodeFormat,
  DecodeHintType,
  RGBLuminanceSource,
  BinaryBitmap,
  HybridBinarizer,
  GlobalHistogramBinarizer,
  MultiFormatWriter,
} = zxingPkg;

export type ScannerStageEvent =
  | 'Camera Initialized'
  | 'Video Stream Started'
  | 'Barcode Engine Initialized'
  | 'Frame Processing Started'
  | 'Barcode Detected'
  | 'Raw Value Received'
  | 'Product Search Started'
  | 'Product Found'
  | 'Product Not Found'
  | 'Scanner Error'
  | 'Camera Stopped';

export interface ScannerLogEntry {
  id: string;
  timestamp: string;
  stage: ScannerStageEvent;
  detail: string;
}

export interface ScannerDiagnosticsState {
  environment: 'Web' | 'Native';
  platform: string;
  engineName: string;
  cameraStatus: 'Idle' | 'Initializing' | 'Streaming' | 'Native ML Kit Active' | 'Stopped' | 'Error';
  enabledFormats: string[];
  framesProcessed: number;
  skippedDuplicateFrames: number;
  lastDetectedValue: string | null;
  lastDetectedFormat: string | null;
  lastError: string | null;
  torchAvailable: boolean;
  torchEnabled: boolean;
  zoomAvailable: boolean;
  zoomRatio: number;
  minZoom: number;
  maxZoom: number;
  logs: ScannerLogEntry[];
}

export interface BarcodeDecodeOutcome {
  rawValue: string;
  format: string;
  engine: string;
}

/**
 * Phase 3: Enabled Barcode Formats across Web & Native Android ML Kit
 */
export const ENABLED_BARCODE_FORMAT_LABELS: string[] = [
  'EAN-13',
  'EAN-8',
  'UPC-A',
  'UPC-E',
  'CODE-128',
  'CODE-39',
  'CODE-93',
  'ITF',
  'QR_CODE',
  'PDF417',
  'DATA_MATRIX',
];

export const WEB_DETECTOR_FORMATS: WebDetectorFormat[] = [
  'ean_13',
  'ean_8',
  'upc_a',
  'upc_e',
  'code_128',
  'code_39',
  'code_93',
  'itf',
  'qr_code',
  'pdf417',
  'data_matrix',
];

export const MLKIT_BARCODE_FORMATS: MLKitBarcodeFormat[] = [
  MLKitBarcodeFormat.Ean13,
  MLKitBarcodeFormat.Ean8,
  MLKitBarcodeFormat.UpcA,
  MLKitBarcodeFormat.UpcE,
  MLKitBarcodeFormat.Code128,
  MLKitBarcodeFormat.Code39,
  MLKitBarcodeFormat.Code93,
  MLKitBarcodeFormat.Itf,
  MLKitBarcodeFormat.QrCode,
  MLKitBarcodeFormat.Pdf417,
  MLKitBarcodeFormat.DataMatrix,
];

export const ZXING_FORMATS: number[] = [
  ZXingBarcodeFormat.EAN_13,
  ZXingBarcodeFormat.EAN_8,
  ZXingBarcodeFormat.UPC_A,
  ZXingBarcodeFormat.UPC_E,
  ZXingBarcodeFormat.CODE_128,
  ZXingBarcodeFormat.CODE_39,
  ZXingBarcodeFormat.CODE_93,
  ZXingBarcodeFormat.ITF,
  ZXingBarcodeFormat.QR_CODE,
  ZXingBarcodeFormat.PDF_417,
  ZXingBarcodeFormat.DATA_MATRIX,
];

export function isNativeCapacitorEnvironment(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

// Global reactive diagnostics state for Phase 6
let diagnosticsState: ScannerDiagnosticsState = {
  environment: isNativeCapacitorEnvironment() ? 'Native' : 'Web',
  platform: (() => {
    try {
      return Capacitor.getPlatform();
    } catch {
      return 'web';
    }
  })(),
  engineName: isNativeCapacitorEnvironment()
    ? 'Google ML Kit (@capacitor-mlkit/barcode-scanning)'
    : 'BarcodeDetector (ZXing-WASM Polyfill) + ZXing MultiFormatReader',
  cameraStatus: 'Idle',
  enabledFormats: [...ENABLED_BARCODE_FORMAT_LABELS],
  framesProcessed: 0,
  skippedDuplicateFrames: 0,
  lastDetectedValue: null,
  lastDetectedFormat: null,
  lastError: null,
  torchAvailable: false,
  torchEnabled: false,
  zoomAvailable: false,
  zoomRatio: 1,
  minZoom: 1,
  maxZoom: 1,
  logs: [],
};

const listeners = new Set<(state: ScannerDiagnosticsState) => void>();

function notifyDiagnosticsListeners() {
  const snapshot = { ...diagnosticsState, logs: [...diagnosticsState.logs] };
  listeners.forEach((cb) => cb(snapshot));
}

export function getScannerDiagnostics(): ScannerDiagnosticsState {
  return { ...diagnosticsState, logs: [...diagnosticsState.logs] };
}

export function subscribeScannerDiagnostics(
  listener: (state: ScannerDiagnosticsState) => void
): () => void {
  listeners.add(listener);
  listener(getScannerDiagnostics());
  return () => {
    listeners.delete(listener);
  };
}

export function updateScannerDiagnostics(partial: Partial<ScannerDiagnosticsState>) {
  diagnosticsState = {
    ...diagnosticsState,
    ...partial,
  };
  notifyDiagnosticsListeners();
}

export function recordScannerStage(stage: ScannerStageEvent, detail: string) {
  const now = new Date();
  const timestamp = now.toISOString().slice(11, 23);
  const entry: ScannerLogEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    timestamp,
    stage,
    detail,
  };
  // Console log for browser DevTools & Android Logcat inspection
  console.info(`[POS-BarcodeScanner] [${stage}] ${detail}`);
  diagnosticsState = {
    ...diagnosticsState,
    ...(stage === 'Scanner Error' ? { lastError: detail } : {}),
    logs: [entry, ...diagnosticsState.logs].slice(0, 40),
  };
  notifyDiagnosticsListeners();
}

export function resetScannerDiagnosticsLogs() {
  diagnosticsState = {
    ...diagnosticsState,
    framesProcessed: 0,
    skippedDuplicateFrames: 0,
    lastError: null,
    logs: [],
  };
  notifyDiagnosticsListeners();
}

// Singleton instances for Web BarcodeDetector & ZXing Readers
let webPonyfillDetector: PonyfillBarcodeDetector | null = null;
let nativeBrowserDetector: any | null = null;
let zxingOneDReader: any | null = null;
let zxingQrReader: any | null = null;
let zxingDataMatrixReader: any | null = null;
let zxingPdf417Reader: any | null = null;
let zxingHints: Map<any, any> | null = null;
let engineInitializedLogged = false;

function ensureWebEnginesInitialized() {
  if (!zxingOneDReader) {
    const hints = new Map();
    hints.set(DecodeHintType.POSSIBLE_FORMATS, ZXING_FORMATS);
    hints.set(DecodeHintType.TRY_HARDER, true);
    zxingHints = hints;
    zxingOneDReader = new MultiFormatOneDReader(hints);
    zxingQrReader = new QRCodeReader();
    zxingDataMatrixReader = new DataMatrixReader();
    zxingPdf417Reader = new PDF417Reader();
  }

  if (!webPonyfillDetector) {
    try {
      webPonyfillDetector = new PonyfillBarcodeDetector({
        formats: WEB_DETECTOR_FORMATS,
      });
    } catch (err: any) {
      recordScannerStage(
        'Scanner Error',
        `PonyfillBarcodeDetector init warning: ${err?.message || String(err)}`
      );
    }
  }

  if (!nativeBrowserDetector && typeof window !== 'undefined' && 'BarcodeDetector' in window) {
    try {
      const NativeClass = (window as any).BarcodeDetector;
      nativeBrowserDetector = new NativeClass({ formats: WEB_DETECTOR_FORMATS });
    } catch {
      try {
        const NativeClass = (window as any).BarcodeDetector;
        nativeBrowserDetector = new NativeClass();
      } catch {
        nativeBrowserDetector = null;
      }
    }
  }

  if (!engineInitializedLogged) {
    engineInitializedLogged = true;
    const hasNative = Boolean(nativeBrowserDetector);
    const engineLabel = isNativeCapacitorEnvironment()
      ? 'Google ML Kit (@capacitor-mlkit/barcode-scanning)'
      : hasNative
      ? 'Native BarcodeDetector + ZXing-WASM Polyfill + ZXing 1D/2D'
      : 'ZXing-WASM BarcodeDetector Polyfill + ZXing 1D/2D Engine';
    updateScannerDiagnostics({
      environment: isNativeCapacitorEnvironment() ? 'Native' : 'Web',
      engineName: engineLabel,
    });
    recordScannerStage(
      'Barcode Engine Initialized',
      `${engineLabel} (${ENABLED_BARCODE_FORMAT_LABELS.join(', ')})`
    );
  }
}

function tryDecodeBitmapWithZXingReaders(
  bitmap: any,
  passLabel: string
): BarcodeDecodeOutcome | null {
  const readers = [
    { reader: zxingOneDReader, name: 'ZXing-1D' },
    { reader: zxingQrReader, name: 'ZXing-QR' },
    { reader: zxingPdf417Reader, name: 'ZXing-PDF417' },
    { reader: zxingDataMatrixReader, name: 'ZXing-DataMatrix' },
  ];
  for (const { reader, name } of readers) {
    if (!reader) continue;
    try {
      const result = reader.decode(bitmap, zxingHints || undefined);
      const rawText = String(result?.getText?.() ?? '').trim();
      if (rawText.length > 0) {
        return {
          rawValue: rawText,
          format: ZXingBarcodeFormat[result.getBarcodeFormat()] || 'UNKNOWN',
          engine: `${name} (${passLabel})`,
        };
      }
    } catch {
      // Next reader
    } finally {
      try {
        reader.reset?.();
      } catch {}
    }
  }
  return null;
}

/**
 * Pure RGBA ImageData decoder using @zxing/library 1D + 2D readers.
 * Runs synchronously in < 2ms in both Browser and Node.js test environments,
 * preserving leading zeros by always returning raw text as a String.
 */
export function decodeBarcodeFromRGBA(
  rgbaData: Uint8ClampedArray,
  width: number,
  height: number
): BarcodeDecodeOutcome | null {
  if (!rgbaData || width <= 0 || height <= 0) return null;
  ensureWebEnginesInitialized();

  const pixelCount = width * height;
  const luminances = new Uint8ClampedArray(pixelCount);

  for (let i = 0, j = 0; i < pixelCount; i++, j += 4) {
    const r = rgbaData[j];
    const g = rgbaData[j + 1];
    const b = rgbaData[j + 2];
    const a = rgbaData[j + 3];
    if (a < 32) {
      luminances[i] = 255;
    } else {
      luminances[i] = (r * 306 + g * 601 + b * 117) >> 10;
    }
  }

  const source = new RGBLuminanceSource(luminances, width, height);

  // Pass 1: HybridBinarizer
  const hit1 = tryDecodeBitmapWithZXingReaders(
    new BinaryBitmap(new HybridBinarizer(source)),
    'HybridBinarizer'
  );
  if (hit1) return hit1;

  // Pass 2: GlobalHistogramBinarizer (better for low-contrast / uneven lighting 1D barcodes)
  const hit2 = tryDecodeBitmapWithZXingReaders(
    new BinaryBitmap(new GlobalHistogramBinarizer(source)),
    'GlobalHistogram'
  );
  if (hit2) return hit2;

  // Pass 3: High-contrast stretch on luminance buffer for faded or glare-affected 1D retail labels
  const contrastLuminances = new Uint8ClampedArray(pixelCount);
  for (let i = 0; i < pixelCount; i++) {
    const v = luminances[i];
    contrastLuminances[i] = Math.max(0, Math.min(255, Math.round((v - 128) * 1.65 + 128)));
  }
  const contrastSource = new RGBLuminanceSource(contrastLuminances, width, height);
  const hit3 = tryDecodeBitmapWithZXingReaders(
    new BinaryBitmap(new HybridBinarizer(contrastSource)),
    'ContrastEnhanced'
  );
  if (hit3) return hit3;

  return null;
}

/**
 * Computes a fast lightweight luminance signature on a 16x16 grid of an ImageData buffer
 * to prevent processing identical/frozen camera frames multiple times (Phase 4).
 */
function computeFrameSignature(rgba: Uint8ClampedArray, width: number, height: number): string {
  const stepX = Math.max(1, Math.floor(width / 16));
  const stepY = Math.max(1, Math.floor(height / 16));
  let hash = 2166136261;
  for (let y = 0; y < height; y += stepY) {
    for (let x = 0; x < width; x += stepX) {
      const idx = (y * width + x) * 4;
      const lum = (rgba[idx] + rgba[idx + 1] + rgba[idx + 2]) >> 2;
      hash ^= lum;
      hash = Math.imul(hash, 16777619);
    }
  }
  return `${width}x${height}:${hash >>> 0}`;
}

let reusableScanCanvas: HTMLCanvasElement | null = null;
let lastProcessedFrameSignature: string | null = null;
let isFrameDecodeInFlight = false;

function getReusableScanCanvas(width: number, height: number): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D | null;
} | null {
  if (typeof document === 'undefined') return null;
  if (!reusableScanCanvas) {
    reusableScanCanvas = document.createElement('canvas');
  }
  if (reusableScanCanvas.width !== width || reusableScanCanvas.height !== height) {
    reusableScanCanvas.width = width;
    reusableScanCanvas.height = height;
  }
  const ctx = reusableScanCanvas.getContext('2d', { willReadFrequently: true });
  return { canvas: reusableScanCanvas, ctx };
}

/**
 * Decodes a barcode from an ImageData or Canvas using:
 * 1. Native Browser BarcodeDetector (if available)
 * 2. ZXing MultiFormatReader (RGBA luminance + contrast pass)
 * 3. barcode-detector/ponyfill (ZXing-C++ WebAssembly)
 */
export async function decodeBarcodeFromImageData(
  imageData: ImageData
): Promise<BarcodeDecodeOutcome | null> {
  ensureWebEnginesInitialized();

  // 1. Fast synchronous ZXing MultiFormatReader check (0ms overhead, works offline & in tests)
  const zxingHit = decodeBarcodeFromRGBA(imageData.data, imageData.width, imageData.height);
  if (zxingHit && zxingHit.rawValue) {
    return zxingHit;
  }

  // 2. Native Browser BarcodeDetector
  if (nativeBrowserDetector) {
    try {
      const detected = await nativeBrowserDetector.detect(imageData);
      if (detected && detected.length > 0) {
        const raw = String(detected[0].rawValue ?? '').trim();
        if (raw) {
          return {
            rawValue: raw,
            format: String(detected[0].format || 'UNKNOWN').toUpperCase(),
            engine: 'Native BarcodeDetector',
          };
        }
      }
    } catch (err: any) {
      // Log only unexpected errors
      if (err?.message && !String(err.message).includes('not supported')) {
        console.debug('[POS-BarcodeScanner] Native BarcodeDetector frame warning:', err.message);
      }
    }
  }

  // 3. barcode-detector/ponyfill (ZXing-C++ WASM)
  if (webPonyfillDetector) {
    try {
      const detected = await webPonyfillDetector.detect(imageData);
      if (detected && detected.length > 0) {
        const raw = String(detected[0].rawValue ?? '').trim();
        if (raw) {
          return {
            rawValue: raw,
            format: String(detected[0].format || 'UNKNOWN').toUpperCase(),
            engine: 'BarcodeDetector WASM Polyfill',
          };
        }
      }
    } catch (err: any) {
      console.debug('[POS-BarcodeScanner] WASM Ponyfill frame warning:', err?.message || err);
    }
  }

  return null;
}

/**
 * Decodes a barcode from an HTMLVideoElement frame with:
 * - Frame readiness validation
 * - Full-frame non-cropping capture (scaled to max 1280px width for optimal 1D/2D bar sharpness)
 * - Duplicate frame deduplication (prevents re-scanning identical frames)
 * - Concurrency lock (prevents CPU spikes)
 */
export async function decodeBarcodeFromVideoElementWithDiagnostics(
  video: HTMLVideoElement,
  options?: { bypassDeduplication?: boolean }
): Promise<BarcodeDecodeOutcome | null> {
  if (!video || video.readyState < 2 || video.videoWidth <= 0 || video.videoHeight <= 0) {
    return null;
  }
  if (isFrameDecodeInFlight && !options?.bypassDeduplication) {
    return null;
  }

  isFrameDecodeInFlight = true;
  try {
    ensureWebEnginesInitialized();

    const maxDim = 1280;
    let targetW = video.videoWidth;
    let targetH = video.videoHeight;
    if (targetW > maxDim || targetH > maxDim) {
      const scale = Math.min(maxDim / targetW, maxDim / targetH);
      targetW = Math.max(1, Math.round(targetW * scale));
      targetH = Math.max(1, Math.round(targetH * scale));
    }

    const surface = getReusableScanCanvas(targetW, targetH);
    if (!surface || !surface.ctx) return null;

    // Draw full uncropped video frame
    surface.ctx.drawImage(video, 0, 0, targetW, targetH);
    const imageData = surface.ctx.getImageData(0, 0, targetW, targetH);

    const signature = computeFrameSignature(imageData.data, targetW, targetH);
    if (!options?.bypassDeduplication && signature === lastProcessedFrameSignature) {
      updateScannerDiagnostics({
        skippedDuplicateFrames: diagnosticsState.skippedDuplicateFrames + 1,
      });
      return null;
    }
    lastProcessedFrameSignature = signature;

    const nextCount = diagnosticsState.framesProcessed + 1;
    if (nextCount === 1) {
      recordScannerStage('Frame Processing Started', `Resolution ${targetW}x${targetH}px`);
    }
    updateScannerDiagnostics({ framesProcessed: nextCount });

    const outcome = await decodeBarcodeFromImageData(imageData);
    if (outcome && outcome.rawValue) {
      const preservedString = String(outcome.rawValue).trim();
      updateScannerDiagnostics({
        lastDetectedValue: preservedString,
        lastDetectedFormat: outcome.format,
        lastError: null,
      });
      recordScannerStage(
        'Barcode Detected',
        `Format: ${outcome.format} | Engine: ${outcome.engine}`
      );
      recordScannerStage('Raw Value Received', `"${preservedString}" (String length: ${preservedString.length})`);
      return {
        ...outcome,
        rawValue: preservedString,
      };
    }

    return null;
  } catch (err: any) {
    const msg = err?.message || String(err);
    recordScannerStage('Scanner Error', `Video frame decode error: ${msg}`);
    return null;
  } finally {
    isFrameDecodeInFlight = false;
  }
}

/**
 * Backward-compatible wrapper returning the decoded barcode string (preserving leading zeros).
 */
export async function decodeBarcodeFromVideoElement(
  video: HTMLVideoElement
): Promise<string | null> {
  const outcome = await decodeBarcodeFromVideoElementWithDiagnostics(video);
  return outcome ? outcome.rawValue : null;
}

/**
 * Decodes a barcode from an Image File or Blob (Phase 7: Saved Image Barcode Testing & Upload).
 * Never shrinks the image to 1x1px; decodes at full natural resolution up to 1600px.
 */
export async function decodeBarcodeFromImageFileWithDiagnostics(
  file: File | Blob
): Promise<BarcodeDecodeOutcome | null> {
  if (!file) return null;
  ensureWebEnginesInitialized();
  recordScannerStage('Frame Processing Started', `Decoding uploaded image (${file.size} bytes)`);

  try {
    // 1. Try createImageBitmap + Canvas -> ImageData (works in all modern browsers)
    if (typeof createImageBitmap === 'function' && typeof document !== 'undefined') {
      const bitmap = await createImageBitmap(file);
      const maxDim = 1600;
      let w = bitmap.width;
      let h = bitmap.height;
      if (w > maxDim || h > maxDim) {
        const scale = Math.min(maxDim / w, maxDim / h);
        w = Math.max(1, Math.round(w * scale));
        h = Math.max(1, Math.round(h * scale));
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        // Fill white background first in case the barcode PNG has a transparent background!
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(bitmap, 0, 0, w, h);
        const imageData = ctx.getImageData(0, 0, w, h);
        updateScannerDiagnostics({
          framesProcessed: diagnosticsState.framesProcessed + 1,
        });
        const outcome = await decodeBarcodeFromImageData(imageData);
        if (outcome && outcome.rawValue) {
          const preserved = String(outcome.rawValue).trim();
          updateScannerDiagnostics({
            lastDetectedValue: preserved,
            lastDetectedFormat: outcome.format,
            lastError: null,
          });
          recordScannerStage(
            'Barcode Detected',
            `Image File | Format: ${outcome.format} | Engine: ${outcome.engine}`
          );
          recordScannerStage('Raw Value Received', `"${preserved}"`);
          return { ...outcome, rawValue: preserved };
        }
      }
    }

    // 2. Fallback via HTMLImageElement for environments without createImageBitmap
    if (typeof document !== 'undefined' && typeof Image !== 'undefined') {
      const imgOutcome = await new Promise<BarcodeDecodeOutcome | null>((resolve) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = async () => {
          URL.revokeObjectURL(url);
          try {
            const w = Math.max(1, img.naturalWidth || img.width);
            const h = Math.max(1, img.naturalHeight || img.height);
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) {
              resolve(null);
              return;
            }
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, w, h);
            ctx.drawImage(img, 0, 0, w, h);
            const imageData = ctx.getImageData(0, 0, w, h);
            const res = await decodeBarcodeFromImageData(imageData);
            resolve(res);
          } catch {
            resolve(null);
          }
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          resolve(null);
        };
        img.src = url;
      });

      if (imgOutcome && imgOutcome.rawValue) {
        const preserved = String(imgOutcome.rawValue).trim();
        updateScannerDiagnostics({
          lastDetectedValue: preserved,
          lastDetectedFormat: imgOutcome.format,
          lastError: null,
        });
        recordScannerStage('Barcode Detected', `Image Element | Format: ${imgOutcome.format}`);
        recordScannerStage('Raw Value Received', `"${preserved}"`);
        return { ...imgOutcome, rawValue: preserved };
      }
    }

    // 3. Direct ponyfill Blob detection
    if (webPonyfillDetector) {
      const results = await webPonyfillDetector.detect(file);
      if (results && results.length > 0 && results[0].rawValue) {
        const preserved = String(results[0].rawValue).trim();
        const fmt = String(results[0].format || 'UNKNOWN').toUpperCase();
        updateScannerDiagnostics({
          lastDetectedValue: preserved,
          lastDetectedFormat: fmt,
          lastError: null,
        });
        recordScannerStage('Barcode Detected', `Blob Ponyfill | Format: ${fmt}`);
        recordScannerStage('Raw Value Received', `"${preserved}"`);
        return {
          rawValue: preserved,
          format: fmt,
          engine: 'BarcodeDetector WASM Polyfill (Blob)',
        };
      }
    }

    recordScannerStage('Scanner Error', 'No readable barcode found in the provided image file.');
    return null;
  } catch (err: any) {
    const msg = err?.message || String(err);
    recordScannerStage('Scanner Error', `Image decode error: ${msg}`);
    return null;
  }
}

export async function decodeBarcodeFromImageFile(file: File): Promise<string | null> {
  const outcome = await decodeBarcodeFromImageFileWithDiagnostics(file);
  return outcome ? outcome.rawValue : null;
}

/**
 * Phase 4: Web MediaStream Hardware Capabilities (Continuous Autofocus, Torch/Flashlight, Zoom)
 */
export async function applyWebCameraTrackEnhancements(stream: MediaStream): Promise<{
  torchAvailable: boolean;
  zoomAvailable: boolean;
  minZoom: number;
  maxZoom: number;
  currentZoom: number;
}> {
  const defaultCaps = {
    torchAvailable: false,
    zoomAvailable: false,
    minZoom: 1,
    maxZoom: 1,
    currentZoom: 1,
  };
  try {
    const track = stream.getVideoTracks()[0];
    if (!track || typeof track.getCapabilities !== 'function') {
      updateScannerDiagnostics(defaultCaps);
      return defaultCaps;
    }
    const caps: any = track.getCapabilities();
    const settings: any = typeof track.getSettings === 'function' ? track.getSettings() : {};

    // Request continuous autofocus if supported by the mobile/USB camera
    const advancedConstraints: any = {};
    if (Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) {
      advancedConstraints.focusMode = 'continuous';
    }
    if (Array.isArray(caps.exposureMode) && caps.exposureMode.includes('continuous')) {
      advancedConstraints.exposureMode = 'continuous';
    }
    if (Object.keys(advancedConstraints).length > 0 && typeof track.applyConstraints === 'function') {
      await track.applyConstraints({ advanced: [advancedConstraints] }).catch((e) => {
        console.debug('[POS-BarcodeScanner] Focus constraint note:', e?.message || e);
      });
    }

    const torchAvailable = Boolean(caps.torch);
    const zoomAvailable = typeof caps.zoom === 'object' && caps.zoom !== null;
    const minZoom = zoomAvailable ? Number(caps.zoom.min || 1) : 1;
    const maxZoom = zoomAvailable ? Number(caps.zoom.max || 1) : 1;
    const currentZoom = Number(settings.zoom || minZoom || 1);

    updateScannerDiagnostics({
      torchAvailable,
      torchEnabled: Boolean(settings.torch),
      zoomAvailable,
      minZoom,
      maxZoom,
      zoomRatio: currentZoom,
    });

    return {
      torchAvailable,
      zoomAvailable,
      minZoom,
      maxZoom,
      currentZoom,
    };
  } catch (err: any) {
    recordScannerStage('Scanner Error', `Camera capabilities check warning: ${err?.message || err}`);
    return defaultCaps;
  }
}

export async function setScannerTorch(
  enabled: boolean,
  webStream?: MediaStream | null
): Promise<boolean> {
  try {
    if (isNativeCapacitorEnvironment()) {
      if (enabled) {
        await MLKitBarcodeScanner.enableTorch();
      } else {
        await MLKitBarcodeScanner.disableTorch();
      }
      updateScannerDiagnostics({ torchEnabled: enabled });
      return enabled;
    }

    const track = webStream?.getVideoTracks()?.[0];
    if (track && typeof track.applyConstraints === 'function') {
      await track.applyConstraints({ advanced: [{ torch: enabled } as any] });
      updateScannerDiagnostics({ torchEnabled: enabled });
      return enabled;
    }
  } catch (err: any) {
    recordScannerStage('Scanner Error', `Flashlight toggle failed: ${err?.message || err}`);
  }
  return false;
}

export async function setScannerZoom(
  zoomRatio: number,
  webStream?: MediaStream | null
): Promise<number> {
  try {
    if (isNativeCapacitorEnvironment()) {
      await MLKitBarcodeScanner.setZoomRatio({ zoomRatio });
      updateScannerDiagnostics({ zoomRatio });
      return zoomRatio;
    }

    const track = webStream?.getVideoTracks()?.[0];
    if (track && typeof track.applyConstraints === 'function') {
      await track.applyConstraints({ advanced: [{ zoom: zoomRatio } as any] });
      updateScannerDiagnostics({ zoomRatio });
      return zoomRatio;
    }
  } catch (err: any) {
    recordScannerStage('Scanner Error', `Zoom adjustment failed: ${err?.message || err}`);
  }
  return zoomRatio;
}

/**
 * Phase 2B: Native Android Capacitor 8 ML Kit Barcode Scanner
 * Supports both:
 * 1. Ready-to-use Google Barcode Scanner UI (`MLKitBarcodeScanner.scan()`) with automatic Google Module availability check & installation.
 * 2. Custom transparent WebView overlay (`MLKitBarcodeScanner.startScan()`) with Torch & Zoom support.
 */
export async function scanWithNativeMLKit(): Promise<BarcodeDecodeOutcome | null> {
  if (!isNativeCapacitorEnvironment()) {
    return null;
  }

  recordScannerStage('Camera Initialized', 'Starting Native Android Google ML Kit Scanner');
  updateScannerDiagnostics({
    environment: 'Native',
    engineName: 'Google ML Kit (@capacitor-mlkit/barcode-scanning)',
    cameraStatus: 'Initializing',
    lastError: null,
  });

  try {
    const supported = await MLKitBarcodeScanner.isSupported();
    if (!supported.supported) {
      throw new Error('Google ML Kit Barcode Scanning is not supported on this device.');
    }

    // Check & install Google Barcode Scanner Module if needed
    const moduleStatus = await MLKitBarcodeScanner.isGoogleBarcodeScannerModuleAvailable();
    if (!moduleStatus.available) {
      recordScannerStage(
        'Barcode Engine Initialized',
        'Installing Google Barcode Scanner Module via Play Services...'
      );
      await new Promise<void>(async (resolve, reject) => {
        const timeout = setTimeout(() => {
          resolve(); // Proceed to startScan fallback if module install takes too long
        }, 12000);

        const listener = await MLKitBarcodeScanner.addListener(
          'googleBarcodeScannerModuleInstallProgress',
          (event) => {
            if (event.state === GoogleBarcodeScannerModuleInstallState.COMPLETED) {
              clearTimeout(timeout);
              listener.remove();
              recordScannerStage(
                'Barcode Engine Initialized',
                'Google Barcode Scanner Module installed successfully.'
              );
              resolve();
            } else if (
              event.state === GoogleBarcodeScannerModuleInstallState.FAILED ||
              event.state === GoogleBarcodeScannerModuleInstallState.CANCELED
            ) {
              clearTimeout(timeout);
              listener.remove();
              reject(new Error(`Google Barcode Scanner Module install failed (state=${event.state})`));
            }
          }
        );

        try {
          await MLKitBarcodeScanner.installGoogleBarcodeScannerModule();
        } catch (installErr) {
          clearTimeout(timeout);
          listener.remove();
          reject(installErr);
        }
      });
    }

    updateScannerDiagnostics({ cameraStatus: 'Native ML Kit Active' });
    recordScannerStage(
      'Video Stream Started',
      `MLKitBarcodeScanner.scan() active (${ENABLED_BARCODE_FORMAT_LABELS.length} formats)`
    );

    const scanResult = await MLKitBarcodeScanner.scan({
      formats: MLKIT_BARCODE_FORMATS,
    });

    updateScannerDiagnostics({ cameraStatus: 'Stopped' });

    if (scanResult.barcodes && scanResult.barcodes.length > 0) {
      const first = scanResult.barcodes[0];
      const rawValue = String(first.rawValue || first.displayValue || '').trim();
      if (rawValue.length > 0) {
        const fmt = String(first.format || 'UNKNOWN');
        updateScannerDiagnostics({
          framesProcessed: diagnosticsState.framesProcessed + 1,
          lastDetectedValue: rawValue,
          lastDetectedFormat: fmt,
          lastError: null,
        });
        recordScannerStage('Barcode Detected', `ML Kit Native | Format: ${fmt}`);
        recordScannerStage('Raw Value Received', `"${rawValue}"`);
        return {
          rawValue,
          format: fmt,
          engine: 'Google ML Kit (scan)',
        };
      }
    }

    return null;
  } catch (err: any) {
    const msg = err?.message || String(err);
    // If user canceled the native scanner dialog, don't treat as fatal error
    if (msg.toLowerCase().includes('cancel')) {
      updateScannerDiagnostics({ cameraStatus: 'Stopped' });
      recordScannerStage('Camera Stopped', 'User canceled native ML Kit scan');
      return null;
    }
    recordScannerStage('Scanner Error', `MLKit scan() error: ${msg}. Attempting startScan() fallback...`);
    return await startInteractiveNativeMLKitScan();
  }
}

/**
 * Interactive Native ML Kit `startScan()` fallback with transparent WebView support,
 * Torch detection, and Zoom range initialization.
 */
export async function startInteractiveNativeMLKitScan(): Promise<BarcodeDecodeOutcome | null> {
  if (!isNativeCapacitorEnvironment()) return null;

  try {
    const perm = await MLKitBarcodeScanner.checkPermissions();
    if (perm.camera !== 'granted') {
      const req = await MLKitBarcodeScanner.requestPermissions();
      if (req.camera !== 'granted') {
        throw new Error('Camera permission denied on Android device.');
      }
    }

    if (typeof document !== 'undefined') {
      document.body.classList.add('barcode-scanner-active');
    }

    updateScannerDiagnostics({ cameraStatus: 'Native ML Kit Active' });

    return await new Promise<BarcodeDecodeOutcome | null>(async (resolve) => {
      const cleanup = async () => {
        if (typeof document !== 'undefined') {
          document.body.classList.remove('barcode-scanner-active');
        }
        try {
          await MLKitBarcodeScanner.removeAllListeners();
          await MLKitBarcodeScanner.stopScan();
        } catch {}
        updateScannerDiagnostics({ cameraStatus: 'Stopped', torchEnabled: false });
      };

      await MLKitBarcodeScanner.addListener('barcodesScanned', async (event) => {
        if (event.barcodes && event.barcodes.length > 0) {
          const b = event.barcodes[0];
          const rawValue = String(b.rawValue || b.displayValue || '').trim();
          if (rawValue.length > 0) {
            const fmt = String(b.format || 'UNKNOWN');
            await cleanup();
            updateScannerDiagnostics({
              framesProcessed: diagnosticsState.framesProcessed + 1,
              lastDetectedValue: rawValue,
              lastDetectedFormat: fmt,
              lastError: null,
            });
            recordScannerStage('Barcode Detected', `ML Kit startScan | Format: ${fmt}`);
            recordScannerStage('Raw Value Received', `"${rawValue}"`);
            resolve({
              rawValue,
              format: fmt,
              engine: 'Google ML Kit (startScan)',
            });
          }
        }
      });

      await MLKitBarcodeScanner.addListener('scanError', async (event) => {
        recordScannerStage('Scanner Error', `ML Kit scanError: ${event.message}`);
        await cleanup();
        resolve(null);
      });

      await MLKitBarcodeScanner.startScan({
        formats: MLKIT_BARCODE_FORMATS,
        lensFacing: MLKitLensFacing.Back,
        resolution: MLKitResolution['1280x720'],
      });

      // Query Torch & Zoom availability once native camera starts
      try {
        const torchAvail = await MLKitBarcodeScanner.isTorchAvailable();
        const minZ = await MLKitBarcodeScanner.getMinZoomRatio();
        const maxZ = await MLKitBarcodeScanner.getMaxZoomRatio();
        updateScannerDiagnostics({
          torchAvailable: Boolean(torchAvail.available),
          zoomAvailable: maxZ.zoomRatio > minZ.zoomRatio,
          minZoom: minZ.zoomRatio,
          maxZoom: maxZ.zoomRatio,
          zoomRatio: minZ.zoomRatio,
        });
      } catch {}
    });
  } catch (err: any) {
    if (typeof document !== 'undefined') {
      document.body.classList.remove('barcode-scanner-active');
    }
    const msg = err?.message || String(err);
    updateScannerDiagnostics({ cameraStatus: 'Error', lastError: msg });
    recordScannerStage('Scanner Error', `Native startScan failed: ${msg}`);
    return null;
  }
}

export async function stopInteractiveNativeMLKitScan(): Promise<void> {
  if (!isNativeCapacitorEnvironment()) return;
  if (typeof document !== 'undefined') {
    document.body.classList.remove('barcode-scanner-active');
  }
  try {
    await MLKitBarcodeScanner.removeAllListeners();
    await MLKitBarcodeScanner.stopScan();
    updateScannerDiagnostics({ cameraStatus: 'Stopped', torchEnabled: false });
    recordScannerStage('Camera Stopped', 'Stopped Native ML Kit Scanner');
  } catch {}
}

const EAN_L_CODES = [
  '0001101', '0011001', '0010011', '0111101', '0100011',
  '0110001', '0101111', '0111011', '0110111', '0001011',
];
const EAN_G_CODES = [
  '0100111', '0110011', '0011011', '0100001', '0011101',
  '0111001', '0000101', '0010001', '0001001', '0010111',
];
const EAN_R_CODES = [
  '1110010', '1100110', '1101100', '1000010', '1011100',
  '1001110', '1010000', '1000100', '1001000', '1110100',
];
const EAN13_PARITY = [
  'LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG',
  'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL',
];

const CODE128_PATTERNS = [
  '11011001100', '11001101100', '11001100110', '10010011000', '10010001100',
  '10001001100', '10011001000', '10011000100', '10001100100', '11001001000',
  '11001000100', '11000100100', '10110011100', '10011011100', '10011001110',
  '10111001100', '10011101100', '10011100110', '11001110010', '11001011100',
  '11001001110', '11011100100', '11001110100', '11101101110', '11101001100',
  '11100101100', '11100100110', '11101100100', '11100110100', '11100110010',
  '11011011000', '11011000110', '11000110110', '10100011000', '10001011000',
  '10001000110', '10110001000', '10001101000', '10001100010', '11010001000',
  '11000101000', '11000100010', '10110111000', '10110001110', '10001101110',
  '10111011000', '10111000110', '10001110110', '11101110110', '11010001110',
  '11000101110', '11011101000', '11011100010', '11011101110', '11101011000',
  '11101000110', '11100010110', '11101101000', '11101100010', '11100011010',
  '11101111010', '11001000010', '11110001010', '10100110000', '10100001100',
  '10010110000', '10010000110', '10000101100', '10000100110', '10110010000',
  '10110000100', '10011010000', '10011000010', '10000110100', '10000110010',
  '11000010010', '11001010000', '11110111010', '11000010100', '10001111010',
  '10100111100', '10010111100', '10010011110', '10111100100', '10011110100',
  '10011110010', '11110100100', '11110010100', '11110010010', '11011011110',
  '11011110110', '11110110110', '10101111000', '10100011110', '10001011110',
  '10111101000', '10111100010', '11110101000', '11110100010', '10111011110',
  '10111101110', '11101011110', '11110101110', '11010000100', '11010010000',
  '11010011100', '1100011101011',
];

function encode1DBits(
  value: string,
  format: 'EAN_13' | 'EAN_8' | 'UPC_A' | 'CODE_128'
): string {
  if (format === 'EAN_13') {
    const digits = value.replace(/\D/g, '').padStart(13, '0').slice(0, 13);
    const first = Number(digits[0]);
    const parity = EAN13_PARITY[first];
    let bits = '101';
    for (let i = 1; i <= 6; i++) {
      const d = Number(digits[i]);
      bits += parity[i - 1] === 'L' ? EAN_L_CODES[d] : EAN_G_CODES[d];
    }
    bits += '01010';
    for (let i = 7; i <= 12; i++) {
      const d = Number(digits[i]);
      bits += EAN_R_CODES[d];
    }
    bits += '101';
    return bits;
  }

  if (format === 'UPC_A') {
    const digits = value.replace(/\D/g, '').padStart(12, '0').slice(0, 12);
    let bits = '101';
    for (let i = 0; i < 6; i++) {
      bits += EAN_L_CODES[Number(digits[i])];
    }
    bits += '01010';
    for (let i = 6; i < 12; i++) {
      bits += EAN_R_CODES[Number(digits[i])];
    }
    bits += '101';
    return bits;
  }

  if (format === 'EAN_8') {
    const digits = value.replace(/\D/g, '').padStart(8, '0').slice(0, 8);
    let bits = '101';
    for (let i = 0; i < 4; i++) {
      bits += EAN_L_CODES[Number(digits[i])];
    }
    bits += '01010';
    for (let i = 4; i < 8; i++) {
      bits += EAN_R_CODES[Number(digits[i])];
    }
    bits += '101';
    return bits;
  }

  // CODE_128 (Code Set B: ASCII 32..126)
  const startCodeB = 104;
  let checksum = startCodeB;
  let bits = CODE128_PATTERNS[startCodeB];
  for (let i = 0; i < value.length; i++) {
    const codeVal = Math.max(0, Math.min(94, value.charCodeAt(i) - 32));
    bits += CODE128_PATTERNS[codeVal];
    checksum += codeVal * (i + 1);
  }
  const checkIndex = checksum % 103;
  bits += CODE128_PATTERNS[checkIndex];
  bits += CODE128_PATTERNS[106]; // Stop pattern
  return bits;
}

/**
 * Phase 7: Standard Barcode Image Generator (EAN-13, EAN-8, UPC-A, CODE-128, QR_CODE)
 * Generates a real bit-accurate barcode RGBA buffer (and File/Canvas in browser)
 * so the decoding engine can be verified against real EAN-13, EAN-8, UPC-A, CODE-128, and QR barcodes.
 */
export function generateStandardBarcodeRGBA(
  value: string,
  format: 'EAN_13' | 'EAN_8' | 'UPC_A' | 'CODE_128' | 'QR_CODE',
  width = 420,
  height = 180
): { data: Uint8ClampedArray; width: number; height: number } {
  if (format === 'QR_CODE') {
    const writer = new MultiFormatWriter();
    const w = 260;
    const h = 260;
    const matrix = writer.encode(value, ZXingBarcodeFormat.QR_CODE, w, h, new Map());
    const actualW = matrix.getWidth();
    const actualH = matrix.getHeight();
    const rgba = new Uint8ClampedArray(actualW * actualH * 4);
    for (let y = 0; y < actualH; y++) {
      for (let x = 0; x < actualW; x++) {
        const isBlack = matrix.get(x, y);
        const color = isBlack ? 0 : 255;
        const idx = (y * actualW + x) * 4;
        rgba[idx] = color;
        rgba[idx + 1] = color;
        rgba[idx + 2] = color;
        rgba[idx + 3] = 255;
      }
    }
    return { data: rgba, width: actualW, height: actualH };
  }

  const bits = encode1DBits(value, format);
  const quietZoneModules = 14;
  const totalModules = bits.length + quietZoneModules * 2;
  const barScale = Math.max(3, Math.floor(width / totalModules));
  const actualW = totalModules * barScale;
  const actualH = height;
  const padY = Math.round(actualH * 0.15);

  const rgba = new Uint8ClampedArray(actualW * actualH * 4);
  rgba.fill(255); // White background with quiet zones

  for (let m = 0; m < bits.length; m++) {
    if (bits[m] === '1') {
      const startX = (quietZoneModules + m) * barScale;
      for (let y = padY; y < actualH - padY; y++) {
        for (let dx = 0; dx < barScale; dx++) {
          const idx = (y * actualW + (startX + dx)) * 4;
          rgba[idx] = 0;
          rgba[idx + 1] = 0;
          rgba[idx + 2] = 0;
          rgba[idx + 3] = 255;
        }
      }
    }
  }

  return { data: rgba, width: actualW, height: actualH };
}

export async function createStandardBarcodeTestFile(
  value: string,
  format: 'EAN_13' | 'EAN_8' | 'UPC_A' | 'CODE_128' | 'QR_CODE'
): Promise<File | null> {
  if (typeof document === 'undefined') return null;
  const { data, width, height } = generateStandardBarcodeRGBA(value, format);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const imageData = new ImageData(new Uint8ClampedArray(data), width, height);
  ctx.putImageData(imageData, 0, 0);

  const blob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/png')
  );
  if (!blob) return null;
  return new File([blob], `test-${format}-${value}.png`, { type: 'image/png' });
}

export function resetScannerFrameSignatureCache(): void {
  lastProcessedFrameSignature = '';
  isFrameDecodeInFlight = false;
}


