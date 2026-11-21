import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { BellRing, ChefHat, CloudOff, Globe, LogOut, Menu, RefreshCw } from 'lucide-react';
import { db } from './lib/db';
import { useLive } from './lib/useLive';
import { initializeApp, readSession, signOut } from './lib/auth';
import { getSyncStatus, startSync, stopSync, subscribeToSync, syncNow } from './lib/sync';
import { addToCart, calculateCartTotals, countCartByMenuId, setQty } from './lib/cart';
import type { CartCharges } from './lib/cart';
import { getCustomer } from './lib/customers';
import { holdOrder } from './lib/held';
import { setOrderStatus } from './lib/onlineOrders';
import { formatAmount } from './lib/format';
import { MIN_DELIVERY_ORDER, recordSale, reopenSale, verifyStock } from './lib/sales';
import { printReceipt } from './lib/receipt';
import { getPrinterSettings, restorePrinterDevice } from './lib/printer';
import { LoginScreen } from './components/LoginScreen';
import { Sidebar } from './components/Sidebar';
import { MenuGrid } from './components/MenuGrid';
import { CartPanel } from './components/CartPanel';
import { PaymentModal } from './components/PaymentModal';
import { ModifierModal } from './components/ModifierModal';
import { HeldOrdersModal } from './components/HeldOrdersModal';
import { DeliveriesModal } from './components/DeliveriesModal';
import { CustomersModal } from './components/CustomersModal';
import { SalesHistoryModal } from './components/SalesHistoryModal';
import { InventoryModal } from './components/InventoryModal';
import { LiveStockPanel } from './components/LiveStockPanel';
import { SuppliersModal } from './components/SuppliersModal';
import { ExpensesModal } from './components/ExpensesModal';
import { SalesAnalyticsModal } from './components/SalesAnalyticsModal';
import { ProfitLossModal } from './components/ProfitLossModal';
import { StaffModal } from './components/StaffModal';
import { OpeningCashModal } from './components/OpeningCashModal';
import { ShiftSummaryModal } from './components/ShiftSummaryModal';
import { ActivityLogModal } from './components/ActivityLogModal';
import { PrinterSettingsModal } from './components/PrinterSettingsModal';
import { AdminSettingsModal } from './components/AdminSettingsModal';
import { OnlineOrdersModal } from './components/OnlineOrdersModal';
import { KitchenDisplayModal } from './components/KitchenDisplayModal';
import { useOrderAlert } from './hooks/useOrderAlert';
import type { CartItem, CustomerInfo, MenuItem, OnlineOrder, PaymentDetail, Sale, User, UserRole } from './lib/db/types';

type Session = { username: string; role: UserRole };

const EMPTY_CHARGES: CartCharges = {
  orderType: 'DINE_IN',
  tableNumber: undefined,
  discountPercent: 0,
  deliveryCharge: 0,
  packingCharge: 0,
  taxPercent: 0,
  otherCharge: 0,
  loyaltyPoints: 0,
};

