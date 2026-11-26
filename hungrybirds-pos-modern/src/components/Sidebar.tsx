import { useState } from 'react';
import {
  LayoutGrid, Globe, Archive, Bike, Users, BarChart3, TrendingUp,
  Boxes, Truck, Receipt, UserCog, Wallet, Clock, Printer, ScrollText,
  ShieldCheck, ChevronLeft, ChevronRight, ChefHat, LogOut, EyeOff,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { db } from '../lib/db';
import { useLive } from '../lib/useLive';
import type { UserRole } from '../lib/db/types';

interface NavItem {
  label: string;
  icon: LucideIcon;
  roles?: UserRole[];
  badge?: number;
  onClick?: () => void;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

export function Sidebar({ role, username, open, onClose, onSignOut, onOpenHeldOrders, onOpenDeliveries, onOpenCustomers, onOpenInventory, onOpenSuppliers, onOpenExpenses, onOpenAnalytics, onOpenPnl, onOpenStaff, onOpenOpeningCash, onOpenShiftSummary, onOpenBlindClose, onOpenActivityLog, onOpenPrinter, onOpenAdmin, onOpenOnlineOrders, onOpenKds }: {
  role: UserRole;
  username: string;
  /** Drawer state below the lg breakpoint, where the sidebar overlays the POS. */
  open: boolean;
  onClose: () => void;
  onSignOut: () => void;
  onOpenHeldOrders: () => void;
  onOpenDeliveries: () => void;
  onOpenCustomers: () => void;
  onOpenInventory: () => void;
  onOpenSuppliers: () => void;
  onOpenExpenses: () => void;
  onOpenAnalytics: () => void;
  onOpenPnl: () => void;
  onOpenStaff: () => void;
  onOpenOpeningCash: () => void;
  onOpenShiftSummary: () => void;
  onOpenBlindClose: () => void;
  onOpenActivityLog: () => void;
  onOpenPrinter: () => void;
  onOpenAdmin: () => void;
  onOpenOnlineOrders: () => void;
  onOpenKds?: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const heldCount = useLive(() => db.heldOrders.count(), []) ?? 0;
  const kdsCount = useLive(async () => {
    const cutoff = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();
    const [held, recent] = await Promise.all([
      db.heldOrders.toArray(),
      db.sales.where('timestamp').above(cutoff).toArray(),
    ]);
    const activeHeld = held.filter((h) => (h.kitchenStatus || 'PREPARING') !== 'SERVED').length;
    const activeSales = recent.filter((s) => !s.refundStatus && (s.kitchenStatus || 'PREPARING') !== 'SERVED').length;
    return activeHeld + activeSales;
  }, []) ?? 0;
  const pendingDeliveries = useLive(() => db.deliveries.where('status').notEqual('COMPLETED').count(), []) ?? 0;
  const pendingOnline = useLive(() => db.onlineOrders.where('status').equals('PENDING').count(), []) ?? 0;

  const groups: NavGroup[] = [
    {
      title: 'Orders',
      items: [
        { label: 'Counter & menu', icon: LayoutGrid },
        { label: 'Kitchen display (KDS)', icon: ChefHat, badge: kdsCount, onClick: onOpenKds },
        { label: 'Online orders', icon: Globe, badge: pendingOnline, onClick: onOpenOnlineOrders },
        { label: 'Held orders', icon: Archive, badge: heldCount, onClick: onOpenHeldOrders },
        { label: 'Deliveries', icon: Bike, badge: pendingDeliveries, onClick: onOpenDeliveries },
        { label: 'Customers', icon: Users, onClick: onOpenCustomers },
      ],
    },
    {
      title: 'Insights',
      items: [
        { label: 'Sales analytics', icon: BarChart3, roles: ['OWNER'], onClick: onOpenAnalytics },
        { label: 'Profit & loss', icon: TrendingUp, roles: ['OWNER'], onClick: onOpenPnl },
      ],
    },
    {
      title: 'Operations',
      items: [
        { label: 'Inventory', icon: Boxes, roles: ['OWNER', 'MANAGER'], onClick: onOpenInventory },
        { label: 'Suppliers', icon: Truck, roles: ['OWNER', 'MANAGER'], onClick: onOpenSuppliers },
        { label: 'Expenses', icon: Receipt, roles: ['OWNER', 'MANAGER'], onClick: onOpenExpenses },
        { label: 'Staff management', icon: UserCog, roles: ['OWNER', 'MANAGER'], onClick: onOpenStaff },
        { label: 'Opening cash', icon: Wallet, roles: ['OWNER', 'MANAGER', 'CASHIER'], onClick: onOpenOpeningCash },
        { label: 'Blind cash close', icon: EyeOff, roles: ['CASHIER', 'MANAGER', 'OWNER'], onClick: onOpenBlindClose },
        { label: 'Shift summary', icon: Clock, roles: ['OWNER', 'MANAGER'], onClick: onOpenShiftSummary },
        { label: 'Printer settings', icon: Printer, onClick: onOpenPrinter },
        { label: 'Activity log', icon: ScrollText, roles: ['OWNER'], onClick: onOpenActivityLog },
        { label: 'Admin settings', icon: ShieldCheck, roles: ['OWNER'], onClick: onOpenAdmin },
      ],
    },
  ];

  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={onClose}
          className="fixed inset-0 z-40 bg-[#000524]/50 lg:hidden"
        />
      )}
      <aside
        className={`bg-white border-r border-[#d4d4d8] py-4 flex-shrink-0 flex flex-col transition-all duration-200 fixed inset-y-0 left-0 z-50 lg:static lg:z-auto ${
          open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        } ${collapsed ? 'w-16 px-2' : 'w-64 px-3'}`}
        aria-label="Main navigation"
      >
        <div className={`sidebar-heading mb-4 flex items-center ${collapsed ? 'justify-center' : 'justify-between px-2'}`}>
          {!collapsed && (
            <div>
              <p className="text-xs font-normal text-[#616f75]">Workspace</p>
              <p className="font-display text-sm font-medium text-[#000000]">Quick access</p>
            </div>
          )}
          <button
            type="button"
            onClick={() => {
              if (window.matchMedia('(min-width: 1024px)').matches) setCollapsed((c) => !c);
              else onClose();
            }}
            className="w-9 h-9 rounded-[8px] border border-[#788991] bg-white hover:bg-[#eff6ff] hover:text-[#2941e0] text-[#273238] flex items-center justify-center transition"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto custom-scrollbar space-y-4">
          {groups.map((group) => {
            const visible = group.items.filter((i) => !i.roles || i.roles.includes(role));
            if (!visible.length) return null;
            return (
              <div key={group.title}>
                {!collapsed && (
                  <p className="px-3 mb-1 text-xs font-medium text-[#526066]">
                    {group.title}
                  </p>
                )}
                {visible.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => {
                      item.onClick?.();
                      if (!window.matchMedia('(min-width: 1024px)').matches) onClose();
                    }}
                    title={collapsed ? item.label : undefined}
                    aria-label={collapsed ? (item.badge ? `${item.label} (${item.badge})` : item.label) : undefined}
                    className={`relative w-full min-h-10 rounded-[8px] px-3 py-2 text-left text-sm font-normal flex items-center gap-3 text-[#000000] hover:bg-[#eff6ff] hover:text-[#2941e0] transition-colors ${
                      collapsed ? 'justify-center' : ''
                    } ${
                      item.label === 'Online orders' && item.badge && item.badge > 0
                        ? 'bg-[#eff6ff] text-[#2941e0] font-medium'
                        : ''
                    }`}
                  >
                    <item.icon
                      className={`w-4 h-4 shrink-0 ${
                        item.label === 'Online orders' && item.badge && item.badge > 0
                          ? 'text-[#5b3ee0]'
                          : 'text-[#526066]'
                      }`}
                      aria-hidden
                    />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                    {collapsed && !!item.badge && (
                      <span
                        className={`absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full text-[11px] font-bold leading-none flex items-center justify-center tabular-nums ${
                          item.label === 'Online orders'
                            ? 'bg-[#5b3ee0] text-white animate-pulse'
                            : 'bg-[#2941e0] text-white'
                        }`}
                      >
                        {item.badge}
                      </span>
                    )}
                    {!collapsed && !!item.badge && (
                      <span
                        className={`ml-auto rounded-[88px] px-2.5 py-0.5 text-xs font-semibold tabular-nums ${
                          item.label === 'Online orders' && item.badge > 0
                            ? 'bg-[#5b3ee0] text-white animate-pulse ring-2 ring-[#c5b9fa]'
                            : 'bg-[#eff6ff] text-[#2941e0]'
                        }`}
                      >
                        {item.badge}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            );
          })}
        </nav>

        {!collapsed ? (
          <div className="mx-1 mt-4 rounded-2xl bg-[#000524] p-3 text-xs leading-relaxed text-white">
            <div className="flex items-center gap-2.5 mb-1">
              <img src="/logo.png" alt="" className="w-8 h-8 object-contain shrink-0" />
              <div className="min-w-0">
                <div className="font-display font-medium text-white truncate">Hungry Birds POS</div>
                <div className="text-[#c5b9fa] truncate">
                  Signed in as <span className="font-medium text-white">{username}</span> · {role}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                onSignOut();
                if (!window.matchMedia('(min-width: 1024px)').matches) onClose();
              }}
              className="mt-2.5 w-full h-10 rounded-[8px] bg-white/10 hover:bg-red-600/35 border border-[#c5b9fa]/50 hover:border-red-300 text-white text-xs font-medium flex items-center justify-center gap-2 transition"
            >
              <LogOut className="w-3.5 h-3.5" aria-hidden /> Logout
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={onSignOut}
            title="Logout"
            aria-label="Logout"
            className="mx-auto mt-4 w-10 h-10 rounded-[8px] border border-[#788991] bg-white hover:bg-red-50 text-[#000000] hover:text-red-700 flex items-center justify-center transition"
          >
            <LogOut className="w-4 h-4" aria-hidden />
          </button>
        )}
      </aside>
    </>
  );
}
