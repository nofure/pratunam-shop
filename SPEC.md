# ระบบร้าน — build spec (contract for every agent)

A point-of-sale + daily cash close + stock + expenses + reports web app for a Thai market
clothing/shoe shop with several booths (แผง). It must be usable **today** by real sellers on cheap
Android phones/tablets, fully offline, in Thai.

## 1. The shop (why the design looks like this)

- Booths sell T-shirts/jerseys, women's pants/skirts, slacks/jeans, shoes/slides/clogs, backpacks.
- Goods are priced **per rack/bin price card**, not per item: 39, 59, 100, 129, 139, 200, 259, 299, 359, 399…
  Quantity promos exist: "39 · 3 ตัว 100", "59 · 2 ตัว 100".
- So we sell by **price buttons** (`Tier` = category name + price + optional qty promo, per booth). No barcodes.
- Payments: cash (most), PromptPay transfer (QR), คนละครึ่ง (government co-pay, the shop receives it in the
  ถุงเงิน app), optionally "other".
- Sellers are staff who may be older and not tech-savvy; the owner is often not at the booth.
  Biggest wins: every sale recorded in 2–3 taps, a daily cash close that shows ขาด/เกิน, and a summary the
  owner receives on LINE.
- Customers bargain (ลูกค้าต่อ) → manual discount must be quick and recorded.

## 2. Stack & rules

- Vite 6 + React 19 + TypeScript 5.9 (strict, `noUnusedLocals`), React Router 6 **HashRouter**, Dexie 4
  (IndexedDB) + `dexie-react-hooks` (`useLiveQuery`), `lucide-react` icons, `qrcode` for QR, vite-plugin-pwa.
- **Do not add npm dependencies.** Everything needed is installed. Do not edit package.json, vite.config.ts,
  tsconfig.json, index.html.
- Plain CSS only (no Tailwind, no CSS-in-JS libs). Tokens are in `src/styles.css` (`--primary`, `--accent`,
  `--danger`, `--surface`, `--border`, `--radius`, `--h-control` …). Use them; never hard-code new colors
  except `TIER_COLORS` in `src/constants.ts`. Feature-specific CSS goes in a CSS file inside your own folder,
  imported by your component, with class names prefixed by the feature (e.g. `.pos-…`, `.shift-…`).
- Light theme only. Mobile-first (360px wide phones) and must also look right on tablets/desktop (≥ 900px:
  side nav; use the extra width, e.g. POS grid + cart side by side).
- Touch targets ≥ 48px (`--h-control`). Money numbers big and clear, `font-variant-numeric: tabular-nums`
  (class `num`).
- Language: **all UI text in Thai**, short and plain. No "กรุณา", no exclamation marks, no English jargon
  (say "ซิงก์" only in sync settings). Buttons are verbs: "บันทึก", "รับเงิน", "ปิดยอด". Use ฿ or "บาท"
  consistently via `baht()` / `bahtSign()` from `src/lib/format.ts`. Dates via `thaiDate()` etc.
- Code (identifiers, comments) in English. Keep comments sparse and useful.
- Must work without network. Never block the UI on sync.
- Money math: amounts are baht numbers; round with `round2()` from `src/lib/format.ts` when dividing
  (unit cost = total / qty). Prices are integers in practice but don't assume it for costs.
- Business day = `dayKey` ('YYYY-MM-DD', local time). Sales/cash moves take the **shift's** dayKey (a night
  market past midnight still counts for the opening day). Lots/adjustments/expenses use the date the user
  picks (default today).

## 3. Data layer (already written — read, don't rewrite)

