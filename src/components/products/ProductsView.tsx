/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { usePOS } from '../../context/POSContext';
import { getTranslation } from '../../lib/translations';
import {
  formatCurrency,
  convertCurrencyAmount,
  getProductPricesInCurrency,
  getProductPackaging,
  formatProductStockBreakdown,
  roundCurrencyValue,
} from '../../lib/pos-calculations';
import {
  generateBarcode,
  normalizeProductBarcodes,
  getAllProductBarcodes,
  matchesProductBarcode,
  resolveScannedProductBarcode,
  getProductSerialNumber,
  formatProductSerialNumber,
  getNextProductSerialNumber,
  matchesProductSearchQuery,
} from '../../lib/inventory-rules';
import {
  decodeBarcodeFromImageFile,
  decodeBarcodeFromImageFileWithDiagnostics,
  decodeBarcodeFromVideoElement,
  decodeBarcodeFromVideoElementWithDiagnostics,
  isNativeCapacitorEnvironment,
  scanWithNativeMLKit,
  applyWebCameraTrackEnhancements,
  resetScannerFrameSignatureCache,
  recordScannerStage,
} from '../../lib/barcode-scanner-engine';
import { ScannerDiagnosticsPanel } from '../checkout/ScannerDiagnosticsPanel';
import { normalizeNumberInput, parseNormalizedNumber } from '../../lib/number-utils';
import {
  Product,
  SupportedCurrency,
  ProductSaleUnitMode,
  AllowedSaleUnitsMode,
} from '../../lib/types';
import { AppCard } from '../ui/AppCard';
import { AppInput } from '../ui/AppInput';
import { TactileButton } from '../ui/TactileButton';
import { HoldToConfirm } from '../ui/HoldToConfirm';
import { AppModal } from '../ui/AppModal';
import {
  Plus,
  Search,
  Edit2,
  Trash2,
  Barcode,
  Camera,
  AlertTriangle,
  RefreshCw,
  X,
  Image as ImageIcon,
  Upload,
  Coins,
  TrendingUp,
  ArrowRightLeft,
  Check,
  Package,
  Layers,
  History,
  Clock,
  Hash,
  FileText,
  UserCheck,
  PackageX,
} from 'lucide-react';
import { playTactileClick, playScannerBeep, triggerHaptic } from '../../lib/sound-fx';

/**
 * Resizes an uploaded image File into a compact Data URL for reliable persistence.
 */
