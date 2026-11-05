/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express, { Request, Response } from 'express';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { hasDatabaseCredentials } from './src/db/index.ts';
import {
  getAllProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
} from './src/db/products-repo.ts';
import {
  getAllCurrencies,
  getBaseCurrency,
  createOrUpdateCurrency,
  deleteCurrency,
  getAllExchangeRates,
  getEffectiveExchangeRates,
  getExchangeRateHistory,
  setExchangeRate,
  updateExchangeRate,
  deleteExchangeRate,
  convertAmount,
} from './src/db/currencies-repo.ts';
import {
  analyticsRouter,
  intelligenceRouter,
  unmetDemandRouter,
} from './src/analytics/analytics.routes.ts';
import {
  PRACTICE_COMPANY_ID,
  readPracticeSandboxState,
  releasePlatformRouter,
  requireServerCapability,
  writePracticeSandboxState,
} from './src/server/release-onboarding.service.ts';
import { backupRestoreRouter } from './src/server/backup-restore.service.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

app.use(express.json({ limit: '50mb' }));

// API: Business Intelligence, Smart Store Operations & Customer Demand Intelligence Endpoints
app.use('/api/analytics', analyticsRouter);
app.use('/api/intelligence', intelligenceRouter);
app.use('/api/unmet-demand', unmetDemandRouter);

// API: Phase 11 Onboarding, Practice Mode, Company Isolation, Auth & RBAC Endpoints
app.use('/api', releasePlatformRouter);

// API: Backup, Restore, Company Migration & Intelligent Data Merge Endpoints
app.use('/api/backups', backupRestoreRouter);

function isPracticeModeRequest(req: Request): boolean {
  const modeHeader = String(req.headers['x-workspace-mode'] || '').toUpperCase();
  const modeQuery = String(req.query.workspaceMode || '').toUpperCase();
  const modeBody = String(req.body?.workspaceMode || '').toUpperCase();
  const companyHeader = String(req.headers['x-company-id'] || '');
  const companyQuery = String(req.query.companyId || '');
  return (
    modeHeader === 'PRACTICE' ||
    modeQuery === 'PRACTICE' ||
    modeBody === 'PRACTICE' ||
    companyHeader === PRACTICE_COMPANY_ID ||
    companyQuery === PRACTICE_COMPANY_ID
  );
}

// Authorization guard for settings & currency modifications
const requireAdminOrManager = (req: Request, res: Response, next: express.NextFunction) => {
  const role = (req.headers['x-user-role'] as string | undefined)?.toLowerCase();
  if (role && (role === 'cashier' || role === 'inventory_clerk' || role === 'report_viewer')) {
    return res.status(403).json({
      error: 'Insufficient permissions: Current role is not authorized to modify exchange rates.',
    });
  }
  return requireServerCapability('company.currency.manage', {
    allowInternalDefaultIfNoHeader: true,
  })(req, res, next);
};

// API: Health & Database Connectivity status
app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    postgresConfigured: hasDatabaseCredentials(),
    databaseType: hasDatabaseCredentials() ? 'PostgreSQL (Connected)' : 'Durable Local Store (Active)',
  });
});

// API: Currencies Endpoints
app.get('/api/currencies', async (req: Request, res: Response) => {
  try {
    const list = await getAllCurrencies();
    const base = await getBaseCurrency();
    res.json({
      baseCurrency: base.code,
      currencies: list,
    });
  } catch (error: any) {
    console.error('Failed to fetch currencies:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch currencies' });
  }
});

