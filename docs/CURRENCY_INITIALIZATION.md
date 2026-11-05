# Currency Initialization & Full Customization — Dqnamo POS

## 1. Zero Automatic Company Currencies Policy
In Production Mode, Dqnamo POS does **not** automatically insert active company currencies or sample exchange rates (`USD = 2700`, `SAR = 720`, `AED = 735`) as if the owner configured them.

---

## 2. Currency Setup & Customization Capabilities
1. **Onboarding Choice (Step 2):**
   - The owner can check **"Skip Currency Setup Now"** (`skipInitialCurrencies: true`) to start the company with **0 currencies** (`currencies: []`) and configure them manually in Settings.
   - Or the owner can specify the base currency (e.g., `SDG`) and optionally enable secondary currencies with explicit exchange rates.
2. **Full Manual Customization in Settings (`ExchangeRateSettings.tsx`):**
   - **Add Any Currency:** Enter any currency code (`SDG`, `USD`, `SAR`, `EGP`, `EUR`, etc.), English name, Arabic name, symbol, decimal places, and check **"Set as Store Base Currency"** (`isBase`) or enter its exchange rate to the base currency.
   - **Set Base Currency Anytime:** Click the **"Base / أساسية"** button on any configured currency card to designate it as the store's accounting base currency (`setBaseCurrencyCode`).
   - **Delete Any Currency:** Every currency card (including the base currency) has a delete button (`removeCurrency`) so the owner can remove any currency they did not intend to keep.
   - **Clear All Currencies:** A dedicated **"Clear All Currencies / مسح جميع العملات"** button (`clearAllCurrencies`) wipes all configured currencies and exchange rates back to `0` (`[]`).
3. **Historical Transaction Integrity:**
   - Every completed sale records an immutable snapshot of `currency`, `exchangeRateUsed`, and `totalInBaseSdg` at the moment of checkout.
   - Subsequent exchange rate updates do **not** silently rewrite historical financial transactions unless an authorized user explicitly invokes the debt repricing workflow.
