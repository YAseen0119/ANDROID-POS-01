/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateStandardBarcodeRGBA,
  decodeBarcodeFromRGBA,
  getScannerDiagnostics,
  recordScannerStage,
  resetScannerDiagnosticsLogs,
  ENABLED_BARCODE_FORMAT_LABELS,
} from './barcode-scanner-engine';

test('Phase 3 & 7: Decodes real EAN-13 barcode image accurately', () => {
  const code = '4006381333931';
  const { data, width, height } = generateStandardBarcodeRGBA(code, 'EAN_13');
  const outcome = decodeBarcodeFromRGBA(data, width, height);
  assert.ok(outcome, 'Expected EAN-13 barcode to be decoded');
  assert.equal(outcome.rawValue, code);
  assert.equal(typeof outcome.rawValue, 'string');
});

test('Phase 3 & 7: Decodes real EAN-8 barcode image accurately', () => {
  const code = '96385074';
  const { data, width, height } = generateStandardBarcodeRGBA(code, 'EAN_8');
  const outcome = decodeBarcodeFromRGBA(data, width, height);
  assert.ok(outcome, 'Expected EAN-8 barcode to be decoded');
  assert.equal(outcome.rawValue, code);
});

test('Phase 3, 5 & 7: Decodes real UPC-A barcode with leading zero preserved as String', () => {
  const upcWithLeadingZero = '012345678905';
  const { data, width, height } = generateStandardBarcodeRGBA(upcWithLeadingZero, 'UPC_A');
  const outcome = decodeBarcodeFromRGBA(data, width, height);
  assert.ok(outcome, 'Expected UPC-A barcode to be decoded');
  assert.equal(outcome.rawValue, upcWithLeadingZero);
  assert.ok(outcome.rawValue.startsWith('0'), 'Leading zero must be preserved as a String');
});

test('Phase 3, 5 & 7: Decodes real CODE-128 barcodes including alphanumeric SKUs and leading zeros', () => {
  const skuCode = 'COS-008-PACK';
  const { data: d1, width: w1, height: h1 } = generateStandardBarcodeRGBA(skuCode, 'CODE_128');
  const out1 = decodeBarcodeFromRGBA(d1, w1, h1);
  assert.ok(out1, 'Expected alphanumeric CODE-128 to be decoded');
  assert.equal(out1.rawValue, skuCode);

  const leadingZerosCode = '000200801008';
  const { data: d2, width: w2, height: h2 } = generateStandardBarcodeRGBA(leadingZerosCode, 'CODE_128');
  const out2 = decodeBarcodeFromRGBA(d2, w2, h2);
  assert.ok(out2, 'Expected leading-zero CODE-128 to be decoded');
  assert.equal(out2.rawValue, leadingZerosCode);
});

test('Phase 3 & 7: Decodes real QR_CODE image accurately', () => {
  const qrValue = '200801008018';
  const { data, width, height } = generateStandardBarcodeRGBA(qrValue, 'QR_CODE');
  const outcome = decodeBarcodeFromRGBA(data, width, height);
  assert.ok(outcome, 'Expected QR_CODE to be decoded');
  assert.equal(outcome.rawValue, qrValue);
});

test('Phase 6: Diagnostics state tracks enabled formats and stage logs accurately', () => {
  resetScannerDiagnosticsLogs();
  recordScannerStage('Camera Initialized', 'Rear camera requested');
  recordScannerStage('Video Stream Started', '1280x720 @ 30fps');
  recordScannerStage('Barcode Detected', 'EAN_13');
  recordScannerStage('Raw Value Received', '4006381333931');
  recordScannerStage('Product Search Started', 'Searching catalog for 4006381333931');
  recordScannerStage('Product Found', 'Natural Hair Dye');

  const diag = getScannerDiagnostics();
  assert.equal(diag.enabledFormats.length, 11);
  assert.deepEqual(diag.enabledFormats, ENABLED_BARCODE_FORMAT_LABELS);
  assert.ok(diag.logs.some((l) => l.stage === 'Camera Initialized'));
  assert.ok(diag.logs.some((l) => l.stage === 'Raw Value Received'));
  assert.ok(diag.logs.some((l) => l.stage === 'Product Found'));
});