app.post('/api/currencies', requireAdminOrManager, async (req: Request, res: Response) => {
  try {
    if (isPracticeModeRequest(req)) {
      return res.status(201).json({
        code: String(req.body?.code || 'USD').toUpperCase(),
        name: req.body?.name || req.body?.code || 'USD',
        symbol: req.body?.symbol || '$',
        practiceModeIsolated: true,
      });
    }
    const { code, name, nameAr, symbol, decimalPlaces, initialRateToBase, createdBy } = req.body;
    if (!code) {
      return res.status(400).json({ error: 'Currency code is required.' });
    }
    const created = await createOrUpdateCurrency({
      code,
      name: name || code,
      nameAr,
      symbol: symbol || code,
      decimalPlaces: decimalPlaces !== undefined ? Number(decimalPlaces) : 2,
      initialRateToBase: initialRateToBase !== undefined ? Number(initialRateToBase) : undefined,
      createdBy: createdBy || 'admin_user',
    });
    res.status(201).json(created);
  } catch (error: any) {
    console.error('Failed to create/update currency:', error);
    res.status(400).json({ error: error.message || 'Failed to save currency' });
  }
});

app.delete('/api/currencies/:code', requireAdminOrManager, async (req: Request, res: Response) => {
  try {
    if (isPracticeModeRequest(req)) {
      return res.json({ success: true, practiceModeIsolated: true });
    }
    const result = await deleteCurrency(req.params.code);
    res.json(result);
  } catch (error: any) {
    console.error(`Failed to delete currency ${req.params.code}:`, error);
    const status = error.message?.includes('not found') ? 404 : 400;
    res.status(status).json({ error: error.message || 'Failed to delete currency' });
  }
});

// API: Exchange Rates Endpoints
app.get('/api/exchange-rates', async (req: Request, res: Response) => {
  try {
    const effectiveOnly = req.query.effective === 'true';
    const source = req.query.source as string | undefined;
    const target = req.query.target as string | undefined;

    if (effectiveOnly) {
      const effectiveRates = await getEffectiveExchangeRates();
      return res.json(effectiveRates);
    }

    const rates = await getAllExchangeRates({ source, target });
    res.json(rates);
  } catch (error: any) {
    console.error('Failed to fetch exchange rates:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch exchange rates' });
  }
});

app.get('/api/exchange-rates/history', async (req: Request, res: Response) => {
  try {
    const source = (req.query.source as string) || 'USD';
    const target = (req.query.target as string) || 'SDG';
    const history = await getExchangeRateHistory(source, target);
    res.json(history);
  } catch (error: any) {
    console.error('Failed to fetch exchange rate history:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch exchange rate history' });
  }
});

app.post('/api/exchange-rates', requireAdminOrManager, async (req: Request, res: Response) => {
  try {
    const { sourceCurrency, targetCurrency, rate, effectiveFrom, expiryDate, createdBy } = req.body;

    if (!sourceCurrency || !targetCurrency) {
      return res.status(400).json({ error: 'sourceCurrency and targetCurrency are required.' });
    }

    if (rate === undefined || rate === null) {
      return res.status(400).json({ error: 'rate is required.' });
    }

    if (isPracticeModeRequest(req)) {
      const practice = readPracticeSandboxState();
      const nextRates = {
        ...(practice.settings?.exchangeRates || {}),
        [String(sourceCurrency).toUpperCase()]: Number(rate),
      };
      writePracticeSandboxState({
        ...practice,
        settings: {
          ...(practice.settings || {}),
          exchangeRates: nextRates,
        },
        updatedAt: new Date().toISOString(),
      });
      return res.status(201).json({
        id: `prac-rate-${Date.now()}`,
        sourceCurrency,
        targetCurrency,
        rate: Number(rate),
        practiceModeIsolated: true,
      });
    }

    const saved = await setExchangeRate({
      sourceCurrency,
      targetCurrency,
      rate: Number(rate),
      effectiveFrom: effectiveFrom ? new Date(effectiveFrom) : new Date(),
      expiryDate: expiryDate ? new Date(expiryDate) : null,
      createdBy: createdBy || 'admin_user',
    });

    res.status(201).json(saved);
  } catch (error: any) {
    console.error('Failed to create exchange rate:', error);
    const msg = error.message || '';
    if (msg.includes('not a recognized') || msg.includes('not found')) {
      return res.status(404).json({ error: msg });
    }
    if (
      msg.includes('positive number') ||
      msg.includes('cannot be identical') ||
      msg.includes('Expiry date must be later') ||
      msg.includes('Invalid')
    ) {
      return res.status(400).json({ error: msg });
    }
    res.status(500).json({ error: msg || 'Failed to save exchange rate' });
  }
});

