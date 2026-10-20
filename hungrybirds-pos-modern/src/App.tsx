import { useCallback, useEffect, useState } from 'react';
import { LogOut, Menu } from 'lucide-react';
import { db } from './lib/db';
import { useLive } from './lib/useLive';
import { initializeApp, readSession, signOut } from './lib/auth';
import { addToCart, calculateCartTotals, setQty } from './lib/cart';
import type { CartCharges } from './lib/cart';
import { getCustomer } from './lib/customers';
import { holdOrder } from './lib/held';
import { formatAmount } from './lib/format';
import { MIN_DELIVERY_ORDER, recordSale, reopenSale, verifyStock } from './lib/sales';
import { printReceipt } from './lib/receipt';
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
import type { CartItem, CustomerInfo, MenuItem, PaymentDetail, Sale, User, UserRole } from './lib/db/types';

type Session = { username: string; role: UserRole };

const EMPTY_CHARGES: CartCharges = {
  orderType: 'DINE_IN',
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
  const [toast, setToast] = useState<string | null>(null);

  const totals = calculateCartTotals(cart, charges);

  useEffect(() => {
    initializeApp().catch((err) => console.error('App init failed:', err));
  }, []);

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
    setTimeout(() => setToast(null), 3000);
  }, []);

  function pickItem(item: MenuItem) {
    if (item.modifierGroups?.length) {
      setModifying(item);
      return;
    }
    setCart((current) =>
      addToCart(current, { id: item.id, menuItemId: item.id, name: item.name, price: item.price, qty: 1 }),
    );
  }

  function resetOrder() {
    setCart([]);
    setCharges(EMPTY_CHARGES);
    setCustomer({});
    setLoyaltyBalance(0);
  }

  async function hold() {
    const id = await holdOrder(cart, charges, customer.phone ? customer : undefined, session?.username || 'Staff');
    resetOrder();
    notify(`Held order #${id}.`);
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

    try {
      const saleId = await recordSale({
        items: cart,
        orderType: charges.orderType,
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
      });
      const sale: Sale = {
        id: saleId,
        timestamp: new Date().toISOString(),
        orderType: charges.orderType,
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
      // The button promises a receipt; print after the UI has settled so the dialog is not blocked by the payment modal.
      setTimeout(() => void printReceipt(sale), 300);
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
      <header className="bg-white p-3 sm:p-4 shadow-lg flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 sticky top-0 z-40 border-b border-gray-100">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setNavOpen(true)}
            aria-label="Open navigation"
            className="lg:hidden w-9 h-9 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-700 flex items-center justify-center"
          >
            <Menu className="w-5 h-5" aria-hidden />
          </button>
          <h1 className="text-xl font-black tracking-tight flex items-center gap-2">
            <span className="text-2xl text-indigo-600 font-black">HB</span>
            <span className="text-gray-900">Hungry Birds</span>
          </h1>
          <span className="text-[10px] px-3 py-1.5 rounded-full bg-blue-50 border border-blue-200 font-bold uppercase tracking-widest text-blue-700">
            {session.role}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden lg:inline text-xs text-gray-600">
            Welcome, <strong className="text-gray-800">{session.username}</strong>
          </span>
          <button
            type="button"
            onClick={() => {
              signOut();
              setSession(null);
              setCart([]);
            }}
            className="bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 px-4 py-2 rounded-xl text-xs font-bold transition flex items-center gap-1.5"
          >
            <LogOut className="w-3.5 h-3.5" /> Logout
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

        <main className="flex-1 min-w-0 overflow-y-auto p-3 sm:p-4 grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
          <div className="xl:col-span-2 space-y-4">
            <MenuGrid onPick={pickItem} />
            <CartPanel
              items={cart}
              role={session.role}
              charges={charges}
              customer={customer}
              loyaltyBalance={loyaltyBalance}
              onChange={setCharges}
              onCustomerChange={setCustomer}
              notify={notify}
              onQtyChange={(id, qty) => setCart((c) => setQty(c, id, qty))}
              onRemove={(id) => setCart((c) => c.filter((i) => i.id !== id))}
              onHold={hold}
              onCheckout={() => setPaying(true)}
            />
          </div>

          <aside className="space-y-4">
            <LiveStockPanel
              canManage={session.role === 'OWNER' || session.role === 'MANAGER'}
              username={session.username}
              onManage={() => setInventoryOpen(true)}
            />

            <div className="bg-white p-4 rounded-3xl shadow-sm border border-gray-100">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-black uppercase tracking-widest text-gray-800">Recent Sales</h3>
                <button
                  type="button"
                  onClick={() => setSalesOpen(true)}
                  className="text-[10px] font-bold text-indigo-600 hover:underline"
                >
                  Manage
                </button>
              </div>
              <RecentSales />
            </div>
          </aside>
        </main>
      </div>

      {paying && (
        <PaymentModal
          total={totals.grandTotal}
          onCancel={() => setPaying(false)}
          onConfirm={complete}
        />
      )}

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
                  title: `${charges.orderType.replace('_', ' ')} · Walk-in`,
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
            setCart((current) => addToCart(current, cartItem));
            setModifying(null);
          }}
        />
      )}

      {toast && (
        <div className="fixed bottom-4 right-4 z-[100] bg-gray-900 text-white text-sm font-semibold px-4 py-3 rounded-xl shadow-xl">
          {toast}
        </div>
      )}
    </div>
  );
}

function RecentSales() {
  const sales = useLive(() => db.sales.orderBy('timestamp').reverse().limit(8).toArray(), []);

  if (!sales?.length) return <p className="text-xs text-gray-400 py-4 text-center">No sales yet.</p>;

  return (
    <ul className="space-y-2 text-xs max-h-[420px] overflow-y-auto custom-scrollbar">
      {sales.map((sale) => (
        <li key={sale.id} className="flex justify-between items-center gap-2 p-2 rounded-lg bg-gray-50">
          <span className="text-gray-500 tabular-nums">
            #{sale.id} · {new Date(sale.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          <span className="font-bold text-gray-800">{formatAmount(sale.total)}</span>
        </li>
      ))}
    </ul>
  );
}

export default App;