- `src/types.ts` — every record type. Read it first.
- `src/db.ts` — Dexie `db` with tables `shop, booths, staff, tiers, sales, shifts, cashMoves, lots,
  adjustments, suppliers, expenses`. **Write only through `save(table, rec)`, `saveMany`, `patch(table, id,
  changes)`, `remove(table, id)`** (soft delete). They stamp id/createdAt/updatedAt/deviceId/synced.
  Never `table.put/add/delete` directly. Exceptions: the sync module, and `importBackup()` in
  `src/lib/backup.ts`, which `bulkPut`s restored rows keeping their own `updatedAt` (so an old backup never
  wins last-write-wins against newer edits on other devices) and with `synced: 0` (so they are pushed).
  Filter reads with `alive(rows)` (drops `deleted: 1`). Use `db.transaction('rw', [...tables], async () => …)`
  when writing several related records.
- `src/device.ts` — per-device localStorage config: `getDevice()`, `setDevice()`, `useDevice()`
  (`boothId` of this device, sync URL/key, `lineNotify`, `autoLockMin`).
- `src/session.tsx` — `useSession()` → `{ staff, isOwner, login, logout }`; `findOwnerByPin(pin)`.
- `src/hooks.ts` — `useShop()`, `useBooths()`, `useStaffList()`, `useTiers(boothId)`, `useAllTiers()`,
  `useOpenShift(boothId)`, `useCurrentBooth()`. `undefined` = loading.
- `src/constants.ts` — Thai labels: `PAY_METHOD_LABEL`, `EXPENSE_CATEGORY_LABEL`, `ADJUST_REASON_LABEL`,
  `TIER_COLORS`, `UNITS`, `DENOMINATIONS`, `CASH_OUT_PRESETS`, `CASH_IN_PRESETS`, `VOID_REASONS`.
- `src/seed.ts` — `PHOTO_TEMPLATE` and `createInitialData(setup)` used by the setup wizard.
- `src/lib/dates.ts` — `todayKey`, `dayKeyOf`, `addDays`, `eachDay`, `startOfMonth`, `endOfMonth`,
  `addMonths`, `diffDays`, `presetRange`, `PRESET_LABEL`, `RangePreset`, `DayRange`, `inRange`.
- `src/lib/format.ts` — `round2`, `baht`, `bahtSign`, `signed`, `num`, `thaiDate`, `thaiDateShort`,
  `thaiDateLong`, `thaiMonth`, `timeHM`, `dateTime`.
- App shell: `src/App.tsx` (routes + `OwnerOnly`), `src/Layout.tsx` (top bar, nav, booth picker),
  `src/features/more/MorePage.tsx`. Routes: `/setup`, `/login`, `/pos`, `/bills`, `/shift`,
  `/shift/history`, `/stock/*`, `/expenses` (owner), `/reports/*` (owner), `/settings/*` (owner), `/more`.

Invariants every module must respect:
- A paid `Sale` is never edited. Voiding sets `status: 'void'`, `voidReason`, `voidedAt`, `voidedBy`.
  Void requires an owner PIN when `shop.voidNeedsOwner === 1` and the current user isn't the owner.
- Only one open shift per booth. Selling requires an open shift for the device's booth; if none, POS shows a
  big "เปิดร้าน" call-to-action (link to `/shift`).
- `Sale.total = subtotal − promoDiscount − manualDiscount`, never negative; `pieces = Σ qty`.
- Expected cash in drawer = `openingFloat + cash sales (paid) + cashIn − cashOut`.
- Stock on hand per tier = `Σ lot.qty + Σ adjustment.qtyChange − Σ qty sold (paid sales)`.
- COGS of a sold item = qty × weighted-average unit cost of that tier's lots (unknown if no lots / no tier).
- Expenses in reports = `Expense` records + `CashMove` of type `out` with `category !== null`.

## 4. Domain API (`src/domain/*`, `src/lib/promptpay.ts`, `src/lib/share.ts`) — pure functions, unit-tested