app.put('/api/exchange-rates/:id', requireAdminOrManager, async (req: Request, res: Response) => {
  try {
    if (isPracticeModeRequest(req)) {
      return res.json({ id: req.params.id, ...req.body, practiceModeIsolated: true });
    }
    const updated = await updateExchangeRate(req.params.id, req.body);
    res.json(updated);
  } catch (error: any) {
    const msg = error.message || '';
    if (msg.includes('not found')) {
      return res.status(404).json({ error: msg });
    }
    if (msg.includes('positive number')) {
      return res.status(400).json({ error: msg });
    }
    console.warn(`Failed to update exchange rate ${req.params.id}:`, msg);
    res.status(500).json({ error: msg || 'Failed to update exchange rate' });
  }
});

app.delete('/api/exchange-rates/:id', requireAdminOrManager, async (req: Request, res: Response) => {
  try {
    if (isPracticeModeRequest(req)) {
      return res.json({ deleted: true, id: req.params.id, practiceModeIsolated: true });
    }
    const result = await deleteExchangeRate(req.params.id);
    res.json(result);
  } catch (error: any) {
    const msg = error.message || 'Failed to delete exchange rate';
    const status = msg.includes('not found') ? 404 : 400;
    res.status(status).json({ error: msg });
  }
});

app.get('/api/convert', async (req: Request, res: Response) => {
  try {
    const amount = parseFloat(req.query.amount as string);
    const from = req.query.from as string;
    const to = req.query.to as string;
    const timestamp = req.query.timestamp ? new Date(req.query.timestamp as string) : new Date();

    if (isNaN(amount) || !from || !to) {
      return res.status(400).json({ error: 'amount, from, and to are required query parameters.' });
    }

    const result = await convertAmount(amount, from, to, timestamp);
    res.json(result);
  } catch (error: any) {
    console.error('Failed to convert amount:', error);
    res.status(400).json({ error: error.message || 'Conversion failed' });
  }
});

// API: Products Endpoints
app.get('/api/products', async (req: Request, res: Response) => {
  try {
    if (isPracticeModeRequest(req)) {
      const practice = readPracticeSandboxState();
      return res.json(practice.products || []);
    }
    const query = req.query.q as string | undefined;
    const category = req.query.category as string | undefined;
    const items = await getAllProducts(query, category);
    res.json(items);
  } catch (error: any) {
    console.error('Failed to fetch products:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch products' });
  }
});

app.get('/api/products/:id', async (req: Request, res: Response) => {
  try {
    if (isPracticeModeRequest(req)) {
      const practice = readPracticeSandboxState();
      const found = (practice.products || []).find((p) => p.id === req.params.id);
      if (!found) return res.status(404).json({ error: 'Product not found in Practice Mode' });
      return res.json(found);
    }
    const item = await getProductById(req.params.id);
    if (!item) {
      return res.status(404).json({ error: 'Product not found' });
    }
    res.json(item);
  } catch (error: any) {
    console.error(`Failed to fetch product ${req.params.id}:`, error);
    res.status(500).json({ error: error.message || 'Failed to fetch product' });
  }
});

