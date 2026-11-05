/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
import {
  ScannerDiagnosticsState,
  getScannerDiagnostics,
  subscribeScannerDiagnostics,
  resetScannerDiagnosticsLogs,
  createStandardBarcodeTestFile,
  decodeBarcodeFromImageFileWithDiagnostics,
} from '../../lib/barcode-scanner-engine';
import { Activity, Terminal, Trash2, CheckCircle2, AlertTriangle, FlaskConical } from 'lucide-react';

interface ScannerDiagnosticsPanelProps {
  isAr: boolean;
  onTestBarcodeDecoded?: (rawValue: string, format: string) => void;
}

const TEST_BARCODE_SAMPLES: {
  label: string;
  format: 'EAN_13' | 'EAN_8' | 'UPC_A' | 'CODE_128' | 'QR_CODE';
  value: string;
}[] = [
  { label: 'EAN-13 (موجود)', format: 'EAN_13', value: '2001010010118' },
  { label: 'EAN-8', format: 'EAN_8', value: '96385074' },
  { label: 'UPC-A (بصفر بادئ)', format: 'UPC_A', value: '012345678905' },
  { label: 'CODE-128 (صبغة)', format: 'CODE_128', value: '200801008018' },
  { label: 'QR Code (جديد)', format: 'QR_CODE', value: '009988776655' },
];