```ts
// src/domain/pricing.ts
export function promoLineTotal(price: number, qty: number, promoQty: number | null, promoPrice: number | null): number
export interface CartLine { key: string; tierId: ID | null; name: string; unit: string; price: number; qty: number; promoQty: number | null; promoPrice: number | null }
export interface CartTotals { items: SaleItem[]; pieces: number; subtotal: number; promoDiscount: number; manualDiscount: number; total: number }
export function lineFromTier(t: Tier): CartLine            // key = t.id, qty 1
export function customLine(name: string, price: number, unit?: string): CartLine  // tierId null, unique key
export function addLine(lines: CartLine[], line: CartLine): CartLine[]            // merge by key (qty += line.qty)
export function setLineQty(lines: CartLine[], key: string, qty: number): CartLine[] // qty <= 0 removes
export function computeCart(lines: CartLine[], manualDiscount: number): CartTotals  // clamps discount to [0, subtotal − promo]
export function cashChange(total: number, received: number): number              // received − total (can be < 0)
export function quickCashOptions(total: number): number[]  // e.g. 139 → [139, 140, 150, 200, 500, 1000]; ascending, unique, ≥ total, max 6

// src/domain/shift.ts
export function computeShiftTotals(openingFloat: number, sales: Sale[], moves: CashMove[]): ShiftTotals // ignores deleted rows
export function denominationTotal(d: Record<string, number>): number
export function nextBillNo(salesInShift: Sale[]): number   // max(billNo)+1, 1 if none
export function cashDiffTone(diff: number): 'ok' | 'short' | 'over'
export function topItems(sales: Sale[], limit?: number): { tierId: ID | null; name: string; price: number; unit: string; qty: number; total: number }[]

// src/domain/stock.ts
export interface TierStock { tierId: ID; received: number; sold: number; adjusted: number; onHand: number; avgCost: number | null; stockValue: number | null; lastReceived: DayKey | null; lastSold: DayKey | null }
export function avgCostByTier(lots: Lot[]): Map<ID, number>
export function computeStock(tiers: Tier[], lots: Lot[], adjustments: Adjustment[], sales: Sale[]): Map<ID, TierStock>
export function isLowStock(t: Tier, s: TierStock | undefined): boolean // trackStock && lowStock != null && onHand <= lowStock

// src/domain/reports.ts
export interface ReportInput { from: DayKey; to: DayKey; boothId: ID | null; sales: Sale[]; shifts: Shift[]; cashMoves: CashMove[]; expenses: Expense[]; lots: Lot[]; adjustments: Adjustment[]; tiers: Tier[]; booths: Booth[]; staff: Staff[] }
export interface Report { … see file … }   // totals, byMethod, byBooth, byTier, byCategory, byStaff, byHour[24], byDay (every day in range),
                                           // cogs, cogsUnknownSales, grossProfit, expenses {total, byCategory}, netProfit, cashDiffs, voids
export function buildReport(input: ReportInput): Report
export function slowMovers(tiers: Tier[], stock: Map<ID, TierStock>, today: DayKey, days?: number): { tier: Tier; stock: TierStock; daysSinceLastSale: number | null }[]
export function lowStockList(tiers: Tier[], stock: Map<ID, TierStock>): { tier: Tier; stock: TierStock }[]

// src/domain/summary.ts — plain-text summaries for LINE (short lines, Thai, no emoji spam)
export function shiftSummaryText(o: { shopName: string; boothName: string; staffName: string; shift: Shift; totals: ShiftTotals; top: ReturnType<typeof topItems> }): string
export function daySummaryText(o: { shopName: string; dayKey: DayKey; report: Report; low: { tier: Tier; stock: TierStock }[] }): string
export function lineShareUrl(text: string): string           // https://line.me/R/share?text=<encoded>

// src/lib/promptpay.ts — Thai QR (EMVCo) payload
export function promptPayTargetType(target: string): 'phone' | 'nationalId' | 'ewallet' | null
export function isValidPromptPayTarget(target: string): boolean
export function promptPayPayload(target: string, amount?: number): string

// src/lib/share.ts — browser helpers
export async function shareOrCopy(text: string, title?: string): Promise<'shared' | 'copied' | 'failed'>
export async function copyText(text: string): Promise<boolean>
export function downloadText(filename: string, text: string, mime?: string): void  // CSV gets a UTF-8 BOM for Excel
export function toCsv(rows: (string | number | null | undefined)[][]): string
```