app.post(
  '/api/products',
  requireServerCapability('products.create', { allowInternalDefaultIfNoHeader: true }),
  async (req: Request, res: Response) => {
    try {
      const {
        name,
        nameAr,
        sku,
        barcode,
        barcodes,
        category,
        categoryAr,
        costPrice,
        sellingPrice,
        priceCurrency,
        stock,
        minStockAlert,
        image,
        imageUrl,
        emoji,
        colorHex,
        serialNumber,
        description,
        descriptionAr,
        previousCostPrice,
        previousSellingPrice,
        priceUpdatedAt,
        priceHistory,
        modificationHistory,
        customFields,
      } = req.body;

      if (!name || !sku) {
        return res.status(400).json({ error: 'Name and SKU are required.' });
      }

      if (isPracticeModeRequest(req)) {
        const practice = readPracticeSandboxState();
        const practiceProduct: any = {
          id: `prac-prod-${Date.now()}`,
          companyId: PRACTICE_COMPANY_ID,
          serialNumber: serialNumber ? Number(serialNumber) : (practice.products?.length || 0) + 1,
          name,
          nameAr,
          description,
          descriptionAr,
          sku,
          barcode: typeof barcode === 'string' ? barcode.trim() : '',
          barcodes: Array.isArray(barcodes) ? barcodes : undefined,
          category: category || 'General',
          categoryAr,
          costPrice: Number(costPrice) || 0,
          sellingPrice: Number(sellingPrice) || 0,
          priceCurrency: priceCurrency || 'SDG',
          stock: Number(stock) || 0,
          minStockAlert: Number(minStockAlert) || 5,
          image: image || imageUrl || undefined,
          emoji: emoji || '📦',
          colorHex: colorHex || '#d97706',
          customFields: customFields || {},
        };
        writePracticeSandboxState({
          ...practice,
          products: [practiceProduct, ...(practice.products || [])],
          updatedAt: new Date().toISOString(),
        });
        return res.status(201).json(practiceProduct);
      }

      const created = await createProduct({
        serialNumber: serialNumber ? Number(serialNumber) : undefined,
        name,
        nameAr,
        description,
        descriptionAr,
        sku,
        barcode: typeof barcode === 'string' ? barcode.trim() : '',
        barcodes: Array.isArray(barcodes) ? barcodes : undefined,
        category: category || 'General',
        categoryAr,
        costPrice: Number(costPrice) || 0,
        sellingPrice: Number(sellingPrice) || 0,
        previousCostPrice,
        previousSellingPrice,
        priceUpdatedAt,
        priceHistory,
        modificationHistory,
        priceCurrency: priceCurrency || 'SDG',
        stock: Number(stock) || 0,
        minStockAlert: Number(minStockAlert) || 5,
        image: image || imageUrl || undefined,
        imageUrl: image || imageUrl || null,
        emoji: emoji || '📦',
        colorHex: colorHex || '#d97706',
        customFields: customFields || {},
      });

      res.status(201).json(created);
    } catch (error: any) {
      console.error('Failed to create product:', error);
      const statusCode = error.message?.includes('Duplicate') ? 409 : 400;
      res.status(statusCode).json({ error: error.message || 'Failed to create product' });
    }
  }
);

app.put(
  '/api/products/:id',
  requireServerCapability('products.edit', { allowInternalDefaultIfNoHeader: true }),
  async (req: Request, res: Response) => {
    try {
      if (isPracticeModeRequest(req)) {
        const practice = readPracticeSandboxState();
        const products = (practice.products || []).map((p) =>
          p.id === req.params.id ? { ...p, ...req.body } : p
        );
        const updated = products.find((p) => p.id === req.params.id);
        if (!updated) {
          return res.status(404).json({ error: 'Practice product not found' });
        }
        writePracticeSandboxState({
          ...practice,
          products,
          updatedAt: new Date().toISOString(),
        });
        return res.json(updated);
      }
      const updated = await updateProduct(req.params.id, req.body);
      res.json(updated);
    } catch (error: any) {
      console.error(`Failed to update product ${req.params.id}:`, error);
      const statusCode = error.message?.includes('Duplicate')
        ? 409
        : error.message?.includes('not found')
        ? 404
        : 400;
      res.status(statusCode).json({ error: error.message || 'Failed to update product' });
    }
  }
);

app.delete(
  '/api/products/:id',
  requireServerCapability('products.delete', { allowInternalDefaultIfNoHeader: true }),
  async (req: Request, res: Response) => {
    try {
      if (isPracticeModeRequest(req)) {
        const practice = readPracticeSandboxState();
        writePracticeSandboxState({
          ...practice,
          products: (practice.products || []).filter((p) => p.id !== req.params.id),
          updatedAt: new Date().toISOString(),
        });
        return res.json({
          success: true,
          practiceModeIsolated: true,
          message: `Practice Product ${req.params.id} deleted.`,
        });
      }
      await deleteProduct(req.params.id);
      res.json({ success: true, message: `Product ${req.params.id} deleted.` });
    } catch (error: any) {
      console.error(`Failed to delete product ${req.params.id}:`, error);
      res.status(500).json({ error: error.message || 'Failed to delete product' });
    }
  }
);