function compressImageFileToDataUrl(file: File, maxDim = 360): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const img = new Image();
      img.onerror = () => resolve(dataUrl);
      img.onload = () => {
        try {
          let { width, height } = img;
          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(dataUrl);
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          const compressed = canvas.toDataURL('image/jpeg', 0.84);
          resolve(compressed);
        } catch {
          resolve(dataUrl);
        }
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

export const ProductsView: React.FC = () => {
  const {
    products,
    addProduct,
    updateProduct,
    deleteProduct,
    settings,
    updateSettings,
    currencies,
    exchangeRates,
    workspaceMode,
    pendingNewProductBarcode,
    setPendingNewProductBarcode,
    openUnmetDemandModal,
  } = usePOS();
  const t = getTranslation(settings.language);
  const isAr = settings.language === 'ar';

  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Form State
  const [formSerialNumber, setFormSerialNumber] = useState('1');
  const [formName, setFormName] = useState('');
  const [formNameAr, setFormNameAr] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formDescriptionAr, setFormDescriptionAr] = useState('');
  const [formSku, setFormSku] = useState('');
  const [formBarcode, setFormBarcode] = useState('');
  const [formAdditionalBarcodes, setFormAdditionalBarcodes] = useState<string[]>([]);
  const [newBarcodeInput, setNewBarcodeInput] = useState('');
  const [formCategory, setFormCategory] = useState('General');
  const [formPriceCurrency, setFormPriceCurrency] = useState<SupportedCurrency>(settings.currency || 'SDG');
  const [formCostPrice, setFormCostPrice] = useState('1000');
  const [formSellingPrice, setFormSellingPrice] = useState('1500');
  // Multi-Unit / Strip & Pack Packaging Customization State
  const [formEnablePackaging, setFormEnablePackaging] = useState<boolean>(false);
  const [formUnitName, setFormUnitName] = useState('Strip');
  const [formUnitNameAr, setFormUnitNameAr] = useState('شريط');
  const [formPackName, setFormPackName] = useState('Pack');
  const [formPackNameAr, setFormPackNameAr] = useState('باكو');
  const [formUnitsPerPack, setFormUnitsPerPack] = useState('8');
  const [formDefaultSaleUnit, setFormDefaultSaleUnit] = useState<ProductSaleUnitMode>('unit');
  const [formAllowedSaleUnits, setFormAllowedSaleUnits] = useState<AllowedSaleUnitsMode>('both');
  const [formPackCostPrice, setFormPackCostPrice] = useState('8000');
  const [formPackSellingPrice, setFormPackSellingPrice] = useState('12000');
  const [formStock, setFormStock] = useState('20');
  const [formMinStockAlert, setFormMinStockAlert] = useState('5');
  const [formEmoji, setFormEmoji] = useState('📦');
  const [formColorHex, setFormColorHex] = useState('#d97706');
  const [formImage, setFormImage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Camera Barcode Scanner State inside Product Modal
  const [isCameraScannerOpen, setIsCameraScannerOpen] = useState(false);
  const [cameraScanTarget, setCameraScanTarget] = useState<'additional' | 'primary'>('additional');
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isDecodingCameraFrame, setIsDecodingCameraFrame] = useState(false);
  const [lastScannedBarcodeFeedback, setLastScannedBarcodeFeedback] = useState<string | null>(null);
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const barcodePhotoInputRef = useRef<HTMLInputElement | null>(null);
  const isNativePlatform = isNativeCapacitorEnvironment();

  // Active currencies list (Zero default currencies in Production unless added by user)
  const activeCurrencies = useMemo(() => {
    if (currencies && currencies.length > 0) {
      return currencies.filter((c) => c.isActive !== false);
    }
    if (workspaceMode === 'PRACTICE') {
      return [
        { code: 'SDG', name: 'Sudanese Pound', nameAr: 'جنيه سوداني', symbol: 'ج.س', decimalPlaces: 2, isBase: true, isActive: true },
        { code: 'USD', name: 'US Dollar', nameAr: 'دولار أمريكي', symbol: '$', decimalPlaces: 2, isBase: false, isActive: true },
        { code: 'SAR', name: 'Saudi Riyal', nameAr: 'ريال سعودي', symbol: 'ر.س', decimalPlaces: 2, isBase: false, isActive: true },
        { code: 'AED', name: 'UAE Dirham', nameAr: 'درهم إماراتي', symbol: 'د.إ', decimalPlaces: 2, isBase: false, isActive: true },
      ];
    }
    return [];
  }, [currencies, workspaceMode]);

  // Categories list
  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => set.add(p.category));
    return Array.from(set);
  }, [products]);

  const filteredProducts = useMemo(() => {
    return products.filter((p, idx) => {
      const matchesSearch = matchesProductSearchQuery(p, searchQuery, idx);
      const matchesCat = categoryFilter === 'all' || p.category === categoryFilter;
      return matchesSearch && matchesCat;
    });
  }, [products, searchQuery, categoryFilter]);

  // Combined deduplicated barcodes in modal
  const allModalBarcodes = useMemo(() => {
    return normalizeProductBarcodes(formBarcode, formAdditionalBarcodes);
  }, [formBarcode, formAdditionalBarcodes]);

  // Live parsed cost & selling prices in modal
  const numericCostPrice = parseNormalizedNumber(formCostPrice, 0);
  const numericSellingPrice = parseNormalizedNumber(formSellingPrice, 0);
  const numericUnitsPerPack = Math.max(1, Math.floor(parseNormalizedNumber(formUnitsPerPack, 8)));
  const numericPackCostPrice = parseNormalizedNumber(
    formPackCostPrice,
    roundCurrencyValue(numericCostPrice * numericUnitsPerPack, formPriceCurrency)
  );
  const numericPackSellingPrice = parseNormalizedNumber(
    formPackSellingPrice,
    roundCurrencyValue(numericSellingPrice * numericUnitsPerPack, formPriceCurrency)
  );
  const unitProfit = Math.round((numericSellingPrice - numericCostPrice) * 100) / 100;
  const packProfit = Math.round((numericPackSellingPrice - numericPackCostPrice) * 100) / 100;
  const profitMarginPercent =
    numericSellingPrice > 0
      ? Math.round(((numericSellingPrice - numericCostPrice) / numericSellingPrice) * 1000) / 10
      : 0;

  // Synchronized handlers for Unit (Strip/Piece) vs Pack prices
  const handleUnitCostChange = (rawVal: string) => {
    const cleaned = normalizeNumberInput(rawVal);
    setFormCostPrice(cleaned);
    const parsedUnitCost = parseNormalizedNumber(cleaned, 0);
    setFormPackCostPrice(
      String(roundCurrencyValue(parsedUnitCost * numericUnitsPerPack, formPriceCurrency))
    );
  };

  const handleUnitSellingChange = (rawVal: string) => {
    const cleaned = normalizeNumberInput(rawVal);
    setFormSellingPrice(cleaned);
    const parsedUnitSell = parseNormalizedNumber(cleaned, 0);
    setFormPackSellingPrice(
      String(roundCurrencyValue(parsedUnitSell * numericUnitsPerPack, formPriceCurrency))
    );
  };

  const handlePackCostChange = (rawVal: string) => {
    const cleaned = normalizeNumberInput(rawVal);
    setFormPackCostPrice(cleaned);
    const parsedPackCost = parseNormalizedNumber(cleaned, 0);
    if (numericUnitsPerPack > 0) {
      setFormCostPrice(
        String(roundCurrencyValue(parsedPackCost / numericUnitsPerPack, formPriceCurrency))
      );
    }
  };

  const handlePackSellingChange = (rawVal: string) => {
    const cleaned = normalizeNumberInput(rawVal);
    setFormPackSellingPrice(cleaned);
    const parsedPackSell = parseNormalizedNumber(cleaned, 0);
    if (numericUnitsPerPack > 0) {
      setFormSellingPrice(
        String(roundCurrencyValue(parsedPackSell / numericUnitsPerPack, formPriceCurrency))
      );
    }
  };

  const handleUnitsPerPackChange = (rawVal: string) => {
    const cleaned = normalizeNumberInput(rawVal);
    setFormUnitsPerPack(cleaned);
    const nextUnits = Math.max(1, Math.floor(parseNormalizedNumber(cleaned, 1)));
    const currentUnitCost = parseNormalizedNumber(formCostPrice, 0);
    const currentUnitSell = parseNormalizedNumber(formSellingPrice, 0);
    setFormPackCostPrice(
      String(roundCurrencyValue(currentUnitCost * nextUnits, formPriceCurrency))
    );
    setFormPackSellingPrice(
      String(roundCurrencyValue(currentUnitSell * nextUnits, formPriceCurrency))
    );
  };

  const applyPackagingPreset = (preset: {
    unitName: string;
    unitNameAr: string;
    packName: string;
    packNameAr: string;
    unitsPerPack: number;
  }) => {
    playTactileClick(settings.soundEnabled);
    setFormEnablePackaging(true);
    setFormUnitName(preset.unitName);
    setFormUnitNameAr(preset.unitNameAr);
    setFormPackName(preset.packName);
    setFormPackNameAr(preset.packNameAr);
    setFormUnitsPerPack(String(preset.unitsPerPack));
    const currentUnitCost = parseNormalizedNumber(formCostPrice, 0);
    const currentUnitSell = parseNormalizedNumber(formSellingPrice, 0);
    setFormPackCostPrice(
      String(roundCurrencyValue(currentUnitCost * preset.unitsPerPack, formPriceCurrency))
    );
    setFormPackSellingPrice(
      String(roundCurrencyValue(currentUnitSell * preset.unitsPerPack, formPriceCurrency))
    );
  };

  // Switch pricing currency inside the Add/Edit modal and automatically convert the entered cost & selling prices
  const handleModalCurrencyChange = (targetCurrCode: string) => {
    playTactileClick(settings.soundEnabled);
    const nextCode = targetCurrCode.toUpperCase();
    if (nextCode === formPriceCurrency) return;

    const currentCost = parseNormalizedNumber(formCostPrice, 0);
    const currentSelling = parseNormalizedNumber(formSellingPrice, 0);
    const currentPackCost = parseNormalizedNumber(
      formPackCostPrice,
      currentCost * numericUnitsPerPack
    );
    const currentPackSelling = parseNormalizedNumber(
      formPackSellingPrice,
      currentSelling * numericUnitsPerPack
    );

    const convertedCost = convertCurrencyAmount(
      currentCost,
      formPriceCurrency,
      nextCode,
      exchangeRates
    );
    const convertedSelling = convertCurrencyAmount(
      currentSelling,
      formPriceCurrency,
      nextCode,
      exchangeRates
    );
    const convertedPackCost = convertCurrencyAmount(
      currentPackCost,
      formPriceCurrency,
      nextCode,
      exchangeRates
    );
    const convertedPackSelling = convertCurrencyAmount(
      currentPackSelling,
      formPriceCurrency,
      nextCode,
      exchangeRates
    );

    setFormPriceCurrency(nextCode);
    setFormCostPrice(String(convertedCost));
    setFormSellingPrice(String(convertedSelling));
    setFormPackCostPrice(String(convertedPackCost));
    setFormPackSellingPrice(String(convertedPackSelling));
  };

  // Add an additional barcode to the product in the modal (NEVER auto-generates unless explicitly passed via Generate button)
  const handleAddExtraBarcode = (customCode?: string) => {
    playTactileClick(settings.soundEnabled);
    const candidate = String(customCode !== undefined ? customCode : newBarcodeInput).trim();
    if (!candidate) {
      setErrorMessage(
        isAr
          ? 'يرجى كتابة الباركود أو مسحه بالكاميرا أولاً، أو الضغط على زر توليد باركود إضافي.'
          : 'Please type or scan a barcode first, or click the Generate Barcode button explicitly.'
      );
      return;
    }

    const resolution = resolveScannedProductBarcode({
      scannedCode: candidate,
      target: 'additional',
      currentPrimary: formBarcode,
      currentAdditional: formAdditionalBarcodes,
      existingProducts: products,
      editingProductId: editingProduct?.id,
    });

    if (!resolution.ok) {
      setErrorMessage(isAr ? resolution.errorAr || null : resolution.errorEn || null);
      return;
    }

    setErrorMessage(null);
    setFormBarcode(resolution.primaryBarcode);
    setFormAdditionalBarcodes(resolution.additionalBarcodes);
    if (customCode === undefined) {
      setNewBarcodeInput('');
    }
  };

  // Apply a barcode scanned via Camera (never auto-generates random barcodes)
  const handleApplyCameraScannedBarcode = async (
    rawScannedCode?: string,
    targetOverride?: 'additional' | 'primary'
  ): Promise<boolean> => {
    const target = targetOverride || cameraScanTarget;
    let candidate = String(rawScannedCode || '').trim();

    // If no code passed directly, try decoding from the live video element first, then fallback to typed input
    if (!candidate && cameraVideoRef.current && cameraActive) {
      setIsDecodingCameraFrame(true);
      try {
        const res = await decodeBarcodeFromVideoElementWithDiagnostics(cameraVideoRef.current);
        if (res?.rawValue) {
          candidate = String(res.rawValue).trim();
        }
      } finally {
        setIsDecodingCameraFrame(false);
      }
    }

    if (!candidate) {
      candidate = String(newBarcodeInput).trim();
    }

    const resolution = resolveScannedProductBarcode({
      scannedCode: candidate,
      target,
      currentPrimary: formBarcode,
      currentAdditional: formAdditionalBarcodes,
      existingProducts: products,
      editingProductId: editingProduct?.id,
    });

    if (!resolution.ok) {
      setErrorMessage(isAr ? resolution.errorAr || null : resolution.errorEn || null);
      return false;
    }

    playScannerBeep(settings.soundEnabled);
    triggerHaptic('success', settings.hapticsEnabled);
    setErrorMessage(null);
    setFormBarcode(String(resolution.primaryBarcode));
    setFormAdditionalBarcodes(resolution.additionalBarcodes);
    setNewBarcodeInput('');
    setLastScannedBarcodeFeedback(
      isAr
        ? `تم قراءة وإضافة الباركود بالكاميرا بنجاح: ${resolution.code}`
        : `Camera scanned & added barcode: ${resolution.code}`
    );
    // Stop live scanning once a valid barcode has been captured
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null;
    }
    setCameraActive(false);
    return true;
  };

  // Trigger Native ML Kit Scanner when running inside Capacitor Android APK
  const handleNativeProductBarcodeScan = async (target: 'additional' | 'primary') => {
    playTactileClick(settings.soundEnabled);
    setCameraScanTarget(target);
    setErrorMessage(null);
    const result = await scanWithNativeMLKit();
    if (result?.rawValue) {
      await handleApplyCameraScannedBarcode(String(result.rawValue), target);
    }
  };

  // Attach MediaStream to <video> element once cameraActive mounts the <video> node
  useEffect(() => {
    if (cameraActive && cameraVideoRef.current && cameraStreamRef.current) {
      const videoEl = cameraVideoRef.current;
      if (videoEl.srcObject !== cameraStreamRef.current) {
        videoEl.srcObject = cameraStreamRef.current;
      }
      videoEl.play().catch(() => {});
    }
  }, [cameraActive, isCameraScannerOpen]);

  // Start/stop live rear camera stream and cross-browser barcode decoding when camera scanner panel is open
  useEffect(() => {
    let scanTimer: number | null = null;
    let isCancelled = false;

    if (isModalOpen && isCameraScannerOpen) {
      resetScannerFrameSignatureCache();
      if (isNativePlatform) {
        // On Android APK, trigger Native ML Kit scanner directly
        scanWithNativeMLKit().then((res) => {
          if (!isCancelled && res?.rawValue) {
            handleApplyCameraScannedBarcode(String(res.rawValue));
          }
        });
      } else if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
        recordScannerStage('Camera Initialized', 'Requesting rear camera in Product Modal');
        navigator.mediaDevices
          .getUserMedia({
            video: {
              facingMode: { ideal: 'environment' },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
            audio: false,
          })
          .catch(() =>
            navigator.mediaDevices.getUserMedia({
              video: true,
              audio: false,
            })
          )
          .then(async (mediaStream) => {
            if (isCancelled) {
              mediaStream.getTracks().forEach((t) => t.stop());
              return;
            }
            cameraStreamRef.current = mediaStream;
            await applyWebCameraTrackEnhancements(mediaStream);
            setCameraActive(true);
            setCameraError(null);
            recordScannerStage('Video Stream Started', 'Product Modal rear camera stream started');

            const runDecodeLoop = async () => {
              if (isCancelled) return;
              const videoEl = cameraVideoRef.current;
              if (videoEl && videoEl.readyState >= 2) {
                try {
                  const decoded = await decodeBarcodeFromVideoElementWithDiagnostics(videoEl);
                  if (!isCancelled && decoded?.rawValue) {
                    const applied = await handleApplyCameraScannedBarcode(String(decoded.rawValue));
                    if (applied) {
                      return; // Stop loop after valid barcode
                    }
                  }
                } catch {}
              }
              if (!isCancelled) {
                scanTimer = window.setTimeout(runDecodeLoop, 220);
              }
            };
            scanTimer = window.setTimeout(runDecodeLoop, 300);
          })
          .catch(() => {
            if (!isCancelled) {
              setCameraActive(false);
              setCameraError(
                isAr
                  ? 'الكاميرا المباشرة غير متاحة حالياً — يمكنك الضغط على "تصوير / اختيار صورة باركود" لقراءة الباركود من صورة.'
                  : 'Live camera stream unavailable — click "Scan from Camera Photo" to decode a barcode from an image.'
              );
            }
          });
      } else {
        setCameraActive(false);
        setCameraError(
          isAr
            ? 'الكاميرا المباشرة غير مدعومة في هذا المتصفح — استخدم زر "تصوير / اختيار صورة باركود" بالأسفل.'
            : 'Camera API unavailable — use the "Scan from Camera Photo" button below.'
        );
      }
    }

    return () => {
      isCancelled = true;
      if (scanTimer) window.clearTimeout(scanTimer);
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach((track) => track.stop());
        cameraStreamRef.current = null;
      }
      setCameraActive(false);
    };
  }, [isModalOpen, isCameraScannerOpen, isAr]);

  // Handle snapping/selecting a photo of a barcode from mobile/desktop camera
  const handleBarcodePhotoCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsDecodingCameraFrame(true);
    setErrorMessage(null);
    try {
      const detected = await decodeBarcodeFromImageFileWithDiagnostics(file);
      if (detected?.rawValue) {
        await handleApplyCameraScannedBarcode(String(detected.rawValue));
      } else {
        setErrorMessage(
          isAr
            ? 'تعذر قراءة الباركود من الصورة المختارة. يرجى التأكد من وضوح خطوط الباركود في الصورة.'
            : 'Could not read a barcode from the selected photo. Please ensure the barcode lines are sharp and clear.'
        );
      }
    } finally {
      setIsDecodingCameraFrame(false);
      if (barcodePhotoInputRef.current) {
        barcodePhotoInputRef.current.value = '';
      }
    }
  };

  const handleRemoveBarcode = (codeToRemove: string) => {
    playTactileClick(settings.soundEnabled);
    if (codeToRemove === formBarcode) {
      if (formAdditionalBarcodes.length > 0) {
        const [nextPrimary, ...rest] = formAdditionalBarcodes;
        setFormBarcode(nextPrimary);
        setFormAdditionalBarcodes(rest);
      } else {
        setFormBarcode('');
      }
    } else {
      setFormAdditionalBarcodes((prev) => prev.filter((c) => c !== codeToRemove));
    }
  };

  const handleSetPrimaryBarcode = (codeToPromote: string) => {
    playTactileClick(settings.soundEnabled);
    if (codeToPromote === formBarcode) return;
    const previousPrimary = formBarcode;
    setFormBarcode(codeToPromote);
    setFormAdditionalBarcodes((prev) =>
      normalizeProductBarcodes(
        previousPrimary,
        prev.filter((c) => c !== codeToPromote)
      )
    );
  };

  const handleImageFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const dataUrl = await compressImageFileToDataUrl(file);
      setFormImage(dataUrl);
      setErrorMessage(null);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to process product image');
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const openCreateModal = (prefilledBarcode?: string) => {
    const initialBarcode =
      typeof prefilledBarcode === 'string' ? String(prefilledBarcode).trim() : '';
    const isPractice = workspaceMode === 'PRACTICE';
    setEditingProduct(null);
    setErrorMessage(null);
    setIsCameraScannerOpen(false);
    setLastScannedBarcodeFeedback(
      initialBarcode
        ? isAr
          ? `تم تعبئة الباركود الممسوح تلقائياً: ${initialBarcode}`
          : `Auto-filled scanned barcode: ${initialBarcode}`
        : null
    );
    setFormSerialNumber(String(getNextProductSerialNumber(products)));
    setFormName('');
    setFormNameAr('');
    setFormDescription('');
    setFormDescriptionAr('');
    if (isPractice) {
      const skuRand = Math.floor(100 + Math.random() * 900);
      setFormSku(`SKU-${skuRand}`);
    } else {
      setFormSku('');
    }
    // IMPORTANT: Never auto-generate a random barcode on modal open!
    // Only pre-fill if a real scanned barcode string was passed from the scanner.
    setFormBarcode(initialBarcode);
    setFormAdditionalBarcodes([]);
    setNewBarcodeInput('');
    setFormCategory(categories[0] || (isPractice ? 'Beverages' : ''));
    const activeCurr =
      (activeCurrencies.length > 0 ? activeCurrencies[0].code : '') ||
      settings.currency ||
      'SDG';
    setFormPriceCurrency(activeCurr);
    if (isPractice) {
      const defaultCostSdg = 2700;
      const defaultSellSdg = 5400;
      const initUnitCost = convertCurrencyAmount(defaultCostSdg, 'SDG', activeCurr, exchangeRates);
      const initUnitSell = convertCurrencyAmount(defaultSellSdg, 'SDG', activeCurr, exchangeRates);
      setFormCostPrice(String(initUnitCost));
      setFormSellingPrice(String(initUnitSell));
      setFormPackCostPrice(String(roundCurrencyValue(initUnitCost * 8, activeCurr)));
      setFormPackSellingPrice(String(roundCurrencyValue(initUnitSell * 8, activeCurr)));
      setFormStock('25');
      setFormMinStockAlert('5');
    } else {
      setFormCostPrice('');
      setFormSellingPrice('');
      setFormPackCostPrice('');
      setFormPackSellingPrice('');
      setFormStock('0');
      setFormMinStockAlert('0');
    }
    setFormEnablePackaging(false);
    setFormUnitName('Strip');
    setFormUnitNameAr('شريط');
    setFormPackName('Pack');
    setFormPackNameAr('باكو');
    setFormUnitsPerPack('8');
    setFormDefaultSaleUnit('unit');
    setFormAllowedSaleUnits('both');
    setFormEmoji('📦');
    setFormColorHex('#d97706');
    setFormImage('');
    setIsModalOpen(true);
  };

  // Phase 5 Requirement #7: When Checkout scanner detects an unregistered barcode,
  // automatically open the Add Product modal with the scanned barcode pre-filled as a String.
  useEffect(() => {
    if (pendingNewProductBarcode && pendingNewProductBarcode.trim().length > 0) {
      const code = String(pendingNewProductBarcode).trim();
      openCreateModal(code);
      setPendingNewProductBarcode(null);
    }
  }, [pendingNewProductBarcode]);

  const openEditModal = (p: Product) => {
    setEditingProduct(p);
    setErrorMessage(null);
    setIsCameraScannerOpen(false);
    setLastScannedBarcodeFeedback(null);
    setFormSerialNumber(String(getProductSerialNumber(p)));
    setFormName(p.name);
    setFormNameAr(p.nameAr || '');
    setFormDescription(p.description || p.customFields?.description || '');
    setFormDescriptionAr(p.descriptionAr || p.customFields?.descriptionAr || '');
    setFormSku(p.sku);
    const allCodes = getAllProductBarcodes(p);
    setFormBarcode(allCodes[0] || p.barcode || '');
    setFormAdditionalBarcodes(allCodes.slice(1));
    setNewBarcodeInput('');
    setFormCategory(p.category);

    // Load prices in the current active store currency so the user can edit or switch currencies seamlessly
    const displayCurr = settings.currency || p.priceCurrency || 'SDG';
    const converted = getProductPricesInCurrency(p, displayCurr, exchangeRates);
    const pkg = getProductPackaging(p);
    setFormPriceCurrency(displayCurr);
    setFormCostPrice(converted.costPrice.toString());
    setFormSellingPrice(converted.sellingPrice.toString());
    setFormEnablePackaging(pkg.enablePackaging);
    setFormUnitName(pkg.unitName || 'Strip');
    setFormUnitNameAr(pkg.unitNameAr || 'شريط');
    setFormPackName(pkg.packName || 'Pack');
    setFormPackNameAr(pkg.packNameAr || 'باكو');
    setFormUnitsPerPack(String(pkg.unitsPerPack || 8));
    setFormDefaultSaleUnit(pkg.defaultSaleUnit || 'unit');
    setFormAllowedSaleUnits(pkg.allowedSaleUnits || 'both');
    setFormPackCostPrice(converted.packCostPrice.toString());
    setFormPackSellingPrice(converted.packSellingPrice.toString());
    setFormStock(p.stock.toString());
    setFormMinStockAlert(p.minStockAlert.toString());
    setFormEmoji(p.emoji || '📦');
    setFormColorHex(p.colorHex || '#d97706');
    setFormImage(p.image || p.imageUrl || p.customFields?.image || '');
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) return;
    setErrorMessage(null);

    // If user typed a barcode in the extra barcode box and didn't click "+", include it automatically
    // IMPORTANT: Never auto-generate a barcode on save if the user left it blank!
    const pendingExtra = newBarcodeInput.trim();
    const finalBarcodes = normalizeProductBarcodes(
      formBarcode.trim(),
      pendingExtra ? [...formAdditionalBarcodes, pendingExtra] : formAdditionalBarcodes
    );

    // Validate barcode uniqueness across other products for any non-empty barcode
    for (const code of finalBarcodes) {
      if (!code) continue;
      const conflict = products.find(
        (p) => (!editingProduct || p.id !== editingProduct.id) && matchesProductBarcode(p, code, true)
      );
      if (conflict) {
        setErrorMessage(
          isAr
            ? `الباركود "${code}" مستخدم بالفعل للمنتج "${conflict.nameAr || conflict.name}".`
            : `Duplicate barcode: "${code}" is already assigned to "${conflict.name}".`
        );
        return;
      }
    }

    const parsedSerial = Math.max(
      1,
      Math.floor(parseNormalizedNumber(formSerialNumber, getNextProductSerialNumber(products)))
    );
    const rawCost = Math.max(0, parseNormalizedNumber(formCostPrice, 0));
    const rawSelling = Math.max(0, parseNormalizedNumber(formSellingPrice, 0));
    const finalUnitsPerPack = formEnablePackaging
      ? Math.max(2, Math.floor(parseNormalizedNumber(formUnitsPerPack, 8)))
      : 1;
    const rawPackCost = formEnablePackaging
      ? Math.max(
          0,
          parseNormalizedNumber(
            formPackCostPrice,
            roundCurrencyValue(rawCost * finalUnitsPerPack, formPriceCurrency)
          )
        )
      : rawCost;
    const rawPackSelling = formEnablePackaging
      ? Math.max(
          0,
          parseNormalizedNumber(
            formPackSellingPrice,
            roundCurrencyValue(rawSelling * finalUnitsPerPack, formPriceCurrency)
          )
        )
      : rawSelling;
    const finalDefaultSaleUnit: ProductSaleUnitMode =
      formAllowedSaleUnits === 'pack_only'
        ? 'pack'
        : formAllowedSaleUnits === 'unit_only'
        ? 'unit'
        : formDefaultSaleUnit;

    const cleanImage = formImage.trim() || undefined;
    const cleanDesc = formDescription.trim() || undefined;
    const cleanDescAr = formDescriptionAr.trim() || undefined;

    const packagingMetadata = {
      enablePackaging: formEnablePackaging,
      unitName: formUnitName.trim() || 'Strip',
      unitNameAr: formUnitNameAr.trim() || 'شريط',
      packName: formPackName.trim() || 'Pack',
      packNameAr: formPackNameAr.trim() || 'باكو',
      unitsPerPack: finalUnitsPerPack,
      defaultSaleUnit: formEnablePackaging ? finalDefaultSaleUnit : ('unit' as ProductSaleUnitMode),
      allowedSaleUnits: formEnablePackaging ? formAllowedSaleUnits : ('unit_only' as AllowedSaleUnitsMode),
      packCostPrice: rawPackCost,
      packSellingPrice: rawPackSelling,
    };

    const payload: Omit<Product, 'id' | 'updatedAt'> = {
      serialNumber: parsedSerial,
      name: formName.trim(),
      nameAr: formNameAr.trim() || undefined,
      description: cleanDesc,
      descriptionAr: cleanDescAr,
      sku: formSku.trim() || `SKU-${Date.now()}`,
      barcode: finalBarcodes[0] || '',
      barcodes: finalBarcodes,
      category: formCategory.trim() || 'General',
      costPrice: rawCost,
      sellingPrice: rawSelling,
      priceCurrency: formPriceCurrency,
      ...packagingMetadata,
      stock: Math.max(0, Math.floor(parseNormalizedNumber(formStock, 0))),
      minStockAlert: Math.max(0, Math.floor(parseNormalizedNumber(formMinStockAlert, 0))),
      image: cleanImage,
      imageUrl: cleanImage || null,
      emoji: formEmoji || '📦',
      colorHex: formColorHex || '#d97706',
      customFields: {
        ...(editingProduct?.customFields || {}),
        serialNumber: parsedSerial,
        description: cleanDesc,
        descriptionAr: cleanDescAr,
        barcodes: finalBarcodes,
        priceCurrency: formPriceCurrency,
        ...packagingMetadata,
        ...(cleanImage ? { image: cleanImage } : {}),
      },
    };

    try {
      if (editingProduct) {
        await updateProduct(editingProduct.id, payload);
      } else {
        await addProduct(payload);
      }
      setIsModalOpen(false);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to save product');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteProduct(id);
      setIsModalOpen(false);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to delete product');
    }
  };

  const activeRateToSdg =
    settings.currency === 'SDG' ? 1 : exchangeRates[settings.currency] || 1;

  return (
    <div className="flex-1 max-w-7xl mx-auto w-full p-4 md:p-6 space-y-5 pb-24">
      {/* Top Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
            {t.productCatalog}
          </h2>
          <span className="text-xs text-neutral-400">
            {isAr
              ? `${products.length} منتج مسجل • الأسعار مرتبطة تلقائياً بسعر الصرف`
              : `${products.length} registered catalog items • Prices dynamically linked to exchange rates`}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="products-open-unmet-demand-btn"
            onClick={() =>
              openUnmetDemandModal({
                sourceScreen: 'products',
                productNameSnapshot: searchQuery.trim() || undefined,
              })
            }
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border border-rose-500/40 bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 text-xs font-bold transition-all"
          >
            <PackageX className="w-4 h-4" />
            <span>
              {isAr ? 'تسجيل طلب غير متوفر' : 'Record Unmet Demand'}
            </span>
          </button>

          <TactileButton
            variant="amber"
            size="md"
            data-testid="open-create-product-modal-btn"
            onClick={() => openCreateModal()}
            leftIcon={<Plus className="w-4 h-4" />}
          >
            {t.createProduct}
          </TactileButton>
        </div>
      </div>

      {/* Live Currency Switcher Bar (Links all product prices with active currency & exchange rate) */}
      <div className="p-3.5 rounded-2xl bg-neutral-900/90 border border-neutral-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shrink-0">
            <Coins className="w-4 h-4" />
          </div>
          <div>
            <div className="text-xs font-bold text-white">
              {isAr
                ? 'عملة عرض وتسعير المنتجات (مرتبطة بسعر الصرف)'
                : 'Active Product Pricing Currency (Exchange Rate Linked)'}
            </div>
            <div className="text-[11px] font-mono text-neutral-400">
              {settings.currency === 'SDG'
                ? isAr
                  ? 'العملة الأساسية: الجنيه السوداني (SDG)'
                  : 'Base Accounting Currency: SDG (1.00)'
                : isAr
                ? `سعر الصرف الفعال: 1 ${settings.currency} = ${activeRateToSdg.toLocaleString()} ج.س (SDG)`
                : `Active Rate: 1 ${settings.currency} = ${activeRateToSdg.toLocaleString()} SDG`}
            </div>
          </div>
        </div>

        <div className="flex items-center flex-wrap gap-1.5">
          {activeCurrencies.map((curr) => {
            const isSelected = settings.currency === curr.code;
            const rateVal = curr.code === 'SDG' ? 1 : exchangeRates[curr.code] || 1;
            return (
              <button
                key={curr.code}
                type="button"
                onClick={() => {
                  playTactileClick(settings.soundEnabled);
                  updateSettings({ currency: curr.code });
                }}
                className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold transition-all border flex items-center gap-1.5 ${
                  isSelected
                    ? 'bg-amber-500 text-neutral-950 border-amber-400 shadow-sm'
                    : 'bg-neutral-950 text-neutral-300 border-neutral-800 hover:border-neutral-700 hover:text-white'
                }`}
              >
                <span>{curr.code}</span>
                {curr.code !== 'SDG' && (
                  <span
                    className={`text-[10px] px-1 rounded ${
                      isSelected ? 'bg-neutral-950/20 text-neutral-950' : 'bg-neutral-800 text-neutral-400'
                    }`}
                  >
                    {rateVal}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="flex-1">
          <AppInput
            data-testid="products-search-input"
            placeholder={
              isAr
                ? 'ابحث بأي كلمة من اسم المنتج، الوصف، الرقم التسلسلي (#0001)، SKU، أو الباركود...'
                : 'Search by any word in product name, description, serial (#0001), SKU, or barcode...'
            }
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            leftIcon={<Search className="w-4 h-4" />}
            rightIcon={
              searchQuery ? (
                <button
                  onClick={() => setSearchQuery('')}
                  className="p-1 text-neutral-400 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              ) : undefined
            }
          />
        </div>

        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="min-h-[46px] px-3.5 py-2.5 rounded-xl bg-neutral-900 border border-neutral-800 text-sm text-neutral-200 focus:outline-none focus:border-amber-500"
        >
          <option value="all">{t.allCategories}</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {/* Products Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {filteredProducts.map((p, idx) => {
          const isLow = p.stock <= p.minStockAlert;
          const isOut = p.stock <= 0;
          const allCodes = getAllProductBarcodes(p);
          const extraBarcodeCount = Math.max(0, allCodes.length - 1);
          const convertedPrices = getProductPricesInCurrency(p, settings.currency, exchangeRates);
          const pkg = getProductPackaging(p);
          const stockBreakdownText = formatProductStockBreakdown(p, settings.language);
          const unitLabel = isAr ? pkg.unitNameAr : pkg.unitName;
          const packLabel = isAr ? pkg.packNameAr : pkg.packName;
          const productImg = p.image || p.imageUrl || p.customFields?.image;
          const serialNum = getProductSerialNumber(p, idx);
          const serialBadge = formatProductSerialNumber(serialNum);
          const prodDesc =
            isAr
              ? p.descriptionAr || p.customFields?.descriptionAr || p.description || p.customFields?.description
              : p.description || p.customFields?.description || p.descriptionAr || p.customFields?.descriptionAr;
          const createdDateStr = p.createdAt || p.customFields?.createdAt || p.updatedAt;
          const prevSellRaw = p.previousSellingPrice ?? p.customFields?.previousSellingPrice;
          const prodCurr = (p.priceCurrency || p.customFields?.priceCurrency || 'SDG').toString().toUpperCase();
          const prevSellConverted =
            prevSellRaw !== undefined && prevSellRaw > 0
              ? convertCurrencyAmount(Number(prevSellRaw), prodCurr, settings.currency, exchangeRates)
              : null;
          const priceUpdatedAt = p.priceUpdatedAt || p.customFields?.priceUpdatedAt;
          const modHistory = p.modificationHistory || p.customFields?.modificationHistory || [];

          return (
            <AppCard key={p.id} className="flex flex-col justify-between">
              <div>
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-3 min-w-0">
                    {productImg ? (
                      <div className="w-12 h-12 rounded-xl overflow-hidden bg-neutral-800 border border-neutral-700/60 shrink-0">
                        <img
                          src={productImg}
                          alt={p.name}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    ) : (
                      <span
                        className="w-12 h-12 flex items-center justify-center text-2xl bg-neutral-800/80 rounded-xl border border-neutral-700/60 shrink-0"
                        style={{ backgroundColor: `${p.colorHex || '#d97706'}22` }}
                      >
                        {p.emoji || '📦'}
                      </span>
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span
                          data-testid={`product-serial-badge-${p.id}`}
                          className="px-1.5 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/40 text-amber-300 font-mono text-[10px] font-extrabold shrink-0"
                          title={isAr ? `الرقم التسلسلي للمنتج: ${serialNum}` : `Product Serial: ${serialNum}`}
                        >
                          {serialBadge}
                        </span>
                        <h4 className="text-sm font-bold text-white leading-snug truncate">
                          {settings.language === 'ar' && p.nameAr ? p.nameAr : p.name}
                        </h4>
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-neutral-400 mt-0.5">
                        <span className="font-mono">{p.sku}</span>
                        {createdDateStr && (
                          <>
                            <span>·</span>
                            <span className="flex items-center gap-1 text-neutral-400" title={isAr ? 'تاريخ الإضافة' : 'Date Added'}>
                              <Clock className="w-3 h-3 text-neutral-500" />
                              <span className="font-mono text-[10px]">
                                {new Date(createdDateStr).toLocaleDateString(isAr ? 'ar-SA' : 'en-US', {
                                  month: 'short',
                                  day: 'numeric',
                                  year: 'numeric',
                                })}
                              </span>
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-md font-semibold shrink-0 ${
                      isOut
                        ? 'bg-rose-950/80 text-rose-400 border border-rose-800/60'
                        : isLow
                        ? 'bg-amber-950/80 text-amber-400 border border-amber-800/60'
                        : 'bg-neutral-800 text-neutral-300'
                    }`}
                  >
                    {isOut ? t.outOfStock : stockBreakdownText}
                  </span>
                </div>

                {/* Product Description Snippet */}
                {prodDesc && (
                  <p className="text-[11px] text-neutral-400 line-clamp-2 mb-2 bg-neutral-950/50 px-2.5 py-1.5 rounded-lg border border-neutral-800/60">
                    {prodDesc}
                  </p>
                )}

                {/* Barcode, Multi-Unit Packaging & Category Badges */}
                <div className="flex items-center flex-wrap gap-1.5 text-xs text-neutral-400 my-2">
                  <div className="flex items-center gap-1.5 bg-neutral-950/80 px-2 py-1 rounded-lg border border-neutral-800 font-mono">
                    <Barcode className="w-3.5 h-3.5 text-amber-500" />
                    <span className="text-neutral-200">
                      {allCodes[0] || p.barcode || (isAr ? 'بدون باركود' : 'No barcode')}
                    </span>
                  </div>
                  {extraBarcodeCount > 0 && (
                    <span
                      className="px-2 py-1 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[11px] font-bold"
                      title={allCodes.slice(1).join(', ')}
                    >
                      +<span className="font-mono">{extraBarcodeCount}</span>{' '}
                      {isAr ? 'باركود' : 'barcodes'}
                    </span>
                  )}
                  {pkg.enablePackaging && pkg.unitsPerPack > 1 && (
                    <span className="px-2 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-[11px] font-bold flex items-center gap-1">
                      <Layers className="w-3 h-3 shrink-0" />
                      <span>
                        {isAr ? (
                          <>
                            الـ{packLabel} = <span className="font-mono">{pkg.unitsPerPack}</span>{' '}
                            {unitLabel}
                          </>
                        ) : (
                          <>
                            1 {packLabel} = <span className="font-mono">{pkg.unitsPerPack}</span>{' '}
                            {unitLabel}
                          </>
                        )}
                      </span>
                    </span>
                  )}
                  {modHistory.length > 0 && (
                    <span
                      className="px-2 py-1 rounded-lg bg-sky-500/10 border border-sky-500/30 text-sky-300 text-[10px] font-semibold flex items-center gap-1"
                      title={
                        isAr
                          ? modHistory[0].summaryAr || 'سجل التعديلات'
                          : modHistory[0].summaryEn || 'Modification log'
                      }
                    >
                      <History className="w-3 h-3 shrink-0" />
                      <span>
                        {isAr ? `${modHistory.length} تعديلات` : `${modHistory.length} edits`}
                      </span>
                    </span>
                  )}
                </div>

                {/* Previous Price History Banner on Card (when price was updated) */}
                {prevSellConverted !== null &&
                  Math.abs(prevSellConverted - convertedPrices.sellingPrice) > 0.001 && (
                    <div className="mb-2 px-2.5 py-1.5 rounded-xl bg-amber-950/30 border border-amber-800/40 flex items-center justify-between gap-2 text-[11px]">
                      <div className="flex items-center gap-1.5 text-amber-300">
                        <History className="w-3.5 h-3.5 shrink-0 text-amber-400" />
                        <span>{isAr ? 'السعر السابق:' : 'Old Price:'}</span>
                        <span className="line-through text-neutral-400 tabular-nums font-bold">
                          {formatCurrency(prevSellConverted, settings.currency, settings.language)}
                        </span>
                      </div>
                      {priceUpdatedAt && (
                        <span className="text-[10px] font-mono text-neutral-400">
                          {new Date(priceUpdatedAt).toLocaleDateString(isAr ? 'ar-SA' : 'en-US', {
                            month: 'short',
                            day: 'numeric',
                          })}
                        </span>
                      )}
                    </div>
                  )}
              </div>

              {/* Purchase (Cost) Price, Selling Price (Unit & Pack) & Edit Trigger */}
              <div className="pt-3 border-t border-neutral-800 flex items-center justify-between gap-2">
                {pkg.enablePackaging && pkg.unitsPerPack > 1 ? (
                  <div className="grid grid-cols-2 gap-2.5 flex-1">
                    <div className="p-2 rounded-xl bg-neutral-950/70 border border-neutral-800/90">
                      <span className="text-[10px] text-neutral-400 block">
                        {isAr ? `سعر الـ${unitLabel}` : `${unitLabel} Price`}
                      </span>
                      <span className="text-xs font-extrabold text-emerald-400 tabular-nums">
                        {formatCurrency(
                          convertedPrices.sellingPrice,
                          settings.currency,
                          settings.language
                        )}
                      </span>
                    </div>
                    <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/30">
                      <span className="text-[10px] text-amber-300 font-semibold block">
                        {isAr ? (
                          <>
                            سعر الـ{packLabel} (<span className="font-mono">{pkg.unitsPerPack}</span>{' '}
                            {unitLabel})
                          </>
                        ) : (
                          <>
                            {packLabel} (<span className="font-mono">{pkg.unitsPerPack}</span>)
                          </>
                        )}
                      </span>
                      <span className="text-xs font-extrabold text-amber-400 tabular-nums">
                        {formatCurrency(
                          convertedPrices.packSellingPrice,
                          settings.currency,
                          settings.language
                        )}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3 flex-1">
                    <div>
                      <span className="text-[10px] text-neutral-400 block">
                        {isAr ? 'سعر الشراء (التكلفة)' : 'Purchase / Cost'}
                      </span>
                      <span className="text-xs font-bold text-neutral-200 tabular-nums">
                        {formatCurrency(convertedPrices.costPrice, settings.currency, settings.language)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-neutral-400 block">
                        {isAr ? 'سعر البيع' : 'Selling Price'}
                      </span>
                      <span className="text-sm font-extrabold text-emerald-400 tabular-nums">
                        {formatCurrency(convertedPrices.sellingPrice, settings.currency, settings.language)}
                      </span>
                    </div>
                  </div>
                )}

                <TactileButton
                  variant="secondary"
                  size="sm"
                  onClick={() => openEditModal(p)}
                  leftIcon={<Edit2 className="w-3.5 h-3.5" />}
                >
                  {isAr ? 'تعديل / السجل' : 'Edit / Log'}
                </TactileButton>
              </div>
            </AppCard>
          );
        })}
      </div>

      {/* Product Edit/Create Modal */}
      <AppModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={editingProduct ? t.editProduct : t.createProduct}
        maxWidth="2xl"
      >
        <form onSubmit={handleSave} className="flex flex-col gap-4 max-h-[78vh] overflow-y-auto pr-1">
          {errorMessage && (
            <div className="flex items-center gap-2 p-3 bg-rose-950/80 border border-rose-800 rounded-xl text-rose-300 text-xs font-semibold">
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* 1. Sequential Serial Number, Product Names & Description */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
            <div className="sm:col-span-3">
              <AppInput
                label={isAr ? 'الرقم التسلسلي (#)' : 'Serial No. (#)'}
                type="text"
                inputMode="numeric"
                dir="ltr"
                value={formSerialNumber}
                onChange={(e) => setFormSerialNumber(normalizeNumberInput(e.target.value))}
                placeholder="1"
                leftIcon={<Hash className="w-3.5 h-3.5 text-amber-400" />}
              />
            </div>

            <div className="sm:col-span-4">
              <AppInput
                label={isAr ? 'اسم المنتج (انجليزي / افتراضي)' : t.productName}
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder={isAr ? 'مثال: Specialty Coffee Beans' : 'e.g. Specialty Coffee Beans'}
                required
                autoFocus
              />
            </div>

            <div className="sm:col-span-5">
              <AppInput
                label={isAr ? 'الاسم بالعربية' : 'Arabic Name (الاسم بالعربية)'}
                value={formNameAr}
                onChange={(e) => setFormNameAr(e.target.value)}
                placeholder="مثال: بن قهوة مختصة"
              />
            </div>
          </div>

          {/* Product Description (AR & EN) for Multi-Word Search */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <AppInput
              label={isAr ? 'وصف المنتج (بالعربية - يظهر في البحث الشامل)' : 'Arabic Description (Searchable)'}
              value={formDescriptionAr}
              onChange={(e) => setFormDescriptionAr(e.target.value)}
              placeholder={
                isAr
                  ? 'اكتب تفاصيل أو كلمات مفتاحية للمنتج للبحث عنها بأي كلمة...'
                  : 'Arabic product description & searchable keywords...'
              }
              leftIcon={<FileText className="w-3.5 h-3.5 text-neutral-400" />}
            />
            <AppInput
              label={isAr ? 'وصف المنتج (انجليزي / إضافي)' : 'Product Description (Searchable Keywords)'}
              value={formDescription}
              onChange={(e) => setFormDescription(e.target.value)}
              placeholder={
                isAr
                  ? 'Example: Herbal ammonia-free hair dye sachets...'
                  : 'e.g. Herbal ammonia-free black henna hair dye sachets...'
              }
              leftIcon={<FileText className="w-3.5 h-3.5 text-neutral-400" />}
            />
          </div>

          {/* 2. SKU & Multi-Barcode Management (Explicit-Only Barcode Generation) */}
          <div className="p-3.5 rounded-2xl bg-neutral-950/80 border border-neutral-800 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                <Barcode className="w-4 h-4" />
                <span>
                  {isAr
                    ? 'إدارة الباركود ورمز الصنف (لا يتم إنشاء باركود تلقائياً إلا عند طلبك)'
                    : 'SKU & Multi-Barcode Manager (Barcodes generated only on explicit request)'}
                </span>
              </span>
              <span className="text-[11px] text-neutral-400">
                {isAr ? (
                  <>
                    عدد الباركودات:{' '}
                    <span className="font-mono font-bold text-neutral-200 tabular-nums">
                      {allModalBarcodes.length}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="font-mono font-bold text-neutral-200 tabular-nums">
                      {allModalBarcodes.length}
                    </span>{' '}
                    barcode(s)
                  </>
                )}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <AppInput
                label={t.sku}
                value={formSku}
                onChange={(e) => setFormSku(e.target.value)}
                required
              />

              <div className="sm:col-span-2 min-w-0">
                <label className="text-xs font-semibold text-neutral-300 block mb-1.5">
                  {isAr
                    ? 'الباركود الأساسي للمنتج (اختياري — امسح بالكاميرا أو اكتب أو اضغط توليد)'
                    : 'Primary Product Barcode (Optional — Scan, type, or click Generate)'}
                </label>
                <div className="flex flex-wrap sm:flex-nowrap gap-2 min-w-0">
                  <input
                    type="text"
                    dir="ltr"
                    data-testid="primary-barcode-input"
                    value={formBarcode}
                    onChange={(e) => setFormBarcode(e.target.value)}
                    placeholder={
                      isAr
                        ? 'بدون باركود تلقائي — امسح أو اكتب أو اضغط توليد'
                        : 'No auto-barcode — scan, type, or click Generate'
                    }
                    className="flex-1 min-w-0 min-h-[44px] px-3.5 rounded-xl bg-neutral-900 border border-neutral-800 text-sm font-mono text-neutral-100 placeholder:font-sans placeholder:text-xs focus:outline-none focus:border-amber-500"
                  />
                  <button
                    type="button"
                    data-testid="open-camera-primary-barcode-btn"
                    onClick={() => {
                      playTactileClick(settings.soundEnabled);
                      setCameraScanTarget('primary');
                      setIsCameraScannerOpen((prev) =>
                        prev && cameraScanTarget === 'primary' ? false : true
                      );
                    }}
                    className={`px-3 min-h-[44px] rounded-xl text-xs font-bold flex items-center gap-1.5 shrink-0 border whitespace-nowrap transition-colors ${
                      isCameraScannerOpen && cameraScanTarget === 'primary'
                        ? 'bg-emerald-500 text-neutral-950 border-emerald-400'
                        : 'bg-emerald-950/70 hover:bg-emerald-900/80 text-emerald-300 border-emerald-700/60'
                    }`}
                    title={
                      isAr
                        ? 'مسح الباركود الأساسي بالكاميرا'
                        : 'Scan primary barcode with camera'
                    }
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span>{isAr ? 'كاميرا' : 'Camera'}</span>
                  </button>
                  <button
                    type="button"
                    data-testid="photo-scan-primary-barcode-btn"
                    onClick={() => {
                      playTactileClick(settings.soundEnabled);
                      setCameraScanTarget('primary');
                      barcodePhotoInputRef.current?.click();
                    }}
                    className="px-3 min-h-[44px] rounded-xl bg-neutral-900 hover:bg-neutral-800 text-emerald-300 text-xs font-semibold flex items-center gap-1.5 shrink-0 border border-neutral-700 whitespace-nowrap"
                    title={isAr ? 'قراءة الباركود من صورة' : 'Read barcode from image'}
                  >
                    <Upload className="w-3.5 h-3.5 text-emerald-400" />
                    <span>{isAr ? 'من صورة' : 'Photo'}</span>
                  </button>
                  <button
                    type="button"
                    data-testid="generate-barcode-explicit-btn"
                    onClick={() => {
                      playTactileClick(settings.soundEnabled);
                      setFormBarcode(generateBarcode());
                    }}
                    className="px-3 min-h-[44px] rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-semibold flex items-center gap-1.5 shrink-0 border border-neutral-700 whitespace-nowrap"
                    title={isAr ? 'توليد باركود أساسي جديد عند الطلب فقط' : 'Generate new primary barcode on request'}
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-amber-400" />
                    <span>{isAr ? 'توليد باركود' : 'Generate'}</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Add Additional Barcode Input & Button */}
            <div className="pt-2 border-t border-neutral-800/80">
              <label className="text-xs font-semibold text-neutral-300 block mb-1.5">
                {isAr
                  ? 'إضافة باركود إضافي للمنتج (عبوة، كرتون، باركود بديل أو عبر الكاميرا)'
                  : 'Add Additional Barcode (Box, Pack, Alternate or Camera Scan)'}
              </label>
              <div className="flex flex-col sm:flex-row gap-2 min-w-0">
                <input
                  type="text"
                  dir={newBarcodeInput ? 'ltr' : isAr ? 'rtl' : 'ltr'}
                  value={newBarcodeInput}
                  onChange={(e) => setNewBarcodeInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddExtraBarcode();
                    }
                  }}
                  placeholder={
                    isAr
                      ? 'اكتب أو امسح الباركود الإضافي بالكاميرا أو اضغط إضافة...'
                      : 'Type/scan extra barcode with camera or click Add Barcode...'
                  }
                  className={`flex-1 min-w-0 min-h-[42px] px-3.5 rounded-xl bg-neutral-900 border border-neutral-800 text-xs text-neutral-100 placeholder:font-sans focus:outline-none focus:border-amber-500 ${
                    newBarcodeInput ? 'font-mono' : 'font-sans'
                  }`}
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    data-testid="open-camera-barcode-btn"
                    onClick={() => {
                      playTactileClick(settings.soundEnabled);
                      setCameraScanTarget('additional');
                      setIsCameraScannerOpen((prev) =>
                        prev && cameraScanTarget === 'additional' ? false : true
                      );
                    }}
                    className={`px-3.5 py-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 shrink-0 border transition-colors ${
                      isCameraScannerOpen && cameraScanTarget === 'additional'
                        ? 'bg-emerald-500 text-neutral-950 border-emerald-400 shadow-sm'
                        : 'bg-emerald-600 hover:bg-emerald-500 text-neutral-950 border-emerald-400/80'
                    }`}
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span>{isAr ? 'مسح بالكاميرا' : 'Scan Camera'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAddExtraBarcode()}
                    className="px-3.5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-neutral-950 text-xs font-bold flex items-center justify-center gap-1.5 shrink-0 transition-colors"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{isAr ? 'إضافة باركود' : 'Add Barcode'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAddExtraBarcode(generateBarcode())}
                    className="px-3 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-amber-300 border border-amber-500/30 text-xs font-semibold flex items-center justify-center gap-1.5 shrink-0 transition-colors"
                  >
                    <Barcode className="w-3.5 h-3.5" />
                    <span>{isAr ? '+ توليد باركود إضافي' : '+ Auto Barcode'}</span>
                  </button>
                </div>
              </div>

              {/* Hidden file input for mobile/desktop camera photo barcode capture */}
              <input
                ref={barcodePhotoInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                onChange={handleBarcodePhotoCapture}
                className="hidden"
              />

              {/* Embedded Live Camera Barcode Scanner Panel */}
              {isCameraScannerOpen && (
                <div
                  data-testid="product-camera-barcode-scanner"
                  className="mt-3 p-3.5 rounded-2xl bg-neutral-900/95 border border-emerald-500/40 space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
                        <Camera className="w-4 h-4" />
                      </span>
                      <div>
                        <span className="text-xs font-bold text-white block">
                          {isAr
                            ? 'ماسح الباركود بالكاميرا (إضافة مباشرة للمنتج)'
                            : 'Camera Barcode Scanner (Direct Product Assignment)'}
                        </span>
                        <span className="text-[11px] text-neutral-400">
                          {cameraScanTarget === 'primary'
                            ? isAr
                              ? 'الوضع الحالي: تعيين كباركود أساسي للمنتج'
                              : 'Mode: Set as Primary Product Barcode'
                            : isAr
                            ? 'الوضع الحالي: إضافة كباركود إضافي للمنتج'
                            : 'Mode: Add as Additional Product Barcode'}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setCameraScanTarget('additional')}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors ${
                          cameraScanTarget === 'additional'
                            ? 'bg-emerald-500 text-neutral-950 border-emerald-400'
                            : 'bg-neutral-950 text-neutral-300 border-neutral-800'
                        }`}
                      >
                        {isAr ? 'باركود إضافي' : 'Additional'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setCameraScanTarget('primary')}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-colors ${
                          cameraScanTarget === 'primary'
                            ? 'bg-amber-500 text-neutral-950 border-amber-400'
                            : 'bg-neutral-950 text-neutral-300 border-neutral-800'
                        }`}
                      >
                        {isAr ? 'باركود أساسي' : 'Primary'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsCameraScannerOpen(false)}
                        className="p-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300"
                        title={isAr ? 'إغلاق الكاميرا' : 'Close camera'}
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Camera Viewfinder with Laser Line */}
                  <div className="relative w-full h-36 bg-neutral-950 rounded-xl border-2 border-dashed border-emerald-500/50 overflow-hidden flex flex-col items-center justify-center">
                    {cameraActive ? (
                      <video
                        ref={cameraVideoRef}
                        className="absolute inset-0 w-full h-full object-cover opacity-75"
                        autoPlay
                        muted
                        playsInline
                      />
                    ) : (
                      <div className="flex flex-col items-center gap-1.5 text-neutral-400 z-10 px-4 text-center">
                        <Camera className="w-7 h-7 text-emerald-400 animate-pulse" />
                        <span className="text-[11px]">
                          {cameraError ||
                            (isAr
                              ? 'وجه الكاميرا نحو الباركود ليتم قراءته وإضافته تلقائياً'
                              : 'Point camera at barcode for automatic detection')}
                        </span>
                      </div>
                    )}

                    {/* Animated scanning beam */}
                    <div className="absolute inset-x-8 h-0.5 bg-emerald-400 shadow-[0_0_12px_#10b981] animate-bounce z-20" />
                    <div className="absolute inset-4 border border-emerald-500/30 rounded-lg pointer-events-none" />
                  </div>

                  {/* Action Buttons inside Camera Scanner */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        data-testid="camera-capture-barcode-btn"
                        onClick={() => handleApplyCameraScannedBarcode()}
                        className="px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-neutral-950 text-xs font-extrabold flex items-center gap-1.5 shadow-sm transition-colors"
                      >
                        <Camera className="w-3.5 h-3.5" />
                        <span>
                          {isAr
                            ? 'التقاط وإضافة الباركود بالكاميرا'
                            : 'Capture & Add Barcode'}
                        </span>
                      </button>

                      <button
                        type="button"
                        data-testid="camera-photo-barcode-btn"
                        onClick={() => barcodePhotoInputRef.current?.click()}
                        className="px-3 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-neutral-200 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                      >
                        <Upload className="w-3.5 h-3.5 text-amber-400" />
                        <span>
                          {isAr ? 'تصوير / اختيار صورة باركود' : 'Scan from Camera Photo'}
                        </span>
                      </button>
                    </div>

                    {lastScannedBarcodeFeedback && (
                      <span
                        data-testid="camera-scanned-feedback"
                        className="text-[11px] font-semibold text-emerald-400 flex items-center gap-1"
                      >
                        <Check className="w-3.5 h-3.5 shrink-0" />
                        <span>{lastScannedBarcodeFeedback}</span>
                      </span>
                    )}
                  </div>

                  {/* Scanner Diagnostics Panel inside Product Modal */}
                  <ScannerDiagnosticsPanel
                    isAr={isAr}
                    onTestBarcodeDecoded={(code: string) => {
                      handleApplyCameraScannedBarcode(code);
                    }}
                  />
                </div>
              )}

              {/* List of all attached barcodes */}
              <div className="flex flex-wrap gap-1.5 mt-2.5">
                {allModalBarcodes.map((code, idx) => {
                  const isPrimary = idx === 0;
                  return (
                    <div
                      key={code}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono border ${
                        isPrimary
                          ? 'bg-amber-500/15 border-amber-500/50 text-amber-300 font-bold'
                          : 'bg-neutral-900 border-neutral-700 text-neutral-200'
                      }`}
                    >
                      <Barcode className="w-3 h-3 shrink-0" />
                      <span>{code}</span>
                      <span
                        className={`text-[10px] px-1.5 py-0.2 rounded ${
                          isPrimary
                            ? 'bg-amber-500 text-neutral-950 font-bold'
                            : 'bg-neutral-800 text-neutral-400 cursor-pointer hover:text-white'
                        }`}
                        onClick={() => !isPrimary && handleSetPrimaryBarcode(code)}
                        title={
                          isPrimary
                            ? isAr
                              ? 'الباركود الأساسي'
                              : 'Primary Barcode'
                            : isAr
                            ? 'اضغط لجعله الباركود الأساسي'
                            : 'Click to set as primary'
                        }
                      >
                        {isPrimary ? (isAr ? 'أساسي' : 'Primary') : `#${idx + 1}`}
                      </span>
                      {allModalBarcodes.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveBarcode(code)}
                          className="text-neutral-400 hover:text-rose-400 p-0.5"
                          aria-label={`Remove barcode ${code}`}
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 3. Purchase (Cost) Price, Selling Price, Multi-Unit Packaging (Strip/Pack) & Dynamic Multi-Currency Linking */}
          <div
            data-testid="product-pricing-packaging-section"
            className="p-3.5 rounded-2xl bg-neutral-950/80 border border-neutral-800 space-y-3.5"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                <ArrowRightLeft className="w-4 h-4" />
                <span>
                  {isAr
                    ? 'تحديد سعر الشراء والبيع وتخصيص البيع بالقطعة / الشريط أو الباكو'
                    : 'Purchase & Selling Price + Multi-Unit (Strip / Pack) Customization'}
                </span>
              </span>

              {/* Currency selector inside modal - switching converts prices immediately */}
              <div className="flex items-center flex-wrap gap-1">
                <span className="text-[11px] text-neutral-400 mr-1">
                  {isAr ? 'عملة الإدخال:' : 'Currency:'}
                </span>
                {activeCurrencies.map((curr) => (
                  <button
                    key={curr.code}
                    type="button"
                    onClick={() => handleModalCurrencyChange(curr.code)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold border transition-all ${
                      formPriceCurrency === curr.code
                        ? 'bg-emerald-500 text-neutral-950 border-emerald-400 shadow-sm'
                        : 'bg-neutral-900 text-neutral-300 border-neutral-800 hover:border-neutral-700'
                    }`}
                  >
                    {curr.code}
                  </button>
                ))}
              </div>
            </div>

            {/* Multi-Unit Packaging Mode Switcher (e.g., Hair Dye: Pack = 8 Strips) */}
            <div className="p-3 rounded-2xl bg-neutral-900/90 border border-amber-500/30 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="w-7 h-7 rounded-xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0">
                    <Layers className="w-4 h-4" />
                  </span>
                  <div>
                    <span className="text-xs font-bold text-white block">
                      {isAr
                        ? 'نظام البيع بالقطعة / الشريط أو الباكو (مثال: الصبغة الباكو = 8 أشرطة)'
                        : 'Multi-Unit Packaging (Sell by Piece/Strip or Full Pack)'}
                    </span>
                    <span className="text-[11px] text-neutral-400">
                      {isAr
                        ? 'خصّص اسم الوحدة الصغرى (شريط/قطعة) والعبوة الكبرى (باكو/كرتون) وعدد الوحدات داخل الباكو'
                        : 'Customize sub-unit (Strip/Piece), pack name (Pack/Box), and units per pack'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    data-testid="disable-packaging-mode-btn"
                    onClick={() => {
                      playTactileClick(settings.soundEnabled);
                      setFormEnablePackaging(false);
                    }}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                      !formEnablePackaging
                        ? 'bg-white text-neutral-950 border-white shadow-sm'
                        : 'bg-neutral-950 text-neutral-400 border-neutral-800 hover:text-white'
                    }`}
                  >
                    {isAr ? 'وحدة واحدة (عادي)' : 'Single Unit'}
                  </button>
                  <button
                    type="button"
                    data-testid="enable-packaging-mode-btn"
                    onClick={() => {
                      playTactileClick(settings.soundEnabled);
                      setFormEnablePackaging(true);
                      const uCount = Math.max(2, Math.floor(parseNormalizedNumber(formUnitsPerPack, 8)));
                      setFormUnitsPerPack(String(uCount));
                      setFormPackCostPrice(
                        String(roundCurrencyValue(numericCostPrice * uCount, formPriceCurrency))
                      );
                      setFormPackSellingPrice(
                        String(roundCurrencyValue(numericSellingPrice * uCount, formPriceCurrency))
                      );
                    }}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all flex items-center gap-1.5 ${
                      formEnablePackaging
                        ? 'bg-amber-500 text-neutral-950 border-amber-400 shadow-sm'
                        : 'bg-neutral-950 text-amber-300 border-amber-500/40 hover:bg-amber-500/10'
                    }`}
                  >
                    <Package className="w-3.5 h-3.5" />
                    <span>{isAr ? 'تخصيص قطعة / شريط + باكو' : 'Strip / Piece + Pack'}</span>
                  </button>
                </div>
              </div>

              {/* Quick Presets Bar */}
              <div className="flex items-center flex-wrap gap-1.5 pt-1">
                <span className="text-[11px] text-neutral-400 font-medium">
                  {isAr ? 'قوالب سريعة:' : 'Quick Presets:'}
                </span>
                <button
                  type="button"
                  data-testid="preset-dye-8-strips-btn"
                  onClick={() =>
                    applyPackagingPreset({
                      unitName: 'Strip',
                      unitNameAr: 'شريط',
                      packName: 'Pack',
                      packNameAr: 'باكو',
                      unitsPerPack: 8,
                    })
                  }
                  className="px-2.5 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 text-[11px] font-bold transition-colors"
                >
                  {isAr ? (
                    <>
                      صبغة: باكو = <span className="font-mono">8</span> شريط
                    </>
                  ) : (
                    <>
                      Hair Dye: Pack = <span className="font-mono">8</span> Strips
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    applyPackagingPreset({
                      unitName: 'Piece',
                      unitNameAr: 'قطعة',
                      packName: 'Dozen Pack',
                      packNameAr: 'باكو (دستة)',
                      unitsPerPack: 12,
                    })
                  }
                  className="px-2.5 py-1 rounded-lg bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 text-neutral-300 text-[11px] font-semibold transition-colors"
                >
                  {isAr ? (
                    <>
                      باكو = <span className="font-mono">12</span> قطعة
                    </>
                  ) : (
                    <>
                      Pack = <span className="font-mono">12</span> Pieces
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    applyPackagingPreset({
                      unitName: 'Unit',
                      unitNameAr: 'حبة',
                      packName: 'Carton',
                      packNameAr: 'كرتون',
                      unitsPerPack: 24,
                    })
                  }
                  className="px-2.5 py-1 rounded-lg bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 text-neutral-300 text-[11px] font-semibold transition-colors"
                >
                  {isAr ? (
                    <>
                      كرتون = <span className="font-mono">24</span> حبة
                    </>
                  ) : (
                    <>
                      Carton = <span className="font-mono">24</span> Units
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    applyPackagingPreset({
                      unitName: 'Box',
                      unitNameAr: 'علبة',
                      packName: 'Pack',
                      packNameAr: 'باكو',
                      unitsPerPack: 6,
                    })
                  }
                  className="px-2.5 py-1 rounded-lg bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 text-neutral-300 text-[11px] font-semibold transition-colors"
                >
                  {isAr ? (
                    <>
                      باكو = <span className="font-mono">6</span> علب
                    </>
                  ) : (
                    <>
                      Pack = <span className="font-mono">6</span> Boxes
                    </>
                  )}
                </button>
              </div>

              {/* Expanded Multi-Unit Customization Controls */}
              {formEnablePackaging && (
                <div
                  data-testid="packaging-customization-fields"
                  className="pt-3 border-t border-neutral-800 space-y-3"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <AppInput
                      label={isAr ? 'اسم الوحدة الصغرى (مثل: شريط / قطعة)' : 'Sub-Unit Name (e.g. Strip)'}
                      value={isAr ? formUnitNameAr : formUnitName}
                      onChange={(e) => {
                        if (isAr) {
                          setFormUnitNameAr(e.target.value);
                        } else {
                          setFormUnitName(e.target.value);
                        }
                      }}
                      placeholder={isAr ? 'شريط' : 'Strip'}
                    />

                    <AppInput
                      label={isAr ? 'اسم العبوة الكبرى (مثل: باكو / كرتون)' : 'Pack Name (e.g. Pack)'}
                      value={isAr ? formPackNameAr : formPackName}
                      onChange={(e) => {
                        if (isAr) {
                          setFormPackNameAr(e.target.value);
                        } else {
                          setFormPackName(e.target.value);
                        }
                      }}
                      placeholder={isAr ? 'باكو' : 'Pack'}
                    />

                    <AppInput
                      label={
                        isAr
                          ? `عدد الـ(${formUnitNameAr || 'شريط'}) داخل الـ(${formPackNameAr || 'باكو'})`
                          : `Units (${formUnitName || 'Strip'}) per ${formPackName || 'Pack'}`
                      }
                      type="text"
                      inputMode="numeric"
                      dir="ltr"
                      value={formUnitsPerPack}
                      onChange={(e) => handleUnitsPerPackChange(e.target.value)}
                    />
                  </div>

                  {/* Allowed Sale Mode & Default Sale Unit in Checkout */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-semibold text-neutral-300 block mb-1.5">
                        {isAr ? 'طريقة البيع المسموحة في الكاشير' : 'Allowed Sale Mode in POS'}
                      </label>
                      <div className="grid grid-cols-3 gap-1.5">
                        {(
                          [
                            {
                              id: 'both' as AllowedSaleUnitsMode,
                              labelAr: `الـ${formUnitNameAr || 'شريط'} والـ${formPackNameAr || 'باكو'} معاً`,
                              labelEn: 'Both Unit & Pack',
                            },
                            {
                              id: 'unit_only' as AllowedSaleUnitsMode,
                              labelAr: `بالـ${formUnitNameAr || 'شريط'} فقط`,
                              labelEn: `${formUnitName || 'Strip'} Only`,
                            },
                            {
                              id: 'pack_only' as AllowedSaleUnitsMode,
                              labelAr: `بالـ${formPackNameAr || 'باكو'} فقط`,
                              labelEn: `${formPackName || 'Pack'} Only`,
                            },
                          ]
                        ).map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => {
                              playTactileClick(settings.soundEnabled);
                              setFormAllowedSaleUnits(opt.id);
                              if (opt.id === 'pack_only') setFormDefaultSaleUnit('pack');
                              if (opt.id === 'unit_only') setFormDefaultSaleUnit('unit');
                            }}
                            className={`px-2 py-2 rounded-xl text-[11px] font-bold border transition-all ${
                              formAllowedSaleUnits === opt.id
                                ? 'bg-emerald-500 text-neutral-950 border-emerald-400'
                                : 'bg-neutral-950 text-neutral-300 border-neutral-800 hover:border-neutral-700'
                            }`}
                          >
                            {isAr ? opt.labelAr : opt.labelEn}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-neutral-300 block mb-1.5">
                        {isAr
                          ? 'الوحدة الافتراضية عند النقر السريع في المبيعات'
                          : 'Default Quick-Add Unit in POS'}
                      </label>
                      <div className="grid grid-cols-2 gap-1.5">
                        <button
                          type="button"
                          disabled={formAllowedSaleUnits === 'pack_only'}
                          onClick={() => {
                            playTactileClick(settings.soundEnabled);
                            setFormDefaultSaleUnit('unit');
                          }}
                          className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all ${
                            formDefaultSaleUnit === 'unit'
                              ? 'bg-amber-500 text-neutral-950 border-amber-400'
                              : 'bg-neutral-950 text-neutral-300 border-neutral-800 disabled:opacity-40'
                          }`}
                        >
                          {isAr
                            ? `البيع بالـ${formUnitNameAr || 'شريط'} (1)`
                            : `By ${formUnitName || 'Strip'} (1)`}
                        </button>
                        <button
                          type="button"
                          disabled={formAllowedSaleUnits === 'unit_only'}
                          onClick={() => {
                            playTactileClick(settings.soundEnabled);
                            setFormDefaultSaleUnit('pack');
                          }}
                          className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all ${
                            formDefaultSaleUnit === 'pack'
                              ? 'bg-amber-500 text-neutral-950 border-amber-400'
                              : 'bg-neutral-950 text-neutral-300 border-neutral-800 disabled:opacity-40'
                          }`}
                        >
                          {isAr ? (
                            <>
                              البيع بالـ{formPackNameAr || 'باكو'} (
                              <span className="font-mono">{numericUnitsPerPack}</span>{' '}
                              {formUnitNameAr || 'شريط'})
                            </>
                          ) : (
                            <>
                              By {formPackName || 'Pack'} (
                              <span className="font-mono">{numericUnitsPerPack}</span>)
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Category + Unit (Strip/Piece) Cost & Selling Prices */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <AppInput
                label={t.category}
                value={formCategory}
                onChange={(e) => setFormCategory(e.target.value)}
                required
              />

              <AppInput
                label={
                  formEnablePackaging
                    ? isAr
                      ? `سعر شراء الـ${formUnitNameAr || 'شريط'} الواحد (${formPriceCurrency})`
                      : `${formUnitName || 'Strip'} Cost (${formPriceCurrency})`
                    : isAr
                    ? `سعر الشراء / التكلفة (${formPriceCurrency})`
                    : `${t.costPrice} (${formPriceCurrency})`
                }
                type="text"
                inputMode="decimal"
                dir="ltr"
                value={formCostPrice}
                onChange={(e) => handleUnitCostChange(e.target.value)}
                required
              />

              <AppInput
                label={
                  formEnablePackaging
                    ? isAr
                      ? `سعر بيع الـ${formUnitNameAr || 'شريط'} الواحد (${formPriceCurrency})`
                      : `${formUnitName || 'Strip'} Selling Price (${formPriceCurrency})`
                    : isAr
                    ? `سعر البيع (${formPriceCurrency})`
                    : `${t.sellingPrice} (${formPriceCurrency})`
                }
                type="text"
                inputMode="decimal"
                dir="ltr"
                value={formSellingPrice}
                onChange={(e) => handleUnitSellingChange(e.target.value)}
                required
              />
            </div>

            {/* Pack Cost & Selling Prices when Multi-Unit Packaging is Enabled */}
            {formEnablePackaging && (
              <div className="p-3 rounded-2xl bg-amber-500/5 border border-amber-500/30 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-bold text-amber-300">
                    {isAr ? (
                      <>
                        تسعير الـ{formPackNameAr || 'باكو'} الكامل (يحتوي على{' '}
                        <span className="font-mono">{numericUnitsPerPack}</span>{' '}
                        {formUnitNameAr || 'شريط'})
                      </>
                    ) : (
                      <>
                        Full {formPackName || 'Pack'} Pricing (Contains{' '}
                        <span className="font-mono">{numericUnitsPerPack}</span>{' '}
                        {formUnitName || 'Strips'})
                      </>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      playTactileClick(settings.soundEnabled);
                      setFormPackCostPrice(
                        String(
                          roundCurrencyValue(numericCostPrice * numericUnitsPerPack, formPriceCurrency)
                        )
                      );
                      setFormPackSellingPrice(
                        String(
                          roundCurrencyValue(
                            numericSellingPrice * numericUnitsPerPack,
                            formPriceCurrency
                          )
                        )
                      );
                    }}
                    className="px-2.5 py-1 rounded-lg bg-neutral-900 hover:bg-neutral-800 border border-neutral-700 text-[11px] text-amber-300 font-semibold"
                  >
                    {isAr ? (
                      <>
                        حساب تلقائي (سعر الـ{formUnitNameAr || 'شريط'} ×{' '}
                        <span className="font-mono">{numericUnitsPerPack}</span>)
                      </>
                    ) : (
                      <>
                        Auto-Calc (Unit × <span className="font-mono">{numericUnitsPerPack}</span>)
                      </>
                    )}
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <AppInput
                    label={
                      isAr
                        ? `سعر شراء الـ${formPackNameAr || 'باكو'} الكامل (${formPriceCurrency})`
                        : `Full ${formPackName || 'Pack'} Cost (${formPriceCurrency})`
                    }
                    type="text"
                    inputMode="decimal"
                    dir="ltr"
                    value={formPackCostPrice}
                    onChange={(e) => handlePackCostChange(e.target.value)}
                  />

                  <AppInput
                    label={
                      isAr
                        ? `سعر بيع الـ${formPackNameAr || 'باكو'} الكامل (${formPriceCurrency})`
                        : `Full ${formPackName || 'Pack'} Selling Price (${formPriceCurrency})`
                    }
                    type="text"
                    inputMode="decimal"
                    dir="ltr"
                    value={formPackSellingPrice}
                    onChange={(e) => handlePackSellingChange(e.target.value)}
                  />
                </div>
              </div>
            )}

            {/* Profit Margin Indicator */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 rounded-xl bg-neutral-900/90 border border-neutral-800 text-xs">
              <div className="flex items-center flex-wrap gap-3">
                <div className="flex items-center gap-1.5">
                  <TrendingUp
                    className={`w-4 h-4 ${unitProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}
                  />
                  <span className="text-neutral-300 font-medium">
                    {formEnablePackaging
                      ? isAr
                        ? `ربح الـ${formUnitNameAr || 'شريط'}:`
                        : `${formUnitName || 'Strip'} Profit:`
                      : isAr
                      ? 'صافي الربح للوحدة:'
                      : 'Unit Profit:'}
                  </span>
                  <span
                    className={`font-mono font-bold tabular-nums ${
                      unitProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {formatCurrency(unitProfit, formPriceCurrency, settings.language)}
                  </span>
                </div>

                {formEnablePackaging && (
                  <div className="flex items-center gap-1.5 pl-2 border-l border-neutral-800">
                    <span className="text-amber-300 font-medium">
                      {isAr
                        ? `ربح الـ${formPackNameAr || 'باكو'}:`
                        : `${formPackName || 'Pack'} Profit:`}
                    </span>
                    <span
                      className={`font-mono font-bold tabular-nums ${
                        packProfit >= 0 ? 'text-amber-400' : 'text-rose-400'
                      }`}
                    >
                      {formatCurrency(packProfit, formPriceCurrency, settings.language)}
                    </span>
                  </div>
                )}
              </div>
              <div className="text-xs">
                <span className="text-neutral-400">
                  {isAr ? 'نسبة هامش الربح: ' : 'Profit Margin: '}
                </span>
                <span
                  className={`font-mono font-bold tabular-nums ${
                    profitMarginPercent >= 0 ? 'text-amber-400' : 'text-rose-400'
                  }`}
                >
                  {profitMarginPercent}%
                </span>
              </div>
            </div>

            {/* Live Multi-Currency Price Equivalents Table */}
            <div>
              <span className="text-[11px] font-semibold text-neutral-400 block mb-1.5">
                {isAr
                  ? 'الأسعار المعادلة تلقائياً بجميع العملات المفعلة (اضغط على أي عملة للتحويل إليها):'
                  : 'Automatic Equivalent Prices Across Active Currencies (Click any currency to switch):'}
              </span>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {activeCurrencies.map((curr) => {
                  const eqCost = convertCurrencyAmount(
                    numericCostPrice,
                    formPriceCurrency,
                    curr.code,
                    exchangeRates
                  );
                  const eqSell = convertCurrencyAmount(
                    numericSellingPrice,
                    formPriceCurrency,
                    curr.code,
                    exchangeRates
                  );
                  const eqPackSell = convertCurrencyAmount(
                    numericPackSellingPrice,
                    formPriceCurrency,
                    curr.code,
                    exchangeRates
                  );
                  const isCurrent = curr.code === formPriceCurrency;
                  const rateToSdg = curr.code === 'SDG' ? 1 : exchangeRates[curr.code] || 1;

                  return (
                    <button
                      key={curr.code}
                      type="button"
                      onClick={() => handleModalCurrencyChange(curr.code)}
                      className={`p-2.5 rounded-xl border text-left transition-all ${
                        isCurrent
                          ? 'bg-emerald-950/40 border-emerald-500/60'
                          : 'bg-neutral-900/70 border-neutral-800 hover:border-neutral-700'
                      }`}
                    >
                      <div className="flex items-center justify-between text-[11px] font-mono mb-1">
                        <span className="font-bold text-white flex items-center gap-1">
                          {curr.code}
                          {isCurrent && <Check className="w-3 h-3 text-emerald-400" />}
                        </span>
                        <span className="text-neutral-400 text-[10px]">
                          {curr.code === 'SDG' ? 'Base' : `1=${rateToSdg} SDG`}
                        </span>
                      </div>
                      <div className="text-[11px] text-neutral-400 flex justify-between">
                        <span>{isAr ? 'شراء:' : 'Cost:'}</span>
                        <span className="text-neutral-200 font-mono font-semibold tabular-nums">
                          {formatCurrency(eqCost, curr.code, settings.language)}
                        </span>
                      </div>
                      <div className="text-[11px] text-neutral-400 flex justify-between mt-0.5">
                        <span>
                          {formEnablePackaging
                            ? isAr
                              ? `بيع الـ${formUnitNameAr || 'شريط'}:`
                              : `${formUnitName || 'Strip'}:`
                            : isAr
                            ? 'بيع:'
                            : 'Sell:'}
                        </span>
                        <span className="text-emerald-400 font-mono font-bold tabular-nums">
                          {formatCurrency(eqSell, curr.code, settings.language)}
                        </span>
                      </div>
                      {formEnablePackaging && (
                        <div className="text-[11px] text-amber-300/90 flex justify-between mt-0.5 pt-0.5 border-t border-neutral-800/70">
                          <span>
                            {isAr
                              ? `بيع الـ${formPackNameAr || 'باكو'}:`
                              : `${formPackName || 'Pack'}:`}
                          </span>
                          <span className="text-amber-400 font-mono font-bold tabular-nums">
                            {formatCurrency(eqPackSell, curr.code, settings.language)}
                          </span>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 4. Product Image Upload / URL & Stock Quantities */}
          <div className="p-3.5 rounded-2xl bg-neutral-950/80 border border-neutral-800 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                <ImageIcon className="w-4 h-4" />
                <span>{isAr ? 'صورة المنتج والمخزون' : 'Product Image & Inventory Stock'}</span>
              </span>
            </div>

            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
              {/* Image Preview Thumbnail */}
              <div className="w-20 h-20 rounded-2xl bg-neutral-900 border border-neutral-700 flex items-center justify-center overflow-hidden shrink-0 relative">
                {formImage ? (
                  <>
                    <img
                      src={formImage}
                      alt="Product preview"
                      className="w-full h-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => setFormImage('')}
                      className="absolute top-1 right-1 w-5 h-5 rounded-full bg-rose-600 text-white flex items-center justify-center shadow"
                      title={isAr ? 'حذف الصورة' : 'Remove image'}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </>
                ) : (
                  <span className="text-3xl">{formEmoji || '📦'}</span>
                )}
              </div>

              <div className="flex-1 w-full space-y-2">
                <div className="flex flex-wrap gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleImageFileUpload}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-3.5 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-xs font-bold text-white flex items-center gap-1.5 transition-colors"
                  >
                    <Upload className="w-3.5 h-3.5 text-amber-400" />
                    <span>{isAr ? 'رفع صورة من الجهاز' : 'Upload Product Image'}</span>
                  </button>
                  {formImage && (
                    <button
                      type="button"
                      onClick={() => setFormImage('')}
                      className="px-3 py-2 rounded-xl bg-rose-950/60 hover:bg-rose-900/70 border border-rose-800/60 text-xs font-semibold text-rose-300 flex items-center gap-1"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>{isAr ? 'إزالة الصورة' : 'Remove Image'}</span>
                    </button>
                  )}
                </div>

                <input
                  type="text"
                  dir="ltr"
                  value={formImage}
                  onChange={(e) => setFormImage(e.target.value)}
                  placeholder={
                    isAr
                      ? 'أو الصق رابط صورة المنتج مباشر (https://...)'
                      : 'Or paste direct product image URL (https://...)'
                  }
                  className="w-full min-h-[38px] px-3 rounded-xl bg-neutral-900 border border-neutral-800 text-xs font-mono text-neutral-200 focus:outline-none focus:border-amber-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-neutral-800/80">
              <div>
                <AppInput
                  label={
                    formEnablePackaging
                      ? isAr
                        ? `إجمالي المخزون بالـ(${formUnitNameAr || 'شريط'})`
                        : `Total Stock in (${formUnitName || 'Strip'})`
                      : t.stockQty
                  }
                  type="text"
                  inputMode="numeric"
                  dir="ltr"
                  value={formStock}
                  onChange={(e) => setFormStock(normalizeNumberInput(e.target.value))}
                  required
                />
                {formEnablePackaging && numericUnitsPerPack > 1 && (
                  <div className="mt-1.5 flex items-center justify-between flex-wrap gap-1">
                    <span className="text-[11px] text-amber-300 font-semibold">
                      {isAr ? (
                        <>
                          يعادل:{' '}
                          <span className="font-mono">
                            {Math.floor(parseNormalizedNumber(formStock, 0) / numericUnitsPerPack)}
                          </span>{' '}
                          {formPackNameAr || 'باكو'}
                          {parseNormalizedNumber(formStock, 0) % numericUnitsPerPack > 0 && (
                            <>
                              {' '}
                              و{' '}
                              <span className="font-mono">
                                {parseNormalizedNumber(formStock, 0) % numericUnitsPerPack}
                              </span>{' '}
                              {formUnitNameAr || 'شريط'}
                            </>
                          )}
                        </>
                      ) : (
                        <>
                          Equals:{' '}
                          <span className="font-mono">
                            {Math.floor(parseNormalizedNumber(formStock, 0) / numericUnitsPerPack)}
                          </span>{' '}
                          {formPackName || 'Pack'}(s)
                        </>
                      )}
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          playTactileClick(settings.soundEnabled);
                          const curr = Math.max(0, Math.floor(parseNormalizedNumber(formStock, 0)));
                          setFormStock(String(curr + numericUnitsPerPack));
                        }}
                        className="px-2 py-0.5 rounded bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 text-[10px] font-bold"
                      >
                        +<span className="font-mono">1</span>{' '}
                        {isAr ? formPackNameAr || 'باكو' : formPackName || 'Pack'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          playTactileClick(settings.soundEnabled);
                          const curr = Math.max(0, Math.floor(parseNormalizedNumber(formStock, 0)));
                          setFormStock(String(curr + numericUnitsPerPack * 5));
                        }}
                        className="px-2 py-0.5 rounded bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 text-neutral-300 text-[10px] font-bold"
                      >
                        +<span className="font-mono">5</span>{' '}
                        {isAr ? formPackNameAr || 'باكو' : formPackName || 'Pack'}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <AppInput
                label={t.minStockAlert}
                type="text"
                inputMode="numeric"
                dir="ltr"
                value={formMinStockAlert}
                onChange={(e) => setFormMinStockAlert(normalizeNumberInput(e.target.value))}
                required
              />

              <div>
                <label className="text-xs font-semibold text-neutral-300 block mb-1.5">
                  {isAr ? 'أيقونة بديلة (Emoji)' : 'Fallback Icon Emoji'}
                </label>
                <input
                  type="text"
                  value={formEmoji}
                  onChange={(e) => setFormEmoji(e.target.value)}
                  maxLength={4}
                  className="w-full min-h-[46px] px-3 text-center text-xl rounded-xl bg-neutral-900 border border-neutral-800"
                />
              </div>
            </div>
          </div>

          {/* 5. Product Creation Date, Price History & Modification Audit Log (سجل الأسعار القديمة والتعديلات على المنتج) */}
          {editingProduct && (
            <div
              data-testid="product-audit-history-section"
              className="p-3.5 rounded-2xl bg-neutral-950/90 border border-neutral-800 space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-neutral-800">
                <div className="flex items-center gap-2">
                  <History className="w-4 h-4 text-amber-400" />
                  <span className="text-xs font-bold text-white">
                    {isAr
                      ? 'تاريخ الإضافة وسجل الأسعار القديمة والتعديلات على المنتج'
                      : 'Creation Date, Old Price History & Product Modification Log'}
                  </span>
                </div>
                <div className="flex items-center flex-wrap gap-2 text-[11px] text-neutral-400">
                  <span className="px-2 py-0.5 rounded-lg bg-neutral-900 border border-neutral-800 font-mono">
                    {isAr ? 'تاريخ الإضافة: ' : 'Added: '}
                    {new Date(
                      editingProduct.createdAt ||
                        editingProduct.customFields?.createdAt ||
                        editingProduct.updatedAt
                    ).toLocaleString(isAr ? 'ar-SA' : 'en-US', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                  <span className="px-2 py-0.5 rounded-lg bg-neutral-900 border border-neutral-800 font-mono">
                    {isAr ? 'آخر تعديل: ' : 'Updated: '}
                    {new Date(editingProduct.updatedAt).toLocaleString(isAr ? 'ar-SA' : 'en-US', {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              </div>

              {/* Price History Sub-panel */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-bold text-amber-300 block">
                  {isAr ? 'سجل تغييرات السعر (السعر القديم ← السعر الجديد):' : 'Price Change History (Old Price → New Price):'}
                </span>
                {(editingProduct.priceHistory || editingProduct.customFields?.priceHistory || []).length > 0 ? (
                  <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                    {(editingProduct.priceHistory || editingProduct.customFields?.priceHistory || []).map(
                      (ph: any) => (
                        <div
                          key={ph.id}
                          className="p-2 rounded-xl bg-neutral-900/80 border border-neutral-800/80 flex flex-wrap items-center justify-between gap-2 text-[11px]"
                        >
                          <div className="flex items-center flex-wrap gap-2">
                            <span className="text-neutral-400">
                              {isAr ? 'البيع:' : 'Sell:'}{' '}
                              <span className="line-through text-rose-400 font-mono">
                                {ph.previousSellingPrice}
                              </span>{' '}
                              →{' '}
                              <span className="text-emerald-400 font-bold font-mono">
                                {ph.newSellingPrice} {ph.currency}
                              </span>
                            </span>
                            <span className="text-neutral-600">·</span>
                            <span className="text-neutral-400">
                              {isAr ? 'التكلفة:' : 'Cost:'}{' '}
                              <span className="font-mono text-neutral-300">
                                {ph.previousCostPrice} → {ph.newCostPrice} {ph.currency}
                              </span>
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-[10px] text-neutral-400">
                            {ph.changedBy && (
                              <span className="flex items-center gap-1 text-sky-300">
                                <UserCheck className="w-3 h-3" />
                                <span>{ph.changedBy}</span>
                              </span>
                            )}
                            <span className="font-mono">
                              {new Date(ph.timestamp).toLocaleString(isAr ? 'ar-SA' : 'en-US', {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          </div>
                        </div>
                      )
                    )}
                  </div>
                ) : (
                  <p className="text-[11px] text-neutral-500">
                    {isAr ? 'لم يتم تغيير سعر هذا المنتج منذ إضافته.' : 'No price changes recorded since product creation.'}
                  </p>
                )}
              </div>

              {/* Modification Audit Log Sub-panel */}
              <div className="space-y-1.5 pt-2 border-t border-neutral-800/70">
                <span className="text-[11px] font-bold text-sky-300 block">
                  {isAr ? 'سجل التعديلات التي تمت على المنتج:' : 'Product Modification Audit Trail:'}
                </span>
                {(editingProduct.modificationHistory || editingProduct.customFields?.modificationHistory || [])
                  .length > 0 ? (
                  <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                    {(
                      editingProduct.modificationHistory ||
                      editingProduct.customFields?.modificationHistory ||
                      []
                    ).map((mod: any) => (
                      <div
                        key={mod.id}
                        className="p-2 rounded-xl bg-neutral-900/60 border border-neutral-800/70 flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 text-[11px]"
                      >
                        <div className="text-neutral-200 font-medium">
                          {isAr ? mod.summaryAr || mod.summaryEn : mod.summaryEn || mod.summaryAr}
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-neutral-400 shrink-0">
                          {mod.changedBy && (
                            <span className="text-amber-300 font-semibold">{mod.changedBy}</span>
                          )}
                          <span className="font-mono">
                            {new Date(mod.timestamp).toLocaleString(isAr ? 'ar-SA' : 'en-US', {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-neutral-500">
                    {isAr ? 'لا توجد تعديلات مسجلة بعد.' : 'No modifications recorded yet.'}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Action Row */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-neutral-800">
            {editingProduct ? (
              <HoldToConfirm
                onConfirm={() => handleDelete(editingProduct.id)}
                label={t.deleteProduct}
                confirmingLabel="Deleting product..."
                variant="danger"
                className="w-full sm:w-auto"
              />
            ) : (
              <div />
            )}

            <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
              <TactileButton variant="ghost" type="button" onClick={() => setIsModalOpen(false)}>
                {t.cancel}
              </TactileButton>

              <TactileButton variant="amber" type="submit">
                {t.saveProduct}
              </TactileButton>
            </div>
          </div>
        </form>
      </AppModal>
    </div>
  );
};
