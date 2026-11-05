/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { usePOS } from '../../context/POSContext';
import { getTranslation } from '../../lib/translations';
import { formatCurrency } from '../../lib/pos-calculations';
import {
  matchesProductBarcode,
  getAllProductBarcodes,
  getProductSerialNumber,
} from '../../lib/inventory-rules';
import {
  decodeBarcodeFromImageFileWithDiagnostics,
  decodeBarcodeFromVideoElementWithDiagnostics,
  isNativeCapacitorEnvironment,
  scanWithNativeMLKit,
  stopInteractiveNativeMLKitScan,
  applyWebCameraTrackEnhancements,
  setScannerTorch,
  setScannerZoom,
  recordScannerStage,
  updateScannerDiagnostics,
  getScannerDiagnostics,
  subscribeScannerDiagnostics,
} from '../../lib/barcode-scanner-engine';
import { ScannerDiagnosticsPanel } from './ScannerDiagnosticsPanel';
import { AppModal } from '../ui/AppModal';
import { AppInput } from '../ui/AppInput';
import { TactileButton } from '../ui/TactileButton';
import {
  Barcode,
  Camera,
  CameraOff,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Image as ImageIcon,
  ScanLine,
  Flashlight,
  ZoomIn,
  PlusCircle,
} from 'lucide-react';
import { playScannerBeep } from '../../lib/sound-fx';

interface BarcodeScannerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onScan?: (code: string) => void;
}

