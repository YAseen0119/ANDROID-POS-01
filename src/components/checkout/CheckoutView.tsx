/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { usePOS } from '../../context/POSContext';
import { getTranslation } from '../../lib/translations';
import {
  formatCurrency,
  getProductPricesInCurrency,
  getProductPackaging,
  getCartItemUnitPricing,
  formatProductStockBreakdown,
} from '../../lib/pos-calculations';
import {
  matchesProductBarcode,
  matchesProductSearchQuery,
  getProductSerialNumber,
  formatProductSerialNumber,
} from '../../lib/inventory-rules';
import { normalizeNumberInput, parseNormalizedNumber } from '../../lib/number-utils';
import { Product, Transaction } from '../../lib/types';
import { TactileButton } from '../ui/TactileButton';
import { DynamicButton } from '../ui/DynamicButton';
import { HoldToConfirm } from '../ui/HoldToConfirm';
import { AppInput } from '../ui/AppInput';
import { AppCard } from '../ui/AppCard';
import { BarcodeScannerModal } from './BarcodeScannerModal';
import { PaymentModal } from './PaymentModal';
import { ReceiptModal } from './ReceiptModal';
import {
  Search,
  Barcode,
  Plus,
  Minus,
  Trash2,
  ShoppingBag,
  CreditCard,
  AlertTriangle,
  X,
  Tag,
  Layers,
  Hash,
  PackageX,
} from 'lucide-react';
import { playTactileClick } from '../../lib/sound-fx';