## 5. UI kit (`src/ui/*`, exported from `src/ui/index.tsx`)

```tsx
<UIProvider>                          // wraps the app (already wired in App.tsx); hosts toasts + confirm dialog
useToast(): (text: string, tone?: 'success' | 'error' | 'info') => void
useConfirm(): (o: { title: string; message?: ReactNode; confirmText?: string; cancelText?: string; danger?: boolean }) => Promise<boolean>
<Button variant="primary|secondary|ghost|danger|accent" size="md|lg|xl" block icon={<Icon/>} loading …buttonProps>
<IconButton label="…" icon={<Icon/>} …buttonProps>
<Card title? actions? className?>…</Card>
<PageHeader title back?={string path | true} actions?/>
<Field label hint? error?>{input}</Field>      // plus classes .input .select .textarea on native elements
<MoneyInput value={number|null} onChange={(n: number|null) => void} placeholder? autoFocus? allowDecimal?/>
<NumPad value={string} onChange={(s: string) => void} allowDecimal? maxLength?/>   // big on-screen keypad
<PinPad length={4..6} onComplete={(pin) => void} error?={string} title?/>        // dots + keypad, clears on error
<Modal open onClose title? footer? size?="md|lg">…</Modal>                    // bottom sheet on phones, dialog on wide
<Segmented options={{value, label}[]} value onChange/>
<Stat label value sub? tone?="default|success|danger|warning"/>
<Badge tone="neutral|success|danger|warning|info|accent">…</Badge>
<EmptyState title hint? action?/>
<Money value={number} size?="sm|md|lg|xl" signed?/>                             // formatted baht, tabular nums
<QrCode text size?/>                                                            // renders with the `qrcode` package
<BarChart data={{ label: string; value: number; highlight?: boolean }[]} height? format?={(v)=>string}/>
<HBarList rows={{ label: string; value: number; sub?: string }[]} format?/>
<DateRangePicker value={DayRange} onChange={(r: DayRange) => void}/>          // preset chips + custom from/to
<Toggle checked onChange label/>
```
Global component classes available to everyone: `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-ghost`,
`.btn-danger`, `.btn-accent`, `.btn-lg`, `.btn-xl`, `.btn-block`, `.input`, `.select`, `.textarea`, `.card`,
`.row` (flex row gap), `.stack` (flex column gap), `.grid-2`, `.grid-3`, `.chip`, `.chip.active`,
`.table` (simple data table), `.section-title`, `.divider`, `.tone-success|danger|warning|info` (text colors).

## 6. File ownership (agents must only create/edit files they own)

| Owner | Files |
|---|---|
| domain | `src/domain/**`, `src/lib/promptpay.ts`, `src/lib/share.ts`, `src/**/*.test.ts` for those |
| ui | `src/ui/**` |
| sync | `src/sync/**`, `backend/**`, `docs/sync-setup.md` |
| pos | `src/features/pos/**` |
| shift | `src/features/shift/**` |
| stock | `src/features/stock/**` |
| expenses | `src/features/expenses/**` |
| reports | `src/features/reports/**` |
| settings | `src/features/settings/**`, `src/features/auth/**`, `src/lib/backup.ts`, `src/lib/demo.ts` |

If you need a change in a file you don't own, don't make it — note it in your final report under
"CROSS-MODULE REQUESTS" with the exact change. Shared files (`src/types.ts`, `db.ts`, `hooks.ts`, …) are
owned by the lead; request changes the same way.

## 7. Definition of done for every agent
- `npx tsc -b` passes with zero errors for your files (other agents' in-progress files may still error —
  report, don't fix them). `npx vitest run <your tests>` passes if you wrote tests.
- Every page handles loading (`undefined`), empty, and error states; destructive actions confirm.
- Works at 360px wide and at 1280px wide.
- Final report: files created, what works, known gaps, cross-module requests.