export const BarcodeScannerModal: React.FC<BarcodeScannerModalProps> = ({
  isOpen,
  onClose,
  onScan,
}) => {
  const { products, addToCart, settings, openAddProductWithBarcode } = usePOS();
  const t = getTranslation(settings.language);
  const isAr = settings.language === 'ar';

  const [barcodeInput, setBarcodeInput] = useState('');
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error' | 'not_found';
    message: string;
    unmatchedBarcode?: string;
  } | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isDecodingFrame, setIsDecodingFrame] = useState(false);
  const [autoOpenNewProductOnMiss, setAutoOpenNewProductOnMiss] = useState(true);
  const [diagState, setDiagState] = useState(() => getScannerDiagnostics());

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return subscribeScannerDiagnostics((next) => setDiagState(next));
  }, []);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    if (isNativeCapacitorEnvironment()) {
      stopInteractiveNativeMLKitScan().catch(() => {});
    }
    setCameraActive(false);
    updateScannerDiagnostics({ cameraStatus: 'Stopped', torchEnabled: false });
  };

  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      setBarcodeInput('');
      setFeedback(null);
      setCameraError(null);
      setIsDecodingFrame(false);
    }
    return () => stopCamera();
  }, [isOpen]);

  // Attach MediaStream to <video> element reliably after cameraActive renders the <video> tag
  useEffect(() => {
    if (!cameraActive || !streamRef.current || !videoRef.current) return;
    const videoEl = videoRef.current;
    if (videoEl.srcObject !== streamRef.current) {
      videoEl.srcObject = streamRef.current;
    }
    videoEl
      .play()
      .then(() => {
        updateScannerDiagnostics({ cameraStatus: 'Streaming' });
        recordScannerStage(
          'Video Stream Started',
          `Live video active (${videoEl.videoWidth || 1280}x${videoEl.videoHeight || 720})`
        );
      })
      .catch((err) => {
        recordScannerStage('Scanner Error', `Video playback start error: ${err?.message || err}`);
      });
  }, [cameraActive]);

  const startCamera = async () => {
    setCameraError(null);
    setFeedback(null);

    // Phase 2B: Native Android Capacitor 8 ML Kit Scanner
    if (isNativeCapacitorEnvironment()) {
      const outcome = await scanWithNativeMLKit();
      if (outcome && outcome.rawValue) {
        handleLookupAndAdd(outcome.rawValue, outcome.format);
      }
      return;
    }

    // Phase 2A: Browser / Google AI Studio Preview WebRTC Rear Camera
    recordScannerStage('Camera Initialized', 'Requesting rear environment camera (1280x720)');
    updateScannerDiagnostics({ cameraStatus: 'Initializing', lastError: null });

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        const msg = isAr
          ? 'متصفحك لا يدعم تشغيل الكاميرا المباشرة. يمكنك التقاط صورة للباركود أو إدخاله يدوياً.'
          : 'Camera API is not supported in this browser. You can upload a barcode photo or enter it manually.';
        setCameraError(msg);
        updateScannerDiagnostics({ cameraStatus: 'Error', lastError: msg });
        recordScannerStage('Scanner Error', msg);
        return;
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
      } catch (envErr: any) {
        recordScannerStage(
          'Camera Initialized',
          `Rear camera fallback to default camera (${envErr?.message || 'fallback'})`
        );
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
      }

      streamRef.current = stream;
      setCameraActive(true);
      await applyWebCameraTrackEnhancements(stream);
    } catch (err: any) {
      const msg = isAr
        ? 'تعذر الوصول إلى الكاميرا. يمكنك رفع صورة الباركود أو استخدام الإدخال اليدوي.'
        : 'Camera permission denied or unavailable. You can upload a barcode photo or use manual entry.';
      setCameraError(msg);
      updateScannerDiagnostics({
        cameraStatus: 'Error',
        lastError: `${msg} (${err?.message || String(err)})`,
      });
      recordScannerStage('Scanner Error', `Camera access failed: ${err?.message || String(err)}`);
    }
  };

  // Continuous throttled frame decoding loop (Phase 2A & Phase 4)
  useEffect(() => {
    if (!cameraActive || !isOpen || isNativeCapacitorEnvironment()) return;

    let cancelled = false;
    let timerId: number | undefined;

    const scanLoop = async () => {
      if (cancelled || !videoRef.current) return;
      try {
        const outcome = await decodeBarcodeFromVideoElementWithDiagnostics(videoRef.current);
        if (!cancelled && outcome && outcome.rawValue) {
          // Phase 5 Step 4: Immediately stop camera scanning on valid barcode hit
          stopCamera();
          handleLookupAndAdd(outcome.rawValue, outcome.format);
          return;
        }
      } catch (err: any) {
        recordScannerStage('Scanner Error', `Frame loop error: ${err?.message || err}`);
      }
      if (!cancelled) {
        timerId = window.setTimeout(scanLoop, 260);
      }
    };

    timerId = window.setTimeout(scanLoop, 350);
    return () => {
      cancelled = true;
      if (timerId) window.clearTimeout(timerId);
    };
  }, [cameraActive, isOpen, products]);

  const handleCaptureCurrentVideoFrame = async () => {
    if (!videoRef.current) return;
    setIsDecodingFrame(true);
    setFeedback(null);
    try {
      const outcome = await decodeBarcodeFromVideoElementWithDiagnostics(videoRef.current, {
        bypassDeduplication: true,
      });
      if (outcome && outcome.rawValue) {
        stopCamera();
        handleLookupAndAdd(outcome.rawValue, outcome.format);
      } else {
        setFeedback({
          type: 'error',
          message: isAr
            ? 'لم يتم العثور على باركود واضح في الكادر الحالي. قرّب الكاميرا من الباركود أو ارفع صورة واضحة.'
            : 'No readable barcode detected in current frame. Hold steady closer to the barcode or upload a clear photo.',
        });
      }
    } finally {
      setIsDecodingFrame(false);
    }
  };

  const handleScanImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsDecodingFrame(true);
    setFeedback(null);
    try {
      const outcome = await decodeBarcodeFromImageFileWithDiagnostics(file);
      if (outcome && outcome.rawValue) {
        handleLookupAndAdd(outcome.rawValue, outcome.format);
      } else {
        setFeedback({
          type: 'error',
          message: isAr
            ? 'تعذر قراءة الباركود من الصورة المرفوعة. تأكد من وضوح خطوط الباركود.'
            : 'Could not decode a barcode from the selected image. Ensure the barcode lines are clear.',
        });
      }
    } finally {
      setIsDecodingFrame(false);
      e.target.value = '';
    }
  };

  /**
   * Phase 5: Process Decoded Barcode Result
   * 1. Extract rawValue as String (preserving leading zeros).
   * 2. Verify non-empty.
   * 3. Stop camera scanning.
   * 4. Search product catalog.
   * 5. If found -> display & add to cart.
   * 6. If NOT found -> open Add Product modal with barcode pre-filled!
   */
  const handleLookupAndAdd = (codeToFind: string, detectedFormat?: string) => {
    // Always preserve as String so leading zeros (e.g. "012345678905") are never lost
    const cleanCode = String(codeToFind ?? '').trim();
    if (!cleanCode) return;

    recordScannerStage(
      'Product Search Started',
      `Searching catalog for barcode/SKU "${cleanCode}"${detectedFormat ? ` [${detectedFormat}]` : ''}`
    );

    const matchedProduct = products.find((p, idx) => {
      const serial = getProductSerialNumber(p, idx);
      return (
        matchesProductBarcode(p, cleanCode, true) ||
        p.sku.toLowerCase() === cleanCode.toLowerCase() ||
        String(serial) === cleanCode.replace(/^#0*/, '')
      );
    });

    if (matchedProduct) {
      const prodTitle = isAr && matchedProduct.nameAr ? matchedProduct.nameAr : matchedProduct.name;
      recordScannerStage('Product Found', `${prodTitle} (ID: ${matchedProduct.id}, Barcode: ${cleanCode})`);
      playScannerBeep(settings.soundEnabled);

      if (onScan) {
        onScan(cleanCode);
        setFeedback({
          type: 'success',
          message: `${isAr ? 'تمت قراءة الباركود بنجاح وإضافة المنتج' : 'Scan Successful — Added'}: ${prodTitle} (${cleanCode})`,
        });
        setBarcodeInput('');
        return;
      }

      const added = addToCart(matchedProduct, 1);
      if (added) {
        setFeedback({
          type: 'success',
          message: `${isAr ? 'تمت قراءة الباركود بنجاح وإضافة المنتج' : 'Scan Successful — Added'}: ${prodTitle} (${cleanCode})`,
        });
        setBarcodeInput('');
      } else {
        setFeedback({
          type: 'error',
          message: `${prodTitle} — ${t.outOfStock}`,
        });
      }
    } else {
      recordScannerStage(
        'Product Not Found',
        `No product registered with barcode "${cleanCode}". Ready to register as new product.`
      );
      setFeedback({
        type: 'not_found',
        unmatchedBarcode: cleanCode,
        message: isAr
          ? `الباركود (${cleanCode}) غير مسجل في قاعدة البيانات.`
          : `Barcode (${cleanCode}) is not registered in the product catalog.`,
      });

      if (autoOpenNewProductOnMiss) {
        onClose();
        openAddProductWithBarcode(cleanCode);
      }
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleLookupAndAdd(barcodeInput, 'MANUAL');
  };

  return (
    <AppModal isOpen={isOpen} onClose={onClose} title={t.scanBarcode}>
      <div className="space-y-4">
        {/* Camera Feed Box */}
        <div className="relative rounded-2xl overflow-hidden bg-neutral-950 border border-neutral-800 aspect-video flex flex-col items-center justify-center">
          {cameraActive ? (
            <>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
              />
              {/* Scanning Reticle Overlay */}
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center p-6">
                <div className="w-full max-w-xs h-32 border-2 border-amber-500/80 rounded-2xl relative shadow-[0_0_30px_rgba(245,158,11,0.3)]">
                  <div className="absolute inset-x-2 top-1/2 h-0.5 bg-rose-500/90 animate-pulse" />
                </div>
              </div>

              {/* Top Hardware Controls: Torch & Zoom (Phase 4) */}
              <div className="absolute top-3 inset-x-3 flex items-center justify-between gap-2">
                {diagState.torchAvailable ? (
                  <button
                    type="button"
                    onClick={() => setScannerTorch(!diagState.torchEnabled, streamRef.current)}
                    className={`px-2.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 border backdrop-blur-md ${
                      diagState.torchEnabled
                        ? 'bg-amber-500 text-neutral-950 border-amber-400'
                        : 'bg-neutral-900/80 text-white border-neutral-700'
                    }`}
                  >
                    <Flashlight className="w-3.5 h-3.5" />
                    <span>{isAr ? 'الفلاش' : 'Flash'}</span>
                  </button>
                ) : (
                  <span />
                )}

                {diagState.zoomAvailable && diagState.maxZoom > diagState.minZoom && (
                  <div className="flex items-center gap-2 px-3 py-1 rounded-xl bg-neutral-900/85 border border-neutral-700 backdrop-blur-md">
                    <ZoomIn className="w-3.5 h-3.5 text-amber-400" />
                    <input
                      type="range"
                      min={diagState.minZoom}
                      max={Math.min(diagState.maxZoom, 5)}
                      step={0.1}
                      value={diagState.zoomRatio}
                      onChange={(e) =>
                        setScannerZoom(Number(e.target.value), streamRef.current)
                      }
                      className="w-20 accent-amber-500"
                    />
                    <span className="font-mono text-[10px] text-white">
                      {diagState.zoomRatio.toFixed(1)}x
                    </span>
                  </div>
                )}
              </div>

              <div className="absolute bottom-3 inset-x-3 flex items-center justify-between gap-2">
                <TactileButton
                  type="button"
                  variant="amber"
                  size="sm"
                  disabled={isDecodingFrame}
                  onClick={handleCaptureCurrentVideoFrame}
                  leftIcon={<ScanLine className="w-4 h-4" />}
                >
                  {isDecodingFrame
                    ? isAr
                      ? 'جاري قراءة الباركود...'
                      : 'Decoding...'
                    : isAr
                    ? 'التقاط وقراءة الباركود الآن'
                    : 'Capture & Read Barcode'}
                </TactileButton>
                <TactileButton
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={stopCamera}
                  leftIcon={<CameraOff className="w-4 h-4" />}
                >
                  {isAr ? 'إيقاف الكاميرا' : 'Stop Camera'}
                </TactileButton>
              </div>
            </>
          ) : (
            <div className="text-center p-6 space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-neutral-900 border border-neutral-800 flex items-center justify-center mx-auto text-amber-400">
                <Barcode className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold text-neutral-200">
                  {isAr
                    ? 'وجّه الكاميرا الخلفية نحو الباركود، أو ارفع صورة باركود محفوظة، أو أدخل الرقم يدوياً'
                    : 'Point rear camera at barcode, upload a saved barcode image, or enter code manually'}
                </p>
                {cameraError && <p className="text-xs text-rose-400">{cameraError}</p>}
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <TactileButton
                  type="button"
                  variant="amber"
                  size="sm"
                  onClick={startCamera}
                  leftIcon={<Camera className="w-4 h-4" />}
                  data-testid="start-barcode-camera-btn"
                >
                  {isNativeCapacitorEnvironment()
                    ? isAr
                      ? 'مسح بالكاميرا (Google ML Kit)'
                      : 'Scan with ML Kit Camera'
                    : isAr
                    ? 'تشغيل الكاميرا الخلفية'
                    : 'Start Rear Camera'}
                </TactileButton>
                <TactileButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => imageInputRef.current?.click()}
                  leftIcon={<ImageIcon className="w-4 h-4 text-emerald-400" />}
                  className="border border-neutral-800 bg-neutral-900/80"
                  data-testid="upload-barcode-photo-btn"
                >
                  {isAr ? 'قراءة باركود من صورة محفوظة' : 'Scan from Saved Photo'}
                </TactileButton>
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleScanImageUpload}
                />
              </div>
            </div>
          )}
        </div>

        {/* Toggle for auto-opening Add Product Modal when scanned barcode is not in DB (Phase 5 Step 7) */}
        <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-neutral-900/70 border border-neutral-800 text-xs">
          <label className="flex items-center gap-2 cursor-pointer text-neutral-300">
            <input
              type="checkbox"
              checked={autoOpenNewProductOnMiss}
              onChange={(e) => setAutoOpenNewProductOnMiss(e.target.checked)}
              className="rounded border-neutral-700 text-amber-500 focus:ring-amber-500"
            />
            <span>
              {isAr
                ? 'فتح نموذج "إضافة منتج جديد" تلقائياً مع تعبئة الباركود إذا لم يكن المنتج مسجلاً'
                : 'Auto-open "Add New Product" with barcode pre-filled when product is not found'}
            </span>
          </label>
        </div>

        {/* Manual / USB Scanner Input */}
        <form onSubmit={handleSubmit} className="flex gap-2">
          <div className="flex-1">
            <AppInput
              placeholder={
                isAr
                  ? 'أدخل رقم الباركود أو امسحه بجهاز الليزر...'
                  : 'Enter barcode manually or scan with USB laser...'
              }
              value={barcodeInput}
              onChange={(e) => setBarcodeInput(e.target.value)}
              leftIcon={<Barcode className="w-4 h-4" />}
              autoFocus
            />
          </div>
          <TactileButton type="submit" variant="primary">
            {isAr ? 'بحث / إضافة' : 'Search / Add'}
          </TactileButton>
        </form>

        {/* Status Feedback (Never shows Scan Successful unless a valid barcode was actually decoded) */}
        {feedback && (
          <div
            data-testid="scanner-feedback-banner"
            className={`p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs font-semibold ${
              feedback.type === 'success'
                ? 'bg-emerald-950/50 border-emerald-800/60 text-emerald-300'
                : feedback.type === 'not_found'
                ? 'bg-amber-950/50 border-amber-500/50 text-amber-200'
                : 'bg-rose-950/50 border-rose-800/60 text-rose-300'
            }`}
          >
            <div className="flex items-center gap-2">
              {feedback.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
              )}
              <span>{feedback.message}</span>
            </div>

            {feedback.type === 'not_found' && feedback.unmatchedBarcode && (
              <TactileButton
                type="button"
                variant="amber"
                size="sm"
                leftIcon={<PlusCircle className="w-3.5 h-3.5" />}
                onClick={() => {
                  const code = feedback.unmatchedBarcode!;
                  onClose();
                  openAddProductWithBarcode(code);
                }}
                data-testid="register-unmatched-barcode-btn"
              >
                {isAr ? 'تسجيل منتج جديد بهذا الباركود' : 'Add Product with Barcode'}
              </TactileButton>
            )}
          </div>
        )}

        {/* Phase 6 & 7: Scanner Diagnostics & Saved Barcode Image Self-Tester */}
        <ScannerDiagnosticsPanel
          isAr={isAr}
          onTestBarcodeDecoded={(rawValue, format) => handleLookupAndAdd(rawValue, format)}
        />

        {/* Quick Catalog Barcode Chips */}
        <div className="pt-2 border-t border-neutral-800/80">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-neutral-400 mb-2.5">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>{isAr ? 'باركودات المنتجات المسجلة حالياً' : 'Registered Product Barcodes'}:</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-36 overflow-y-auto pr-1">
            {products.map((prod) => (
              <button
                key={prod.id}
                type="button"
                onClick={() => handleLookupAndAdd(prod.barcode, 'CATALOG')}
                disabled={prod.stock <= 0}
                className="flex items-center justify-between p-2.5 rounded-xl bg-neutral-800/60 hover:bg-neutral-800 border border-neutral-700/50 text-left transition-colors disabled:opacity-40"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-lg">{prod.emoji || '📦'}</span>
                  <div className="truncate">
                    <div className="text-xs font-bold text-white truncate">
                      {isAr && prod.nameAr ? prod.nameAr : prod.name}
                    </div>
                    <div className="text-[10px] font-mono text-neutral-400 flex items-center gap-1">
                      <span>{prod.barcode || prod.sku}</span>
                      {getAllProductBarcodes(prod).length > 1 && (
                        <span className="px-1 py-0.2 rounded bg-amber-500/20 text-amber-300 font-bold">
                          +{getAllProductBarcodes(prod).length - 1}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <span className="text-xs font-mono font-bold text-amber-400 shrink-0 ml-2 tabular-nums">
                  {formatCurrency(prod.sellingPrice, settings.currency, settings.language)}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </AppModal>
  );
};
