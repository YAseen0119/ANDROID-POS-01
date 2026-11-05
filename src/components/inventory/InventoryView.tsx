/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { usePOS } from '../../context/POSContext';
import { getTranslation } from '../../lib/translations';
import { formatCurrency, getProductPricesInCurrency } from '../../lib/pos-calculations';
import { StockMovementType, Product } from '../../lib/types';
import { normalizeNumberInput, parseNormalizedNumber } from '../../lib/number-utils';
import { AppCard } from '../ui/AppCard';
import { AppInput } from '../ui/AppInput';
import { TactileButton } from '../ui/TactileButton';
import { AppModal } from '../ui/AppModal';
import { GoodsReceiptModal } from './GoodsReceiptModal';
import {
  ArrowUpRight,
  ArrowDownLeft,
  AlertTriangle,
  PlusCircle,
  History,
  TrendingUp,
  DollarSign,
  PackageCheck,
  FileText,
  Truck,
} from 'lucide-react';

export const InventoryView: React.FC = () => {
  const { products, stockMovements, recordStockAdjustment, settings, exchangeRates } = usePOS();
  const t = getTranslation(settings.language);
  const isAr = settings.language === 'ar';

  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [isAdjustModalOpen, setIsAdjustModalOpen] = useState(false);
  const [isGoodsReceiptOpen, setIsGoodsReceiptOpen] = useState(false);
  const [goodsReceiptProduct, setGoodsReceiptProduct] = useState<Product | null>(null);
  const [movementType, setMovementType] = useState<StockMovementType>('restock');
  const [amountInput, setAmountInput] = useState('10');
  const [reasonInput, setReasonInput] = useState('');

  // Valuation computations converted into active store currency
  const valuation = useMemo(() => {
    let totalCost = 0;
    let potentialRev = 0;
    let lowStockCount = 0;

    products.forEach((p) => {
      const converted = getProductPricesInCurrency(p, settings.currency, exchangeRates);
      totalCost += converted.costPrice * p.stock;
      potentialRev += converted.sellingPrice * p.stock;
      if (p.stock <= p.minStockAlert) lowStockCount += 1;
    });

    return {
      cost: Math.round(totalCost * 100) / 100,
      revenue: Math.round(potentialRev * 100) / 100,
      lowStockCount,
    };
  }, [products, settings.currency, exchangeRates]);

  const openAdjustment = (product: Product) => {
    setSelectedProduct(product);
    setMovementType('restock');
    setAmountInput('10');
    setReasonInput('Weekly supplier restock batch');
    setIsAdjustModalOpen(true);
  };

  const openGoodsReceipt = (product?: Product) => {
    setGoodsReceiptProduct(product || null);
    setIsGoodsReceiptOpen(true);
  };

  const handleApplyAdjustment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProduct) return;
    const amount = parseNormalizedNumber(amountInput, 0);
    if (amount <= 0 && movementType !== 'audit') return;

    recordStockAdjustment(selectedProduct.id, movementType, amount, reasonInput);
    setIsAdjustModalOpen(false);
  };

  return (
    <div className="flex-1 max-w-7xl mx-auto w-full p-4 md:p-6 space-y-6 pb-24">
      {/* Header & KPI Summary */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
            {t.inventoryManagement}
          </h2>
          <span className="text-xs text-neutral-400">
            {isAr
              ? 'إدارة المخزون، استلام فواتير المشتريات والبضائع، وسجل الحركات المباشر'
              : 'Real-time multi-SKU inventory tracking, goods receipt & audit logs'}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <TactileButton
            variant="emerald"
            size="sm"
            data-testid="inventory-open-goods-receipt-btn"
            onClick={() => openGoodsReceipt()}
            leftIcon={<PackageCheck className="w-4 h-4" />}
          >
            {t.receiveSupplierGoodsBtn}
          </TactileButton>
        </div>
      </div>

      {/* Valuation Metrics Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4">
        <AppCard>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-neutral-400">{t.totalAssetValue}</span>
            <DollarSign className="w-4 h-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-white tabular-nums">
            {formatCurrency(valuation.cost, settings.currency, settings.language)}
          </div>
          <span className="text-[11px] text-neutral-500">
            {isAr ? 'بناءً على سعر التكلفة للوحدة' : 'Based on unit cost price'}
          </span>
        </AppCard>

        <AppCard>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-neutral-400">{t.potentialRevenue}</span>
            <TrendingUp className="w-4 h-4 text-amber-400" />
          </div>
          <div className="text-2xl font-bold font-mono text-amber-400 tabular-nums">
            {formatCurrency(valuation.revenue, settings.currency, settings.language)}
          </div>
          <span className="text-[11px] text-neutral-500">
            {isAr ? 'الإيراد التقديري عند بيع المخزون' : 'Estimated retail liquidation'}
          </span>
        </AppCard>

        <AppCard className={valuation.lowStockCount > 0 ? 'border-amber-500/50 bg-amber-950/20' : ''}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-neutral-400">{t.lowStockAlerts}</span>
            <AlertTriangle className="w-4 h-4 text-rose-400" />
          </div>
          <div className="text-2xl font-bold text-white">
            <span className="font-mono tabular-nums">{valuation.lowStockCount}</span>{' '}
            <span className="text-sm font-normal text-neutral-400">
              {isAr ? 'أصناف' : 'items'}
            </span>
          </div>
          <span className="text-[11px] text-neutral-500">
            {isAr ? 'أصناف وصلت لحد التنبيه' : 'Threshold alert triggers'}
          </span>
        </AppCard>
      </div>

      {/* Stock Levels Table / Grid */}
      <AppCard>
        <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
          <div className="flex items-center gap-2">
            <PackageCheck className="w-4 h-4 text-amber-500" />
            <h3 className="font-bold text-sm text-white">
              {isAr ? 'مستويات المخزون حسب المنتج' : 'Stock Levels by Product'}
            </h3>
          </div>
          <span className="text-xs text-neutral-500">
            <span className="font-mono tabular-nums">{products.length}</span>{' '}
            {isAr ? 'صنف مسجل' : 'catalog items'}
          </span>
        </div>

        <div className="divide-y divide-neutral-800/80 mt-1">
          {products.map((p) => {
            const isLow = p.stock <= p.minStockAlert;
            const isOut = p.stock <= 0;
            const productImg = p.image || p.imageUrl || p.customFields?.image;
            const converted = getProductPricesInCurrency(p, settings.currency, exchangeRates);

            return (
              <div
                key={p.id}
                className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
              >
                <div className="flex items-center gap-3">
                  {productImg ? (
                    <div className="w-10 h-10 rounded-xl overflow-hidden bg-neutral-800 border border-neutral-700/60 shrink-0">
                      <img src={productImg} alt={p.name} className="w-full h-full object-cover" />
                    </div>
                  ) : (
                    <span className="text-xl p-2 rounded-xl bg-neutral-800 border border-neutral-700/60">
                      {p.emoji || '📦'}
                    </span>
                  )}
                  <div>
                    <div className="font-bold text-sm text-white">
                      {isAr && p.nameAr ? p.nameAr : p.name}
                    </div>
                    <div className="text-xs text-neutral-400 flex flex-wrap items-center gap-2">
                      <span className="font-mono">{p.sku}</span>
                      <span>·</span>
                      <span>
                        {isAr ? 'الشراء:' : 'Cost:'}{' '}
                        <span className="font-mono tabular-nums">
                          {formatCurrency(converted.costPrice, settings.currency, settings.language)}
                        </span>
                      </span>
                      <span>·</span>
                      <span className="text-emerald-400">
                        {isAr ? 'البيع:' : 'Sell:'}{' '}
                        <span className="font-mono tabular-nums">
                          {formatCurrency(converted.sellingPrice, settings.currency, settings.language)}
                        </span>
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between sm:justify-end gap-3">
                  <div className="text-right">
                    <span
                      className={`text-sm font-bold ${
                        isOut ? 'text-rose-400' : isLow ? 'text-amber-400' : 'text-emerald-400'
                      }`}
                    >
                      <span className="font-mono tabular-nums">{p.stock}</span>{' '}
                      {isAr ? 'وحدة' : 'units'}
                    </span>
                    <span className="block text-[10px] text-neutral-500">
                      {isOut ? t.outOfStock : isLow ? t.lowStock : t.inStock}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <TactileButton
                      variant="secondary"
                      size="sm"
                      onClick={() => openGoodsReceipt(p)}
                      leftIcon={<Truck className="w-3.5 h-3.5 text-emerald-400" />}
                    >
                      {isAr ? 'استلام بضاعة' : 'Receive Goods'}
                    </TactileButton>

                    <TactileButton
                      variant="secondary"
                      size="sm"
                      onClick={() => openAdjustment(p)}
                      leftIcon={<PlusCircle className="w-3.5 h-3.5" />}
                    >
                      {t.adjustStock}
                    </TactileButton>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </AppCard>

      {/* Stock Movements Journal */}
      <AppCard>
        <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-purple-400" />
            <h3 className="font-bold text-sm text-white">{t.movementHistory}</h3>
          </div>
          <span className="text-xs text-neutral-500">
            <span className="font-mono tabular-nums">{stockMovements.length}</span>{' '}
            {isAr ? 'سجل حركة' : 'audit records'}
          </span>
        </div>

        <div className="divide-y divide-neutral-800/80 mt-1 max-h-80 overflow-y-auto pr-1">
          {stockMovements.map((mov) => {
            const isPositive = mov.quantityChange >= 0;
            return (
              <div key={mov.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-2.5">
                  <div
                    className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold shrink-0 ${
                      isPositive
                        ? 'bg-emerald-500/10 text-emerald-400'
                        : 'bg-rose-500/10 text-rose-400'
                    }`}
                  >
                    {isPositive ? (
                      <ArrowUpRight className="w-4 h-4" />
                    ) : (
                      <ArrowDownLeft className="w-4 h-4" />
                    )}
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-bold text-white">{mov.productName}</span>
                      {mov.receiptMode && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-800/50 flex items-center gap-1">
                          {mov.receiptMode === 'invoice_only' ? (
                            <FileText className="w-2.5 h-2.5" />
                          ) : (
                            <PackageCheck className="w-2.5 h-2.5" />
                          )}
                          <span>
                            {mov.receiptMode === 'goods_and_invoice'
                              ? isAr
                                ? 'استلام بضاعة وفاتورة'
                                : 'Goods & Invoice'
                              : mov.receiptMode === 'goods_only'
                              ? isAr
                                ? 'استلام بضاعة فقط'
                                : 'Goods Only'
                              : isAr
                              ? 'استلام فاتورة فقط'
                              : 'Invoice Only'}
                          </span>
                        </span>
                      )}
                      {mov.invoiceNumber && (
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-neutral-900 text-amber-300 border border-neutral-800">
                          {mov.invoiceNumber}
                        </span>
                      )}
                    </div>
                    <span className="text-neutral-500 text-[11px] block">
                      {mov.reason} •{' '}
                      <span className="font-mono">
                        {new Date(mov.timestamp).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </span>
                  </div>
                </div>

                <div className="text-right shrink-0">
                  <span
                    className={`font-mono font-bold tabular-nums ${
                      isPositive ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {mov.quantityChange > 0 ? `+${mov.quantityChange}` : mov.quantityChange}
                  </span>
                  <span className="block text-[10px] font-mono text-neutral-500">
                    {mov.previousStock} → {mov.newStock}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </AppCard>

      {/* Goods Receipt / Supplier Purchase Invoice Modal */}
      <GoodsReceiptModal
        isOpen={isGoodsReceiptOpen}
        onClose={() => setIsGoodsReceiptOpen(false)}
        initialProduct={goodsReceiptProduct}
      />

      {/* Adjustment Modal */}
      <AppModal
        isOpen={isAdjustModalOpen}
        onClose={() => setIsAdjustModalOpen(false)}
        title={t.adjustStock}
        description={selectedProduct ? `${selectedProduct.name} (Current Stock: ${selectedProduct.stock})` : ''}
      >
        <form onSubmit={handleApplyAdjustment} className="flex flex-col gap-4">
          <div>
            <label className="text-xs font-semibold text-neutral-300 block mb-1.5">
              {t.movementType}
            </label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: 'restock', label: t.restock, color: 'text-emerald-400' },
                { id: 'damage', label: t.damage, color: 'text-rose-400' },
                { id: 'loss', label: t.loss, color: 'text-amber-400' },
                { id: 'audit', label: t.audit, color: 'text-blue-400' },
              ].map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMovementType(m.id as StockMovementType)}
                  className={`p-2.5 rounded-xl border text-left text-xs font-semibold transition-all ${
                    movementType === m.id
                      ? 'bg-neutral-800 border-amber-500 text-white'
                      : 'bg-neutral-900 border-neutral-800 text-neutral-400 hover:text-white'
                  }`}
                >
                  <span className={m.color}>{m.label}</span>
                </button>
              ))}
            </div>
          </div>

          <AppInput
            label={movementType === 'audit' ? 'New Exact Stock Level' : t.quantityDelta}
            type="text"
            inputMode="numeric"
            dir="ltr"
            value={amountInput}
            onChange={(e) => setAmountInput(normalizeNumberInput(e.target.value))}
            required
            autoFocus
          />

          <AppInput
            label={t.reason}
            value={reasonInput}
            onChange={(e) => setReasonInput(e.target.value)}
            placeholder="e.g. Broken in transit, supplier delivery"
          />

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-neutral-800">
            <TactileButton variant="ghost" type="button" onClick={() => setIsAdjustModalOpen(false)}>
              {t.cancel}
            </TactileButton>
            <TactileButton variant="amber" type="submit">
              {t.saveAdjustment}
            </TactileButton>
          </div>
        </form>
      </AppModal>
    </div>
  );
};