export const CheckoutView: React.FC<{ isCartDrawerOpen?: boolean; onCloseCartDrawer?: () => void }> = ({
  isCartDrawerOpen = false,
  onCloseCartDrawer,
}) => {
  const {
    products,
    cart,
    addToCart,
    setCartItemSaleUnit,
    updateCartQuantity,
    removeFromCart,
    clearCart,
    cartTotals,
    settings,
    exchangeRates,
    globalDiscountPercent,
    setGlobalDiscountPercent,
    globalDiscountAmount,
    setGlobalDiscountAmount,
    openUnmetDemandModal,
  } = usePOS();

  const t = getTranslation(settings.language);
  const isAr = settings.language === 'ar';

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [discountAmountInput, setDiscountAmountInput] = useState<string>(
    globalDiscountAmount > 0 ? String(globalDiscountAmount) : ''
  );
  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isPaymentOpen, setIsPaymentOpen] = useState(false);
  const [completedTransaction, setCompletedTransaction] = useState<Transaction | null>(null);
  const [isReceiptOpen, setIsReceiptOpen] = useState(false);

  // Derive unique categories
  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => {
      const cat = settings.language === 'ar' && p.categoryAr ? p.categoryAr : p.category;
      set.add(cat);
    });
    return Array.from(set);
  }, [products, settings.language]);

  // Filter products by category & tokenized search query (any word in name, description, serial number, any barcode, SKU)
  const filteredProducts = useMemo(() => {
    return products.filter((prod, idx) => {
      const matchesSearch = matchesProductSearchQuery(prod, searchQuery, idx);
      const prodCat = settings.language === 'ar' && prod.categoryAr ? prod.categoryAr : prod.category;
      const matchesCat = selectedCategory === 'all' || prodCat === selectedCategory;

      return matchesSearch && matchesCat;
    });
  }, [products, searchQuery, selectedCategory, settings.language]);

  const handleBarcodeScanned = (code: string) => {
    const item = products.find((p, idx) => {
      const serial = getProductSerialNumber(p, idx);
      return (
        matchesProductBarcode(p, code, true) ||
        p.sku.toLowerCase() === code.toLowerCase() ||
        String(serial) === code.replace(/^#0*/, '')
      );
    });
    if (item) {
      if (item.stock <= 0) {
        openUnmetDemandModal({
          productId: item.id,
          isRegisteredProduct: true,
          unavailabilityReason: 'OUT_OF_STOCK',
          sourceScreen: 'checkout',
        });
      } else {
        addToCart(item, 1);
      }
    } else if (code.trim()) {
      openUnmetDemandModal({
        isRegisteredProduct: false,
        barcode: code.trim(),
        productNameSnapshot: `Unregistered Barcode (${code.trim()})`,
        unavailabilityReason: 'NOT_STOCKED',
        sourceScreen: 'checkout',
      });
    }
  };

  const handlePaymentSuccess = (transaction: Transaction) => {
    setIsPaymentOpen(false);
    setCompletedTransaction(transaction);
    setIsReceiptOpen(true);
    onCloseCartDrawer?.();
  };

  const handleNewSale = () => {
    setIsReceiptOpen(false);
    setCompletedTransaction(null);
  };

  return (
    <div className="flex-1 flex flex-col lg:flex-row gap-6 p-4 md:p-6 max-w-7xl mx-auto w-full pb-24">
      {/* Left Column: Product Workstation */}
      <div className="flex-1 flex flex-col gap-4 min-w-0">
        {/* Search Bar + Barcode Scanner Trigger */}
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <AppInput
              placeholder={
                isAr
                  ? 'ابحث بأي كلمة من الاسم، الوصف، الرقم التسلسلي (#0001)، أو الباركود...'
                  : 'Search by any word in name, description, serial (#0001), SKU, or barcode...'
              }
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              leftIcon={<Search className="w-4 h-4" />}
              rightIcon={
                searchQuery ? (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="p-1 hover:text-white"
                    aria-label="Clear search"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                ) : undefined
              }
            />
          </div>

          <TactileButton
            variant="amber"
            size="md"
            onClick={() => setIsScannerOpen(true)}
            leftIcon={<Barcode className="w-5 h-5" />}
            aria-label="Scan barcode"
            className="shrink-0"
          >
            <span className="hidden sm:inline">{t.scanBarcode}</span>
          </TactileButton>

          <button
            type="button"
            data-testid="checkout-open-unmet-demand-btn"
            onClick={() =>
              openUnmetDemandModal({
                sourceScreen: 'checkout',
                productNameSnapshot: searchQuery.trim() || undefined,
              })
            }
            className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2.5 rounded-xl border border-rose-500/40 bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 text-xs font-bold transition-all"
            title={
              isAr
                ? 'تسجيل سريع لطلب عميل غير متوفر'
                : 'Fast Capture: Customer Requested Unavailable Product'
            }
          >
            <PackageX className="w-4 h-4 shrink-0" />
            <span className="hidden md:inline">
              {isAr ? 'طلب غير متوفر' : 'Unmet Demand'}
            </span>
          </button>
        </div>

        {/* Category Horizontal Filter Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1.5 scrollbar-none">
          <button
            onClick={() => {
              playTactileClick(settings.soundEnabled);
              setSelectedCategory('all');
            }}
            className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all border ${
              selectedCategory === 'all'
                ? 'bg-white text-neutral-950 border-white shadow-sm'
                : 'bg-neutral-900 text-neutral-400 border-neutral-800 hover:text-white hover:border-neutral-700'
            }`}
          >
            {t.allCategories}
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => {
                playTactileClick(settings.soundEnabled);
                setSelectedCategory(cat);
              }}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all border ${
                selectedCategory === cat
                  ? 'bg-amber-400 text-neutral-950 border-amber-400 shadow-sm'
                  : 'bg-neutral-900 text-neutral-400 border-neutral-800 hover:text-white hover:border-neutral-700'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Product Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
          {filteredProducts.map((product) => {
            const prodIndex = products.findIndex((p) => p.id === product.id);
            const serialNum = getProductSerialNumber(product, prodIndex >= 0 ? prodIndex : 0);
            const isOutOfStock = product.stock <= 0;
            const isLow = product.stock > 0 && product.stock <= product.minStockAlert;
            const inCartItem = cart.find((i) => i.product.id === product.id);
            const inCartQty = inCartItem?.quantity || 0;
            const prices = getProductPricesInCurrency(product, settings.currency, exchangeRates);
            const convertedPrice = prices.sellingPrice;
            const pkg = getProductPackaging(product);
            const hasMultiUnit = pkg.enablePackaging && pkg.unitsPerPack > 1;
            const unitLabel = isAr ? pkg.unitNameAr : pkg.unitName;
            const packLabel = isAr ? pkg.packNameAr : pkg.packName;
            const canAddPack = product.stock >= pkg.unitsPerPack && pkg.allowedSaleUnits !== 'unit_only';
            const canAddUnit = product.stock >= 1 && pkg.allowedSaleUnits !== 'pack_only';
            const productImg = product.image || product.imageUrl || product.customFields?.image;
            const prodDesc = isAr && product.descriptionAr ? product.descriptionAr : product.description;

            return (
              <div
                key={product.id}
                onClick={() => {
                  if (!isOutOfStock) {
                    addToCart(product, 1);
                  }
                }}
                role="button"
                tabIndex={isOutOfStock ? -1 : 0}
                onKeyDown={(e) => {
                  if ((e.key === 'Enter' || e.key === ' ') && !isOutOfStock) {
                    e.preventDefault();
                    addToCart(product, 1);
                  }
                }}
                className={`group relative flex flex-col justify-between p-3.5 rounded-2xl border text-left transition-all select-none focus:outline-none focus:ring-2 focus:ring-amber-500/50 ${
                  isOutOfStock
                    ? 'opacity-40 cursor-not-allowed bg-neutral-900/50 border-neutral-850'
                    : 'bg-neutral-900 hover:bg-neutral-850 border-neutral-800 hover:border-neutral-700 cursor-pointer shadow-sm hover:shadow-md active:scale-[0.99]'
                }`}
                aria-label={`Add ${product.name} to cart`}
              >
                {/* Visual Top Slot with Image / Emoji & Badges */}
                <div className="flex items-start justify-between gap-1 mb-2 w-full">
                  {productImg ? (
                    <div className="w-11 h-11 rounded-xl overflow-hidden bg-neutral-800 border border-white/10 shrink-0">
                      <img
                        src={productImg}
                        alt={product.name}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  ) : (
                    <div
                      className="w-11 h-11 rounded-xl flex items-center justify-center text-xl shadow-inner border border-white/5"
                      style={{ backgroundColor: `${product.colorHex || '#d97706'}22` }}
                    >
                      <span>{product.emoji || '📦'}</span>
                    </div>
                  )}

                  <div className="flex flex-col items-end gap-1">
                    <span className="px-1.5 py-0.5 rounded bg-neutral-800 border border-neutral-700 text-amber-400 font-mono font-bold text-[10px] inline-flex items-center gap-0.5">
                      <Hash className="w-2.5 h-2.5" />
                      <span>{formatProductSerialNumber(serialNum).replace('#', '')}</span>
                    </span>
                    {inCartQty > 0 && (
                      <span className="px-2 py-0.5 rounded-full bg-amber-500 text-neutral-950 font-bold text-[10px]">
                        <span className="font-mono">{inCartQty}</span>{' '}
                        {hasMultiUnit
                          ? inCartItem?.selectedSaleUnit === 'pack'
                            ? packLabel
                            : unitLabel
                          : isAr
                          ? 'بالسلة'
                          : 'in cart'}
                      </span>
                    )}
                    {hasMultiUnit && (
                      <span className="px-1.5 py-0.5 rounded-md bg-emerald-500/15 border border-emerald-500/40 text-emerald-300 text-[10px] font-bold flex items-center gap-1">
                        <Layers className="w-2.5 h-2.5 shrink-0" />
                        <span>
                          {packLabel} = <span className="font-mono">{pkg.unitsPerPack}</span>{' '}
                          {unitLabel}
                        </span>
                      </span>
                    )}
                    {isLow && (
                      <span className="text-[10px] text-amber-400 font-medium flex items-center gap-0.5">
                        <AlertTriangle className="w-2.5 h-2.5" />
                        <span>{formatProductStockBreakdown(product, settings.language)}</span>
                      </span>
                    )}
                    {isOutOfStock && (
                      <span className="text-[10px] text-rose-400 font-medium">
                        {isAr ? 'نفد' : 'Out'}
                      </span>
                    )}
                  </div>
                </div>

                {/* Name, Description & SKU */}
                <div className="mb-2 w-full">
                  <h4 className="text-sm font-semibold text-white group-hover:text-amber-200 transition-colors line-clamp-2 leading-snug">
                    {isAr && product.nameAr ? product.nameAr : product.name}
                  </h4>
                  {prodDesc && (
                    <p className="text-[10px] text-neutral-400 line-clamp-1 mt-0.5">
                      {prodDesc}
                    </p>
                  )}
                  <span className="text-[11px] font-mono text-neutral-500 block mt-0.5">
                    {product.sku}
                  </span>
                </div>

                {/* Price & Unit/Pack Quick Add Triggers */}
                {hasMultiUnit ? (
                  <div className="pt-2 border-t border-neutral-800/80 w-full space-y-1.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-neutral-400">{unitLabel}:</span>
                      <span className="font-mono font-bold text-emerald-400 tabular-nums">
                        {formatCurrency(prices.sellingPrice, settings.currency, settings.language)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-amber-300 font-medium">
                        {packLabel} (<span className="font-mono">{pkg.unitsPerPack}</span>):
                      </span>
                      <span className="font-mono font-bold text-amber-400 tabular-nums">
                        {formatCurrency(
                          prices.packSellingPrice,
                          settings.currency,
                          settings.language
                        )}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5 pt-1">
                      {canAddUnit && (
                        <button
                          type="button"
                          data-testid={`add-unit-${product.id}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            addToCart(product, 1, 'unit');
                          }}
                          className="px-2 py-1.5 rounded-lg bg-neutral-800 hover:bg-emerald-500 hover:text-neutral-950 text-neutral-200 text-[11px] font-bold transition-colors flex items-center justify-center gap-1"
                        >
                          <Plus className="w-3 h-3 shrink-0" />
                          <span>{unitLabel}</span>
                        </button>
                      )}
                      {canAddPack && (
                        <button
                          type="button"
                          data-testid={`add-pack-${product.id}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            addToCart(product, 1, 'pack');
                          }}
                          className="px-2 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500 hover:text-neutral-950 border border-amber-500/40 text-amber-300 text-[11px] font-bold transition-colors flex items-center justify-center gap-1"
                        >
                          <Plus className="w-3 h-3 shrink-0" />
                          <span>{packLabel}</span>
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between pt-2 border-t border-neutral-800/80 w-full">
                    <span className="text-sm font-bold font-mono text-emerald-400 tabular-nums">
                      {formatCurrency(convertedPrice, settings.currency, settings.language)}
                    </span>
                    {isOutOfStock || isLow ? (
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          data-testid={`record-unmet-${product.id}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            openUnmetDemandModal({
                              productId: product.id,
                              isRegisteredProduct: true,
                              unavailabilityReason: 'OUT_OF_STOCK',
                              sourceScreen: 'checkout',
                            });
                          }}
                          className="px-2 py-1 rounded-lg border border-rose-500/40 bg-rose-500/20 hover:bg-rose-500 hover:text-white text-rose-300 text-[10px] font-bold transition-colors flex items-center gap-1"
                          title={
                            isAr
                              ? 'تسجيل طلب عميل لهذا المنتج النافد أو المنخفض'
                              : 'Record customer unmet demand for this item'
                          }
                        >
                          <PackageX className="w-3 h-3" />
                          <span>{isAr ? 'طلب عميل' : 'Log Demand'}</span>
                        </button>
                        {!isOutOfStock && (
                          <div className="w-7 h-7 rounded-lg bg-neutral-800 group-hover:bg-amber-500 group-hover:text-neutral-950 text-neutral-300 flex items-center justify-center transition-colors">
                            <Plus className="w-4 h-4" />
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="w-7 h-7 rounded-lg bg-neutral-800 group-hover:bg-amber-500 group-hover:text-neutral-950 text-neutral-300 flex items-center justify-center transition-colors">
                        <Plus className="w-4 h-4" />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {filteredProducts.length === 0 && (
          <div className="flex flex-col items-center justify-center p-10 text-center bg-neutral-900/40 rounded-2xl border border-neutral-800 space-y-3">
            <ShoppingBag className="w-10 h-10 text-neutral-600" />
            <p className="text-sm font-medium text-neutral-300">
              {isAr
                ? 'لا توجد منتجات مطابقة لبحثك في الكتالوج الحالي.'
                : 'No products match your search in the current catalog.'}
            </p>
            <button
              type="button"
              data-testid="empty-search-record-unmet-btn"
              onClick={() =>
                openUnmetDemandModal({
                  isRegisteredProduct: false,
                  productNameSnapshot: searchQuery.trim() || '',
                  unavailabilityReason: 'NOT_STOCKED',
                  sourceScreen: 'checkout',
                })
              }
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-neutral-950 text-xs font-bold shadow-lg shadow-amber-500/20 transition"
            >
              <PackageX className="w-4 h-4" />
              <span>
                {isAr
                  ? `تسجيل طلب عميل لمنتج غير متوفر${searchQuery.trim() ? `: "${searchQuery.trim()}"` : ''}`
                  : `Record Unmet Customer Request${searchQuery.trim() ? `: "${searchQuery.trim()}"` : ''}`}
              </span>
            </button>
          </div>
        )}
      </div>

      {/* Right Column / Mobile Drawer: Live Shopping Cart Panel */}
      <div
        className={`lg:w-96 shrink-0 flex flex-col bg-neutral-900/95 border border-neutral-800 rounded-3xl p-5 shadow-xl ${
          isCartDrawerOpen
            ? 'fixed inset-x-0 bottom-0 top-16 z-50 rounded-t-3xl rounded-b-none p-5 overflow-y-auto max-w-lg mx-auto bg-neutral-900'
            : 'hidden lg:flex'
        }`}
      >
        {/* Cart Header */}
        <div className="flex items-center justify-between pb-3 border-b border-neutral-800">
          <div className="flex items-center gap-2">
            <ShoppingBag className="w-5 h-5 text-amber-500" />
            <h3 className="font-bold text-base text-white">{t.cart}</h3>
            <span className="text-xs font-mono text-neutral-400">
              ({cartTotals.totalItemsCount})
            </span>
          </div>

          <div className="flex items-center gap-2">
            {cart.length > 0 && (
              <HoldToConfirm
                onConfirm={clearCart}
                label={t.clearCart}
                confirmingLabel="Clearing..."
                variant="danger"
                className="py-1 px-2.5 text-xs min-h-[34px]"
                allowUndo={false}
              />
            )}
            {isCartDrawerOpen && (
              <button
                onClick={onCloseCartDrawer}
                className="p-1 text-neutral-400 hover:text-white lg:hidden"
                aria-label="Close cart drawer"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>

        {/* Cart Items List */}
        <div className="flex-1 overflow-y-auto py-3 space-y-2.5 min-h-[120px] max-h-[34vh] lg:max-h-[36vh]">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-44 text-center text-neutral-500 px-4">
              <ShoppingBag className="w-8 h-8 mb-2 opacity-50" />
              <p className="text-xs">{t.cartEmpty}</p>
            </div>
          ) : (
            cart.map((item) => {
              const pkg = getProductPackaging(item.product);
              const pricing = getCartItemUnitPricing(
                item,
                settings.currency,
                exchangeRates,
                settings.language
              );
              const maxAllowedQty =
                pricing.saleUnit === 'pack'
                  ? Math.floor(item.product.stock / pkg.unitsPerPack)
                  : item.product.stock;
              const unitLabel = isAr ? pkg.unitNameAr : pkg.unitName;
              const packLabel = isAr ? pkg.packNameAr : pkg.packName;

              return (
                <div
                  key={item.product.id}
                  className="p-3 bg-neutral-950/70 border border-neutral-800 rounded-2xl flex flex-col gap-2 group"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0 pr-1">
                      <h5 className="text-xs font-semibold text-white truncate">
                        {isAr && item.product.nameAr ? item.product.nameAr : item.product.name}
                      </h5>
                      <div className="flex items-center flex-wrap gap-1.5 text-[11px] text-neutral-400 mt-0.5">
                        <span className="text-emerald-400 font-mono font-bold tabular-nums">
                          {formatCurrency(
                            pricing.unitSellingPrice,
                            settings.currency,
                            settings.language
                          )}
                        </span>
                        <span className="font-mono">× {item.quantity}</span>
                        {pkg.enablePackaging && (
                          <span className="px-1.5 py-0.2 rounded bg-neutral-800 text-amber-300 text-[10px] font-bold">
                            {pricing.saleUnitLabel}
                          </span>
                        )}
                        <span className="font-mono">=</span>
                        <span className="font-mono font-semibold text-white tabular-nums">
                          {formatCurrency(
                            pricing.unitSellingPrice * item.quantity,
                            settings.currency,
                            settings.language
                          )}
                        </span>
                      </div>
                    </div>

                    {/* Tactile Quantity Stepper */}
                    <div className="flex items-center gap-1 shrink-0 bg-neutral-850 p-1 rounded-xl border border-neutral-750">
                      <button
                        onClick={() => updateCartQuantity(item.product.id, -1)}
                        className="w-7 h-7 rounded-lg bg-neutral-800 hover:bg-neutral-700 active:scale-95 text-neutral-200 flex items-center justify-center font-bold"
                        aria-label={`Decrease ${item.product.name} quantity`}
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>

                      <span className="w-7 text-center font-mono font-bold text-xs tabular-nums text-white">
                        {item.quantity}
                      </span>

                      <button
                        onClick={() => updateCartQuantity(item.product.id, 1)}
                        disabled={item.quantity >= maxAllowedQty}
                        className="w-7 h-7 rounded-lg bg-neutral-800 hover:bg-neutral-700 active:scale-95 text-neutral-200 flex items-center justify-center font-bold disabled:opacity-30 disabled:pointer-events-none"
                        aria-label={`Increase ${item.product.name} quantity`}
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>

                      <button
                        onClick={() => removeFromCart(item.product.id)}
                        className="w-7 h-7 ml-1 rounded-lg text-neutral-500 hover:text-rose-400 flex items-center justify-center"
                        aria-label={`Remove ${item.product.name} from cart`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Strip / Piece vs Pack Switcher inside Cart Item */}
                  {pkg.enablePackaging &&
                    pkg.unitsPerPack > 1 &&
                    pkg.allowedSaleUnits === 'both' && (
                      <div className="flex items-center justify-between gap-1.5 pt-1.5 border-t border-neutral-800/80">
                        <span className="text-[10px] text-neutral-400">
                          {isAr ? 'وحدة البيع:' : 'Sale Unit:'}
                        </span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            data-testid={`cart-unit-mode-${item.product.id}`}
                            onClick={() => {
                              playTactileClick(settings.soundEnabled);
                              setCartItemSaleUnit(item.product.id, 'unit');
                            }}
                            className={`px-2.5 py-0.5 rounded-lg text-[10px] font-bold border transition-all ${
                              pricing.saleUnit === 'unit'
                                ? 'bg-emerald-500 text-neutral-950 border-emerald-400'
                                : 'bg-neutral-900 text-neutral-300 border-neutral-800 hover:border-neutral-700'
                            }`}
                          >
                            {isAr ? `بالـ${unitLabel} (1)` : `${unitLabel} (1)`}
                          </button>
                          <button
                            type="button"
                            data-testid={`cart-pack-mode-${item.product.id}`}
                            disabled={item.product.stock < pkg.unitsPerPack}
                            onClick={() => {
                              playTactileClick(settings.soundEnabled);
                              setCartItemSaleUnit(item.product.id, 'pack');
                            }}
                            className={`px-2.5 py-0.5 rounded-lg text-[10px] font-bold border transition-all ${
                              pricing.saleUnit === 'pack'
                                ? 'bg-amber-500 text-neutral-950 border-amber-400'
                                : 'bg-neutral-900 text-amber-300 border-neutral-800 hover:border-neutral-700 disabled:opacity-40'
                            }`}
                          >
                            {isAr ? (
                              <>
                                بالـ{packLabel} (<span className="font-mono">{pkg.unitsPerPack}</span>{' '}
                                {unitLabel})
                              </>
                            ) : (
                              <>
                                {packLabel} (<span className="font-mono">{pkg.unitsPerPack}</span>)
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    )}
                </div>
              );
            })
          )}
        </div>

        {/* Global Cart Discount Input (Percentage Chips + Custom Discount Amount Input) */}
        {cart.length > 0 && (
          <div
            data-testid="cart-discount-section"
            className="pt-2.5 pb-1.5 border-t border-neutral-800/80 space-y-2"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-neutral-400 flex items-center gap-1 font-medium">
                <Tag className="w-3.5 h-3.5 text-amber-500" />
                <span>{isAr ? 'نسبة الخصم %:' : 'Discount %:'}</span>
              </span>
              <div className="flex gap-1">
                {[0, 5, 10, 15].map((d) => {
                  const isChipActive = globalDiscountAmount === 0 && globalDiscountPercent === d;
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => {
                        playTactileClick(settings.soundEnabled);
                        setDiscountAmountInput('');
                        setGlobalDiscountPercent(d);
                      }}
                      className={`px-2 py-0.5 text-[11px] font-mono rounded-lg border transition-colors ${
                        isChipActive
                          ? 'bg-amber-500 text-neutral-950 font-bold border-amber-400'
                          : 'bg-neutral-800 text-neutral-300 border-neutral-700 hover:border-neutral-600'
                      }`}
                    >
                      {d}%
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Direct Custom Discount Amount Input */}
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="cart-custom-discount-amount"
                className="text-xs text-neutral-300 font-medium whitespace-nowrap"
              >
                {isAr ? 'أو اكتب مبلغ الخصم:' : 'Or Discount Amount:'}
              </label>
              <div className="relative flex-1 max-w-[190px]">
                <input
                  id="cart-custom-discount-amount"
                  data-testid="cart-discount-amount-input"
                  type="text"
                  inputMode="decimal"
                  dir="ltr"
                  value={
                    globalDiscountAmount === 0 && discountAmountInput === ''
                      ? ''
                      : discountAmountInput
                  }
                  onChange={(e) => {
                    const cleaned = normalizeNumberInput(e.target.value);
                    setDiscountAmountInput(cleaned);
                    const parsed = parseNormalizedNumber(cleaned, 0);
                    setGlobalDiscountAmount(Math.max(0, parsed));
                  }}
                  placeholder={isAr ? `المبلغ (${settings.currency})` : `0.00 (${settings.currency})`}
                  className={`w-full min-h-[34px] pl-2.5 pr-12 py-1 rounded-xl bg-neutral-950 border text-xs font-mono text-white placeholder:font-sans placeholder:text-neutral-500 focus:outline-none transition-colors ${
                    globalDiscountAmount > 0
                      ? 'border-amber-500 ring-1 ring-amber-500/30'
                      : 'border-neutral-800 focus:border-amber-500'
                  }`}
                />
                <div className="absolute inset-y-0 right-1.5 flex items-center gap-1">
                  {globalDiscountAmount > 0 && (
                    <button
                      type="button"
                      data-testid="clear-discount-amount-btn"
                      onClick={() => {
                        playTactileClick(settings.soundEnabled);
                        setDiscountAmountInput('');
                        setGlobalDiscountAmount(0);
                      }}
                      className="p-0.5 rounded text-neutral-400 hover:text-white"
                      aria-label={isAr ? 'مسح مبلغ الخصم' : 'Clear discount amount'}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                  <span className="text-[10px] font-mono font-bold text-amber-400 pointer-events-none">
                    {settings.currency}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Summary Breakdown */}
        <div className="pt-3 border-t border-neutral-800 space-y-1.5 text-xs text-neutral-400">
          <div className="flex justify-between">
            <span>{t.subtotal}</span>
            <span className="font-mono tabular-nums text-white">
              {formatCurrency(cartTotals.subtotal, settings.currency, settings.language)}
            </span>
          </div>

          {cartTotals.discountAmount > 0 && (
            <div className="flex justify-between text-rose-400">
              <span>{t.discount}</span>
              <span className="font-mono tabular-nums">
                -{formatCurrency(cartTotals.discountAmount, settings.currency, settings.language)}
              </span>
            </div>
          )}

          <div className="flex justify-between">
            <span>
              {t.tax} ({settings.taxRatePercent}%)
              {settings.isTaxInclusive && ' (incl.)'}
            </span>
            <span className="font-mono tabular-nums text-white">
              {formatCurrency(cartTotals.taxAmount, settings.currency, settings.language)}
            </span>
          </div>

          <div className="flex justify-between text-base font-extrabold text-white pt-2 border-t border-neutral-800">
            <span>{t.total}</span>
            <span className="font-mono tabular-nums text-amber-400 text-xl">
              {formatCurrency(cartTotals.grandTotal, settings.currency, settings.language)}
            </span>
          </div>
        </div>

        {/* DynamicButton Pay Trigger */}
        <div className="pt-4">
          <DynamicButton
            status="ready"
            onClick={() => setIsPaymentOpen(true)}
            readyLabel={`${t.payNow} • ${formatCurrency(
              cartTotals.grandTotal,
              settings.currency,
              settings.language
            )}`}
            readyIcon={<CreditCard className="w-5 h-5 text-current" />}
            variant="emerald"
            disabled={cart.length === 0}
            className="w-full text-base py-3.5 shadow-lg"
          />
        </div>
      </div>

      {/* Modals */}
      <BarcodeScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onScan={handleBarcodeScanned}
      />

      <PaymentModal
        isOpen={isPaymentOpen}
        onClose={() => setIsPaymentOpen(false)}
        onSuccess={handlePaymentSuccess}
      />

      <ReceiptModal
        isOpen={isReceiptOpen}
        onClose={() => setIsReceiptOpen(false)}
        transaction={completedTransaction}
        onNewSale={handleNewSale}
      />
    </div>
  );
};