export const ScannerDiagnosticsPanel: React.FC<ScannerDiagnosticsPanelProps> = ({
  isAr,
  onTestBarcodeDecoded,
}) => {
  const [diag, setDiag] = useState<ScannerDiagnosticsState>(() => getScannerDiagnostics());
  const [isExpanded, setIsExpanded] = useState(false);
  const [testingFormat, setTestingFormat] = useState<string | null>(null);

  useEffect(() => {
    return subscribeScannerDiagnostics((next) => setDiag(next));
  }, []);

  const handleRunImageSelfTest = async (sample: (typeof TEST_BARCODE_SAMPLES)[number]) => {
    setTestingFormat(sample.label);
    try {
      const file = await createStandardBarcodeTestFile(sample.value, sample.format);
      if (!file) return;
      const outcome = await decodeBarcodeFromImageFileWithDiagnostics(file);
      if (outcome && outcome.rawValue && onTestBarcodeDecoded) {
        onTestBarcodeDecoded(outcome.rawValue, outcome.format);
      }
    } finally {
      setTestingFormat(null);
    }
  };

  return (
    <div
      data-testid="scanner-diagnostics-panel"
      className="rounded-2xl bg-neutral-950/90 border border-neutral-800/90 p-3 space-y-2.5 text-xs"
    >
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          data-testid="toggle-scanner-diagnostics-btn"
          onClick={() => setIsExpanded((prev) => !prev)}
          className="flex items-center gap-2 text-left font-bold text-amber-300 hover:text-amber-200"
        >
          <Activity className="w-4 h-4 text-amber-400 shrink-0" />
          <span>
            {isAr
              ? 'لوحة تشخيص وفحص محرك الباركود (Scanner Diagnostics)'
              : 'Barcode Scanner Diagnostics & Engine Inspector'}
          </span>
          <span className="px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-300 font-mono text-[10px]">
            {diag.environment} • {diag.cameraStatus}
          </span>
        </button>

        <div className="flex items-center gap-1.5">
          {diag.logs.length > 0 && (
            <button
              type="button"
              onClick={() => resetScannerDiagnosticsLogs()}
              className="p-1 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-neutral-400 hover:text-white"
              title={isAr ? 'مسح السجل' : 'Clear logs'}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsExpanded((prev) => !prev)}
            className="px-2 py-0.5 rounded-lg bg-neutral-900 border border-neutral-800 text-[10px] font-bold text-neutral-300"
          >
            {isExpanded ? (isAr ? 'إخفاء' : 'Hide') : isAr ? 'عرض التفاصيل' : 'Details'}
          </button>
        </div>
      </div>

      {/* Compact Always-Visible Summary Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
        <div className="p-2 rounded-xl bg-neutral-900/80 border border-neutral-800/80">
          <span className="text-neutral-400 block text-[10px]">
            {isAr ? 'البيئة والمحرك' : 'Environment & Engine'}
          </span>
          <span className="font-mono font-bold text-white truncate block" title={diag.engineName}>
            {diag.environment} ({diag.platform})
          </span>
        </div>
        <div className="p-2 rounded-xl bg-neutral-900/80 border border-neutral-800/80">
          <span className="text-neutral-400 block text-[10px]">
            {isAr ? 'حالة الكاميرا' : 'Camera Status'}
          </span>
          <span
            className={`font-mono font-bold block ${
              diag.cameraStatus === 'Streaming' || diag.cameraStatus === 'Native ML Kit Active'
                ? 'text-emerald-400'
                : diag.cameraStatus === 'Error'
                ? 'text-rose-400'
                : 'text-amber-300'
            }`}
          >
            {diag.cameraStatus}
          </span>
        </div>
        <div className="p-2 rounded-xl bg-neutral-900/80 border border-neutral-800/80">
          <span className="text-neutral-400 block text-[10px]">
            {isAr ? 'الإطارات المعالجة' : 'Frames Processed'}
          </span>
          <span className="font-mono font-bold text-sky-300 block">
            {diag.framesProcessed}{' '}
            <span className="text-[10px] text-neutral-500">
              (تخطي مكرر: {diag.skippedDuplicateFrames})
            </span>
          </span>
        </div>
        <div className="p-2 rounded-xl bg-neutral-900/80 border border-neutral-800/80">
          <span className="text-neutral-400 block text-[10px]">
            {isAr ? 'آخر باركود مكتشف' : 'Last Detected Value'}
          </span>
          <span
            data-testid="diag-last-detected-value"
            className="font-mono font-bold text-emerald-400 truncate block"
          >
            {diag.lastDetectedValue
              ? `${diag.lastDetectedValue} (${diag.lastDetectedFormat})`
              : '—'}
          </span>
        </div>
      </div>

      {isExpanded && (
        <div className="space-y-2.5 pt-2 border-t border-neutral-800/80">
          {/* Engine Name & Formats */}
          <div className="space-y-1">
            <div className="flex flex-wrap items-center justify-between gap-1 text-[11px]">
              <span className="text-neutral-400">{isAr ? 'محرك التعرف النشط:' : 'Active Engine:'}</span>
              <span className="font-mono text-amber-300 font-semibold">{diag.engineName}</span>
            </div>
            <div className="flex flex-wrap gap-1 pt-1">
              {diag.enabledFormats.map((fmt) => (
                <span
                  key={fmt}
                  className="px-1.5 py-0.5 rounded bg-neutral-900 border border-neutral-800 text-[10px] font-mono text-neutral-300"
                >
                  {fmt}
                </span>
              ))}
            </div>
          </div>

          {/* Last Error if any */}
          {diag.lastError && (
            <div className="p-2 rounded-xl bg-rose-950/40 border border-rose-500/40 text-rose-300 text-[11px] flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0" />
              <span className="font-mono break-all">{diag.lastError}</span>
            </div>
          )}

          {/* Phase 7: Saved Barcode Image Self-Test Bar */}
          <div className="p-2.5 rounded-xl bg-neutral-900/90 border border-neutral-800 space-y-2">
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-300">
              <FlaskConical className="w-3.5 h-3.5 text-emerald-400" />
              <span>
                {isAr
                  ? 'اختبار محرك القراءة بصور باركود حقيقية (بدون كاميرا):'
                  : 'Test Barcode Engine with Real Generated Barcode Images:'}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {TEST_BARCODE_SAMPLES.map((sample) => (
                <button
                  key={sample.label}
                  type="button"
                  data-testid={`self-test-${sample.format}`}
                  disabled={Boolean(testingFormat)}
                  onClick={() => handleRunImageSelfTest(sample)}
                  className="px-2 py-1 rounded-lg bg-neutral-800 hover:bg-emerald-500/20 hover:border-emerald-500/40 border border-neutral-700 text-[10px] font-mono font-bold text-neutral-200 hover:text-emerald-300 transition-colors"
                >
                  {testingFormat === sample.label ? '...' : `${sample.label}: ${sample.value}`}
                </button>
              ))}
            </div>
          </div>

          {/* Stage Logs */}
          <div className="space-y-1">
            <span className="text-[10px] font-bold text-neutral-400 flex items-center gap-1">
              <Terminal className="w-3 h-3 text-amber-400" />
              <span>
                {isAr
                  ? 'سجل مراحل الكاميرا والتعرف والبحث (Live Stage Logs):'
                  : 'Live Stage Logs:'}
              </span>
            </span>
            <div className="max-h-36 overflow-y-auto rounded-xl bg-black/60 border border-neutral-800 p-2 font-mono text-[10px] space-y-1">
              {diag.logs.length === 0 ? (
                <div className="text-neutral-500">
                  {isAr ? 'لا توجد سجلات بعد — افتح الكاميرا أو اختبر صورة باركود.' : 'No logs yet.'}
                </div>
              ) : (
                diag.logs.map((entry) => (
                  <div key={entry.id} className="flex items-start gap-1.5 leading-relaxed">
                    <span className="text-neutral-500 shrink-0">[{entry.timestamp}]</span>
                    <span
                      className={`font-bold shrink-0 ${
                        entry.stage === 'Barcode Detected' ||
                        entry.stage === 'Raw Value Received' ||
                        entry.stage === 'Product Found'
                          ? 'text-emerald-400'
                          : entry.stage === 'Scanner Error' || entry.stage === 'Product Not Found'
                          ? 'text-rose-400'
                          : 'text-amber-300'
                      }`}
                    >
                      [{entry.stage}]
                    </span>
                    <span className="text-neutral-300 break-all">{entry.detail}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
