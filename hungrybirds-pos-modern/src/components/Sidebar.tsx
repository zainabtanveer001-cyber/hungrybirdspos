import { useState } from 'react';
import {
  LayoutGrid, Globe, Archive, Bike, Users, BarChart3, TrendingUp,
  Boxes, Truck, Receipt, UserCog, Wallet, Clock, Printer, ScrollText,
  ShieldCheck, ChevronLeft, ChevronRight,
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

export function Sidebar({ role, username, open, onClose, onSignOut, onOpenHeldOrders, onOpenDeliveries, onOpenCustomers, onOpenInventory, onOpenSuppliers, onOpenExpenses, onOpenAnalytics, onOpenPnl, onOpenStaff, onOpenOpeningCash, onOpenShiftSummary, onOpenActivityLog, onOpenPrinter, onOpenAdmin, onOpenOnlineOrders }: {
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
  onOpenActivityLog: () => void;
  onOpenPrinter: () => void;
  onOpenAdmin: () => void;
  onOpenOnlineOrders: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const heldCount = useLive(() => db.heldOrders.count(), []) ?? 0;
  const pendingDeliveries = useLive(() => db.deliveries.where('status').notEqual('COMPLETED').count(), []) ?? 0;
  const pendingOnline = useLive(() => db.onlineOrders.where('status').equals('PENDING').count(), []) ?? 0;

  const groups: NavGroup[] = [
    {
      title: 'Orders',
      items: [
        { label: 'Counter & menu', icon: LayoutGrid },
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
        { label: 'Opening cash', icon: Wallet, roles: ['OWNER'], onClick: onOpenOpeningCash },
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
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
        />
      )}
      <aside
        className={`bg-white border-r border-gray-200 py-4 flex-shrink-0 flex flex-col transition-all duration-200 fixed inset-y-0 left-0 z-50 lg:static lg:z-auto ${
          open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        } ${collapsed ? 'w-16 px-2' : 'w-64 px-3'}`}
        aria-label="Main navigation"
      >
      <div className={`sidebar-heading mb-4 flex items-center ${collapsed ? 'justify-center' : 'justify-between px-2'}`}>
        {!collapsed && (
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-gray-500">Workspace</p>
            <p className="mt-1 text-sm font-semibold text-gray-700">Quick access</p>
          </div>
        )}
        <button
          type="button"
          onClick={() => {
            // The drawer only collapses to icons on wide screens; on a phone it closes.
            if (window.matchMedia('(min-width: 1024px)').matches) setCollapsed((c) => !c);
            else onClose();
          }}
          className="w-11 h-11 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 flex items-center justify-center transition"
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
                <p className="px-3 mb-1 text-[10px] font-bold uppercase tracking-[0.18em] text-gray-500">
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
                  className={`w-full rounded-xl px-3 py-2.5 text-left text-sm font-medium flex items-center gap-3 text-gray-700 hover:bg-indigo-50 hover:text-indigo-700 transition-colors ${
                    collapsed ? 'justify-center' : ''
                  }`}
                >
                  <item.icon className="w-5 h-5 shrink-0" aria-hidden />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                  {!collapsed && !!item.badge && (
                    <span className={`ml-auto rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-bold text-white ${
                      item.label === 'Online orders' && item.badge > 0
                        ? 'animate-pulse ring-2 ring-blue-400'
                        : ''
                    }`}>
                      {item.badge}
                    </span>
                  )}
                </button>
              ))}
            </div>
          );
        })}
      </nav>

      {!collapsed && (
        <div className="mx-2 mt-4 border-t border-gray-200 pt-3 text-[11px] leading-relaxed text-gray-500">
          <button type="button" onClick={onSignOut} className="block font-semibold text-gray-600 hover:text-red-600 min-h-11 px-2">
            Hungry Birds POS
          </button>
          <span>
            Signed in as <span className="font-semibold text-gray-600">{username}</span> · {role}
          </span>
        </div>
      )}
      </aside>
    </>
  );
}