function App() {
  const [session, setSession] = useState<Session | null>(readSession());
  const [cart, setCart] = useState<CartItem[]>([]);
  const [charges, setCharges] = useState<CartCharges>(EMPTY_CHARGES);
  const [customer, setCustomer] = useState<CustomerInfo>({});
  const [loyaltyBalance, setLoyaltyBalance] = useState(0);
  const [modifying, setModifying] = useState<MenuItem | null>(null);
  const [paying, setPaying] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [heldOpen, setHeldOpen] = useState(false);
  const [deliveriesOpen, setDeliveriesOpen] = useState(false);
  const [customersOpen, setCustomersOpen] = useState(false);
  const [salesOpen, setSalesOpen] = useState(false);
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [suppliersOpen, setSuppliersOpen] = useState(false);
  const [expensesOpen, setExpensesOpen] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [pnlOpen, setPnlOpen] = useState(false);
  const [staffOpen, setStaffOpen] = useState(false);
  const [openingCashOpen, setOpeningCashOpen] = useState(false);
  const [shiftSummaryOpen, setShiftSummaryOpen] = useState(false);
  const [activityLogOpen, setActivityLogOpen] = useState(false);
  const [printerOpen, setPrinterOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [onlineOrdersOpen, setOnlineOrdersOpen] = useState(false);
  const [kdsOpen, setKdsOpen] = useState(false);
  const [activeOnlineOrder, setActiveOnlineOrder] = useState<OnlineOrder | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [lastAddedMenuId, setLastAddedMenuId] = useState<string | null>(null);
  const [lastAddedLineId, setLastAddedLineId] = useState<string | null>(null);

  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const addedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const totals = calculateCartTotals(cart, charges);
  const cartQtyByMenuId = useMemo(() => countCartByMenuId(cart), [cart]);

  useEffect(() => {
    initializeApp().catch((err) => console.error('App init failed:', err));
    restorePrinterDevice().catch(() => {});
  }, []);

  useEffect(() => {
    if (!session) return;
    startSync();
    return stopSync;
  }, [session]);

  useEffect(() => {
    let active = true;
    getCustomer(customer.phone).then((found) => {
      if (active) setLoyaltyBalance(found?.loyaltyPoints || 0);
    });
    return () => {
      active = false;
    };
  }, [customer.phone]);

  const notify = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (addedTimerRef.current) clearTimeout(addedTimerRef.current);
    };
  }, []);

  const { pendingCount: pendingOnlineCount, recentArrival: onlineOrderPulse } = useOrderAlert(notify, onlineOrdersOpen);

  const addCartItem = useCallback(
    (cartItem: CartItem) => {
      const existing = cart.find((i) => i.id === cartItem.id);
      const nextQty = existing ? existing.qty + 1 : cartItem.qty;
      setCart((current) => addToCart(current, cartItem));
      setLastAddedMenuId(cartItem.menuItemId || cartItem.id);
      setLastAddedLineId(cartItem.id);
      if (addedTimerRef.current) clearTimeout(addedTimerRef.current);
      addedTimerRef.current = setTimeout(() => {
        setLastAddedMenuId(null);
        setLastAddedLineId(null);
      }, 950);
      notify(`Added ${cartItem.name} to cart (×${nextQty})`);
    },
    [cart, notify],
  );

  function pickItem(item: MenuItem) {
    if (item.modifierGroups?.length) {
      setModifying(item);
      return;
    }
    addCartItem({ id: item.id, menuItemId: item.id, name: item.name, price: item.price, qty: 1 });
  }

  const resetOrder = useCallback(() => {
    setCart([]);
    setCharges(EMPTY_CHARGES);
    setCustomer({});
    setLoyaltyBalance(0);
    setActiveOnlineOrder(null);
  }, []);

  const hold = useCallback(async () => {
    if (!cart.length) return;
    const id = await holdOrder(cart, charges, customer.phone ? customer : undefined, session?.username || 'Staff');
    resetOrder();
    notify(`Held order #${id}${charges.tableNumber ? ` (${charges.tableNumber})` : ''}.`);
  }, [cart, charges, customer, notify, resetOrder, session?.username]);

  const startCheckout = useCallback(async () => {
    if (!cart.length) return;
    if (session?.role === 'WAITER') {
      notify('Waiters cannot take payments. Ask a cashier or manager.');
      return;
    }
    if (charges.orderType === 'DELIVERY' && !customer.phone?.trim()) {
      notify('Delivery orders need a customer phone number.');
      return;
    }
    if (charges.orderType === 'DELIVERY' && totals.subtotal - totals.discountAmount < MIN_DELIVERY_ORDER) {
      notify(`Minimum order total for delivery is ${formatAmount(MIN_DELIVERY_ORDER)}.`);
      return;
    }
    const stockError = await verifyStock(cart);
    if (stockError) {
      notify(stockError);
      return;
    }
    setPaying(true);
  }, [cart, charges.orderType, customer.phone, notify, session?.role, totals.discountAmount, totals.subtotal]);

  useEffect(() => {
    if (!session) return;
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if (e.key === '/' && !isInput) {
        e.preventDefault();
        document.getElementById('posMenuSearchInput')?.focus();
      } else if (e.key === 'F2' && cart.length > 0 && !paying) {
        e.preventDefault();
        void startCheckout();
      } else if (e.key === 'F4' && cart.length > 0 && !paying) {
        e.preventDefault();
        void hold();
      } else if (e.key === 'F8') {
        e.preventDefault();
        setKdsOpen((prev) => !prev);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [session, cart.length, paying, hold, startCheckout]);

  async function closeOnlineOrder(saleId: number) {
    const order = activeOnlineOrder;
    if (!order?.id) return;
    const status = order.orderType === 'DELIVERY' ? 'PREPARING' : 'COMPLETED';
    await db.onlineOrders.update(order.id, { saleId });
    await setOrderStatus(order.id, status, session?.username || 'Staff');
  }

  async function complete(payments: PaymentDetail[]) {
    if (charges.orderType === 'DELIVERY' && !customer.phone?.trim()) {
      notify('Delivery orders need a customer phone number.');
      return;
    }
    if (charges.orderType === 'DELIVERY' && totals.subtotal - totals.discountAmount < MIN_DELIVERY_ORDER) {
      notify(`Minimum order total for delivery is ${formatAmount(MIN_DELIVERY_ORDER)}.`);
      return;
    }

    const stockError = await verifyStock(cart);
    if (stockError) {
      notify(stockError);
      return;
    }

    const tableNumber = charges.orderType === 'DINE_IN' ? charges.tableNumber : undefined;

    try {
      const saleId = await recordSale({
        items: cart,
        orderType: charges.orderType,
        tableNumber,
        serverUser: session?.username || 'Staff',
        subtotal: totals.subtotal,
        discountPercent: charges.discountPercent,
        discountAmount: totals.discountAmount,
        deliveryCharge: totals.deliveryCharge,
        packingCharge: totals.packingCharge,
        taxPercent: charges.taxPercent,
        taxAmount: totals.taxAmount,
        otherCharge: totals.otherCharge,
        loyaltyRedeemPoints: charges.loyaltyPoints,
        loyaltyDiscount: totals.loyaltyDiscount,
        total: totals.grandTotal,
        payments,
        customer: customer.phone ? customer : undefined,
        deliveryInfo: charges.orderType === 'DELIVERY' ? customer : undefined,
        onlineOrderId: activeOnlineOrder?.cloudId ?? null,
      });
      closeOnlineOrder(saleId);
      const sale: Sale = {
        id: saleId,
        timestamp: new Date().toISOString(),
        orderType: charges.orderType,
        tableNumber,
        serverUser: session?.username || 'Staff',
        items: cart,
        subtotal: totals.subtotal,
        discountPercent: charges.discountPercent,
        discountAmount: totals.discountAmount,
        deliveryCharge: totals.deliveryCharge,
        packingCharge: totals.packingCharge,
        taxPercent: charges.taxPercent,
        taxAmount: totals.taxAmount,
        otherCharge: totals.otherCharge,
        total: totals.grandTotal,
        payments,
        customer: customer.phone ? customer : undefined,
        deliveryInfo: charges.orderType === 'DELIVERY' ? customer : undefined,
        totalReceived: totals.grandTotal,
        totalChange: payments.reduce((sum, p) => sum + (Number(p.change) || 0), 0),
      };
      resetOrder();
      setPaying(false);
      notify(`Sale #${saleId} completed — ${formatAmount(totals.grandTotal)}`);
      getPrinterSettings().then((printer) => {
        if (!printer.autoPrint) return;
        setTimeout(() => {
          printReceipt(sale)
            .then((how) => {
              if (how === 'browser') notify('Printer unavailable — printing from the browser instead.');
            })
            .catch((e) => {
              console.error('Print receipt failed', e);
              notify('Printing failed. Sale was still recorded.');
            });
        }, 300);
      });
    } catch (err) {
      console.error('Sale failed:', err);
      notify('Failed to process sale. Please try again.');
    }
  }

  if (!session) {
    return <LoginScreen onSignedIn={(user: User) => setSession({ username: user.username, role: user.role })} />;
  }

  return (
    <div className="h-screen overflow-hidden bg-ui-bg flex flex-col">
      <header className="bg-white px-2.5 sm:px-6 h-14 flex justify-between items-center gap-1.5 sm:gap-3 sticky top-0 z-40 border-b border-[#d4d4d8] shrink-0">
        <div className="flex items-center gap-1.5 sm:gap-3 min-w-0">
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            aria-label="Open navigation"
            className="relative lg:hidden w-9 h-9 shrink-0 rounded-[8px] border border-[#788991] bg-white hover:bg-[#eff6ff] text-[#000000] flex items-center justify-center"
          >
            <Menu className="w-4 h-4" aria-hidden />
            {pendingOnlineCount > 0 && (
              <span
                aria-hidden
                className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-[#5b3ee0] ring-2 ring-white animate-pulse"
              />
            )}
          </button>
          <h1 className="font-display text-sm sm:text-xl font-medium tracking-normal flex items-center gap-1.5 sm:gap-2.5 min-w-0">
            <img src="/logo.svg" alt="" className="w-7 h-7 sm:w-8 sm:h-8 shrink-0" />
            <span
              className={`text-[#000000] truncate ${
                pendingOnlineCount > 0 ? 'sr-only sm:not-sr-only' : ''
              }`}
            >
              Hungry Birds
            </span>
          </h1>
          <span className="hidden sm:inline-flex text-xs px-3 py-1 rounded-[88px] bg-[#eff6ff] font-semibold text-[#2941e0] shrink-0">
            {session.role}
          </span>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setOnlineOrdersOpen(true)}
            title={
              pendingOnlineCount > 0
                ? `${pendingOnlineCount} pending online ${pendingOnlineCount === 1 ? 'order' : 'orders'}`
                : 'Open Online Orders'
            }
            aria-label={
              pendingOnlineCount > 0
                ? `Online orders (${pendingOnlineCount} pending)`
                : 'Online orders'
            }
            className={`relative px-2.5 sm:px-3.5 h-9 rounded-[8px] text-xs font-semibold transition flex items-center gap-1.5 shrink-0 ${
              pendingOnlineCount > 0
                ? `bg-[#5b3ee0] hover:bg-[#4c31c9] text-white shadow-sm ${
                    onlineOrderPulse ? 'ring-2 ring-[#c5b9fa] animate-pulse' : ''
                  }`
                : 'bg-[#eff6ff] hover:bg-[#e0edff] text-[#2941e0]'
            }`}
          >
            {pendingOnlineCount > 0 ? (
              <>
                <span className="relative flex h-2 w-2 shrink-0" aria-hidden>
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-white" />
                </span>
                <BellRing className="w-4 h-4 shrink-0" aria-hidden />
                <span className="hidden sm:inline">Online</span>
                <span className="px-1.5 py-0.5 rounded-full bg-white text-[#5b3ee0] text-[11px] font-bold leading-none tabular-nums">
                  {pendingOnlineCount}
                </span>
              </>
            ) : (
              <>
                <Globe className="w-4 h-4 shrink-0" aria-hidden />
                <span className="hidden sm:inline">Online</span>
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => setKdsOpen(true)}
            title="Open Kitchen Display System (F8)"
            className="bg-[#eff6ff] hover:bg-[#e0edff] text-[#2941e0] px-2.5 sm:px-3.5 h-9 rounded-[8px] text-xs font-semibold transition flex items-center gap-1 sm:gap-1.5 shrink-0"
          >
            <ChefHat className="w-4 h-4 shrink-0" aria-hidden /> <span>KDS</span>
          </button>
          <SyncBadge />
          <span className="hidden lg:inline text-xs text-[#526066]">
            Welcome, <strong className="font-medium text-[#000000]">{session.username}</strong>
          </span>
          <button
            type="button"
            onClick={() => {
              signOut();
              setSession(null);
              setCart([]);
            }}
            aria-label="Logout"
            className="bg-white hover:bg-red-50 text-[#000000] hover:text-red-700 border border-[#788991] px-2.5 sm:px-4 h-9 rounded-[8px] text-xs font-medium transition flex items-center gap-1 sm:gap-1.5 shrink-0"
          >
            <LogOut className="w-3.5 h-3.5 shrink-0" aria-hidden /> <span className="hidden min-[360px]:inline">Logout</span>
          </button>
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        <Sidebar
          role={session.role}
          username={session.username}
          open={navOpen}
          onClose={() => setNavOpen(false)}
          onSignOut={() => {
            signOut();
            setSession(null);
            setCart([]);
          }}
          onOpenKds={() => setKdsOpen(true)}
          onOpenHeldOrders={() => setHeldOpen(true)}
          onOpenDeliveries={() => setDeliveriesOpen(true)}
          onOpenCustomers={() => setCustomersOpen(true)}
          onOpenInventory={() => setInventoryOpen(true)}
          onOpenSuppliers={() => setSuppliersOpen(true)}
          onOpenExpenses={() => setExpensesOpen(true)}
          onOpenAnalytics={() => setAnalyticsOpen(true)}
          onOpenPnl={() => setPnlOpen(true)}
          onOpenStaff={() => setStaffOpen(true)}
          onOpenOpeningCash={() => setOpeningCashOpen(true)}
          onOpenShiftSummary={() => setShiftSummaryOpen(true)}
          onOpenActivityLog={() => setActivityLogOpen(true)}
          onOpenPrinter={() => setPrinterOpen(true)}
          onOpenAdmin={() => setAdminOpen(true)}
          onOpenOnlineOrders={() => setOnlineOrdersOpen(true)}
        />

        <main className="flex-1 min-w-0 overflow-y-auto p-3 sm:p-4 pb-28 lg:pb-4 grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
          {pendingOnlineCount > 0 && !onlineOrdersOpen && (
            <div
              role="status"
              aria-live="polite"
              className={`lg:col-span-3 rounded-2xl bg-[#000524] border border-[#5b3ee0] px-4 py-3 text-white flex flex-wrap items-center justify-between gap-3 shadow-lg ${
                onlineOrderPulse ? 'ring-2 ring-[#c5b9fa]' : ''
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden>
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#c5b9fa] opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[#5b3ee0]" />
                </span>
                <BellRing className="w-4 h-4 text-[#c5b9fa] shrink-0" aria-hidden />
                <p className="text-xs sm:text-sm font-medium">
                  <strong>
                    {pendingOnlineCount} new online {pendingOnlineCount === 1 ? 'order' : 'orders'}
                  </strong>{' '}
                  waiting to be accepted
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOnlineOrdersOpen(true)}
                className="px-4 h-9 rounded-[8px] bg-[#5b3ee0] hover:bg-[#4c31c9] text-white text-xs font-semibold transition shrink-0"
              >
                View &amp; Accept
              </button>
            </div>
          )}

          <div className="lg:col-span-2 space-y-4">
            <MenuGrid
              onPick={pickItem}
              cartQtyByMenuId={cartQtyByMenuId}
              lastAddedMenuId={lastAddedMenuId}
            />

            <div id="posCartMobileAnchor" className="lg:hidden scroll-mb-24 scroll-mt-4">
              <CartPanel
                items={cart}
                role={session.role}
                charges={charges}
                customer={customer}
                loyaltyBalance={loyaltyBalance}
                lastAddedLineId={lastAddedLineId}
                onChange={setCharges}
                onCustomerChange={setCustomer}
                notify={notify}
                onQtyChange={(id, qty) => setCart((c) => setQty(c, id, qty))}
                onRemove={(id) => setCart((c) => c.filter((i) => i.id !== id))}
                onHold={hold}
                onCheckout={() => void startCheckout()}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
              <LiveStockPanel
                canManage={session.role === 'OWNER' || session.role === 'MANAGER'}
                username={session.username}
                onManage={() => setInventoryOpen(true)}
              />

              <div className="bg-white p-4 rounded-2xl border border-[#e0edff]">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-display text-sm font-medium text-[#273238]">Recent Sales</h3>
                  <button
                    type="button"
                    onClick={() => setSalesOpen(true)}
                    className="text-xs font-medium text-[#2941e0] hover:underline px-2 py-1"
                  >
                    Manage
                  </button>
                </div>
                <RecentSales />
              </div>
            </div>
          </div>

          <aside className="hidden lg:block lg:sticky lg:top-0">
            <CartPanel
              items={cart}
              role={session.role}
              charges={charges}
              customer={customer}
              loyaltyBalance={loyaltyBalance}
              lastAddedLineId={lastAddedLineId}
              onChange={setCharges}
              onCustomerChange={setCustomer}
              notify={notify}
              onQtyChange={(id, qty) => setCart((c) => setQty(c, id, qty))}
              onRemove={(id) => setCart((c) => c.filter((i) => i.id !== id))}
              onHold={hold}
              onCheckout={() => void startCheckout()}
            />
          </aside>
        </main>
      </div>

      {cart.length > 0 && (() => {
        const count = cart.reduce((s, i) => s + i.qty, 0);
        return (
          <div
            className={`lg:hidden fixed bottom-0 inset-x-0 z-30 bg-[#000524] border-t px-4 py-2.5 flex items-center justify-between gap-3 shadow-2xl transition-all ${
              lastAddedLineId ? 'border-emerald-400 ring-2 ring-emerald-400/60' : 'border-[#795afa]/40'
            }`}
          >
            <button
              type="button"
              onClick={() => document.getElementById('posCartMobileAnchor')?.scrollIntoView({ behavior: 'smooth', block: 'end' })}
              className="text-left min-w-0"
            >
              <div className="text-[11px] font-medium text-[#c5b9fa]">
                {count} {count === 1 ? 'item' : 'items'} · {charges.orderType.replace('_', ' ')}
                {charges.tableNumber ? ` (${charges.tableNumber})` : ''}
              </div>
              <div className="font-display text-base font-semibold text-white tabular-nums">
                {formatAmount(totals.grandTotal)}
              </div>
            </button>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => document.getElementById('posCartMobileAnchor')?.scrollIntoView({ behavior: 'smooth', block: 'end' })}
                className="px-3 h-10 rounded-[8px] border border-[#c5b9fa]/60 text-xs font-medium text-white hover:bg-white/10 transition"
              >
                View Order
              </button>
              <button
                type="button"
                onClick={() => void startCheckout()}
                className="px-4 h-10 rounded-[8px] bg-[#2941e0] hover:bg-[#1f35c4] text-xs font-semibold text-white transition"
              >
                Checkout
              </button>
            </div>
          </div>
        );
      })()}

      {paying && (
        <PaymentModal
          total={totals.grandTotal}
          onCancel={() => setPaying(false)}
          onConfirm={complete}
        />
      )}

      {kdsOpen && <KitchenDisplayModal onClose={() => setKdsOpen(false)} notify={notify} />}

      {heldOpen && (
        <HeldOrdersModal
          onClose={() => setHeldOpen(false)}
          onRestore={({ items, charges: restored, customer: restoredCustomer }) => {
            setCart(items);
            setCharges(restored);
            setCustomer(restoredCustomer ?? {});
            setLoyaltyBalance(0);
            setHeldOpen(false);
            notify('Held order restored to cart.');
          }}
        />
      )}

      {deliveriesOpen && (
        <DeliveriesModal onClose={() => setDeliveriesOpen(false)} notify={notify} />
      )}

      {customersOpen && <CustomersModal onClose={() => setCustomersOpen(false)} />}

      {inventoryOpen && <InventoryModal onClose={() => setInventoryOpen(false)} notify={notify} />}

      {suppliersOpen && <SuppliersModal onClose={() => setSuppliersOpen(false)} notify={notify} />}

      {expensesOpen && (
        <ExpensesModal
          role={session.role}
          username={session.username}
          onClose={() => setExpensesOpen(false)}
          notify={notify}
        />
      )}

      {staffOpen && (
        <StaffModal username={session.username} onClose={() => setStaffOpen(false)} notify={notify} />
      )}

      {openingCashOpen && (
        <OpeningCashModal
          username={session.username}
          onClose={() => setOpeningCashOpen(false)}
          notify={notify}
        />
      )}

      {shiftSummaryOpen && (
        <ShiftSummaryModal
          username={session.username}
          onClose={() => setShiftSummaryOpen(false)}
          notify={notify}
          onClosed={() => setOpeningCashOpen(true)}
        />
      )}

      {onlineOrdersOpen && (
        <OnlineOrdersModal
          username={session.username}
          notify={notify}
          onClose={() => setOnlineOrdersOpen(false)}
          onAccept={(items, order) => {
            setCart(items);
            setCharges({ ...EMPTY_CHARGES, orderType: order.orderType });
            setCustomer(order.customer || {});
            setLoyaltyBalance(0);
            setActiveOnlineOrder(order);
          }}
        />
      )}

      {activityLogOpen && <ActivityLogModal onClose={() => setActivityLogOpen(false)} />}

      {printerOpen && (
        <PrinterSettingsModal
          username={session.username}
          notify={notify}
          preview={
            totals.grandTotal > 0
              ? {
                  title: `${charges.orderType.replace('_', ' ')} · ${charges.tableNumber ? `Table ${charges.tableNumber}` : 'Walk-in'}`,
                  lines: cart.map((line): [string, string] => [
                    `${line.qty} × ${line.name}`,
                    formatAmount(line.price * line.qty),
                  ]),
                  total: totals.grandTotal,
                }
              : null
          }
          onClose={() => setPrinterOpen(false)}
        />
      )}

      {adminOpen && (
        <AdminSettingsModal
          username={session.username}
          notify={notify}
          onClose={() => setAdminOpen(false)}
        />
      )}

      {analyticsOpen && <SalesAnalyticsModal onClose={() => setAnalyticsOpen(false)} />}

      {pnlOpen && <ProfitLossModal onClose={() => setPnlOpen(false)} />}

      {salesOpen && (
        <SalesHistoryModal
          role={session.role}
          username={session.username}
          notify={notify}
          onClose={() => setSalesOpen(false)}
          onReopen={async (sale: Sale) => {
            if (cart.length && !window.confirm('Your cart is not empty. Re-open this order and overwrite it?')) return;
            await reopenSale(sale, session.username);
            setCart(sale.items);
            setCharges({
              orderType: sale.orderType || 'DINE_IN',
              tableNumber: sale.tableNumber,
              discountPercent: Number(sale.discountPercent) || 0,
              deliveryCharge: Number(sale.deliveryCharge) || 0,
              packingCharge: Number(sale.packingCharge) || 0,
              taxPercent: Number(sale.taxPercent) || 0,
              otherCharge: Number(sale.otherCharge) || 0,
              loyaltyPoints: Number(sale.loyaltyRedeemPoints) || 0,
            });
            setCustomer(sale.customer || sale.deliveryInfo || {});
            setSalesOpen(false);
            notify(`Order #${sale.id} loaded back into the cart.`);
          }}
        />
      )}

      {modifying && (
        <ModifierModal
          item={modifying}
          notify={notify}
          onCancel={() => setModifying(null)}
          onAdd={(cartItem) => {
            addCartItem(cartItem);
            setModifying(null);
          }}
        />
      )}

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed right-4 z-[100] max-w-[calc(100vw-2rem)] bg-[#000524] border border-[#5b3ee0] text-white text-sm font-medium px-4 py-3 rounded-[10px] shadow-xl ${
            cart.length > 0 ? 'bottom-20 lg:bottom-4' : 'bottom-4'
          }`}
        >
          {toast}
        </div>
      )}
    </div>
  );
}

function SyncBadge() {
  const status = useSyncExternalStore(subscribeToSync, getSyncStatus, getSyncStatus);

  if (status.state === 'off') {
    return (
      <span className="flex items-center gap-1 text-xs font-medium text-[#526066] shrink-0" title="Sign in with a cloud account to sync across devices">
        <CloudOff className="w-3.5 h-3.5 shrink-0" aria-hidden /> <span className="hidden sm:inline">Local only</span>
      </span>
    );
  }
  const error = status.state === 'error';
  return (
    <button
      type="button"
      onClick={() => void syncNow()}
      title={error ? `Sync error: ${status.error}` : status.lastSync ? `Last synced ${new Date(status.lastSync).toLocaleTimeString()}` : 'Syncing'}
      className={`flex items-center gap-1.5 text-xs font-semibold px-2.5 sm:px-3 h-9 rounded-[8px] border shrink-0 transition ${
        error ? 'text-red-700 bg-red-50 border-red-300 hover:bg-red-100' : 'text-emerald-800 bg-emerald-50 border-emerald-200 hover:bg-emerald-100'
      }`}
    >
      <RefreshCw className={`w-3.5 h-3.5 shrink-0 ${status.state === 'syncing' ? 'animate-spin' : ''}`} aria-hidden />
      <span className="hidden sm:inline">{error ? 'Sync issue' : status.state === 'syncing' ? 'Syncing' : 'Synced'}</span>
    </button>
  );
}

function RecentSales() {
  const sales = useLive(() => db.sales.orderBy('timestamp').reverse().limit(8).toArray(), []);

  if (!sales?.length) return <p className="text-xs text-[#616f75] py-4 text-center">No sales recorded yet.</p>;

  return (
    <ul className="space-y-2 text-xs max-h-[420px] overflow-y-auto custom-scrollbar">
      {sales.map((sale) => (
        <li key={sale.id} className="flex justify-between items-center gap-2 p-2.5 rounded-[10px] bg-[#f8fafd] border border-[#e0edff]">
          <span className="text-[#526066] tabular-nums">
            #{sale.id} · {new Date(sale.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            {sale.tableNumber ? ` · ${sale.tableNumber}` : ''}
          </span>
          <span className="font-semibold text-[#000000] tabular-nums">{formatAmount(sale.total)}</span>
        </li>
      ))}
    </ul>
  );
}

export default App;