// Multi-Device Shared Store Synchronization (.data/store-state.json)
const STORE_SYNC_FILE = path.resolve(__dirname, '.data', 'store-state.json');

interface SharedStoreState {
  storeCode: string;
  updatedAt: string;
  transactions: any[];
  customers: any[];
  stockMovements: any[];
  users: any[];
  activeSessions: any[];
  unmetDemandRequests?: any[];
}

function readSharedStoreState(): SharedStoreState {
  try {
    if (fs.existsSync(STORE_SYNC_FILE)) {
      const raw = fs.readFileSync(STORE_SYNC_FILE, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (e) {
    console.warn('Could not read store-state.json:', e);
  }
  return {
    storeCode: 'DQ-POS-MAIN',
    updatedAt: new Date().toISOString(),
    transactions: [],
    customers: [],
    stockMovements: [],
    users: [],
    activeSessions: [],
    unmetDemandRequests: [],
  };
}

function writeSharedStoreState(state: SharedStoreState) {
  try {
    const dir = path.dirname(STORE_SYNC_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(STORE_SYNC_FILE, JSON.stringify(state, null, 2), 'utf-8');
  } catch (e) {
    console.warn('Could not write store-state.json:', e);
  }
}

function mergeById<T extends { id?: string; sessionId?: string }>(
  serverList: T[],
  incomingList: T[],
  keyField: 'id' | 'sessionId' = 'id'
): T[] {
  const map = new Map<string, T>();
  for (const item of serverList || []) {
    const k = String((item as any)?.[keyField] || '');
    if (k) map.set(k, item);
  }
  for (const item of incomingList || []) {
    const k = String((item as any)?.[keyField] || '');
    if (k) map.set(k, { ...(map.get(k) || {}), ...item });
  }
  return Array.from(map.values());
}

function resolveRequestCompanyScope(req: Request): string {
  const headerComp = String(req.headers['x-company-id'] || '').trim();
  const queryComp = String(req.query.companyId || '').trim();
  const bodyComp = String(req.body?.companyId || '').trim();
  return headerComp || queryComp || bodyComp || '';
}

function filterByCompanyScope<T extends { companyId?: string }>(
  list: T[],
  companyId: string
): T[] {
  if (!companyId) return list || [];
  return (list || []).filter((item) => !item.companyId || item.companyId === companyId);
}

function tagWithCompanyScope<T extends Record<string, any>>(
  list: T[],
  companyId: string
): T[] {
  if (!companyId) return list || [];
  return (list || []).map((item) => ({
    ...item,
    companyId: item.companyId || companyId,
  }));
}

app.get('/api/store-sync', async (req: Request, res: Response) => {
  try {
    if (isPracticeModeRequest(req)) {
      const practice = readPracticeSandboxState();
      return res.json({
        ...practice,
        storeCode: 'DQ-POS-PRACTICE',
        workspaceMode: 'PRACTICE',
        companyId: PRACTICE_COMPANY_ID,
      });
    }
    const companyId = resolveRequestCompanyScope(req);
    const state = readSharedStoreState();
    const allProducts = await getAllProducts();
    const products = filterByCompanyScope(allProducts as any[], companyId);
    res.json({
      ...state,
      companyId: companyId || undefined,
      transactions: filterByCompanyScope(state.transactions, companyId),
      customers: filterByCompanyScope(state.customers, companyId),
      stockMovements: filterByCompanyScope(state.stockMovements, companyId),
      users: filterByCompanyScope(state.users, companyId),
      activeSessions: filterByCompanyScope(state.activeSessions, companyId),
      unmetDemandRequests: filterByCompanyScope(state.unmetDemandRequests || [], companyId),
      products,
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to read shared store sync state' });
  }
});

app.post('/api/store-sync', async (req: Request, res: Response) => {
  try {
    const {
      transactions,
      customers,
      stockMovements,
      users,
      activeSessions,
      unmetDemandRequests,
    } = req.body || {};

    if (isPracticeModeRequest(req)) {
      const currentPractice = readPracticeSandboxState();
      const nextPractice = {
        ...currentPractice,
        updatedAt: new Date().toISOString(),
        transactions: Array.isArray(transactions)
          ? mergeById(currentPractice.transactions, transactions, 'id')
          : currentPractice.transactions,
        customers: Array.isArray(customers)
          ? mergeById(currentPractice.customers, customers, 'id')
          : currentPractice.customers,
        stockMovements: Array.isArray(stockMovements)
          ? mergeById(currentPractice.stockMovements, stockMovements, 'id')
          : currentPractice.stockMovements,
        users: Array.isArray(users)
          ? mergeById(currentPractice.users, users, 'id')
          : currentPractice.users,
        activeSessions: Array.isArray(activeSessions)
          ? mergeById(currentPractice.activeSessions, activeSessions, 'sessionId')
          : currentPractice.activeSessions,
        unmetDemandRequests: Array.isArray(unmetDemandRequests)
          ? mergeById(currentPractice.unmetDemandRequests || [], unmetDemandRequests, 'id')
          : currentPractice.unmetDemandRequests || [],
      };
      writePracticeSandboxState(nextPractice);
      return res.json({
        ...nextPractice,
        storeCode: 'DQ-POS-PRACTICE',
        workspaceMode: 'PRACTICE',
        companyId: PRACTICE_COMPANY_ID,
      });
    }

    const companyId = resolveRequestCompanyScope(req);
    const current = readSharedStoreState();
    const nextState: SharedStoreState = {
      storeCode: 'DQ-POS-MAIN',
      updatedAt: new Date().toISOString(),
      transactions: Array.isArray(transactions)
        ? mergeById(current.transactions, tagWithCompanyScope(transactions, companyId), 'id')
        : current.transactions,
      customers: Array.isArray(customers)
        ? mergeById(current.customers, tagWithCompanyScope(customers, companyId), 'id')
        : current.customers,
      stockMovements: Array.isArray(stockMovements)
        ? mergeById(current.stockMovements, tagWithCompanyScope(stockMovements, companyId), 'id')
        : current.stockMovements,
      users: Array.isArray(users)
        ? mergeById(current.users, tagWithCompanyScope(users, companyId), 'id')
        : current.users,
      activeSessions: Array.isArray(activeSessions)
        ? mergeById(current.activeSessions, tagWithCompanyScope(activeSessions, companyId), 'sessionId')
        : current.activeSessions,
      unmetDemandRequests: Array.isArray(unmetDemandRequests)
        ? mergeById(
            current.unmetDemandRequests || [],
            tagWithCompanyScope(unmetDemandRequests, companyId),
            'id'
          )
        : current.unmetDemandRequests || [],
    };

    writeSharedStoreState(nextState);
    const allProducts = await getAllProducts();
    res.json({
      ...nextState,
      companyId: companyId || undefined,
      transactions: filterByCompanyScope(nextState.transactions, companyId),
      customers: filterByCompanyScope(nextState.customers, companyId),
      stockMovements: filterByCompanyScope(nextState.stockMovements, companyId),
      users: filterByCompanyScope(nextState.users, companyId),
      activeSessions: filterByCompanyScope(nextState.activeSessions, companyId),
      unmetDemandRequests: filterByCompanyScope(nextState.unmetDemandRequests || [], companyId),
      products: filterByCompanyScope(allProducts as any[], companyId),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to sync shared store state' });
  }
});

// Full-stack Vite development integration
if (process.env.NODE_ENV !== 'production') {
  const { createServer } = await import('vite');
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
} else {
  // Production static file hosting
  app.use(express.static(path.resolve(__dirname, 'dist')));
  app.get('*', (req: Request, res: Response) => {
    res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
  });
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Dqnamo POS Backend Server listening on http://0.0.0.0:${PORT}`);
});
