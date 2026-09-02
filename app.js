// ==========================================
// Hungry Birds Restaurant POS v3.6
// - Added Delivery Management: Pending / Active / Completed deliveries
// - KDS (Kitchen) ticket printing along with customer/cash receipt on thermal printer
// ==========================================

// ------------------------------
// Firebase Real-Time Cloud Init
// ------------------------------
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyAIibLNTusvBFOEcExpdb1tYQh_1rv2q7k",
  authDomain: "hungry-birds-3e16f.firebaseapp.com",
  projectId: "hungry-birds-3e16f",
  storageBucket: "hungry-birds-3e16f.firebasestorage.app",
  messagingSenderId: "339589167106",
  appId: "1:339589167106:web:4828ef951176e3e41e4f1b",
  measurementId: "G-ZVJYRZ18H1"
};

let cloudDb = null;
let cloudSyncEnabled = false;

try {
    if (typeof firebase !== "undefined" && firebase.initializeApp) {
        firebase.initializeApp(firebaseConfig);
        cloudDb = firebase.firestore();
        cloudSyncEnabled = true;
        console.log("Cloud Real-time Firestore sync initialized.");
    }
} catch (e) {
    console.warn("Cloud Firestore operating in local-sync mode.", e);
}

async function hashPin(pinString) {
    const encoder = new TextEncoder();
    const data = encoder.encode(pinString);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function validateAuthorizationPin(enteredPin, expectedHash) {
    const hashedInput = await hashPin(enteredPin);
    return hashedInput === expectedHash;
}
// ------------------------------
// Session & Shift Lifecycle
// ------------------------------
async function purgeSessionAndLogout() {
    try {
        if (typeof firebase !== 'undefined' && firebase.auth()) {
            await firebase.auth().signOut();
        }
    } catch (error) {
        console.error('Sign-out failed:', error);
    } finally {
        teardownMenuCategoryCloudSync();
        // This clears your shiftStartTime and shiftOpeningCash
        localStorage.clear();
        sessionStorage.clear();
        window.location.reload();
    }
}

async function completeShiftAndLock(shiftData) {
    // You can adapt this to write to an actual "shifts" Dexie table later if you create one
    console.log("Shift Data Saved:", shiftData);
    await purgeSessionAndLogout();
}

// ------------------------------
// Utility helpers
// ------------------------------
function escapeHtml(str) {
    if (str === undefined || str === null) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function debounce(fn, wait = 250) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
}

function formatAmount(amount) {
    try {
        return new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 2 }).format(amount);
    } catch (e) {
        return `Rs ${Number(amount || 0).toFixed(2)}`;
    }
}

async function logAudit(action, details, saleId = null) {
    try {
        await db.auditLogs.add({
            timestamp: new Date().toISOString(),
            action,
            details,
            saleId,
            user: currentUser?.username || "Staff"
        });
    } catch (e) {
        console.warn("Audit log write failed:", e);
    }
}

// ------------------------------
// CSV Export Helpers
// ------------------------------
function csvEscapeCell(value) {
    const str = value === undefined || value === null ? "" : String(value);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function downloadCSV(filename, headers, rows) {
    const lines = [headers.map(csvEscapeCell).join(",")]
        .concat(rows.map(row => row.map(csvEscapeCell).join(",")));
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

window.exportSalesCSV = async function () {
    const sales = await db.sales.orderBy("timestamp").toArray();
    if (sales.length === 0) return alert("No sales to export.");

    const headers = ["Order ID", "Date", "Server", "Order Type", "Items", "Subtotal", "Discount %", "Discount Amount", "Delivery Charge", "Packing Charge", "Tax %", "Tax Amount", "Other Charges", "Total", "Refunded Amount", "Refund Status", "Payment Methods"];
    const rows = sales.map(sale => [
        sale.id,
        sale.timestamp ? new Date(sale.timestamp).toLocaleString() : "",
        sale.serverUser || "",
        sale.orderType || "",
        (sale.items || []).map(i => `${i.name} x${i.qty}`).join("; "),
        Number(sale.subtotal || 0).toFixed(2),
        sale.discountPercent || 0,
        Number(sale.discountAmount || 0).toFixed(2),
        Number(sale.deliveryCharge || 0).toFixed(2),
        Number(sale.packingCharge || 0).toFixed(2),
        Number(sale.taxPercent || 0).toFixed(2),
        Number(sale.taxAmount || 0).toFixed(2),
        Number(sale.otherCharge || 0).toFixed(2),
        Number(sale.total || 0).toFixed(2),
        Number(sale.refundedAmount || 0).toFixed(2),
        sale.refundStatus || "",
        (sale.payments || []).map(p => `${p.method}: Rs ${Number(p.amount).toFixed(2)}`).join("; ")
    ]);

    downloadCSV(`Sales_Export_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
};

window.exportExpensesCSV = async function () {
    if (currentRole !== "OWNER") return alert("Access Denied: Owner role required to export expenses.");

    const startDate = document.getElementById("expenseStartDate")?.value;
    const endDate = document.getElementById("expenseEndDate")?.value;

    let expenses = await db.expenses.orderBy("timestamp").toArray();
    if (startDate || endDate) {
        const start = startDate ? new Date(startDate).setHours(0, 0, 0, 0) : -Infinity;
        const end = endDate ? new Date(endDate).setHours(23, 59, 59, 999) : Infinity;
        expenses = expenses.filter(exp => {
            const t = new Date(exp.timestamp).getTime();
            return t >= start && t <= end;
        });
    }

    if (expenses.length === 0) return alert("No expenses to export for the selected range.");

    const headers = ["ID", "Date", "Description", "Amount", "Category", "Payment Method", "Supplier", "Status", "Recorded By"];
    const rows = expenses.map(exp => [
        exp.id,
        exp.timestamp ? new Date(exp.timestamp).toLocaleString() : "",
        exp.description || "",
        Number(exp.amount || 0).toFixed(2),
        exp.category || "",
        exp.paymentMethod || "",
        exp.supplierId || "",
        exp.status || "APPROVED",
        exp.serverUser || ""
    ]);

    downloadCSV(`Expenses_Export_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
};

window.exportInventoryCSV = async function () {
    const items = await db.inventory.toArray();
    if (items.length === 0) return alert("No inventory items to export.");

    const headers = ["ID", "Name", "Stock", "Unit", "Cost Per Unit"];
    const rows = items.map(item => [
        item.id,
        item.name || "",
        Number(item.stock || 0).toFixed(2),
        item.unit || "",
        Number(item.cost || 0).toFixed(2)
    ]);

    downloadCSV(`Inventory_Export_${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
};

// ------------------------------
// Dexie Database Initialization
// ------------------------------
const db = new Dexie("HungryBirdsPOS");

// Bump version to include deliveries store
db.version(14).stores({
    floorTables: "++id, number, status, waiter, currentSale",
    sales: "++id, timestamp, total, orderType, discountPercent, serverUser",
    categories: "id, name",
    menu: "id, categoryId, name, price, imageUrl",
    recipes: "++id, menuItemId, inventoryId, qtyRequired",
    inventory: "id, name, stock, unit, cost",
    suppliers: "id",
    stockHistory: "++id, ingredient, created",
    customers: "id, phone",
    waiters: "id",
    kitchenOrders: "++id, saleId, tableId, status, createdAt",
    users: "++id, username, role",
    settings: "key, value",
    tableOrders: "++id, tableId, status, createdAt",
    heldOrders: "++id, timestamp, serverUser, orderType",
    deliveries: "++id, saleId, status, createdAt, assignedTo",
    expenses: "++id, timestamp, amount, category, description, serverUser, status" // New expenses store
});

// Bump version to include audit log store
db.version(15).stores({
    auditLogs: "++id, timestamp, action, user, saleId"
});

// ----------------------------------------------------
// Dexie Real-Time Hooks (Auto Updates UI without reload)
// ----------------------------------------------------
db.sales.hook('creating', function () {
    setTimeout(() => {
        window.renderRecentSales();
        renderDashboard();
    }, 100);
});

db.sales.hook('updating', function () {
    setTimeout(() => {
        window.renderRecentSales();
        renderDashboard();
    }, 100);
});

db.sales.hook('deleting', function () {
    setTimeout(() => {
        window.renderRecentSales();
        renderDashboard();
    }, 100);
});

db.deliveries?.hook?.('creating', function () {
    setTimeout(() => {
        renderDeliveryManagementLists().catch(e => console.warn(e));
    }, 100);
});
db.deliveries?.hook?.('updating', function () {
    setTimeout(() => {
        renderDeliveryManagementLists().catch(e => console.warn(e));
    }, 100);
});
db.deliveries?.hook?.('deleting', function () {
    setTimeout(() => {
        renderDeliveryManagementLists().catch(e => console.warn(e));
    }, 100);
});

// ------------------------------
// Global Application State
// ------------------------------
let cart = [];
let currentOrderType = "DINE_IN";
let selectedCategoryId = "ALL";
let currentCustomer = null;
let currentWaiter = "";
let currentDiscountPercent = 0;
let currentDeliveryCharge = 0;
let currentPackingCharge = 0;
let currentTaxPercent = 0;
let currentOtherCharge = 0;
let currentLoyaltyRedeemPoints = 0;
let cartCustomerLoyaltyBalance = 0;
const LOYALTY_EARN_RATE = 100; // Rs spent per 1 point earned
const LOYALTY_POINT_VALUE = 1; // Rs discount per point redeemed
let pendingRefundSaleId = null;

let currentUser = null;
let currentRole = null;

let bluetoothDevice = null;
let printerCharacteristic = null;

// Bulk Selection State
let selectedSaleIds = new Set();

let currentShiftStartTime = localStorage.getItem("shiftStartTime") || new Date().toISOString();
if (!localStorage.getItem("shiftStartTime")) {
    localStorage.setItem("shiftStartTime", currentShiftStartTime);
}

let currentShiftOpeningCash = Number(localStorage.getItem("shiftOpeningCash") || 0);

const TABLE_STATUS = {
    AVAILABLE: "AVAILABLE",
    OCCUPIED: "OCCUPIED"
};

// Payment modal state
let pendingSaleContext = null; // Will hold sale details until payments confirmed
let paymentRowCounter = 0;

const PAYMENT_METHODS = ["Cash", "Card", "Mobile/Other"];

// New: pending edit sale id when owner PIN required
let pendingEditSaleId = null;
let pendingDeleteSaleId = null;
let pendingDeleteSaleIds = null;
let pendingOwnerAction = null;
let openingCashEditAuthorized = false;
let pendingModifierMenuId = null;

function isMainActionMenuOpen() {
    return !document.getElementById("mainActionMenu")?.classList.contains("hidden");
}

window.closeMainActionMenu = function () {
    document.getElementById("mainActionMenu")?.classList.add("hidden");
    document.getElementById("mainActionMenuButton")?.setAttribute("aria-expanded", "false");
};

window.toggleMainActionMenu = function () {
    const menu = document.getElementById("mainActionMenu");
    const button = document.getElementById("mainActionMenuButton");
    if (!menu || !button) return;

    const willOpen = menu.classList.contains("hidden");
    menu.classList.toggle("hidden", !willOpen);
    button.setAttribute("aria-expanded", String(willOpen));
};

// ------------------------------
// Application Startup
// ------------------------------
document.addEventListener("DOMContentLoaded", async () => {
    console.log("Hungry Birds POS Starting...");

    if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register("./sw.js").catch(err => console.warn("Service worker registration failed:", err));
    }

    await db.open().catch(err => console.error("Dexie Open Error:", err));
    await initializeUsers();
    await initializeApplication();

    const passwordInput = document.getElementById("loginPassword");
    if (passwordInput) {
        passwordInput.addEventListener("keyup", e => {
            if (e.key === "Enter") window.login();
        });
    }

    const regPasswordInput = document.getElementById("regPassword");
    if (regPasswordInput) {
        regPasswordInput.addEventListener("keyup", e => {
            if (e.key === "Enter") window.signUp();
        });
    }

    document.addEventListener("click", event => {
        const menu = document.getElementById("mainActionMenu");
        const button = document.getElementById("mainActionMenuButton");
        if (isMainActionMenuOpen() && menu && button && !menu.contains(event.target) && !button.contains(event.target)) {
            window.closeMainActionMenu();
        }
    });

    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && isMainActionMenuOpen()) {
            window.closeMainActionMenu();
            document.getElementById("mainActionMenuButton")?.focus();
        }
    });
    // --- NEW SECURE LISTENERS ---

    // Secure Void / Override Action Integration
    const voidBtn = document.getElementById('void-btn'); // Ensure this ID matches your HTML
    if(voidBtn) {
        voidBtn.addEventListener('click', async () => {
            const enteredPin = document.getElementById('void-modal-pin').value;
            // TODO: Fetch this hash dynamically from your `users` Dexie table based on the logged-in admin
            const expectedAdminHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"; 
            
            const isAuthorized = await validateAuthorizationPin(enteredPin, expectedAdminHash);
            if (isAuthorized) {
                console.log("Authorization granted. Proceeding with void.");
                // Execute item deletion here (e.g., remove from cart array, render UI)
            } else {
                alert("Invalid PIN code.");
            }
        });
    }

    // Secure Shift Closing Integration
    const endShiftBtn = document.getElementById('confirm-end-shift-btn'); // Ensure this ID matches your HTML
    if(endShiftBtn) {
        endShiftBtn.addEventListener('click', async () => {
            const finalCash = document.getElementById('final-cash').value;
            await completeShiftAndLock({ 
                cashInDrawer: finalCash,
                startedAt: currentShiftStartTime,
                openingCash: currentShiftOpeningCash
            });
        });
    }

    // Secure Logout Integration
    const logoutBtn = document.getElementById('logout-button'); // Ensure this ID matches your HTML
    if(logoutBtn) {
        logoutBtn.addEventListener('click', purgeSessionAndLogout);
    }
});

async function initializeApplication() {
    await ensureDefaultCategories();
    await ensureDefaultOwnerPin();
    currentShiftOpeningCash = await getShiftOpeningCash();
    
    // Default to first category for large menus (not "ALL")
    const categories = await db.categories.toArray();
    if (categories.length > 0 && selectedCategoryId === "ALL") {
        selectedCategoryId = categories[0].id;
    }
    
    await renderDashboard();
    await renderCategoryBar();
    await renderMenu();
    renderCart();
    initializeSearch();
    await renderRecentSales();
    await updateHeldOrdersBadge();
}

// Default categories
async function ensureDefaultCategories() {
    const count = await db.categories.count();
    if (count > 0) return;

    const defaultCategories = [
        { id: "cat_burgers", name: "Burgers" },
        { id: "cat_pizza", name: "Pizza" },
        { id: "cat_wraps", name: "Wraps" },
        { id: "cat_bowls", name: "Rice & Bowls" },
        { id: "cat_drinks", name: "Drinks" },
        { id: "cat_desserts", name: "Desserts" }
    ];

    await db.categories.bulkAdd(defaultCategories);
}

// ====================================================
// Owner Sales Analytics (Day, Week, Month Wise)
// ====================================================
async function getSalesAnalytics() {
    const allSales = await db.sales.toArray();
    const now = new Date();

    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const startOfWeek = new Date(startOfDay);
    const day = startOfWeek.getDay();
    const diffToMonday = startOfWeek.getDate() - day + (day === 0 ? -6 : 1);
    startOfWeek.setDate(diffToMonday);

    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    let todaySales = 0;
    let weekSales = 0;
    let monthSales = 0;
    let totalOverallSales = 0;

    let todayCount = 0;
    let weekCount = 0;
    let monthCount = 0;
    let totalCount = allSales.length;

    let todayDiscounts = 0;
    let weekDiscounts = 0;
    let monthDiscounts = 0;
    let totalDiscounts = 0;

    allSales.forEach(sale => {
        const saleDate = new Date(sale.timestamp);
        const amount = Number(sale.total) || 0;
        const discountAmount = Number(sale.discountAmount) || ((Number(sale.subtotal) || 0) * (Number(sale.discountPercent) || 0) / 100);

        totalOverallSales += amount;
        totalDiscounts += discountAmount;

        if (saleDate >= startOfDay) {
            todaySales += amount;
            todayDiscounts += discountAmount;
            todayCount++;
        }
        if (saleDate >= startOfWeek) {
            weekSales += amount;
            weekDiscounts += discountAmount;
            weekCount++;
        }
        if (saleDate >= startOfMonth) {
            monthSales += amount;
            monthDiscounts += discountAmount;
            monthCount++;
        }
    });

    return {
        todaySales,
        weekSales,
        monthSales,
        totalOverallSales,
        todayCount,
        weekCount,
        monthCount,
        totalCount,
        todayDiscounts,
        weekDiscounts,
        monthDiscounts,
        totalDiscounts
    };
}

window.openSalesAnalyticsModal = async function () {
    if (currentRole !== "OWNER") {
        alert("Access Denied: Owner role required to view sales analytics.");
        return;
    }

    const data = await getSalesAnalytics();

    setText("analyticsTodaySales", formatAmount(data.todaySales));
    setText("analyticsTodayCount", `${data.todayCount} completed orders today`);

    setText("analyticsWeekSales", formatAmount(data.weekSales));
    setText("analyticsWeekCount", `${data.weekCount} orders this week`);
    setText("analyticsWeekDiscounts", `Discounts given: ${formatAmount(data.weekDiscounts)}`);

    setText("analyticsMonthSales", formatAmount(data.monthSales));
    setText("analyticsMonthCount", `${data.monthCount} orders this month`);
    setText("analyticsMonthDiscounts", `Discounts given: ${formatAmount(data.monthDiscounts)}`);

    setText("analyticsOverallSales", formatAmount(data.totalOverallSales));
    setText("analyticsOverallCount", `${data.totalCount} overall orders recorded`);
    setText("analyticsOverallDiscounts", `Total discounts given: ${formatAmount(data.totalDiscounts)}`);

    document.getElementById("salesAnalyticsModal")?.classList.remove("hidden");
};

window.closeSalesAnalyticsModal = function () {
    document.getElementById("salesAnalyticsModal")?.classList.add("hidden");
};
window.openPnlModal = function() {
    if (currentRole !== "OWNER") return alert("Owner access required.");
    document.getElementById("pnlModal").classList.remove("hidden");
    setPnlDate('today'); // Default view
};

window.closePnlModal = function() {
    document.getElementById("pnlModal").classList.add("hidden");
};

window.setPnlDate = function(type) {
    const startInput = document.getElementById("pnlStartDate");
    const endInput = document.getElementById("pnlEndDate");
    const today = new Date();
    
    if (type === 'today') {
        const dateStr = today.toISOString().split('T')[0];
        startInput.value = dateStr;
        endInput.value = dateStr;
    } else if (type === 'month') {
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
        startInput.value = firstDay.toISOString().split('T')[0];
        endInput.value = today.toISOString().split('T')[0];
    }
    
    generatePnlReport();
};

window.generatePnlReport = async function() {
    const startDate = document.getElementById("pnlStartDate").value;
    const endDate = document.getElementById("pnlEndDate").value;

    const start = startDate ? new Date(startDate).setHours(0,0,0,0) : -Infinity;
    const end = endDate ? new Date(endDate).setHours(23,59,59,999) : Infinity;

    // 1. Calculate Sales
    const allSales = await db.sales.toArray();
    const filteredSales = allSales.filter(sale => {
        const saleDate = new Date(sale.timestamp).getTime();
        return saleDate >= start && saleDate <= end;
    });
    const totalSales = filteredSales.reduce((sum, s) => sum + (Number(s.total) || 0), 0);

    // 2. Calculate Expenses (ONLY Approved)
    const allExpenses = await db.expenses.toArray();
    const filteredExpenses = allExpenses.filter(exp => {
        const expDate = new Date(exp.timestamp).getTime();
        const isApproved = exp.status === "APPROVED" || !exp.status;
        return isApproved && (expDate >= start && expDate <= end);
    });
    const totalExpenses = filteredExpenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

    // 3. Calculate Net Profit
    const netProfit = totalSales - totalExpenses;

    // 4. Update UI
    document.getElementById("pnlTotalSales").textContent = `Rs ${totalSales.toFixed(2)}`;
    document.getElementById("pnlTotalExpenses").textContent = `Rs ${totalExpenses.toFixed(2)}`;
    
    const profitEl = document.getElementById("pnlNetProfit");
    profitEl.textContent = `Rs ${netProfit.toFixed(2)}`;
    
    // Dynamically change color based on profit/loss
    if (netProfit < 0) {
        profitEl.classList.remove("text-indigo-700", "text-green-700");
        profitEl.classList.add("text-red-600");
    } else {
        profitEl.classList.remove("text-indigo-700", "text-red-600");
        profitEl.classList.add("text-green-700");
    }
};

// ====================================================
// Expense Management System (Updated)
// ====================================================

window.openExpenseModal = async function () {
    if (currentRole !== "OWNER" && currentRole !== "MANAGER") {
        alert("Access Denied: Owner or Manager role required.");
        return;
    }

    await loadSuppliersForExpenses(); // Load suppliers into dropdown
    resetExpenseForm();

    const ownerSection = document.getElementById("ownerExpenseSection");
    const managerNotice = document.getElementById("managerExpenseNotice");

    if (currentRole === "OWNER") {
        ownerSection?.classList.remove("hidden");
        managerNotice?.classList.add("hidden");
        setExpenseFilter('today'); // Default to showing today's expenses
    } else {
        ownerSection?.classList.add("hidden");
        managerNotice?.classList.remove("hidden");
    }

    document.getElementById("expenseModal")?.classList.remove("hidden");
};

window.closeExpenseModal = function () {
    document.getElementById("expenseModal")?.classList.add("hidden");
    resetExpenseForm();
};

// NEW: Load Suppliers into the dropdown
async function loadSuppliersForExpenses() {
    const supplierSelect = document.getElementById("expenseSupplier");
    if (!supplierSelect) return;
    
    // Assuming you have a 'suppliers' store in Dexie with {id, name}
    const suppliers = await db.suppliers.toArray();
    
    supplierSelect.innerHTML = '<option value="">-- No Supplier --</option>' + 
        suppliers.map(s => `<option value="${s.id}">${escapeHtml(s.name || s.id)}</option>`).join("");
}

// ====================================================
// Supplier Management
// ====================================================
window.openSupplierModal = async function () {
    document.getElementById("supplierModal")?.classList.remove("hidden");
    resetSupplierForm();
    await renderSupplierList();
};

window.closeSupplierModal = function () {
    document.getElementById("supplierModal")?.classList.add("hidden");
};

window.resetSupplierForm = function () {
    document.getElementById("editSupplierId").value = "";
    document.getElementById("supplierName").value = "";
    document.getElementById("supplierPhone").value = "";
    document.getElementById("supplierAddress").value = "";
    document.getElementById("supplierNotes").value = "";
};

window.saveSupplier = async function () {
    const editId = document.getElementById("editSupplierId").value;
    const name = document.getElementById("supplierName").value.trim();
    const phone = document.getElementById("supplierPhone").value.trim();
    const address = document.getElementById("supplierAddress").value.trim();
    const notes = document.getElementById("supplierNotes").value.trim();

    if (!name) return alert("Supplier name is required.");

    const id = editId || "SUP_" + Date.now();
    await db.suppliers.put({ id, name, phone, address, notes });

    resetSupplierForm();
    await renderSupplierList();
    await loadSuppliersForExpenses();
};

window.editSupplier = async function (id) {
    const supplier = await db.suppliers.get(id);
    if (!supplier) return;

    document.getElementById("editSupplierId").value = supplier.id;
    document.getElementById("supplierName").value = supplier.name || "";
    document.getElementById("supplierPhone").value = supplier.phone || "";
    document.getElementById("supplierAddress").value = supplier.address || "";
    document.getElementById("supplierNotes").value = supplier.notes || "";
};

window.deleteSupplier = async function (id) {
    if (!confirm("Delete this supplier? Existing expenses referencing it will keep their record.")) return;
    await db.suppliers.delete(id);
    await renderSupplierList();
    await loadSuppliersForExpenses();
};

async function renderSupplierList() {
    const container = document.getElementById("supplierList");
    if (!container) return;

    const suppliers = await db.suppliers.toArray();
    if (suppliers.length === 0) {
        container.innerHTML = `<div class="text-gray-400 text-xs text-center py-4">No suppliers added yet.</div>`;
        return;
    }

    const allExpenses = await db.expenses.toArray();

    container.innerHTML = suppliers.map(s => {
        const totalSpent = allExpenses
            .filter(e => e.supplierId === s.id && (e.status === "APPROVED" || !e.status))
            .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

        return `
        <div class="p-3 bg-white rounded-xl border shadow-sm flex justify-between items-start gap-2">
            <div>
                <div class="font-bold text-sm text-gray-800">${escapeHtml(s.name)}</div>
                <div class="text-[11px] text-gray-500">${escapeHtml(s.phone || '—')} • ${escapeHtml(s.address || '—')}</div>
                ${s.notes ? `<div class="text-[11px] text-gray-400 mt-0.5">${escapeHtml(s.notes)}</div>` : ''}
                <div class="text-[11px] text-teal-700 font-bold mt-1">Total Spent: ${formatAmount(totalSpent)}</div>
            </div>
            <div class="flex gap-2 shrink-0">
                <button onclick="editSupplier('${s.id}')" class="text-xs bg-amber-50 text-amber-700 px-2 py-1 rounded hover:bg-amber-100">Edit</button>
                <button onclick="deleteSupplier('${s.id}')" class="text-xs bg-red-100 text-red-600 px-2 py-1 rounded hover:bg-red-200">Delete</button>
            </div>
        </div>
    `;
    }).join("");
}

window.resetExpenseForm = function () {
    document.getElementById("editExpenseId").value = "";
    document.getElementById("expenseDescription").value = "";
    document.getElementById("expenseAmount").value = "";
    document.getElementById("expenseCategory").value = "Utilities";
    document.getElementById("expensePaymentMethod").value = "Cash Drawer";
    document.getElementById("expenseSupplier").value = "";
    document.getElementById("expenseFormTitle").textContent = "Add New Expense";
};

// Update saveExpense to handle statuses
window.saveExpense = async function () {
    const editId = document.getElementById("editExpenseId").value;
    const description = document.getElementById("expenseDescription").value.trim();
    const amount = parseFloat(document.getElementById("expenseAmount").value) || 0;
    const category = document.getElementById("expenseCategory").value;
    const paymentMethod = document.getElementById("expensePaymentMethod").value;
    const supplierId = document.getElementById("expenseSupplier").value;

    if (!description || amount <= 0) {
        alert("Please enter a valid description and a positive expense amount.");
        return;
    }

    // Managers default to PENDING. Owners default to APPROVED.
    const initialStatus = currentRole === "OWNER" ? "APPROVED" : "PENDING";

    const expenseData = {
        description,
        amount,
        category,
        paymentMethod,
        supplierId,
        serverUser: currentUser?.username || "Staff",
        status: initialStatus 
    };

    if (editId) {
        if (currentRole !== "OWNER") return alert("Only the Owner can edit expenses.");
        // We preserve the existing status when editing unless explicitly changing it
        await db.expenses.update(Number(editId), expenseData);
        alert("Expense updated successfully.");
    } else {
        expenseData.timestamp = new Date().toISOString();
        await db.expenses.add(expenseData);
        alert(currentRole === "OWNER" ? "Expense added successfully." : "Expense submitted for Owner approval.");
    }

    resetExpenseForm();
    if (currentRole === "OWNER") await renderExpenseList();
};

// New functions for Owner to Approve/Reject
window.updateExpenseStatus = async function(id, newStatus) {
    if (currentRole !== "OWNER") return;
    await db.expenses.update(id, { status: newStatus });
    await logAudit("EXPENSE_" + newStatus, `Expense #${id} marked ${newStatus}`);
    await renderExpenseList();
};

window.deleteExpense = async function (id) {
    if (currentRole !== "OWNER") return;
    if (!confirm("Delete this expense? This cannot be undone.")) return;

    await db.expenses.delete(id);
    await logAudit("EXPENSE_DELETE", `Expense #${id} deleted`);
    resetExpenseForm();
    await renderExpenseList();
};

// Update renderExpenseList to show statuses and action buttons
window.renderExpenseList = async function() {
    const container = document.getElementById("expenseList");
    if (!container) return;

    const startDate = document.getElementById("expenseStartDate").value;
    const endDate = document.getElementById("expenseEndDate").value;

    let expenses = await db.expenses.orderBy("timestamp").reverse().toArray();

    if (startDate || endDate) {
        expenses = expenses.filter(exp => {
            const expDate = new Date(exp.timestamp).setHours(0,0,0,0);
            const start = startDate ? new Date(startDate).setHours(0,0,0,0) : -Infinity;
            const end = endDate ? new Date(endDate).setHours(23,59,59,999) : Infinity;
            return expDate >= start && expDate <= end;
        });
    }

    // Only calculate totals for APPROVED or legacy (undefined status) expenses
    let total = expenses
        .filter(e => e.status === "APPROVED" || !e.status) 
        .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
        
    document.getElementById("totalExpenseAmount").textContent = `Approved Total: Rs ${total.toFixed(2)}`;

    if (expenses.length === 0) {
        container.innerHTML = `<div class="text-gray-400 text-xs text-center py-4">No expenses found for this period.</div>`;
        return;
    }

    container.innerHTML = expenses.map(exp => {
        const currentStatus = exp.status || "APPROVED"; // Legacy records default to Approved
        
        let statusBadge = '';
        if (currentStatus === "PENDING") statusBadge = '<span class="bg-yellow-100 text-yellow-800 px-1.5 py-0.5 rounded text-[9px] font-bold">⏳ PENDING</span>';
        else if (currentStatus === "APPROVED") statusBadge = '<span class="bg-green-100 text-green-800 px-1.5 py-0.5 rounded text-[9px] font-bold">✅ APPROVED</span>';
        else if (currentStatus === "REJECTED") statusBadge = '<span class="bg-red-100 text-red-800 px-1.5 py-0.5 rounded text-[9px] font-bold">❌ REJECTED</span>';

        return `
        <div class="flex justify-between items-center bg-white p-3 rounded-xl border shadow-sm text-xs ${currentStatus === 'REJECTED' ? 'opacity-60' : ''}">
            <div class="flex-1">
                <div class="font-bold text-gray-800 flex items-center gap-1.5">
                    ${escapeHtml(exp.description)} 
                    ${statusBadge}
                </div>
                <div class="text-[10px] text-gray-500 mt-1">
                    ${new Date(exp.timestamp).toLocaleString()} • By: ${escapeHtml(exp.serverUser)}
                </div>
            </div>
            <div class="flex flex-col items-end gap-1">
                <strong class="text-teal-700 text-sm">Rs ${Number(exp.amount).toFixed(2)}</strong>
                ${currentRole === 'OWNER' ? `
                    <div class="flex gap-2 mt-1">
                        ${currentStatus === 'PENDING' ? `
                            <button onclick="updateExpenseStatus(${exp.id}, 'APPROVED')" class="text-green-600 hover:text-green-800 font-bold" title="Approve">✔️</button>
                            <button onclick="updateExpenseStatus(${exp.id}, 'REJECTED')" class="text-red-600 hover:text-red-800 font-bold" title="Reject">✖️</button>
                        ` : ''}
                        <button onclick="editExpense(${exp.id})" class="text-indigo-600 hover:text-indigo-800 font-bold">✏️</button>
                        <button onclick="deleteExpense(${exp.id})" class="text-red-600 hover:text-red-800 font-bold">🗑️</button>
                    </div>
                ` : ''}
            </div>
        </div>
    `}).join("");
}

// NEW: Helper function for quick date filters
window.setExpenseFilter = function(type) {
    const startInput = document.getElementById("expenseStartDate");
    const endInput = document.getElementById("expenseEndDate");
    const today = new Date();
    
    if (type === 'all') {
        startInput.value = '';
        endInput.value = '';
    } else if (type === 'today') {
        const dateStr = today.toISOString().split('T')[0];
        startInput.value = dateStr;
        endInput.value = dateStr;
    } else if (type === 'week') {
        const firstDay = new Date(today.setDate(today.getDate() - today.getDay()));
        startInput.value = firstDay.toISOString().split('T')[0];
        endInput.value = new Date().toISOString().split('T')[0];
    } else if (type === 'month') {
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
        startInput.value = firstDay.toISOString().split('T')[0];
        endInput.value = new Date().toISOString().split('T')[0];
    }
    
    renderExpenseList();
};



window.editExpense = async function (id) {
    if (currentRole !== "OWNER") return;
    const exp = await db.expenses.get(id);
    if (!exp) return;

    document.getElementById("editExpenseId").value = exp.id;
    document.getElementById("expenseDescription").value = exp.description;
    document.getElementById("expenseAmount").value = exp.amount;
    document.getElementById("expenseCategory").value = exp.category || "Utilities";
    document.getElementById("expensePaymentMethod").value = exp.paymentMethod || "Cash Drawer";
    document.getElementById("expenseSupplier").value = exp.supplierId || "";
    
    document.getElementById("expenseFormTitle").textContent = `Edit Expense #${exp.id}`;
};
// ====================================================
// Shift & Sales Closing Reports (With Inventory Stock & Cost)
// ====================================================
window.openShiftCloseModal = async function () {
    const reportBox = document.getElementById("shiftReportContent");
    if (!reportBox) return;

    const sales = await db.sales.toArray();
    const shiftStartTimeMs = new Date(currentShiftStartTime).getTime();
    const shiftSales = sales.filter(s => new Date(s.timestamp).getTime() >= shiftStartTimeMs);
    const openingCash = await getShiftOpeningCash();

    const totalSales = shiftSales.reduce((sum, s) => sum + (s.total || 0), 0);
    const totalOrders = shiftSales.length;
    const totalPackingCharges = shiftSales.reduce((sum, sale) => sum + (Number(sale.packingCharge) || 0), 0);
    const totalTax = shiftSales.reduce((sum, sale) => sum + (Number(sale.taxAmount) || 0), 0);
    const totalOtherCharges = shiftSales.reduce((sum, sale) => sum + (Number(sale.otherCharge) || 0), 0);

    const dineInSales = shiftSales.filter(s => s.orderType === 'DINE_IN').reduce((sum, s) => sum + (s.total || 0), 0);
    const takeawaySales = shiftSales.filter(s => s.orderType === 'TAKEAWAY').reduce((sum, s) => sum + (s.total || 0), 0);
    const deliverySales = shiftSales.filter(s => s.orderType === 'DELIVERY').reduce((sum, s) => sum + (s.total || 0), 0);
    const cashCollected = shiftSales.reduce((sum, sale) => {
        const cashFromSale = (sale.payments || []).reduce((rowTotal, payment) => {
            if ((payment.method || 'Cash') !== 'Cash') return rowTotal;
            const cashAmount = Number(payment.cashGiven ?? payment.amount ?? 0) || 0;
            return rowTotal + cashAmount;
        }, 0);
        return sum + cashFromSale;
    }, 0);
    const totalChangeGiven = shiftSales.reduce((sum, sale) => sum + (Number(sale.totalChange || 0)), 0);
    const netCashInDrawer = cashCollected - totalChangeGiven;
    const expectedDrawerCash = openingCash + netCashInDrawer;

    const discountsByStaff = {};
    let totalDiscounts = 0;
    let discountedOrderCount = 0;

    shiftSales.forEach(sale => {
        const amount = Number(sale.discountAmount) || ((Number(sale.subtotal) || 0) * (Number(sale.discountPercent) || 0) / 100);
        totalDiscounts += amount;
        if (amount > 0) {
            discountedOrderCount += 1;
            const user = sale.serverUser || 'Staff';
            discountsByStaff[user] = (discountsByStaff[user] || 0) + amount;
        }
    });

    const inventory = await db.inventory.toArray();
    const recipes = await db.recipes.toArray();

    // compute aggregated ingredient consumption and cost
    const ingredientUsage = {}; // inventoryId -> { qtyConsumed, name, unit, costPerUnit, costConsumed }
    let totalConsumedCost = 0;

    for (const sale of shiftSales) {
        for (const item of sale.items) {
            const itemRecipes = recipes.filter(r => r.menuItemId === item.id);
            for (const recipe of itemRecipes) {
                const inv = inventory.find(i => i.id === recipe.inventoryId);
                const invCost = inv ? Number(inv.cost || 0) : 0;
                const invName = inv ? inv.name : (recipe.inventoryId || 'Unknown');
                const invUnit = inv ? (inv.unit || '') : '';

                const qtyToAdd = (recipe.qtyRequired || 0) * (item.qty || 0);
                if (!ingredientUsage[recipe.inventoryId]) {
                    ingredientUsage[recipe.inventoryId] = {
                        qtyConsumed: 0,
                        name: invName,
                        unit: invUnit,
                        costPerUnit: invCost,
                        costConsumed: 0
                    };
                }
                ingredientUsage[recipe.inventoryId].qtyConsumed += qtyToAdd;
                const costForThis = qtyToAdd * invCost;
                ingredientUsage[recipe.inventoryId].costConsumed += costForThis;
                totalConsumedCost += costForThis;
            }
        }
    }

    const grossProfit = totalSales - totalConsumedCost; // revenue after discounts already reflected in sale.total

    reportBox.innerHTML = `
        <div id="pdfShiftReportWrapper" class="p-4 bg-white rounded-xl border border-gray-200 space-y-4">
            <div class="border-b pb-3 text-center">
                <h2 class="font-extrabold text-lg text-gray-800 uppercase">Hungry Birds POS</h2>
                <p class="text-xs text-gray-500">Official Shift Closing & Inventory Report</p>
            </div>

            <div class="text-xs space-y-1 bg-gray-50 p-3 rounded-lg border">
                <div><strong>Opened By / Manager:</strong> ${escapeHtml(currentUser?.username || 'Owner')}</div>
                <div><strong>Shift Start:</strong> ${new Date(currentShiftStartTime).toLocaleString()}</div>
                <div><strong>Opening Cash:</strong> ${formatAmount(openingCash)}</div>
                <div><strong>Total Cash Given by Customers:</strong> ${formatAmount(cashCollected)}</div>
                <div><strong>Total Change Given Back:</strong> -${formatAmount(totalChangeGiven)}</div>
                <div><strong>Net Cash Received:</strong> ${formatAmount(netCashInDrawer)}</div>
                <div><strong>Expected Drawer Cash:</strong> ${formatAmount(expectedDrawerCash)}</div>
                <div><strong>Report Generated:</strong> ${new Date().toLocaleString()}</div>
            </div>

            <div class="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-center">
                <div class="text-xs font-bold text-emerald-800">TOTAL SHIFT REVENUE (AFTER DISCOUNTS)</div>
                <div class="text-3xl font-extrabold text-emerald-700">${formatAmount(totalSales)}</div>
                <div class="text-xs text-emerald-600 mt-1">${totalOrders} Total Orders Completed</div>
            </div>

            <div class="space-y-2">
                <h4 class="text-xs font-bold text-gray-700 uppercase tracking-wide">Revenue Breakdown</h4>
                <div class="grid grid-cols-3 gap-2 text-center text-xs">
                    <div class="bg-indigo-50 border border-indigo-100 p-2 rounded-lg">
                        <span class="block text-gray-500 text-[10px]">Dine In</span>
                        <strong class="text-indigo-900">${formatAmount(dineInSales)}</strong>
                    </div>
                    <div class="bg-amber-50 border border-amber-100 p-2 rounded-lg">
                        <span class="block text-gray-500 text-[10px]">Takeaway</span>
                        <strong class="text-amber-900">${formatAmount(takeawaySales)}</strong>
                    </div>
                    <div class="bg-blue-50 border border-blue-100 p-2 rounded-lg">
                        <span class="block text-gray-500 text-[10px]">Delivery</span>
                        <strong class="text-blue-900">${formatAmount(deliverySales)}</strong>
                    </div>
                </div>
            </div>

            <div class="border-t pt-3 space-y-1 text-xs text-gray-600">
                <h4 class="text-xs font-bold text-gray-700 uppercase tracking-wide">Checkout Charges Collected</h4>
                <div class="flex justify-between"><span>Packing Charges:</span><strong>${formatAmount(totalPackingCharges)}</strong></div>
                <div class="flex justify-between"><span>Tax:</span><strong>${formatAmount(totalTax)}</strong></div>
                <div class="flex justify-between"><span>Other Charges:</span><strong>${formatAmount(totalOtherCharges)}</strong></div>
            </div>

            <div class="border-t pt-3 space-y-2">
                <h4 class="text-xs font-bold text-gray-700 uppercase tracking-wide">Inventory Stock Summary & Cost Usage</h4>
                <div class="bg-gray-50 p-2 rounded-lg border max-h-48 overflow-y-auto space-y-1.5 text-xs">
                    ${Object.keys(ingredientUsage).length === 0 ? '<div class="text-gray-400 text-center py-2">No ingredient consumption recorded this shift.</div>' : ''}
                    ${Object.keys(ingredientUsage).map(key => {
                        const u = ingredientUsage[key];
                        return `
                            <div class="flex justify-between items-center bg-white p-2 rounded border">
                                <div>
                                    <span class="font-bold text-gray-800">${escapeHtml(u.name)}</span>
                                    <span class="text-[10px] text-gray-500 block">Consumed: ${Number(u.qtyConsumed).toFixed(2)} ${escapeHtml(u.unit || '')} • Cost/unit: ${formatAmount(u.costPerUnit)}</span>
                                </div>
                                <div class="text-right">
                                    <span class="font-extrabold ${u.costConsumed > 0 ? 'text-red-600' : 'text-emerald-700'}">
                                        ${formatAmount(u.costConsumed)}
                                    </span>
                                    <span class="text-[10px] text-gray-400 block">Cost</span>
                                </div>
                            </div>
                        `;
                    }).join("")}
                </div>
            </div>

            <div class="border-t pt-3 space-y-2">
                <div class="flex justify-between items-center text-xs text-gray-600">
                    <span>Discounted Orders This Shift:</span>
                    <strong class="text-indigo-700">${discountedOrderCount}</strong>
                </div>

                <div class="bg-gray-50 p-3 rounded-lg border space-y-2 text-xs text-gray-600">
                    <div class="font-semibold text-gray-700">Discounts by Staff</div>
                    ${Object.keys(discountsByStaff).length === 0 ? '<div class="text-gray-500">No discounts were applied by any employee or owner during this shift.</div>' : Object.keys(discountsByStaff).map(user => {
                        return `<div class="flex justify-between"><span>${escapeHtml(user)}</span><strong class="text-red-600">${formatAmount(discountsByStaff[user])}</strong></div>`;
                    }).join("")}
                </div>

                <div class="flex justify-between items-center text-xs text-gray-600">
                    <span>Total Discounts Given:</span>
                    <strong class="text-red-600">- ${formatAmount(totalDiscounts)}</strong>
                </div>

                <div class="flex justify-between items-center text-xs text-gray-600">
                    <span>Total Raw Material Cost Consumed:</span>
                    <strong class="text-red-700">${formatAmount(totalConsumedCost)}</strong>
                </div>

                <div class="flex justify-between items-center text-sm font-bold ${grossProfit >= 0 ? 'text-emerald-700' : 'text-red-600'}">
                    <span>GROSS PROFIT / (LOSS):</span>
                    <strong>${formatAmount(grossProfit)}</strong>
                </div>
            </div>
        </div>
    `;

    document.getElementById("shiftReportModal")?.classList.remove("hidden");
};

window.closeShiftReportModal = function () {
    document.getElementById("shiftReportModal")?.classList.add("hidden");
};

async function getShiftOpeningCash() {
    const stored = await db.settings.get("shiftOpeningCash");
    const savedValue = stored ? Number(stored.value) : Number(localStorage.getItem("shiftOpeningCash") || 0);
    const normalized = Number.isFinite(savedValue) ? Math.max(0, savedValue) : 0;
    currentShiftOpeningCash = normalized;
    if (typeof localStorage !== "undefined") {
        localStorage.setItem("shiftOpeningCash", String(normalized));
    }
    return normalized;
}

async function setShiftOpeningCash(amount) {
    const value = Number(amount) || 0;
    const normalized = Math.max(0, Number.isFinite(value) ? value : 0);
    currentShiftOpeningCash = normalized;
    if (typeof localStorage !== "undefined") {
        localStorage.setItem("shiftOpeningCash", String(normalized));
    }
    await db.settings.put({ key: "shiftOpeningCash", value: String(normalized) });
    return normalized;
}

async function resetShiftOpeningCash() {
    currentShiftOpeningCash = 0;
    if (typeof localStorage !== "undefined") {
        localStorage.removeItem("shiftOpeningCash");
    }
    try {
        await db.settings.delete("shiftOpeningCash");
    } catch (err) {
        console.warn("Could not clear shift opening cash:", err);
    }
}

window.openShiftOpeningModal = async function (authorizedByOwnerPin = false) {
    if (currentRole !== "OWNER" && !authorizedByOwnerPin) {
        pendingOwnerAction = "openingCash";
        const modal = document.getElementById("ownerAuthModal");
        if (!modal) {
            alert("Owner authorization required to edit opening cash.");
            return;
        }
        modal.classList.remove("hidden");
        const pinInput = document.getElementById("ownerAuthPinInput");
        if (pinInput) {
            pinInput.value = "";
            pinInput.focus();
        }
        document.getElementById("ownerAuthError")?.classList.add("hidden");
        return;
    }

    currentShiftOpeningCash = await getShiftOpeningCash();
    const input = document.getElementById("openingCashInput");
    if (input) {
        input.value = String(currentShiftOpeningCash || 0);
    }
    document.getElementById("shiftOpeningModal")?.classList.remove("hidden");
};

window.closeShiftOpeningModal = function () {
    document.getElementById("shiftOpeningModal")?.classList.add("hidden");
    openingCashEditAuthorized = false;
};

window.saveOpeningCash = async function () {
    if (currentRole !== "OWNER" && !openingCashEditAuthorized) {
        alert("Only the owner can edit opening cash.");
        return;
    }

    const input = document.getElementById("openingCashInput");
    const value = Number(input?.value || 0);

    if (!Number.isFinite(value) || value < 0) {
        alert("Please enter a valid non-negative opening cash amount.");
        return;
    }

    await setShiftOpeningCash(value);
    openingCashEditAuthorized = false;
    closeShiftOpeningModal();
    renderDashboard();
};

window.confirmCloseShift = async function () {
    if (!confirm("Are you sure you want to end the current shift? This will reset active shift revenue tracking.")) {
        return;
    }

    await logAudit("SHIFT_CLOSE", `Shift closed at ${new Date().toLocaleString()}`);

    currentShiftStartTime = new Date().toISOString();
    localStorage.setItem("shiftStartTime", currentShiftStartTime);
    await resetShiftOpeningCash();

    alert("Shift closed successfully! Set the opening cash for the new shift session.");
    closeShiftReportModal();
    openShiftOpeningModal();
    renderDashboard();
};

window.printShiftReportPDF = async function () {
    const reportContainer = document.getElementById("pdfShiftReportWrapper");
    if (!reportContainer) return;

    try {
        const canvas = await html2canvas(reportContainer, { scale: 2 });
        const imgData = canvas.toDataURL("image/png");
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

        pdf.addImage(imgData, "PNG", 10, 10, 190, (canvas.height * 190) / canvas.width);
        pdf.save(`Shift_Closing_Report_${new Date().toISOString().slice(0,10)}.pdf`);
    } catch (err) {
        console.error("PDF Export Error:", err);
        alert("Failed to export shift report: " + (err.message || err));
    }
};

// ====================================================
// User Authentication, Sign-Up & Roles
// ====================================================
async function initializeUsers() {
    const count = await db.users.count();
    if (count === 0) {
        // store usernames normalized and hash default passwords for safety
        const defaults = [
            { username: "owner", password: "1234", role: "OWNER" },
            { username: "manager", password: "1234", role: "MANAGER" },
            { username: "cashier", password: "1234", role: "CASHIER" },
            { username: "waiter", password: "1234", role: "WAITER" }
        ];

        for (const u of defaults) {
            const normalized = u.username.trim().toLowerCase();
            const hashed = (typeof bcrypt !== 'undefined') ? bcrypt.hashSync(u.password, 10) : u.password;
            await db.users.add({ username: normalized, password: hashed, role: u.role });
        }
        console.log("Default role accounts initialized.");
    }
}

window.toggleAuthMode = function(mode) {
    const loginForm = document.getElementById("loginForm");
    const registerForm = document.getElementById("registerForm");
    if (mode === 'REGISTER') {
        loginForm?.classList.add("hidden");
        registerForm?.classList.remove("hidden");
    } else {
        registerForm?.classList.add("hidden");
        loginForm?.classList.remove("hidden");
    }
};

const AUTH_EMAIL_DOMAIN = "hungrybirds-pos.local";

function normalizeUsername(value) {
    return String(value || "").trim().toLowerCase();
}

function usernameAuthEmail(username) {
    return `${normalizeUsername(username)}@${AUTH_EMAIL_DOMAIN}`;
}

window.createEmployee = async function () {
    if (currentRole !== "OWNER") {
        alert("Only the Owner can create employee accounts.");
        return;
    }

    const name = document.getElementById("employeeName")?.value.trim() || "";
    const username = normalizeUsername(document.getElementById("employeeUsername")?.value);
    const password = document.getElementById("employeePassword")?.value || "";
    const role = document.getElementById("employeeRole")?.value || "WAITER";
    const result = document.getElementById("employeeManagementResult");

    if (!name || !username || password.length < 6) {
        alert("Enter a name, username, and a password of at least 6 characters.");
        return;
    }
    if (!/^[a-z0-9._-]+$/.test(username)) {
        alert("Username may contain only lowercase letters, numbers, dots, underscores, and hyphens.");
        return;
    }

    try {
        const existing = await cloudDb.collection("users").where("usernameLower", "==", username).limit(1).get();
        if (!existing.empty) {
            alert("That username is already in use.");
            return;
        }

        const provisioningApp = firebase.apps.find(app => app.name === "employeeProvisioning")
            || firebase.initializeApp(firebaseConfig, "employeeProvisioning");
        const credential = await provisioningApp.auth().createUserWithEmailAndPassword(usernameAuthEmail(username), password);

        await cloudDb.collection("users").doc(credential.user.uid).set({
            username,
            usernameLower: username,
            displayName: name,
            role,
            active: true,
            authEmail: usernameAuthEmail(username),
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        ["employeeName", "employeeUsername", "employeePassword"].forEach(id => {
            const input = document.getElementById(id);
            if (input) input.value = "";
        });
        if (result) {
            result.textContent = `Employee '${username}' created successfully.`;
            result.className = "text-xs text-emerald-700";
        }
        await renderEmployeeList();
    } catch (error) {
        console.error("Employee creation failed:", error);
        alert(`Could not create employee: ${error.message}`);
    }
};

async function renderEmployeeList() {
    const container = document.getElementById("employeeList");
    if (!container || !cloudDb || currentRole !== "OWNER") return;

    const snapshot = await cloudDb.collection("users").orderBy("usernameLower").get();
    container.innerHTML = snapshot.docs.map(doc => {
        const employee = doc.data();
        return `<div class="flex justify-between items-center border rounded-lg p-2 text-xs">
            <span><strong>${escapeHtml(employee.displayName || employee.username)}</strong> (${escapeHtml(employee.username || "")}) - ${escapeHtml(employee.role || "")}</span>
            <span class="font-bold ${employee.active ? "text-emerald-700" : "text-red-600"}">${employee.active ? "Active" : "Disabled"}</span>
        </div>`;
    }).join("");
}

firebase.auth().onAuthStateChanged(async (user) => {
    if (user) {
        // Verify user against your authorized staff collection in Firestore
        if (!cloudDb) {
            console.error("Firebase Firestore is unavailable; staff access cannot be verified.");
            alert("Login is unavailable because the staff database could not be reached.");
            await firebase.auth().signOut();
            return;
        }

        const userDoc = await cloudDb.collection('users').doc(user.uid).get();

        if (userDoc.exists && userDoc.data().active === true) {
            const profile = userDoc.data();
            startSession({ ...user, username: profile.username, role: profile.role, displayName: profile.displayName });
            await renderEmployeeList();
            setupMenuCategoryCloudSync();
        } else {
            alert("Unauthorized account. Access denied.");
            await firebase.auth().signOut();
        }
    } else {
        currentUser = null;
        currentRole = null;
        document.getElementById("loginScreen")?.classList.remove("hidden");
    }
});
/*

window.signUp = async function() {
    const usernameEl = document.getElementById("regUsername");
    const passwordEl = document.getElementById("regPassword");
    const roleEl = document.getElementById("regRole");

    if (!usernameEl || !passwordEl || !roleEl) return;

    const usernameRaw = usernameEl.value.trim();
    const username = usernameRaw.toLowerCase();
    const password = passwordEl.value;
    const role = roleEl.value;

    if (!username || !password) {
        alert("Please provide both username and password to register.");
        return;
    }

    const existingUser = await db.users.where("username").equals(username).first();
    if (existingUser) {
        alert(`Username '${username}' is already taken. Please pick another unique username.`);
        return;
    }

    let hashed = password;
    if (typeof bcrypt !== 'undefined') {
        hashed = bcrypt.hashSync(password, 10);
    }

    const newUser = { username, password: hashed, role };
    await db.users.add(newUser);

    alert(`Account created successfully! Logging in as ${role === 'OWNER' ? 'Owner' : 'Employee (' + role + ')'}.`);

    usernameEl.value = "";
    passwordEl.value = "";

    startSession(newUser);
};
*/
// ------------------------------
// Firebase Login & Observer
// ------------------------------
window.login = async () => {
    const usernameInput = document.getElementById("loginUsername");
    const passwordInput = document.getElementById("loginPassword");

    if (!usernameInput || !passwordInput) return;

    const username = normalizeUsername(usernameInput.value);
    const password = passwordInput.value;

    if (!username || !password) {
        alert("Please fill in both username and password fields.");
        return;
    }

    try {
        const profileSnapshot = await cloudDb.collection("users").where("usernameLower", "==", username).limit(1).get();
        if (profileSnapshot.empty) {
            alert("Username not found or account is not configured.");
            return;
        }

        const profile = profileSnapshot.docs[0].data();
        if (profile.active !== true) {
            alert("This account is disabled. Contact the Owner.");
            return;
        }

        await firebase.auth().signInWithEmailAndPassword(profile.authEmail || usernameAuthEmail(username), password);
    } catch (error) {
        console.error("Firebase Login Error:", error.code, error.message);
        if (error.code === 'auth/invalid-credential' || error.code === 'auth/wrong-password') {
            alert("Incorrect password.");
        } else {
            alert("Login Failed: " + error.message);
        }
    }
};
function startSession(user) {
    currentUser = user;
    currentRole = user.role;
    currentWaiter = user.username;

    sessionStorage.setItem("loggedUser", JSON.stringify(user));

    document.getElementById("loginScreen")?.classList.add("hidden");
    document.getElementById("posScreen")?.classList.remove("hidden");

    setText("loggedUserName", user.username);

    const roleTitle = user.role === 'OWNER' ? '👑 OWNER' : `👤 EMPLOYEE (${user.role})`;
    setText("roleBadge", roleTitle);

    applyRoleViews();
    applyPermissions();
    renderDashboard();
    renderMenu();
    renderCart();
    renderRecentSales();
}

function applyRoleViews() {
    const mainPos = document.getElementById("mainPosView");
    mainPos?.classList.remove("hidden");
}

window.logout = async function () {
    if (!confirm("Are you sure you want to log out?")) return;
    currentUser = null;
    currentRole = null;
    sessionStorage.removeItem("loggedUser");
    teardownMenuCategoryCloudSync();

    // Must sign out of Firebase too, otherwise onAuthStateChanged auto-logs back in on refresh
    try {
        if (typeof firebase !== "undefined" && firebase.auth()) {
            await firebase.auth().signOut();
        }
    } catch (error) {
        console.error("Firebase sign-out failed:", error);
    }

    const u = document.getElementById("loginUsername");
    const p = document.getElementById("loginPassword");
    if (u) u.value = "";
    if (p) p.value = "";

    document.getElementById("posScreen")?.classList.add("hidden");
    document.getElementById("loginScreen")?.classList.remove("hidden");
};

function applyPermissions() {
    document.querySelectorAll("[data-role]").forEach(element => {
        const allowed = element.dataset.role.split(",");
        if (allowed.includes(currentRole)) {
            element.classList.remove("hidden");
        } else {
            element.classList.add("hidden");
        }
    });
}

// ====================================================
// Settings: Owner PIN helpers
// ====================================================
async function getOwnerPin() {
    const s = await db.settings.get("ownerPin");
    return s ? String(s.value) : "7774";
}

async function setOwnerPin(newPin) {
    await db.settings.put({ key: "ownerPin", value: String(newPin) });
}

async function ensureDefaultOwnerPin() {
    const s = await db.settings.get("ownerPin");
    if (!s || String(s.value) === "1234") {
        await db.settings.put({ key: "ownerPin", value: "7774" });
    }
}

// ====================================================
// Hold My Order System
// ====================================================
window.holdCurrentOrder = async function () {
    if (cart.length === 0) {
        alert("Cart is empty. Please add items to hold an order.");
        return;
    }

    const { subtotal, discountAmount, deliveryCharge, packingCharge, otherCharge, taxAmount, loyaltyDiscount, grandTotal } = calculateCartTotals();

    let deliveryDetails = null;
    if (currentOrderType === "DELIVERY") {
        deliveryDetails = {
            name: document.getElementById("deliveryCustomerName")?.value.trim() || "",
            phone: document.getElementById("deliveryCustomerPhone")?.value.trim() || "",
            address: document.getElementById("deliveryAddress")?.value.trim() || ""
        };
    }

    const heldOrderData = {
        items: JSON.parse(JSON.stringify(cart)),
        subtotal,
        discountPercent: currentDiscountPercent,
        discountAmount,
        deliveryCharge,
        packingCharge,
        taxPercent: currentTaxPercent,
        taxAmount,
        otherCharge,
        loyaltyRedeemPoints: currentLoyaltyRedeemPoints,
        loyaltyDiscount,
        total: grandTotal,
        orderType: currentOrderType,
        deliveryInfo: deliveryDetails,
        customer: getCartCustomerInput(),
        table: currentOrderType === "DINE_IN" ? null : null,
        serverUser: currentUser?.username || "Staff",
        timestamp: new Date().toISOString()
    };

    await db.heldOrders.add(heldOrderData);

    clearCheckoutCharges();
    clearDeliveryDetails();
    clearCartCustomer();

    renderCart();
    await updateHeldOrdersBadge();
    alert("Order successfully placed on hold!");
};

window.openHeldOrdersModal = async function () {
    document.getElementById("heldOrdersModal")?.classList.remove("hidden");
    await renderHeldOrdersList();
};

window.closeHeldOrdersModal = function () {
    document.getElementById("heldOrdersModal")?.classList.add("hidden");
};

async function renderHeldOrdersList() {
    const container = document.getElementById("heldOrdersList");
    if (!container) return;

    const heldOrders = await db.heldOrders.orderBy("id").reverse().toArray();
    if (heldOrders.length === 0) {
        container.innerHTML = `<div class="text-gray-400 text-xs text-center py-6">No held orders.</div>`;
        return;
    }

    container.innerHTML = heldOrders.map(order => `
        <div class="p-3 bg-amber-50/60 border border-amber-200 rounded-xl space-y-2">
            <div class="flex justify-between items-start">
                <div>
                    <div class="font-bold text-xs text-gray-800">
                        Held Order #${order.id}
                        <span class="ml-1 text-[10px] text-orange-700 font-bold bg-orange-100 px-1.5 py-0.5 rounded">(${escapeHtml(order.orderType || 'DINE_IN')})</span>
                        ${order.table ? `<span class="ml-1 text-[10px] text-indigo-700 font-bold bg-indigo-100 px-1.5 py-0.5 rounded">Table ${escapeHtml(String(order.table))}</span>` : ''}
                    </div>
                    <div class="text-[10px] text-gray-500">
                        By: ${escapeHtml(order.serverUser || 'Staff')} • ${new Date(order.timestamp).toLocaleTimeString()}
                    </div>
                </div>
                <div class="font-bold text-amber-800 text-xs">${formatAmount(order.total)}</div>
            </div>

            <div class="text-xs text-gray-600 bg-white p-2 rounded border border-amber-100">
                ${escapeHtml(order.items.map(i => `${i.name} x${i.qty}`).join(", "))}
            </div>

            <div class="flex items-center justify-end gap-2 pt-1">
                <button onclick="restoreHeldOrder(${order.id})" class="text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-3 py-1.5 rounded-lg transition">
                    🔄 Restore to Cart
                </button>
                <button onclick="deleteHeldOrder(${order.id})" class="text-xs bg-red-100 text-red-600 hover:bg-red-200 font-bold px-3 py-1.5 rounded-lg transition">
                    🗑️ Discard
                </button>
            </div>
        </div>
    `).join("");
}

window.restoreHeldOrder = async function (id) {
    if (cart.length > 0) {
        if (!confirm("Restoring this held order will replace items currently in your cart. Proceed?")) {
            return;
        }
    }

    const order = await db.heldOrders.get(id);
    if (!order) return alert("Held order not found.");

    cart = JSON.parse(JSON.stringify(order.items));
    currentDiscountPercent = order.discountPercent || 0;
    const discInput = document.getElementById("discountInput");
    if (discInput) discInput.value = currentDiscountPercent;

    setOrderType(order.orderType || "DINE_IN");

    if (order.deliveryInfo) {
        const name = document.getElementById("deliveryCustomerName");
        const phone = document.getElementById("deliveryCustomerPhone");
        const addr = document.getElementById("deliveryAddress");
        if (name) name.value = order.deliveryInfo.name || "";
        if (phone) phone.value = order.deliveryInfo.phone || "";
        if (addr) addr.value = order.deliveryInfo.address || "";
    }

    currentDeliveryCharge = Number(order.deliveryCharge) || 0;
    const chargeInput = document.getElementById("deliveryChargeInput");
    if (chargeInput) chargeInput.value = currentDeliveryCharge;

    currentPackingCharge = Number(order.packingCharge) || 0;
    currentTaxPercent = Number(order.taxPercent) || 0;
    currentOtherCharge = Number(order.otherCharge) || 0;
    syncCheckoutChargeInputs();

    restoreCartCustomerInput(order.customer);
    currentLoyaltyRedeemPoints = Number(order.loyaltyRedeemPoints) || 0;
    const redeemInput = document.getElementById("cartLoyaltyRedeemInput");
    if (redeemInput) redeemInput.value = currentLoyaltyRedeemPoints || "";

    await db.heldOrders.delete(id);

    renderCart();
    await updateHeldOrdersBadge();
    closeHeldOrdersModal();
};

window.deleteHeldOrder = async function (id) {
    if (!confirm("Are you sure you want to discard this held order?")) return;
    await db.heldOrders.delete(id);
    await renderHeldOrdersList();
    await updateHeldOrdersBadge();
};

async function updateHeldOrdersBadge() {
    const count = await db.heldOrders.count();
    setText("heldOrdersBadge", count);
}

async function syncSaleToCloud(saleData) {
    if (!cloudSyncEnabled || !cloudDb) return;
    try {
        await cloudDb.collection("sales").add({
            ...saleData,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        console.log("Sale synced to cloud successfully.");
    } catch (err) {
        console.error("Cloud sales sync error:", err);
    }
}

// ====================================================
// Menu / Category Cloud Sync (so items added on one browser show up on others)
// ====================================================
let unsubscribeMenuSync = null;
let unsubscribeCategorySync = null;

async function pushMenuItemToCloud(menuItem, recipeRows) {
    if (!cloudSyncEnabled || !cloudDb) return;
    try {
        await cloudDb.collection("menu").doc(menuItem.id).set({ ...menuItem, recipes: recipeRows });
    } catch (err) {
        console.error("Cloud menu sync error:", err);
    }
}

async function deleteMenuItemFromCloud(id) {
    if (!cloudSyncEnabled || !cloudDb) return;
    try {
        await cloudDb.collection("menu").doc(id).delete();
    } catch (err) {
        console.error("Cloud menu delete sync error:", err);
    }
}

async function pushCategoryToCloud(category) {
    if (!cloudSyncEnabled || !cloudDb) return;
    try {
        await cloudDb.collection("categories").doc(category.id).set(category);
    } catch (err) {
        console.error("Cloud category sync error:", err);
    }
}

async function deleteCategoryFromCloud(id) {
    if (!cloudSyncEnabled || !cloudDb) return;
    try {
        await cloudDb.collection("categories").doc(id).delete();
    } catch (err) {
        console.error("Cloud category delete sync error:", err);
    }
}

// Mirrors Firestore menu/category changes (from any browser) into local Dexie, then re-renders.
function setupMenuCategoryCloudSync() {
    if (!cloudSyncEnabled || !cloudDb) return;

    unsubscribeMenuSync = cloudDb.collection("menu").onSnapshot(async snapshot => {
        for (const change of snapshot.docChanges()) {
            const data = change.doc.data();
            if (change.type === "removed") {
                await db.menu.delete(change.doc.id);
                await db.recipes.where("menuItemId").equals(change.doc.id).delete();
            } else {
                const { recipes, ...menuItem } = data;
                await db.menu.put({ ...menuItem, id: change.doc.id });
                await db.recipes.where("menuItemId").equals(change.doc.id).delete();
                for (const r of (recipes || [])) {
                    await db.recipes.add({ menuItemId: change.doc.id, inventoryId: r.inventoryId, qtyRequired: r.qtyRequired });
                }
            }
        }
        if (snapshot.docChanges().length > 0) {
            await renderMenu();
            await renderOwnerFoodList();
        }
    }, err => console.error("Menu cloud sync listener error:", err));

    unsubscribeCategorySync = cloudDb.collection("categories").onSnapshot(async snapshot => {
        for (const change of snapshot.docChanges()) {
            if (change.type === "removed") {
                await db.categories.delete(change.doc.id);
            } else {
                await db.categories.put({ ...change.doc.data(), id: change.doc.id });
            }
        }
        if (snapshot.docChanges().length > 0) {
            await renderCategoryBar();
            await renderOwnerAdminCategories();
            await populateCategorySelect();
        }
    }, err => console.error("Category cloud sync listener error:", err));
}

function teardownMenuCategoryCloudSync() {
    unsubscribeMenuSync?.();
    unsubscribeCategorySync?.();
    unsubscribeMenuSync = null;
    unsubscribeCategorySync = null;
}

// ====================================================
// Order Type Management
// ====================================================
window.setOrderType = function (type) {
    currentOrderType = type;

    const btnDineIn = document.getElementById("btnDineIn");
    const btnTakeaway = document.getElementById("btnTakeaway");
    const btnDelivery = document.getElementById("btnDelivery");
    const deliveryBox = document.getElementById("deliveryInfoBox");

    const activeClasses = "bg-indigo-600 text-white shadow";
    const inactiveClasses = "text-gray-600 hover:text-indigo-600 bg-transparent";

    if (btnDineIn) btnDineIn.className = `px-3 py-1.5 rounded-md transition ${type === 'DINE_IN' ? activeClasses : inactiveClasses}`;
    if (btnTakeaway) btnTakeaway.className = `px-3 py-1.5 rounded-md transition ${type === 'TAKEAWAY' ? activeClasses : inactiveClasses}`;
    if (btnDelivery) btnDelivery.className = `px-3 py-1.5 rounded-md transition ${type === 'DELIVERY' ? activeClasses : inactiveClasses}`;

    if (type === 'DELIVERY') {
        deliveryBox?.classList.remove("hidden");
    } else {
        deliveryBox?.classList.add("hidden");
        currentDeliveryCharge = 0;
        renderCart();
    }
};

window.updateDeliveryCharge = function (value) {
    let val = parseFloat(value);
    if (isNaN(val) || val < 0) val = 0;
    currentDeliveryCharge = val;
    renderCart();
};

window.clearDeliveryDetails = function () {
    const name = document.getElementById("deliveryCustomerName");
    const phone = document.getElementById("deliveryCustomerPhone");
    const addr = document.getElementById("deliveryAddress");
    const chargeInput = document.getElementById("deliveryChargeInput");
    if (name) name.value = "";
    if (phone) phone.value = "";
    if (addr) addr.value = "";
    if (chargeInput) chargeInput.value = 0;
    currentDeliveryCharge = 0;
};

// ====================================================
// Customer CRM (lookup, history, loyalty stats)
// ====================================================
function normalizePhone(phone) {
    return String(phone || "").trim();
}

const lookupCartCustomerDebounced = debounce(async (phone) => {
    const infoEl = document.getElementById("cartCustomerInfo");
    const nameInput = document.getElementById("cartCustomerName");
    const redeemBox = document.getElementById("cartLoyaltyRedeemBox");
    const normalized = normalizePhone(phone);

    if (!normalized) {
        if (infoEl) infoEl.classList.add("hidden");
        if (redeemBox) redeemBox.classList.add("hidden");
        cartCustomerLoyaltyBalance = 0;
        currentLoyaltyRedeemPoints = 0;
        renderCart();
        return;
    }

    const existing = await db.customers.get(normalized);
    if (existing) {
        if (nameInput && !nameInput.value.trim()) nameInput.value = existing.name || "";
        cartCustomerLoyaltyBalance = Number(existing.loyaltyPoints) || 0;
        if (infoEl) {
            infoEl.textContent = `Returning customer: ${existing.totalOrders || 0} orders • Total spent ${formatAmount(existing.totalSpent || 0)} • ⭐ ${cartCustomerLoyaltyBalance} points`;
            infoEl.classList.remove("hidden");
        }
        if (redeemBox) {
            if (cartCustomerLoyaltyBalance > 0) redeemBox.classList.remove("hidden");
            else redeemBox.classList.add("hidden");
        }
    } else {
        cartCustomerLoyaltyBalance = 0;
        currentLoyaltyRedeemPoints = 0;
        if (infoEl) {
            infoEl.textContent = "New customer — will be saved after checkout.";
            infoEl.classList.remove("hidden");
        }
        if (redeemBox) redeemBox.classList.add("hidden");
    }
    renderCart();
}, 300);

window.lookupCartCustomer = function (phone) {
    lookupCartCustomerDebounced(phone);
};

window.applyLoyaltyRedemption = function (pointsValue) {
    let points = parseInt(pointsValue, 10);
    if (isNaN(points) || points < 0) points = 0;
    if (points > cartCustomerLoyaltyBalance) {
        alert(`Customer only has ${cartCustomerLoyaltyBalance} points available.`);
        points = cartCustomerLoyaltyBalance;
    }
    currentLoyaltyRedeemPoints = points;
    const input = document.getElementById("cartLoyaltyRedeemInput");
    if (input) input.value = points || "";
    renderCart();
};

window.clearCartCustomer = function () {
    const phoneInput = document.getElementById("cartCustomerPhone");
    const nameInput = document.getElementById("cartCustomerName");
    const infoEl = document.getElementById("cartCustomerInfo");
    const redeemBox = document.getElementById("cartLoyaltyRedeemBox");
    const redeemInput = document.getElementById("cartLoyaltyRedeemInput");
    if (phoneInput) phoneInput.value = "";
    if (nameInput) nameInput.value = "";
    if (infoEl) infoEl.classList.add("hidden");
    if (redeemBox) redeemBox.classList.add("hidden");
    if (redeemInput) redeemInput.value = "";
    cartCustomerLoyaltyBalance = 0;
    currentLoyaltyRedeemPoints = 0;
    renderCart();
};

function getCartCustomerInput() {
    const phone = normalizePhone(document.getElementById("cartCustomerPhone")?.value);
    const name = document.getElementById("cartCustomerName")?.value.trim() || "";
    if (!phone) return null;
    return { phone, name };
}

function restoreCartCustomerInput(customer) {
    const phoneInput = document.getElementById("cartCustomerPhone");
    const nameInput = document.getElementById("cartCustomerName");
    if (phoneInput) phoneInput.value = customer?.phone || "";
    if (nameInput) nameInput.value = customer?.name || "";
    if (customer?.phone) {
        lookupCartCustomerDebounced(customer.phone);
    }
}

async function upsertCustomerRecord(customer, saleTotal, redeemedPoints = 0) {
    if (!customer || !customer.phone) return;
    const existing = await db.customers.get(customer.phone);
    const earnedPoints = Math.floor((Number(saleTotal) || 0) / LOYALTY_EARN_RATE);
    const newBalance = Math.max(0, (Number(existing?.loyaltyPoints) || 0) - (Number(redeemedPoints) || 0) + earnedPoints);
    await db.customers.put({
        id: customer.phone,
        phone: customer.phone,
        name: customer.name || existing?.name || "",
        totalOrders: (existing?.totalOrders || 0) + 1,
        totalSpent: (existing?.totalSpent || 0) + (Number(saleTotal) || 0),
        loyaltyPoints: newBalance,
        lastVisit: new Date().toISOString(),
        createdAt: existing?.createdAt || new Date().toISOString()
    });
}

window.openCustomerModal = async function () {
    document.getElementById("customerModal")?.classList.remove("hidden");
    showCustomerListView();
    await renderCustomerList();
};

window.closeCustomerModal = function () {
    document.getElementById("customerModal")?.classList.add("hidden");
};

window.showCustomerListView = function () {
    document.getElementById("customerListView")?.classList.remove("hidden");
    document.getElementById("customerHistoryView")?.classList.add("hidden");
};

window.renderCustomerList = async function (searchText = "") {
    const container = document.getElementById("customerListContainer");
    if (!container) return;

    let customers = await db.customers.toArray();
    customers.sort((a, b) => new Date(b.lastVisit || 0).getTime() - new Date(a.lastVisit || 0).getTime());

    const normalized = (searchText || "").trim().toLowerCase();
    if (normalized) {
        customers = customers.filter(c =>
            String(c.name || "").toLowerCase().includes(normalized) ||
            String(c.phone || "").toLowerCase().includes(normalized)
        );
    }

    if (customers.length === 0) {
        container.innerHTML = `<div class="text-gray-400 text-xs text-center py-6">No customers found.</div>`;
        return;
    }

    container.innerHTML = customers.map(c => `
        <div onclick="viewCustomerHistory('${escapeHtml(c.phone)}')" class="p-3 bg-white rounded-xl border shadow-sm flex justify-between items-center cursor-pointer hover:bg-purple-50 transition">
            <div>
                <div class="font-bold text-sm text-gray-800">${escapeHtml(c.name || "Unnamed Customer")}</div>
                <div class="text-[11px] text-gray-500">${escapeHtml(c.phone)} • Last visit: ${c.lastVisit ? new Date(c.lastVisit).toLocaleDateString() : "—"}</div>
            </div>
            <div class="text-right">
                <div class="font-bold text-purple-700 text-xs">${formatAmount(c.totalSpent || 0)}</div>
                <div class="text-[10px] text-gray-500">${c.totalOrders || 0} orders</div>
            </div>
        </div>
    `).join("");
};

window.viewCustomerHistory = async function (phone) {
    const customer = await db.customers.get(phone);
    if (!customer) return;

    document.getElementById("customerListView")?.classList.add("hidden");
    document.getElementById("customerHistoryView")?.classList.remove("hidden");

    const detailsEl = document.getElementById("customerHistoryDetails");
    if (detailsEl) {
        detailsEl.innerHTML = `
            <div class="p-3 bg-purple-50 border border-purple-200 rounded-xl">
                <div class="font-bold text-sm text-gray-800">${escapeHtml(customer.name || "Unnamed Customer")}</div>
                <div class="text-xs text-gray-600">${escapeHtml(customer.phone)}</div>
                <div class="flex gap-4 mt-2 text-xs">
                    <div><strong class="text-purple-700">${customer.totalOrders || 0}</strong> orders</div>
                    <div><strong class="text-purple-700">${formatAmount(customer.totalSpent || 0)}</strong> total spent</div>
                    <div><strong class="text-purple-700">⭐ ${customer.loyaltyPoints || 0}</strong> points</div>
                </div>
            </div>
        `;
    }

    const allSales = await db.sales.toArray();
    const customerSales = allSales
        .filter(s => normalizePhone(s.customer?.phone || s.deliveryInfo?.phone) === phone)
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    const ordersEl = document.getElementById("customerHistoryOrders");
    if (ordersEl) {
        ordersEl.innerHTML = customerSales.length === 0
            ? `<div class="text-gray-400 text-xs text-center py-4">No past orders found for this customer.</div>`
            : customerSales.map(s => `
                <div class="p-2 bg-white rounded-lg border flex justify-between items-center text-xs">
                    <div>
                        <div class="font-bold text-gray-800">Order #${s.id}</div>
                        <div class="text-[10px] text-gray-500">${new Date(s.timestamp).toLocaleString()}</div>
                    </div>
                    <div class="font-bold text-emerald-700">${formatAmount(s.total || 0)}</div>
                </div>
            `).join("");
    }
};


// ====================================================
window.connectPrinter = async function () {
    try {
        bluetoothDevice = await navigator.bluetooth.requestDevice({
            acceptAllDevices: true,
            optionalServices: ['000018f0-0000-1000-8000-00805f9b34fb', '49535343-fe7d-41a5-8b53-07423c5a2253']
        });
        const server = await bluetoothDevice.gatt.connect();
        const services = await server.getPrimaryServices();

        for (const service of services) {
            const characteristics = await service.getCharacteristics();
            if (characteristics.length > 0) {
                printerCharacteristic = characteristics[0];
                break;
            }
        }
        alert("Printer Connected: " + (bluetoothDevice.name || "Unknown"));
    } catch (e) {
        console.error("Printer Connection Error:", e);
        alert("Failed to connect printer: " + (e.message || e));
    }
};

// Helper: write Uint8Array to printer in chunks
async function writeToPrinter(uint8Array) {
    if (!printerCharacteristic) throw new Error("Printer not connected");
    const CHUNK = 20;
    for (let i = 0; i < uint8Array.length; i += CHUNK) {
        const slice = uint8Array.slice(i, i + CHUNK);
        await printerCharacteristic.writeValue(slice);
        // small delay can help older printers - but keep short
        await new Promise(res => setTimeout(res, 20));
    }
}

// Print KDS ticket (kitchen) - compact order for cooks
async function printKDS(saleId, items, meta = {}) {
    if (!printerCharacteristic) {
        console.warn("No printer connected for KDS.");
        return;
    }

    try {
        const encoder = new TextEncoder();

        // KDS formatting: header, order meta, items (name x qty), optional notes
        // ESC/POS minimal formatting sequences
        // Initialize, center, bold, then left listing
        let text = "";
        text += "\x1B@\x1Ba\x01"; // init, center
        text += "\x1B!\x20"; // emphasized/bold-ish (font size small/big depending on printer)
        text += "KITCHEN ORDER\n";
        text += "\x1B!\x00"; // normal
        text += `Order: #${saleId}\n`;
        if (meta.server) text += `By: ${escapeHtml(meta.server)}\n`;
        text += `Time: ${new Date().toLocaleTimeString()}\n`;
        if (meta.table) text += `Table: ${escapeHtml(String(meta.table))}\n`;
        text += "--------------------------------\n";

        // print items - one per line
        for (const it of items) {
            const lineName = (it.name || '').slice(0, 28); // truncate to fit narrower paper
            const qty = Number(it.qty || 0);
            // Format: left: name, right: qty
            // Use fixed width approx: name padded to 24 chars then qty right aligned
            const padded = lineName.padEnd(28, ' ');
            const qtyTxt = `x${qty}`.padStart(4, ' ');
            text += `${padded}${qtyTxt}\n`;
        }

        text += "--------------------------------\n";
        if (meta.notes) {
            text += `Notes: ${escapeHtml(meta.notes)}\n`;
        }
        text += "\n\n"; // spacing
        text += "\x1DV\x41\x03"; // cut

        const data = encoder.encode(text);
        await writeToPrinter(data);
        console.log("KDS printed for order", saleId);
    } catch (e) {
        console.error("KDS print error:", e);
    }
}

async function printReceipt(saleId, cartItems, subtotal, discountPercent, total, deliveryInfo = null, payments = [], totalChange = 0, orderType = currentOrderType, deliveryCharge = 0, packingCharge = 0, taxPercent = 0, taxAmount = 0, otherCharge = 0) {
    if (!printerCharacteristic) {
        console.warn("No printer connected.");
        return;
    }

    const encoder = new TextEncoder();
    const divider = "------------------------------------------\n";
    const normalizedOrderType = String(orderType || "DINE_IN").toUpperCase();
    const footerMessage = normalizedOrderType === "DELIVERY"
        ? "Thank you for ordering delivery!"
        : normalizedOrderType === "TAKEAWAY"
            ? "Thank you for choosing takeaway!"
            : "Thank you for dining with us!";

    let text = "\x1B@\x1Ba\x01\x1BE\x01\x1D!\x11HUNGRY BIRDS RESTAURANT\n";
    text += "\x1D!\x00\x1BE\x000325-7867774\nDubai Park Stop, Main GT Road Lahore\n";
    text += divider;
    text += "\x1BE\x01ORDER RECEIPT\n\x1BE\x00";
    text += `Order ID: #${saleId}\nDate: ${new Date().toLocaleString()}\nServer: ${currentUser?.username || "Staff"}\nType: ${normalizedOrderType}\n`;

    if (normalizedOrderType === "DINE_IN") {
        text += "Table: Counter Service\n";
    }

    if (normalizedOrderType === "DELIVERY" && deliveryInfo) {
        text += divider;
        text += "\x1BE\x01DELIVERY DETAILS\n\x1BE\x00";
        text += `Name: ${deliveryInfo.name || "N/A"}\nPhone: ${deliveryInfo.phone || "N/A"}\nAddress: ${deliveryInfo.address || "N/A"}\n`;
    }

    text += divider;
    text += "\x1BE\x01ITEMS\n\x1BE\x00";
    cartItems.forEach(item => {
        const itemName = String(item.name || "Item");
        const itemNameLines = itemName.match(/.{1,42}/g) || ["Item"];
        text += `${itemNameLines.join("\n")}\n`;
        text += `Qty: ${item.qty}    Rs ${(item.price * item.qty).toFixed(2)}\n`;
        text += divider;
    });

    text += "\x1Ba\x02";
    text += `Subtotal: Rs ${subtotal.toFixed(2)}\n`;
    if (discountPercent > 0) {
        const discAmount = subtotal * (discountPercent / 100);
        text += `Discount (${discountPercent}%): -Rs ${discAmount.toFixed(2)}\n`;
    }
    if (deliveryCharge > 0) {
        text += `Delivery Charge: Rs ${Number(deliveryCharge).toFixed(2)}\n`;
    }
    if (packingCharge > 0) text += `Packing Charge: Rs ${Number(packingCharge).toFixed(2)}\n`;
    if (taxAmount > 0) text += `Tax (${Number(taxPercent).toFixed(2)}%): Rs ${Number(taxAmount).toFixed(2)}\n`;
    if (otherCharge > 0) text += `Other Charges: Rs ${Number(otherCharge).toFixed(2)}\n`;
    text += `\x1BE\x01\x1D!\x11GRAND TOTAL: Rs ${total.toFixed(2)}\n\x1D!\x00\x1BE\x00`;

    if (payments && payments.length > 0) {
        text += divider;
        text += "\x1BE\x01PAYMENTS\n\x1BE\x00";
        payments.forEach(p => {
            if (p.method === 'Cash') {
                const given = (p.cashGiven != null) ? p.cashGiven.toFixed(2) : p.amount.toFixed(2);
                text += `${p.method}: Rs ${p.amount.toFixed(2)}\nGiven: Rs ${given}`;
                if (p.change && p.change > 0) text += `\nChange: Rs ${p.change.toFixed(2)}`;
                text += "\n";
            } else {
                text += `${p.method}: Rs ${p.amount.toFixed(2)}\n`;
            }
        });
        if (totalChange && totalChange > 0) {
            text += `Change to return: Rs ${totalChange.toFixed(2)}\n`;
        }
    }

    text += divider;
    text += `\x1Ba\x01\x1BE\x01${footerMessage}\n`;
    text += "HungryPOS (Made by Rehan Shafiq)\n\x1BE\x00\n\n\n\x1DV\x41\x03";

    const data = encoder.encode(text);

    try {
        await writeToPrinter(data);
        console.log("Customer receipt printed for order", saleId);
    } catch (e) {
        console.error("Receipt print error:", e);
    }
}

// ====================================================
// Stock PIN & Verification Handlers
// ====================================================
window.promptStockPin = function () {
    document.getElementById("stockPinModal")?.classList.remove("hidden");
    const pinInput = document.getElementById("stockPinInput");
    if (pinInput) {
        pinInput.value = "";
        pinInput.focus();
    }
    document.getElementById("stockPinError")?.classList.add("hidden");
};

window.closeStockPinModal = function () {
    document.getElementById("stockPinModal")?.classList.add("hidden");
};

window.submitStockPin = async function () {
    const pinInput = document.getElementById("stockPinInput");
    const enteredPin = pinInput?.value.trim();

    const ownerPin = await getOwnerPin();

    if (enteredPin === ownerPin) {
        document.getElementById("stockPinModal")?.classList.add("hidden");
        document.getElementById("stockLockedState")?.classList.add("hidden");
        document.getElementById("stockUnlockedState")?.classList.remove("hidden");
        document.getElementById("lockStockBtn")?.classList.remove("hidden");
        await renderInventoryList();
    } else {
        document.getElementById("stockPinError")?.classList.remove("hidden");
    }
};

window.lockStockView = function () {
    document.getElementById("stockLockedState")?.classList.remove("hidden");
    document.getElementById("stockUnlockedState")?.classList.add("hidden");
    document.getElementById("lockStockBtn")?.classList.add("hidden");
};

window.protectedOpenInventoryModal = function () {
    if (currentRole !== "OWNER" && currentRole !== "MANAGER") {
        alert("Access Denied: Owner or Manager role required.");
        return;
    }
    document.getElementById("inventoryModal")?.classList.remove("hidden");
    renderModalInventoryList();
};

window.closeInventoryModal = function () {
    document.getElementById("inventoryModal")?.classList.add("hidden");
};

// ====================================================
// Live Stock Management
// ====================================================
window.addNewInventoryItem = async function () {
    const nameEl = document.getElementById("newItemName");
    const stockEl = document.getElementById("newItemStock");
    const unitEl = document.getElementById("newItemUnit");
    const costEl = document.getElementById("newItemCost");

    if (!nameEl?.value || !stockEl?.value) return alert("Enter item name and stock quantity.");

    const id = "INV_" + Date.now();
    await db.inventory.put({
        id,
        name: nameEl.value.trim(),
        stock: parseFloat(stockEl.value),
        unit: unitEl?.value.trim() || "pcs",
        cost: parseFloat(costEl?.value || 0) || 0
    });

    nameEl.value = "";
    stockEl.value = "";
    if (unitEl) unitEl.value = "";
    if (costEl) costEl.value = "";

    await renderModalInventoryList();
    await renderInventoryList();
    await renderLowStockAlert();
};

async function renderInventoryList() {
    const container = document.getElementById("inventoryContainer");
    if (!container) return;

    const threshold = await getLowStockThreshold();
    const thresholdInput = document.getElementById("lowStockThresholdInput");
    if (thresholdInput && document.activeElement !== thresholdInput) thresholdInput.value = threshold;

    const items = await db.inventory.toArray();
    if (items.length === 0) {
        container.innerHTML = `<div class="text-gray-400 text-xs text-center py-2">No raw inventory found.</div>`;
        return;
    }

    container.innerHTML = items.map(item => `
        <div class="p-2 bg-gray-50 rounded border space-y-1">
            <div class="flex justify-between items-center">
                <div>
                    <div class="font-bold text-gray-800">${escapeHtml(item.name)}</div>
                    <div class="text-[11px] text-gray-500">Cost/unit: ${formatAmount(Number(item.cost || 0))} • Unit: ${escapeHtml(item.unit || '')}</div>
                </div>
                <span class="font-extrabold text-xs ${item.stock <= threshold ? 'text-red-600' : 'text-emerald-700'}">${Number(item.stock).toFixed(2)} ${escapeHtml(item.unit || '')}</span>
            </div>
            <div class="flex items-center gap-1">
                <input type="number" id="inlineStockInput_${item.id}" value="${Number(item.stock)}" step="0.1" class="w-20 p-1 text-xs border rounded bg-white">
                <button onclick="saveQuickStock('${item.id}')" class="bg-indigo-600 text-white text-[10px] font-bold px-2 py-1 rounded hover:bg-indigo-700 transition">Update</button>
                <button onclick="quickAdjustStock('${item.id}', 1)" class="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-1 rounded hover:bg-emerald-200">+1</button>
                <button onclick="quickAdjustStock('${item.id}', -1)" class="bg-red-100 text-red-800 text-[10px] font-bold px-2 py-1 rounded hover:bg-red-200">-1</button>
            </div>
        </div>
    `).join("");
}

window.saveQuickStock = async function (id) {
    const input = document.getElementById(`inlineStockInput_${id}`);
    if (!input) return;

    const newStock = parseFloat(input.value);
    if (isNaN(newStock) || newStock < 0) return alert("Enter a valid non-negative number.");

    await db.inventory.update(id, { stock: newStock });
    await renderInventoryList();
    await renderLowStockAlert();
    if (!document.getElementById("inventoryModal")?.classList.contains("hidden")) {
        await renderModalInventoryList();
    }
};

window.quickAdjustStock = async function (id, delta) {
    const item = await db.inventory.get(id);
    if (!item) return;

    const updatedStock = Math.max(0, (Number(item.stock) || 0) + delta);
    await db.inventory.update(id, { stock: updatedStock });
    await renderInventoryList();
    await renderLowStockAlert();
    if (!document.getElementById("inventoryModal")?.classList.contains("hidden")) {
        await renderModalInventoryList();
    }
};

async function renderModalInventoryList() {
    const container = document.getElementById("modalInventoryList");
    if (!container) return;

    const items = await db.inventory.toArray();
    container.innerHTML = items.map(item => `
        <div class="p-3 bg-white rounded-xl border shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items:center gap-2">
            <div class="flex-1 grid grid-cols-1 sm:grid-cols-4 gap-2 w-full">
                <input id="editName_${item.id}" type="text" value="${escapeHtml(item.name)}" class="p-1.5 border rounded text-xs font-semibold text-gray-800 bg-white">
                <div class="flex items-center gap-1">
                    <input id="editStock_${item.id}" type="number" step="0.01" value="${Number(item.stock)}" class="p-1.5 border rounded text-xs font-bold text-gray-800 bg-white w-full">
                </div>
                <input id="editUnit_${item.id}" type="text" value="${escapeHtml(item.unit || '')}" placeholder="Unit (kg, pcs)" class="p-1.5 border rounded text-xs bg-white">
                <input id="editCost_${item.id}" type="number" step="0.01" value="${Number(item.cost || 0).toFixed(2)}" placeholder="Cost per Unit" class="p-1.5 border rounded text-xs bg-white">
            </div>
            <div class="flex gap-2 w-full sm:w-auto justify-end">
                <button onclick="saveFullModalIngredient('${item.id}')" class="bg-emerald-600 text-white text-xs font-bold px-3 py-1.5 rounded hover:bg-emerald-700 transition">Save</button>
                <button onclick="deleteInventoryItem('${item.id}')" class="bg-red-100 text-red-600 text-xs font-bold px-2 py-1.5 rounded hover:bg-red-200 transition">Delete</button>
            </div>
        </div>
    `).join("");
}

window.saveFullModalIngredient = async function (id) {
    const nameInput = document.getElementById(`editName_${id}`);
    const stockInput = document.getElementById(`editStock_${id}`);
    const unitInput = document.getElementById(`editUnit_${id}`);
    const costInput = document.getElementById(`editCost_${id}`);

    if (!nameInput?.value || !stockInput?.value) return alert("Ingredient name and stock quantity cannot be empty.");

    const updatedStock = parseFloat(stockInput.value);
    if (isNaN(updatedStock) || updatedStock < 0) return alert("Enter a valid stock number.");

    const updatedCost = parseFloat(costInput?.value || '0') || 0;

    await db.inventory.update(id, {
        name: nameInput.value.trim(),
        stock: updatedStock,
        unit: unitInput?.value.trim() || "pcs",
        cost: updatedCost
    });

    await renderModalInventoryList();
    await renderInventoryList();
    await renderLowStockAlert();
};

window.deleteInventoryItem = async function (id) {
    if (!confirm("Delete this inventory item?")) return;
    await db.inventory.delete(id);
    await renderModalInventoryList();
    await renderInventoryList();
    await renderLowStockAlert();
};

// ====================================================
// Owner Admin Modal (Menu & Category Admin)
// ====================================================
window.authenticateOwner = function () {
    if (currentRole !== "OWNER") {
        alert("Owner authentication required.");
        return;
    }
    document.getElementById("ownerAdminModal")?.classList.remove("hidden");
    renderOwnerAdminCategories();
    renderOwnerFoodList();
    populateCategorySelect();
};

window.closeOwnerAdminModal = function () {
    document.getElementById("ownerAdminModal")?.classList.add("hidden");
};

window.addCategory = async function () {
    const input = document.getElementById("newCatName");
    if (!input || !input.value.trim()) return;

    const catId = "CAT_" + Date.now();
    const category = { id: catId, name: input.value.trim() };
    await db.categories.put(category);
    pushCategoryToCloud(category).catch(e => console.warn("Cloud category sync failed (non-blocking):", e));
    input.value = "";

    await renderOwnerAdminCategories();
    await renderCategoryBar();
    await populateCategorySelect();
};

async function renderOwnerAdminCategories() {
    const container = document.getElementById("ownerCategoryList");
    if (!container) return;

    const categories = await db.categories.toArray();
    container.innerHTML = categories.map(cat => `
        <div class="bg-purple-200 text-purple-900 px-3 py-1 rounded-full text-xs font-bold flex items-center gap-2">
            <span>${escapeHtml(cat.name)}</span>
            <button onclick="deleteCategory('${cat.id}')" class="text-red-600 font-extrabold hover:text-red-800">&times;</button>
        </div>
    `).join("");
}

window.deleteCategory = async function (id) {
    if (!confirm("Delete category?")) return;
    await db.categories.delete(id);
    deleteCategoryFromCloud(id).catch(e => console.warn("Cloud category delete sync failed (non-blocking):", e));
    await renderOwnerAdminCategories();
    await renderCategoryBar();
    await populateCategorySelect();
};

async function populateCategorySelect() {
    const select = document.getElementById("foodCategorySelect");
    if (!select) return;

    const categories = await db.categories.toArray();
    select.innerHTML = categories.map(cat => `<option value="${escapeHtml(cat.id)}">${escapeHtml(cat.name)}</option>`).join("");
}

window.addRecipeIngredientRow = async function (prefillInvId = null, prefillQty = null) {
    const container = document.getElementById("recipeIngredientRows");
    if (!container) return;

    const ingredients = await db.inventory.toArray();
    const rowId = Date.now() + Math.floor(Math.random() * 999);

    const div = document.createElement("div");
    div.className = "flex gap-2 items-center";
    div.id = `recipe-row-${rowId}`;

    const select = document.createElement("select");
    select.className = "p-1.5 border rounded text-xs flex-1 recipe-inv-id bg-white";

    select.innerHTML = ingredients.map(ing => {
        const selected = prefillInvId && prefillInvId === ing.id ? 'selected' : '';
        return `<option value="${escapeHtml(ing.id)}" ${selected}>${escapeHtml(ing.name)} (${escapeHtml(ing.unit || '')})</option>`;
    }).join('');

    const input = document.createElement("input");
    input.type = "number";
    input.placeholder = "Qty";
    input.step = "0.01";
    input.className = "p-1.5 border rounded text-xs w-20 recipe-qty bg-white";
    if (prefillQty != null) input.value = Number(prefillQty);

    const btn = document.createElement("button");
    btn.className = "text-red-600 text-xs font-bold px-2";
    btn.type = "button";
    btn.innerText = "X";
    btn.onclick = () => div.remove();

    div.appendChild(select);
    div.appendChild(input);
    div.appendChild(btn);
    container.appendChild(div);
};

// ====================================================
// Product Modifiers: admin group/option builder
// ====================================================
window.addModifierGroupRow = function (prefillGroup = null) {
    const container = document.getElementById("modifierGroupsRows");
    if (!container) return;

    const groupId = prefillGroup?.id || ("GRP_" + Date.now() + Math.floor(Math.random() * 999));
    const div = document.createElement("div");
    div.className = "border rounded-xl p-3 bg-gray-50 space-y-2 modifier-group-row";
    div.dataset.groupId = groupId;

    div.innerHTML = `
        <div class="flex flex-wrap items-center gap-2">
            <input type="text" placeholder="Group name (e.g. Size)" class="modifier-group-name p-1.5 border rounded text-xs flex-1 min-w-[120px]" value="${escapeHtml(prefillGroup?.name || '')}">
            <label class="flex items-center gap-1 text-[11px] font-bold text-gray-600">
                <input type="checkbox" class="modifier-group-required" ${prefillGroup?.required ? 'checked' : ''}> Required
            </label>
            <label class="flex items-center gap-1 text-[11px] font-bold text-gray-600">
                <input type="checkbox" class="modifier-group-multiple" ${prefillGroup?.multiple ? 'checked' : ''}> Multi-select
            </label>
            <button type="button" onclick="this.closest('.modifier-group-row').remove()" class="text-red-600 text-xs font-bold px-2">Remove Group</button>
        </div>
        <div class="modifier-options-rows space-y-1"></div>
        <button type="button" class="text-[11px] bg-indigo-50 text-indigo-700 px-2 py-1 rounded font-bold hover:bg-indigo-100" onclick="addModifierOptionRow(this)">+ Add Option</button>
    `;

    container.appendChild(div);

    const optionsRows = div.querySelector(".modifier-options-rows");
    (prefillGroup?.options || []).forEach(opt => window.addModifierOptionRow(null, optionsRows, opt));
};

window.addModifierOptionRow = function (buttonEl, targetContainer = null, prefillOption = null) {
    const optionsRows = targetContainer || buttonEl.closest(".modifier-group-row").querySelector(".modifier-options-rows");
    const row = document.createElement("div");
    row.className = "flex gap-2 items-center modifier-option-row";
    row.innerHTML = `
        <input type="text" placeholder="Option name (e.g. Large)" class="modifier-option-name p-1.5 border rounded text-xs flex-1" value="${escapeHtml(prefillOption?.name || '')}">
        <input type="number" step="0.01" placeholder="Price +/-" class="modifier-option-price p-1.5 border rounded text-xs w-24" value="${prefillOption != null ? Number(prefillOption.price || 0) : ''}">
        <button type="button" onclick="this.closest('.modifier-option-row').remove()" class="text-red-600 text-xs font-bold px-2">X</button>
    `;
    optionsRows.appendChild(row);
};

// Reads the admin form's modifier group rows into a plain data structure for storage.
function collectModifierGroupsFromForm() {
    const groups = [];
    document.querySelectorAll("#modifierGroupsRows > .modifier-group-row").forEach(groupEl => {
        const name = groupEl.querySelector(".modifier-group-name")?.value.trim();
        if (!name) return;
        const required = groupEl.querySelector(".modifier-group-required")?.checked || false;
        const multiple = groupEl.querySelector(".modifier-group-multiple")?.checked || false;
        const options = [];
        groupEl.querySelectorAll(".modifier-option-row").forEach(optEl => {
            const optName = optEl.querySelector(".modifier-option-name")?.value.trim();
            if (!optName) return;
            const optPrice = Number(optEl.querySelector(".modifier-option-price")?.value || 0) || 0;
            options.push({ name: optName, price: optPrice });
        });
        if (options.length > 0) {
            groups.push({ id: groupEl.dataset.groupId, name, required, multiple, options });
        }
    });
    return groups;
}

window.handleFoodImageUpload = async function (event) {
    const file = event?.target?.files?.[0];
    const preview = document.getElementById("foodImagePreview");
    if (!file || !preview) return;

    if (!file.type.startsWith("image/")) {
        alert("Please choose a valid image file.");
        event.target.value = "";
        return;
    }

    const reader = new FileReader();
    reader.onload = () => {
        const imageUrl = reader.result;
        preview.src = imageUrl;
        preview.dataset.imageUrl = imageUrl;
        preview.classList.remove("hidden");
    };
    reader.readAsDataURL(file);
};

let isSavingFoodItem = false; // guards against double-click causing duplicate recipe rows
window.saveFoodItem = async function () {
    if (isSavingFoodItem) return;
    isSavingFoodItem = true;
    try {
        const idEl = document.getElementById("editFoodId");
        const nameEl = document.getElementById("foodName");
        const priceEl = document.getElementById("foodPrice");
        const catEl = document.getElementById("foodCategorySelect");
        const preview = document.getElementById("foodImagePreview");

        if (!nameEl?.value || !priceEl?.value || !catEl?.value) return alert("Fill in dish details.");

        const foodId = idEl.value || "MENU_" + Date.now();
        const imageUrl = preview?.dataset.imageUrl || preview?.src || "";
        const recipeRows = Array.from(document.querySelectorAll("#recipeIngredientRows > div"))
            .map(row => ({
                inventoryId: row.querySelector(".recipe-inv-id")?.value,
                qtyRequired: parseFloat(row.querySelector(".recipe-qty")?.value || 0)
            }))
            .filter(r => r.inventoryId && r.qtyRequired > 0);

        await db.menu.put({
            id: foodId,
            name: nameEl.value.trim(),
            price: parseFloat(priceEl.value),
            categoryId: catEl.value,
            imageUrl: imageUrl,
            modifierGroups: collectModifierGroupsFromForm()
        });

        await db.recipes.where("menuItemId").equals(foodId).delete();
        for (const r of recipeRows) {
            await db.recipes.add({ menuItemId: foodId, inventoryId: r.inventoryId, qtyRequired: r.qtyRequired });
        }
        pushMenuItemToCloud({ id: foodId, name: nameEl.value.trim(), price: parseFloat(priceEl.value), categoryId: catEl.value, imageUrl, modifierGroups: collectModifierGroupsFromForm() }, recipeRows)
            .catch(e => console.warn("Cloud menu sync failed (non-blocking):", e));

        resetFoodForm();
        await renderMenu();
        await renderOwnerFoodList();
    } finally {
        isSavingFoodItem = false;
    }
};

window.resetFoodForm = function () {
    const preview = document.getElementById("foodImagePreview");
    const input = document.getElementById("foodImageInput");

    document.getElementById("editFoodId").value = "";
    document.getElementById("foodName").value = "";
    document.getElementById("foodPrice").value = "";
    document.getElementById("recipeIngredientRows").innerHTML = "";
    document.getElementById("modifierGroupsRows").innerHTML = "";
    if (preview) {
        preview.src = "";
        preview.dataset.imageUrl = "";
        preview.classList.add("hidden");
    }
    if (input) input.value = "";
    document.getElementById("foodFormTitle").innerText = "2. Add New Food Item";
};

window.addInstantItemToCart = function () {
    if (currentRole !== "OWNER") {
        alert("Owner access required to add instant cart items.");
        return;
    }

    const nameEl = document.getElementById("instantItemName");
    const priceEl = document.getElementById("instantItemPrice");
    if (!nameEl || !priceEl) return;

    const name = nameEl.value.trim();
    const price = Number(priceEl.value);

    if (!name || Number.isNaN(price) || price < 0) {
        alert("Please enter a valid item name and price.");
        return;
    }

    const existing = cart.find(item => item.name.toLowerCase() === name.toLowerCase() && Number(item.price) === price && String(item.id).startsWith("CUSTOM_"));
    if (existing) {
        existing.qty += 1;
    } else {
        cart.push({
            id: `CUSTOM_${Date.now()}`,
            name,
            price,
            qty: 1
        });
    }

    nameEl.value = "";
    priceEl.value = "";
    renderCart();
};

window.changeMenuItemPrice = async function (menuId) {
    const menuItem = await db.menu.get(menuId);
    if (!menuItem) return;

    const newPriceRaw = window.prompt(`Update price for "${menuItem.name}"`, String(menuItem.price || 0));
    if (newPriceRaw === null) return;

    const newPrice = Number(newPriceRaw);
    if (Number.isNaN(newPrice) || newPrice < 0) {
        alert("Please enter a valid non-negative price.");
        return;
    }

    await db.menu.update(menuId, { price: newPrice });
    await renderMenu();
    await renderOwnerFoodList();
};

async function renderOwnerFoodList() {
    const container = document.getElementById("ownerFoodList");
    if (!container) return;

    const menu = await db.menu.toArray();
    container.innerHTML = menu.map(item => `
        <div class="flex justify-between items-center bg-white p-3 rounded-lg border shadow-sm gap-3">
            <div class="flex items-center gap-3 min-w-0 flex-1">
                ${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.name)}" class="w-12 h-12 object-cover rounded-lg border" />` : `<div class="w-12 h-12 rounded-lg bg-orange-100 flex items-center justify-center text-lg">🍽️</div>`}
                <div class="min-w-0">
                    <div class="font-bold text-sm text-gray-800 truncate">${escapeHtml(item.name)}</div>
                    <div class="text-xs text-gray-500">${formatAmount(item.price)}</div>
                </div>
            </div>
            <div class="flex flex-wrap gap-2 justify-end shrink-0">
                <button onclick="handleMenuItemClick('${item.id}')" class="text-xs bg-indigo-50 text-indigo-700 px-2 py-1 rounded hover:bg-indigo-100">Add</button>
                <button onclick="changeMenuItemPrice('${item.id}')" class="text-xs bg-amber-50 text-amber-700 px-2 py-1 rounded hover:bg-amber-100">Price</button>
                <button onclick="loadFoodForEdit('${item.id}')" class="text-xs bg-amber-50 text-amber-700 px-2 py-1 rounded hover:bg-amber-100">Edit</button>
                <button onclick="deleteFoodItem('${item.id}')" class="text-xs bg-red-100 text-red-600 px-2 py-1 rounded hover:bg-red-200">Delete</button>
            </div>
        </div>
    `).join("");
}

window.loadFoodForEdit = async function (menuId) {
    const menuItem = await db.menu.get(menuId);
    if (!menuItem) return alert("Menu item not found.");

    const preview = document.getElementById("foodImagePreview");
    const input = document.getElementById("foodImageInput");

    document.getElementById("editFoodId").value = menuId;
    document.getElementById("foodName").value = menuItem.name || "";
    document.getElementById("foodPrice").value = Number(menuItem.price || 0);
    if (preview) {
        preview.src = menuItem.imageUrl || "";
        preview.dataset.imageUrl = menuItem.imageUrl || "";
        preview.classList.toggle("hidden", !menuItem.imageUrl);
    }
    if (input) input.value = "";

    await populateCategorySelect();
    const catSelect = document.getElementById("foodCategorySelect");
    if (catSelect) catSelect.value = menuItem.categoryId || (catSelect.options[0] && catSelect.options[0].value);

    document.getElementById("recipeIngredientRows").innerHTML = "";

    const recipes = await db.recipes.where("menuItemId").equals(menuId).toArray();
    if (recipes && recipes.length > 0) {
        for (const r of recipes) {
            await window.addRecipeIngredientRow(r.inventoryId, r.qtyRequired);
        }
    }

    document.getElementById("modifierGroupsRows").innerHTML = "";
    (menuItem.modifierGroups || []).forEach(group => window.addModifierGroupRow(group));

    document.getElementById("foodFormTitle").innerText = "2. Edit Food Item";
    document.getElementById("ownerAdminModal")?.classList.remove("hidden");
    const foodFormTitle = document.getElementById("foodFormTitle");
    if (foodFormTitle) foodFormTitle.scrollIntoView({ behavior: "smooth", block: "center" });
};

window.deleteFoodItem = async function (id) {
    if (!confirm("Delete food item?")) return;
    await db.menu.delete(id);
    await db.recipes.where("menuItemId").equals(id).delete();
    deleteMenuItemFromCloud(id).catch(e => console.warn("Cloud menu delete sync failed (non-blocking):", e));
    await renderMenu();
    await renderOwnerFoodList();
};

// ====================================================
// Menu & Category Bar
// ====================================================
async function renderCategoryBar() {
    const categories = await db.categories.toArray();
    const container = document.getElementById("categoryFilterBar");
    if (!container) return;

    const allMenu = await db.menu.toArray();
    const countByCategory = {};
    categories.forEach(cat => {
        countByCategory[cat.id] = allMenu.filter(item => item.categoryId === cat.id).length;
    });

    container.classList.remove("hidden");
    container.style.display = "flex";
    container.style.alignItems = "center";
    container.style.minHeight = "40px";
    container.style.gap = "0.5rem";

    let html = categoryButtonHtml("ALL", "All Items", allMenu.length);
    categories.forEach(cat => {
        html += categoryButtonHtml(cat.id, cat.name, countByCategory[cat.id] || 0);
    });

    container.innerHTML = html;

    container.querySelectorAll("button[data-cat]").forEach(btn => {
        btn.addEventListener("click", () => {
            const id = btn.dataset.cat;
            selectCategory(id);
        });
    });
}

function categoryButtonHtml(id, name, itemCount = 0) {
    const isSelected = selectedCategoryId === id;
    const countBadge = itemCount > 0 ? `<span class="ml-1 text-[10px] bg-white/20 px-1.5 py-0.5 rounded-full font-mono">${itemCount}</span>` : "";
    const selectedClasses = "px-4 py-2 rounded-lg m-1 whitespace-nowrap font-semibold border transition-all duration-200 bg-indigo-600 text-white border-indigo-600 shadow-sm flex items-center";
    const normalClasses = "px-4 py-2 rounded-lg m-1 whitespace-nowrap font-semibold border transition-all duration-200 bg-gray-50 text-gray-700 border-gray-200 hover:bg-indigo-50 hover:text-indigo-700 hover:border-indigo-200 flex items-center";

    const classes = isSelected ? selectedClasses : normalClasses;

    return `<button type="button" data-cat="${escapeHtml(id)}" aria-pressed="${isSelected ? "true" : "false"}" class="${classes}">${escapeHtml(name)}${countBadge}</button>`;
}

window.selectCategory = function (id) {
    selectedCategoryId = id;
    renderCategoryBar();
    renderMenu();
};

async function renderMenu(searchText) {
    const categories = await db.categories.toArray();
    let menu = await db.menu.toArray();
    if (searchText === undefined) {
        searchText = document.getElementById("menuSearch")?.value || "";
    }
    const normalizedText = (searchText || "").trim().toLowerCase();

    if (normalizedText) {
        menu = menu.filter(item => (item.name || "").toLowerCase().includes(normalizedText));
        const categoryIdLookup = new Map(categories.map(cat => [cat.id, cat.name]));
        const uncategorizedItems = menu.filter(item => !item.categoryId || !categoryIdLookup.has(item.categoryId));
        const grouped = categories
            .map(cat => ({
                category: cat,
                items: menu.filter(item => item.categoryId === cat.id)
            }))
            .filter(g => g.items.length > 0);
        
        if (uncategorizedItems.length) {
            grouped.push({ category: { id: "UNCATEGORIZED", name: "Uncategorized" }, items: uncategorizedItems });
        }
        
        renderMenuGroups(grouped, normalizedText);
        return;
    }

    if (selectedCategoryId !== "ALL") {
        menu = menu.filter(item => item.categoryId === selectedCategoryId);
        const category = categories.find(c => c.id === selectedCategoryId);
        const grouped = category ? [{ category, items: menu }] : [];
        renderMenuGroups(grouped, "");
        return;
    }

    const allCats = await db.categories.toArray();
    const firstCat = allCats[0];
    if (firstCat) {
        menu = menu.filter(item => item.categoryId === firstCat.id);
        renderMenuGroups([{ category: firstCat, items: menu }], "");
    }
}

function renderMenuGroups(grouped, searchText = "") {
    const container = document.getElementById("menuContainer");
    if (!container) return;

    const hasItems = grouped.some(group => group.items.length > 0);
    if (!hasItems) {
        const emptyMessage = searchText
            ? `No items match "${escapeHtml(searchText)}".`
            : "No dishes available. Add some in Owner Admin.";
        container.innerHTML = `<div class="col-span-full text-center text-gray-400 py-6">${emptyMessage}</div>`;
        return;
    }

    container.innerHTML = grouped.map(group => {
        if (!group.items.length) return "";

        return `
            <div class="col-span-full">
                <div class="mb-2">
                    <h4 class="text-sm font-bold uppercase tracking-wide text-gray-600">${escapeHtml(group.category.name)} <span class="text-xs font-normal text-gray-400">(${group.items.length})</span></h4>
                </div>
                <div class="grid grid-cols-3 sm:grid-cols-5 gap-2">
                    ${group.items.map(item => `
                        <div class="bg-white rounded-lg shadow-sm border overflow-hidden cursor-pointer hover:shadow-md transition-all" onclick="handleMenuItemClick('${escapeHtml(item.id)}')">
                            ${item.imageUrl ? `<img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.name)}" class="w-full h-14 object-cover border-b" />` : `<div class="h-14 bg-gradient-to-br from-orange-100 to-amber-50 flex items-center justify-center text-xl">🍽️</div>`}
                            <div class="p-2">
                                <h3 class="font-bold text-sm text-gray-800 leading-tight">${escapeHtml(item.name)}</h3>
                                <p class="text-indigo-600 font-bold text-xs mt-1">${formatAmount(item.price)}</p>
                            </div>
                        </div>
                    `).join("")}
                </div>
            </div>
        `;
    }).join("");
}

function initializeSearch() {
    const search = document.getElementById("menuSearch");
    if (!search) return;

    const onInput = debounce(async () => {
        const text = search.value.trim();
        if (!text) {
            await renderMenu();
            return;
        }

        await renderMenu(text);
    }, 250);

    search.addEventListener("input", onInput);
}

// ====================================================
// Cart & Discount Calculations
// ====================================================
window.addItemToCart = async function (menuId) {
    const menuItem = await db.menu.get(menuId);
    if (!menuItem) return;

    const existing = cart.find(item => item.id === menuId);
    if (existing) {
        existing.qty++;
    } else {
        cart.push({
            id: menuItem.id,
            menuItemId: menuItem.id,
            name: menuItem.name,
            price: menuItem.price,
            qty: 1
        });
    }
    renderCart();
};

// Routes plain items straight to cart; items with modifiers open the customization modal first.
window.handleMenuItemClick = async function (menuId) {
    const menuItem = await db.menu.get(menuId);
    if (!menuItem) return;

    if (menuItem.modifierGroups && menuItem.modifierGroups.length > 0) {
        await openModifierModal(menuId);
    } else {
        await window.addItemToCart(menuId);
    }
};

async function openModifierModal(menuId) {
    const menuItem = await db.menu.get(menuId);
    if (!menuItem) return;

    pendingModifierMenuId = menuId;
    setText("modifierModalTitle", `Customize: ${menuItem.name}`);

    const container = document.getElementById("modifierGroupsContainer");
    if (!container) return;

    container.innerHTML = menuItem.modifierGroups.map(group => `
        <div class="modifier-select-group" data-group-id="${escapeHtml(group.id)}">
            <div class="text-xs font-bold text-gray-700 mb-1">${escapeHtml(group.name)} ${group.required ? '<span class="text-red-500">*</span>' : ''}</div>
            <div class="space-y-1">
                ${group.options.map((opt, idx) => `
                    <label class="flex items-center justify-between gap-2 p-2 border rounded-lg text-xs bg-gray-50 cursor-pointer">
                        <span class="flex items-center gap-2">
                            <input type="${group.multiple ? 'checkbox' : 'radio'}" name="modgroup_${escapeHtml(group.id)}" class="modifier-option-input" value="${idx}" onchange="updateModifierModalTotal()">
                            ${escapeHtml(opt.name)}
                        </span>
                        <span class="font-bold ${opt.price >= 0 ? 'text-emerald-700' : 'text-red-600'}">${opt.price >= 0 ? '+' : ''}${formatAmount(opt.price)}</span>
                    </label>
                `).join("")}
            </div>
        </div>
    `).join("");

    await updateModifierModalTotal();
    document.getElementById("modifierSelectModal")?.classList.remove("hidden");
}

window.closeModifierModal = function () {
    document.getElementById("modifierSelectModal")?.classList.add("hidden");
    pendingModifierMenuId = null;
};

window.updateModifierModalTotal = async function () {
    if (!pendingModifierMenuId) return;
    const menuItem = await db.menu.get(pendingModifierMenuId);
    if (!menuItem) return;

    let total = Number(menuItem.price) || 0;
    document.querySelectorAll("#modifierGroupsContainer .modifier-option-input:checked").forEach(input => {
        const groupEl = input.closest(".modifier-select-group");
        const group = (menuItem.modifierGroups || []).find(g => g.id === groupEl.dataset.groupId);
        const opt = group?.options[Number(input.value)];
        if (opt) total += Number(opt.price) || 0;
    });

    setText("modifierModalTotal", formatAmount(total));
};

window.confirmAddModifiedItem = async function () {
    if (!pendingModifierMenuId) return;
    const menuItem = await db.menu.get(pendingModifierMenuId);
    if (!menuItem) return;

    const selectedModifiers = [];
    let total = Number(menuItem.price) || 0;
    let missingRequired = null;

    document.querySelectorAll("#modifierGroupsContainer .modifier-select-group").forEach(groupEl => {
        const group = (menuItem.modifierGroups || []).find(g => g.id === groupEl.dataset.groupId);
        if (!group) return;
        const checkedInputs = Array.from(groupEl.querySelectorAll(".modifier-option-input:checked"));

        if (group.required && checkedInputs.length === 0) {
            missingRequired = group.name;
            return;
        }

        checkedInputs.forEach(input => {
            const opt = group.options[Number(input.value)];
            if (opt) {
                selectedModifiers.push({ group: group.name, name: opt.name, price: Number(opt.price) || 0 });
                total += Number(opt.price) || 0;
            }
        });
    });

    if (missingRequired) {
        alert(`Please select an option for "${missingRequired}".`);
        return;
    }

    const modifierKey = selectedModifiers.map(m => `${m.group}:${m.name}`).sort().join('|');
    const cartId = modifierKey ? `${menuItem.id}::${modifierKey}` : menuItem.id;
    const displayName = selectedModifiers.length > 0
        ? `${menuItem.name} (${selectedModifiers.map(m => m.name).join(', ')})`
        : menuItem.name;

    const existing = cart.find(item => item.id === cartId);
    if (existing) {
        existing.qty++;
    } else {
        cart.push({
            id: cartId,
            menuItemId: menuItem.id,
            name: displayName,
            price: total,
            qty: 1,
            modifiers: selectedModifiers
        });
    }

    closeModifierModal();
    renderCart();
};

window.updateDiscount = function (value) {
    let val = parseFloat(value);
    if (isNaN(val) || val < 0) val = 0;
    if (val > 100) val = 100;

    currentDiscountPercent = val;
    renderCart();
};

function normalizeCharge(value, maximum = Infinity) {
    const amount = parseFloat(value);
    if (!Number.isFinite(amount) || amount < 0) return 0;
    return Math.min(amount, maximum);
}

function calculateCartTotals() {
    const subtotal = cart.reduce((sum, item) => sum + (Number(item.price) * Number(item.qty)), 0);
    const discountAmount = subtotal * (currentDiscountPercent / 100);
    const deliveryCharge = currentOrderType === "DELIVERY" ? normalizeCharge(currentDeliveryCharge) : 0;
    const packingCharge = normalizeCharge(currentPackingCharge);
    const otherCharge = normalizeCharge(currentOtherCharge);
    const taxableAmount = subtotal - discountAmount + deliveryCharge + packingCharge + otherCharge;
    const taxAmount = taxableAmount * (currentTaxPercent / 100);
    const loyaltyDiscount = Math.min(
        (Number(currentLoyaltyRedeemPoints) || 0) * LOYALTY_POINT_VALUE,
        Math.max(0, subtotal - discountAmount)
    );
    const grandTotal = Math.max(0, taxableAmount + taxAmount - loyaltyDiscount);

    return { subtotal, discountAmount, deliveryCharge, packingCharge, otherCharge, taxAmount, loyaltyDiscount, grandTotal };
}

window.updatePackingCharge = function (value) {
    currentPackingCharge = normalizeCharge(value);
    renderCart();
};

window.updateTaxPercent = function (value) {
    currentTaxPercent = normalizeCharge(value, 100);
    renderCart();
};

window.updateOtherCharge = function (value) {
    currentOtherCharge = normalizeCharge(value);
    renderCart();
};

function syncCheckoutChargeInputs() {
    const packingInput = document.getElementById("packingChargeInput");
    const taxInput = document.getElementById("taxPercentInput");
    const otherInput = document.getElementById("otherChargeInput");
    if (packingInput) packingInput.value = currentPackingCharge || 0;
    if (taxInput) taxInput.value = currentTaxPercent || 0;
    if (otherInput) otherInput.value = currentOtherCharge || 0;
}

function clearCheckoutCharges() {
    cart = [];
    currentDiscountPercent = 0;
    currentPackingCharge = 0;
    currentTaxPercent = 0;
    currentOtherCharge = 0;
    const discInput = document.getElementById("discountInput");
    if (discInput) discInput.value = 0;
    syncCheckoutChargeInputs();
}

function renderCart() {
    const container = document.getElementById("cartItems");
    const subtotalEl = document.getElementById("cartSubtotal");
    const totalEl = document.getElementById("cartTotal");
    const discRow = document.getElementById("discountAmountRow");
    const discAmountEl = document.getElementById("cartDiscountAmount");
    const chargeRow = document.getElementById("deliveryChargeRow");
    const chargeAmountEl = document.getElementById("cartDeliveryCharge");
    const packingChargeRow = document.getElementById("packingChargeRow");
    const packingChargeAmountEl = document.getElementById("cartPackingCharge");
    const taxAmountRow = document.getElementById("taxAmountRow");
    const taxAmountEl = document.getElementById("cartTaxAmount");
    const otherChargeRow = document.getElementById("otherChargeRow");
    const otherChargeAmountEl = document.getElementById("cartOtherCharge");

    if (!container) return;

    if (cart.length === 0) {
        container.innerHTML = `<div class="text-center text-gray-400 py-4">Cart is empty</div>`;
        if (subtotalEl) subtotalEl.innerText = "Rs 0.00";
        if (totalEl) totalEl.innerText = "Rs 0.00";
        if (discRow) discRow.classList.add("hidden");
        if (chargeRow) chargeRow.classList.add("hidden");
        if (packingChargeRow) packingChargeRow.classList.add("hidden");
        if (taxAmountRow) taxAmountRow.classList.add("hidden");
        if (otherChargeRow) otherChargeRow.classList.add("hidden");
        return;
    }

    container.innerHTML = cart.map(item => {
        const lineTotal = item.price * item.qty;
        const canEditPrice = currentRole === "OWNER";
        return `
            <div class="border rounded-lg p-3 mb-2 bg-white flex justify-between items-center shadow-sm">
                <div>
                    <div class="font-semibold text-gray-800">${escapeHtml(item.name)}</div>
                    <div class="flex items-center gap-2 text-xs text-gray-500">
                        <span>${formatAmount(item.price)}</span>
                        ${canEditPrice ? `<button onclick="event.stopPropagation(); changeCartItemPrice('${escapeHtml(item.id)}')" class="text-indigo-600 font-bold underline">Change</button>` : ""}
                    </div>
                </div>
                <div class="flex items-center gap-3">
                    <div class="flex gap-1 items-center">
                        <button onclick="decreaseQty('${escapeHtml(item.id)}')" class="px-2 py-0.5 bg-red-500 text-white rounded text-sm">-</button>
                        <span class="font-bold px-2 text-sm">${escapeHtml(String(item.qty))}</span>
                        <button onclick="increaseQty('${escapeHtml(item.id)}')" class="px-2 py-0.5 bg-green-500 text-white rounded text-sm">+</button>
                    </div>
                    <div class="font-bold text-sm w-16 text-right text-gray-800">${formatAmount(lineTotal)}</div>
                </div>
            </div>
        `;
    }).join("");

    const { subtotal, discountAmount, deliveryCharge, packingCharge, otherCharge, taxAmount, loyaltyDiscount, grandTotal } = calculateCartTotals();

    if (subtotalEl) subtotalEl.innerText = formatAmount(subtotal);
    if (totalEl) totalEl.innerText = formatAmount(grandTotal);

    if (currentDiscountPercent > 0) {
        if (discRow) discRow.classList.remove("hidden");
        if (discAmountEl) discAmountEl.innerText = `-${formatAmount(discountAmount)} (${currentDiscountPercent}%)`;
    } else {
        if (discRow) discRow.classList.add("hidden");
    }

    if (deliveryCharge > 0) {
        if (chargeRow) chargeRow.classList.remove("hidden");
        if (chargeAmountEl) chargeAmountEl.innerText = formatAmount(deliveryCharge);
    } else {
        if (chargeRow) chargeRow.classList.add("hidden");
    }

    if (packingCharge > 0) {
        if (packingChargeRow) packingChargeRow.classList.remove("hidden");
        if (packingChargeAmountEl) packingChargeAmountEl.innerText = formatAmount(packingCharge);
    } else {
        if (packingChargeRow) packingChargeRow.classList.add("hidden");
    }

    if (taxAmount > 0) {
        if (taxAmountRow) taxAmountRow.classList.remove("hidden");
        if (taxAmountEl) taxAmountEl.innerText = `${formatAmount(taxAmount)} (${currentTaxPercent}%)`;
    } else {
        if (taxAmountRow) taxAmountRow.classList.add("hidden");
    }

    if (otherCharge > 0) {
        if (otherChargeRow) otherChargeRow.classList.remove("hidden");
        if (otherChargeAmountEl) otherChargeAmountEl.innerText = formatAmount(otherCharge);
    } else {
        if (otherChargeRow) otherChargeRow.classList.add("hidden");
    }

    const loyaltyRow = document.getElementById("loyaltyDiscountRow");
    const loyaltyAmountEl = document.getElementById("cartLoyaltyDiscount");
    if (loyaltyDiscount > 0) {
        if (loyaltyRow) loyaltyRow.classList.remove("hidden");
        if (loyaltyAmountEl) loyaltyAmountEl.innerText = `-${formatAmount(loyaltyDiscount)} (${currentLoyaltyRedeemPoints} pts)`;
    } else {
        if (loyaltyRow) loyaltyRow.classList.add("hidden");
    }
}

window.increaseQty = function (id) {
    const item = cart.find(i => i.id === id);
    if (item) { item.qty++; renderCart(); }
};

window.changeCartItemPrice = function (id) {
    if (currentRole !== "OWNER") {
        alert("Owner access required to change item price.");
        return;
    }

    const item = cart.find(i => i.id === id);
    if (!item) return;

    const rawValue = window.prompt(`Set the price for "${item.name}"`, String(item.price || 0));
    if (rawValue === null) return;

    const newPrice = Number(rawValue);
    if (Number.isNaN(newPrice) || newPrice < 0) {
        alert("Please enter a valid non-negative price.");
        return;
    }

    item.price = newPrice;
    renderCart();
};

window.decreaseQty = function (id) {
    const item = cart.find(i => i.id === id);
    if (!item) return;
    item.qty--;
    if (item.qty <= 0) cart = cart.filter(i => i.id !== id);
    renderCart();
};

// ====================================================
// Checkout & Persistence (IndexedDB + Cloud)
// ====================================================
function formatCurrencyPlain(amount) {
    try {
        return new Intl.NumberFormat('en-PK', { style: 'currency', currency: 'PKR', maximumFractionDigits: 2 }).format(amount);
    } catch (e) {
        return `Rs ${Number(amount || 0).toFixed(2)}`;
    }
}

function openPaymentModal() {
    if (!pendingSaleContext) return alert("No sale pending.");
    document.getElementById("paymentModal")?.classList.remove("hidden");
    clearPaymentRows();
    addPaymentRow({ method: "Cash", amount: pendingSaleContext.total, cashGiven: pendingSaleContext.total });
    updatePaymentTotals();
}

function closePaymentModal() {
    document.getElementById("paymentModal")?.classList.add("hidden");
}

function clearPaymentRows() {
    const container = document.getElementById("paymentRows");
    if (!container) return;
    container.innerHTML = "";
    paymentRowCounter = 0;
}

function addPaymentRow(prefill = {}) {
    const container = document.getElementById("paymentRows");
    if (!container) return;
    paymentRowCounter++;
    const rowId = `paymentRow_${paymentRowCounter}`;

    const methods = PAYMENT_METHODS;
    const methodOptions = methods.map(m => `<option value="${m}" ${prefill.method === m ? 'selected' : ''}>${m}</option>`).join("");

    const amountVal = (typeof prefill.amount === 'number') ? prefill.amount.toFixed(2) : (prefill.amount || "");
    const cashGivenVal = (typeof prefill.cashGiven === 'number') ? prefill.cashGiven.toFixed(2) : (prefill.cashGiven || amountVal);

    const div = document.createElement("div");
    div.className = "p-2 bg-white rounded border flex gap-2 items-center";
    div.id = rowId;

    div.innerHTML = `
        <select class="p-1 border rounded text-xs payment-method" onchange="onPaymentRowMethodChange('${rowId}')">
            ${methodOptions}
        </select>
        <input type="number" step="0.01" min="0" placeholder="Amount" class="p-1 border rounded text-xs w-24 payment-amount" value="${amountVal}" oninput="updatePaymentTotals()">
        <input type="number" step="0.01" min="0" placeholder="Cash Given" class="p-1 border rounded text-xs w-24 payment-cashgiven ${prefill.method === 'Cash' ? '' : 'hidden'}" value="${cashGivenVal}" oninput="updatePaymentTotals()">
        <button type="button" onclick="removePaymentRow('${rowId}')" class="text-red-600 text-xs font-bold px-2 py-1 rounded">Remove</button>
    `;

    container.appendChild(div);
    updatePaymentTotals();
}

function removePaymentRow(rowId) {
    const el = document.getElementById(rowId);
    if (el) el.remove();
    updatePaymentTotals();
}

function onPaymentRowMethodChange(rowId) {
    const row = document.getElementById(rowId);
    if (!row) return;
    const method = row.querySelector('.payment-method')?.value;
    const cashGivenInput = row.querySelector('.payment-cashgiven');
    if (method === 'Cash') {
        cashGivenInput?.classList.remove('hidden');
        const amt = parseFloat(row.querySelector('.payment-amount')?.value || '0');
        if (!cashGivenInput.value) cashGivenInput.value = amt.toFixed(2);
    } else {
        cashGivenInput?.classList.add('hidden');
    }
    updatePaymentTotals();
}

function updatePaymentTotals() {
    const rows = Array.from(document.querySelectorAll('#paymentRows > div'));
    const totalDue = pendingSaleContext ? (Number(pendingSaleContext.total) || 0) : 0;

    let totalPaid = 0;

    for (const row of rows) {
        const method = row.querySelector('.payment-method')?.value;
        const amount = parseFloat(row.querySelector('.payment-amount')?.value || '0') || 0;

        if (method === 'Cash') {
            const cashGiven = parseFloat(row.querySelector('.payment-cashgiven')?.value || String(amount)) || 0;
            totalPaid += cashGiven;
        } else {
            totalPaid += amount;
        }
    }

    const change = Math.max(0, totalPaid - totalDue);
    const remaining = Math.max(0, totalDue - totalPaid);

    setText("paymentTotalDue", formatCurrencyPlain(totalDue));
    setText("paymentTotalPaid", formatCurrencyPlain(totalPaid));
    setText("paymentChange", formatCurrencyPlain(change));
    setText("paymentRemaining", formatCurrencyPlain(remaining));

    const remainingRow = document.getElementById("paymentRemainingRow");
    const confirmBtn = document.getElementById("confirmPaymentBtn");
    if (remaining > 0) {
        remainingRow?.classList.remove("hidden");
        if (confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.classList.add("opacity-50");
        }
    } else {
        remainingRow?.classList.add("hidden");
        if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.classList.remove("opacity-50");
        }
    }
}

async function confirmPaymentAndProcess() {
    const rows = Array.from(document.querySelectorAll('#paymentRows > div'));
    if (!pendingSaleContext) return alert("Sale context missing.");

    const payments = [];
    let totalReceived = 0;

    for (const row of rows) {
        const method = row.querySelector('.payment-method')?.value || 'Cash';
        const amount = parseFloat(row.querySelector('.payment-amount')?.value || '0') || 0;
        const cashGivenInput = row.querySelector('.payment-cashgiven');
        const cashGiven = (cashGivenInput && !cashGivenInput.classList.contains('hidden')) ? (parseFloat(cashGivenInput.value || '0') || 0) : null;

        payments.push({
            method,
            amount,
            cashGiven: cashGiven
        });

        if (method === 'Cash') {
            totalReceived += (cashGiven !== null ? cashGiven : amount);
        } else {
            totalReceived += amount;
        }
    }

    const due = Number(pendingSaleContext.total) || 0;
    if (totalReceived < due) {
        return alert(`Total received (${formatCurrencyPlain(totalReceived)}) is less than total due (${formatCurrencyPlain(due)}).`);
    }

    pendingSaleContext.payments = payments;
    pendingSaleContext.totalReceived = totalReceived;
    pendingSaleContext.totalChange = Math.max(0, totalReceived - due);

    closePaymentModal();

    await completeSaleWithPayments(pendingSaleContext);

    pendingSaleContext = null;
    clearPaymentRows();
}

window.processSale = async function () {
    if (cart.length === 0) return alert("Cart is empty.");

    const { subtotal, discountAmount, deliveryCharge, packingCharge, otherCharge, taxAmount, loyaltyDiscount, grandTotal } = calculateCartTotals();

    if (currentOrderType === "DELIVERY" && (subtotal - discountAmount) < 500) {
        alert(`Minimum order total for delivery is Rs 500.00. Current total is ${formatAmount(subtotal - discountAmount)}.`);
        return;
    }

    let deliveryDetails = null;
    if (currentOrderType === "DELIVERY") {
        const name = document.getElementById("deliveryCustomerName")?.value.trim() || "";
        const phone = document.getElementById("deliveryCustomerPhone")?.value.trim() || "";
        const address = document.getElementById("deliveryAddress")?.value.trim() || "";

        if (!address) {
            if (!confirm("No delivery address was entered. Proceed anyway?")) {
                return;
            }
        }

        deliveryDetails = { name, phone, address };
    }

    const stockOk = await verifyStock();
    if (!stockOk) return;

    pendingSaleContext = {
        items: JSON.parse(JSON.stringify(cart)),
        subtotal,
        discountPercent: currentDiscountPercent,
        discountAmount,
        deliveryCharge,
        packingCharge,
        taxPercent: currentTaxPercent,
        taxAmount,
        otherCharge,
        loyaltyRedeemPoints: currentLoyaltyRedeemPoints,
        loyaltyDiscount,
        total: grandTotal,
        paymentMethod: null,
        orderType: currentOrderType,
        deliveryInfo: deliveryDetails,
        customer: getCartCustomerInput(),
        table: null,
        serverUser: currentUser?.username || "Staff",
        timestamp: new Date().toISOString()
    };

    openPaymentModal();
};

async function completeSaleWithPayments(saleData) {
    let savedSaleId = null;
    try {
        await db.transaction('rw', db.sales, db.inventory, db.recipes, async () => {
            const saleRecord = { ...saleData };
            let totalChange = 0;
            saleRecord.payments = (saleData.payments || []).map(p => {
                const changeForRow = (p.method === 'Cash' && p.cashGiven != null) ? Math.max(0, Number(p.cashGiven) - Number(p.amount)) : 0;
                totalChange += changeForRow;
                return {
                    method: p.method,
                    amount: Number(p.amount) || 0,
                    cashGiven: p.cashGiven != null ? Number(p.cashGiven) : null,
                    change: changeForRow
                };
            });
            saleRecord.totalReceived = saleData.totalReceived || saleRecord.payments.reduce((s, p) => s + (p.method === 'Cash' ? (p.cashGiven != null ? p.cashGiven : p.amount) : p.amount), 0);
            saleRecord.totalChange = saleData.totalChange || totalChange;

            savedSaleId = await db.sales.add(saleRecord);

            for (const cartItem of saleRecord.items) {
                const recipes = await db.recipes.where("menuItemId").equals(cartItem.menuItemId || cartItem.id).toArray();
                for (const recipe of recipes) {
                    const ingredient = await db.inventory.get(recipe.inventoryId);
                    if (!ingredient) continue;
                    const newStock = (Number(ingredient.stock) || 0) - (recipe.qtyRequired * cartItem.qty);
                    await db.inventory.update(recipe.inventoryId, { stock: Math.max(0, newStock) });
                }
            }
        });
    } catch (err) {
        console.error("Transaction failed:", err);
        alert("Failed to process sale. Please try again.");
        return;
    }

    syncSaleToCloud({ ...saleData, localId: savedSaleId }).catch(e => console.warn("Cloud sync failed (non-blocking):", e));

    // If delivery, create delivery record
    if (saleData.orderType === 'DELIVERY') {
        try {
            await createDeliveryForSale(savedSaleId, saleData);
        } catch (e) {
            console.warn("Failed to create delivery record:", e);
        }
    }

    // Save/update CRM record so returning customers can be looked up next visit
    const crmCustomer = saleData.customer || (saleData.orderType === 'DELIVERY' && saleData.deliveryInfo?.phone ? saleData.deliveryInfo : null);
    if (crmCustomer && crmCustomer.phone) {
        try {
            await upsertCustomerRecord(crmCustomer, saleData.total, saleData.loyaltyRedeemPoints || 0);
            if (saleData.loyaltyRedeemPoints > 0) {
                await logAudit("LOYALTY_REDEEM", `Redeemed ${saleData.loyaltyRedeemPoints} points (${formatAmount(saleData.loyaltyDiscount || 0)}) for ${crmCustomer.phone} on sale #${savedSaleId}`);
            }
        } catch (e) {
            console.warn("Failed to update customer record:", e);
        }
    }

    // Print KDS ticket first (kitchen), then customer receipt.
    // Both calls are non-blocking to sale completion, but we await them to ensure printing is attempted.
    try {
        if (printerCharacteristic) {
            await printKDS(savedSaleId, saleData.items, { server: saleData.serverUser, table: saleData.table, notes: saleData.notes });
            await printReceipt(savedSaleId, saleData.items, saleData.subtotal, saleData.discountPercent, saleData.total, saleData.deliveryInfo, saleData.payments || [], saleData.totalChange || 0, saleData.orderType, saleData.deliveryCharge || 0, saleData.packingCharge || 0, saleData.taxPercent || 0, saleData.taxAmount || 0, saleData.otherCharge || 0);
        } else {
            console.warn("Printer not connected - skipping receipts.");
        }
    } catch (e) {
        console.error("Printing flow error:", e);
    }

    alert(`Order Processed Successfully by ${currentUser?.username || 'Staff'}!`);

    clearCheckoutCharges();

    clearDeliveryDetails();
    clearCartCustomer();
    renderCart();
    if (document.getElementById("stockUnlockedState") && !document.getElementById("stockUnlockedState").classList.contains("hidden")) {
        renderInventoryList();
    }

    // Refresh deliveries UI if open
    if (!document.getElementById("deliveryManagementModal")?.classList.contains("hidden")) {
        await renderDeliveryManagementLists();
    }
}

// ====================================================
// Delivery Management: creation, render, actions
// ====================================================
async function createDeliveryForSale(saleId, saleData) {
    const delivery = {
        saleId,
        status: 'PENDING', // PENDING -> ACTIVE -> COMPLETED
        createdAt: new Date().toISOString(),
        assignedTo: null,
        eta: null,
        customerName: saleData.deliveryInfo?.name || '',
        customerPhone: saleData.deliveryInfo?.phone || '',
        customerAddress: saleData.deliveryInfo?.address || ''
    };

    await db.deliveries.add(delivery);
    // update sale record with deliveryStatus for quick reference
    await db.sales.update(saleId, { deliveryStatus: 'PENDING' });
    return true;
}

window.openDeliveryManagementModal = async function () {
    document.getElementById("deliveryManagementModal")?.classList.remove("hidden");
    await renderDeliveryManagementLists();
};

window.closeDeliveryManagementModal = function () {
    document.getElementById("deliveryManagementModal")?.classList.add("hidden");
};

async function renderDeliveryManagementLists() {
    const pendingContainer = document.getElementById("pendingDeliveriesContainer");
    const activeContainer = document.getElementById("activeDeliveriesContainer");
    const completedContainer = document.getElementById("completedDeliveriesContainer");

    if (!pendingContainer || !activeContainer || !completedContainer) return;

    const pending = await db.deliveries.where("status").equals("PENDING").reverse().toArray();
    const active = await db.deliveries.where("status").equals("ACTIVE").reverse().toArray();
    const completed = await db.deliveries.where("status").equals("COMPLETED").reverse().toArray();

    pendingContainer.innerHTML = pending.length === 0 ? `<div class="text-gray-400 text-xs text-center py-6">No pending deliveries.</div>` : pending.map(d => deliveryCardHtml(d, 'PENDING')).join("");
    activeContainer.innerHTML = active.length === 0 ? `<div class="text-gray-400 text-xs text-center py-6">No active deliveries.</div>` : active.map(d => deliveryCardHtml(d, 'ACTIVE')).join("");
    completedContainer.innerHTML = completed.length === 0 ? `<div class="text-gray-400 text-xs text-center py-6">No completed deliveries.</div>` : completed.map(d => deliveryCardHtml(d, 'COMPLETED')).join("");
}

function deliveryCardHtml(d, status) {
    const shortAddress = d.customerAddress ? (d.customerAddress.length > 80 ? d.customerAddress.slice(0, 77) + "..." : d.customerAddress) : '—';
    const etaInfo = d.eta ? `<div class="text-[11px] text-gray-500">ETA: ${escapeHtml(d.eta)}</div>` : '';
    const assignedInfo = d.assignedTo ? `<div class="text-[11px] text-gray-500">Rider: ${escapeHtml(d.assignedTo)}</div>` : '';
    const saleBadge = d.saleId ? `<span class="ml-2 text-[10px] text-indigo-600 font-bold bg-indigo-50 px-1.5 py-0.5 rounded">#${escapeHtml(String(d.saleId))}</span>` : '';

    let actions = '';
    if (status === 'PENDING') {
        actions = `
            <button onclick="assignDelivery(${d.id})" class="bg-emerald-600 text-white text-xs font-bold px-3 py-1.5 rounded hover:bg-emerald-700">Assign & Start</button>
            <button onclick="cancelDelivery(${d.id})" class="bg-red-100 text-red-600 text-xs font-bold px-2 py-1.5 rounded hover:bg-red-200">Cancel</button>
        `;
    } else if (status === 'ACTIVE') {
        actions = `
            <button onclick="updateDeliveryETA(${d.id})" class="bg-indigo-50 text-indigo-700 text-xs font-bold px-2 py-1.5 rounded hover:bg-indigo-100">Update ETA</button>
            <button onclick="completeDelivery(${d.id})" class="bg-emerald-50 text-emerald-700 text-xs font-bold px-3 py-1.5 rounded hover:bg-emerald-100">Mark Completed</button>
        `;
    } else if (status === 'COMPLETED') {
        actions = `
            <button onclick="viewDelivery(${d.id})" class="bg-gray-50 text-gray-700 text-xs font-bold px-3 py-1.5 rounded hover:bg-gray-100">View</button>
            <button onclick="deleteDelivery(${d.id})" class="bg-red-50 text-red-600 text-xs font-bold px-2 py-1.5 rounded hover:bg-red-100">Delete</button>
        `;
    }

    return `
        <div class="p-3 bg-white rounded-xl border shadow-sm space-y-2">
            <div class="flex justify-between items-start">
                <div>
                    <div class="font-bold text-sm text-gray-800">
                        ${escapeHtml(d.customerName || 'Customer')} ${saleBadge}
                    </div>
                    <div class="text-[11px] text-gray-500">${escapeHtml(d.customerPhone || '—')}</div>
                    <div class="text-[12px] text-gray-700 mt-1">${escapeHtml(shortAddress)}</div>
                    ${assignedInfo}
                    ${etaInfo}
                </div>
                <div class="text-xs font-bold text-indigo-700">${new Date(d.createdAt).toLocaleTimeString()}</div>
            </div>

            <div class="flex justify-end gap-2">
                ${actions}
            </div>
        </div>
    `;
}

async function assignDelivery(id) {
    const rider = window.prompt("Assign to rider/delivery person (enter name or contact):");
    if (rider === null) return;
    const eta = window.prompt("Optional: Enter ETA (e.g., 20 mins):") || null;

    await db.deliveries.update(id, {
        assignedTo: rider ? String(rider).trim() : null,
        eta: eta ? String(eta).trim() : null,
        status: 'ACTIVE'
    });

    // update sale record
    const record = await db.deliveries.get(id);
    if (record?.saleId) {
        await db.sales.update(record.saleId, { deliveryStatus: 'ACTIVE' });
    }

    await renderDeliveryManagementLists();
}

async function updateDeliveryETA(id) {
    const existing = await db.deliveries.get(id);
    if (!existing) return alert("Delivery not found.");
    const eta = window.prompt("Update ETA (e.g., 15 mins)", existing.eta || "");
    if (eta === null) return;
    await db.deliveries.update(id, { eta: eta ? String(eta).trim() : null });
    await renderDeliveryManagementLists();
}

async function completeDelivery(id) {
    if (!confirm("Mark this delivery as completed?")) return;
    await db.deliveries.update(id, { status: 'COMPLETED', completedAt: new Date().toISOString() });

    const record = await db.deliveries.get(id);
    if (record?.saleId) {
        await db.sales.update(record.saleId, { deliveryStatus: 'DELIVERED' });
    }

    await renderDeliveryManagementLists();
    alert("Delivery marked as completed.");
}

async function cancelDelivery(id) {
    if (!confirm("Cancel and remove this pending delivery?")) return;
    const record = await db.deliveries.get(id);
    if (record?.saleId) {
        await db.sales.update(record.saleId, { deliveryStatus: 'CANCELLED' });
    }
    await db.deliveries.delete(id);
    await renderDeliveryManagementLists();
    alert("Delivery cancelled.");
}

async function deleteDelivery(id) {
    if (!confirm("Delete this delivery record? This cannot be undone.")) return;
    await db.deliveries.delete(id);
    await renderDeliveryManagementLists();
}

// optional: show a small view of completed delivery details
async function viewDelivery(id) {
    const d = await db.deliveries.get(id);
    if (!d) return alert("Delivery not found.");
    let msg = `Delivery #${d.id}\nCustomer: ${d.customerName || '—'}\nPhone: ${d.customerPhone || '—'}\nAddress: ${d.customerAddress || '—'}\nAssigned to: ${d.assignedTo || '—'}\nStatus: ${d.status}\nCreated: ${new Date(d.createdAt).toLocaleString()}`;
    if (d.completedAt) msg += `\nCompleted At: ${new Date(d.completedAt).toLocaleString()}`;
    alert(msg);
}

// ====================================================
// Stock verification & old helpers
// ====================================================
async function verifyStock() {
    for (const cartItem of cart) {
        const recipes = await db.recipes.where("menuItemId").equals(cartItem.menuItemId || cartItem.id).toArray();
        for (const recipe of recipes) {
            const ingredient = await db.inventory.get(recipe.inventoryId);
            if (!ingredient) continue;
            if ((Number(ingredient.stock) || 0) < (recipe.qtyRequired * cartItem.qty)) {
                alert(`${ingredient.name} is out of stock or insufficient quantity.`);
                return false;
            }
        }
    }
    return true;
}

async function deductInventory(itemsToDeduct) {
    for (const cartItem of itemsToDeduct) {
        const recipes = await db.recipes.where("menuItemId").equals(cartItem.menuItemId || cartItem.id).toArray();
        for (const recipe of recipes) {
            const ingredient = await db.inventory.get(recipe.inventoryId);
            if (!ingredient) continue;
            await db.inventory.update(recipe.inventoryId, {
                stock: (Number(ingredient.stock) || 0) - (recipe.qtyRequired * cartItem.qty)
            });
        }
    }
    await renderLowStockAlert();
}

async function restoreInventory(itemsToRestore) {
    for (const cartItem of itemsToRestore) {
        const recipes = await db.recipes.where("menuItemId").equals(cartItem.menuItemId || cartItem.id).toArray();
        for (const recipe of recipes) {
            const ingredient = await db.inventory.get(recipe.inventoryId);
            if (!ingredient) continue;
            await db.inventory.update(recipe.inventoryId, {
                stock: (Number(ingredient.stock) || 0) + (recipe.qtyRequired * cartItem.qty)
            });
        }
    }
    await renderLowStockAlert();
}

// ====================================================
// Post-Sales Management & Bulk Actions
// ====================================================
let receiptSearchTimer = null;
let receiptSearchRequestVersion = 0;

function hideReceiptSearchResults() {
    document.getElementById("receiptSearchStatus")?.classList.add("hidden");
    const results = document.getElementById("receiptSearchResults");
    if (results) {
        results.classList.add("hidden");
        results.innerHTML = "";
    }
}

async function renderReceiptSearchResults(query, requestVersion) {
    const status = document.getElementById("receiptSearchStatus");
    const results = document.getElementById("receiptSearchResults");
    if (!status || !results) return;

    const sales = await db.sales.toArray();
    if (requestVersion !== receiptSearchRequestVersion) return;

    const normalizedQuery = query.toLowerCase();
    const matchingSales = sales.filter(sale => {
        const customer = sale.customer || {};
        const delivery = sale.deliveryInfo || {};
        return [sale.id, customer.name, customer.phone, delivery.name, delivery.phone]
            .some(value => String(value || "").toLowerCase().includes(normalizedQuery));
    }).sort((a, b) => new Date(b.timestamp || 0).getTime() - new Date(a.timestamp || 0).getTime());

    status.textContent = matchingSales.length === 0
        ? "No receipts found."
        : `${matchingSales.length} receipt${matchingSales.length === 1 ? "" : "s"} found.`;
    status.classList.remove("hidden");

    if (matchingSales.length === 0) {
        results.innerHTML = `<div class="rounded-lg border border-dashed border-blue-200 bg-white p-3 text-center text-xs text-gray-500">Try a receipt number, customer name, or phone number.</div>`;
    } else {
        results.innerHTML = matchingSales.map(sale => {
            const customerName = sale.customer?.name || sale.deliveryInfo?.name || "Walk-in customer";
            const customerPhone = sale.customer?.phone || sale.deliveryInfo?.phone || "No phone saved";
            return `
                <div class="rounded-lg border border-blue-100 bg-white p-3 text-xs shadow-sm">
                    <div class="flex items-start justify-between gap-2">
                        <div class="min-w-0">
                            <div class="font-bold text-gray-800">Receipt #${escapeHtml(String(sale.id))}</div>
                            <div class="mt-0.5 text-[11px] text-gray-500">${escapeHtml(new Date(sale.timestamp).toLocaleString())} | ${escapeHtml(sale.orderType || "DINE_IN")}</div>
                        </div>
                        <div class="shrink-0 font-bold text-emerald-700">${formatAmount(sale.total || 0)}</div>
                    </div>
                    <div class="mt-2 text-gray-700"><strong>${escapeHtml(customerName)}</strong> <span class="text-gray-500">${escapeHtml(customerPhone)}</span></div>
                    <div class="mt-2 flex justify-end gap-1.5 border-t border-gray-100 pt-2">
                        <button type="button" onclick="downloadReceiptPDF(${Number(sale.id)})" class="rounded bg-indigo-50 px-2 py-1 text-[10px] font-bold text-indigo-700 hover:bg-indigo-100">PDF</button>
                        <button type="button" onclick="shareReceipt(${Number(sale.id)})" class="rounded bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700 hover:bg-emerald-100">Share</button>
                    </div>
                </div>
            `;
        }).join("");
    }

    results.classList.remove("hidden");
}

window.searchOldReceipts = function (value, searchImmediately = false) {
    const query = String(value || "").trim();
    clearTimeout(receiptSearchTimer);
    const requestVersion = ++receiptSearchRequestVersion;

    if (!query) {
        hideReceiptSearchResults();
        return;
    }

    const search = () => renderReceiptSearchResults(query, requestVersion).catch(error => {
        console.error("Receipt search failed:", error);
        if (requestVersion !== receiptSearchRequestVersion) return;
        const status = document.getElementById("receiptSearchStatus");
        if (status) {
            status.textContent = "Could not search receipts. Please try again.";
            status.classList.remove("hidden");
        }
    });

    if (searchImmediately) {
        search();
    } else {
        receiptSearchTimer = setTimeout(search, 250);
    }
};

window.clearReceiptSearch = function () {
    const input = document.getElementById("receiptSearchInput");
    if (input) input.value = "";
    clearTimeout(receiptSearchTimer);
    receiptSearchRequestVersion++;
    hideReceiptSearchResults();
    input?.focus();
};

window.renderRecentSales = async function () {
    const container = document.getElementById("salesContainer");
    if (!container) return;

    try {
        let sales = await db.sales.toArray();

        sales.sort((a, b) => {
            const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
            const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
            return timeB - timeA;
        });

        sales = sales.slice(0, 15);

        if (sales.length === 0) {
            container.innerHTML = `<div class="text-gray-400 text-xs text-center py-4">No recent sales recorded locally.</div>`;
            updateBulkSalesUI();
            return;
        }

        container.innerHTML = sales.map(sale => `
            <div class="p-3 bg-gray-50 border rounded-xl space-y-2">
                <div class="flex justify-between items-start gap-2">
                    <div class="flex items-center gap-2">
                        <input type="checkbox" value="${escapeHtml(String(sale.id))}" ${selectedSaleIds.has(sale.id) ? 'checked' : ''} onchange="toggleSelectSale(${sale.id}, this.checked)" class="sale-checkbox rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer">
                        <div>
                            <div class="font-bold text-xs text-gray-800">
                                Order #${escapeHtml(String(sale.id || 'N/A'))}
                                <span class="ml-1 text-[10px] text-indigo-600 font-bold bg-indigo-50 px-1.5 py-0.5 rounded">(${escapeHtml(sale.orderType || 'DINE_IN')})</span>
                                ${sale.discountPercent > 0 ? `<span class="ml-1 text-[10px] text-red-500 font-bold">-${escapeHtml(String(sale.discountPercent))}%</span>` : ''}
                                ${sale.deliveryStatus ? `<span class="ml-1 text-[10px] text-${sale.deliveryStatus === 'DELIVERED' ? 'green' : sale.deliveryStatus === 'ACTIVE' ? 'blue' : 'amber'}-700 font-bold bg-${sale.deliveryStatus === 'DELIVERED' ? 'emerald' : sale.deliveryStatus === 'ACTIVE' ? 'blue' : 'amber'}-50 px-1.5 py-0.5 rounded">${escapeHtml(String(sale.deliveryStatus))}</span>` : ''}
                                ${sale.refundStatus ? `<span class="ml-1 text-[10px] text-red-700 font-bold bg-red-50 px-1.5 py-0.5 rounded">${sale.refundStatus === 'FULL' ? 'REFUNDED' : 'PARTIAL REFUND'}</span>` : ''}
                            </div>
                            <div class="text-[10px] text-gray-500">
                                By: ${escapeHtml(sale.serverUser || 'Staff')} • ${sale.timestamp ? new Date(sale.timestamp).toLocaleTimeString() : 'Just now'}
                            </div>
                        </div>
                    </div>
                    <div class="font-bold text-emerald-700 text-xs">${formatAmount(sale.total || 0)}</div>
                </div>

                <div class="flex items-center justify-end gap-1.5 pt-1 border-t border-gray-200">
                    <button onclick="downloadReceiptPDF(${sale.id})" title="Download Receipt PDF" class="text-[10px] bg-indigo-50 text-indigo-700 hover:bg-indigo-100 font-bold px-2 py-1 rounded flex items-center gap-1 transition">
                        📄 PDF
                    </button>
                    <button onclick="shareReceipt(${sale.id})" title="Share Receipt via WhatsApp/Native" class="text-[10px] bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-bold px-2 py-1 rounded flex items-center gap-1 transition">
                        📲 Share
                    </button>
                    <button onclick="editSale(${sale.id})" title="Re-open into cart for editing" class="text-[10px] bg-amber-50 text-amber-700 hover:bg-amber-100 font-bold px-2 py-1 rounded transition">
                        ✏️ Edit
                    </button>
                    ${(currentRole === 'OWNER' || currentRole === 'MANAGER') && sale.refundStatus !== 'FULL' ? `
                    <button onclick="openRefundModal(${sale.id})" title="Refund items from this order" class="text-[10px] bg-orange-50 text-orange-700 hover:bg-orange-100 font-bold px-2 py-1 rounded transition">
                        💵 Refund
                    </button>` : ''}
                    <button onclick="deleteSale(${sale.id})" title="Delete receipt record" class="text-[10px] bg-red-50 text-red-600 hover:bg-red-100 font-bold px-2 py-1 rounded transition">
                        🗑️ Delete
                    </button>
                </div>
            </div>
        `).join("");

        updateBulkSalesUI();
    } catch (err) {
        console.error("Error rendering recent sales:", err);
        container.innerHTML = `<div class="text-red-500 text-xs text-center py-4">Error loading sales history.</div>`;
    }
};

// ------------------------------
// Bulk Selection Handlers
// ------------------------------
window.toggleSelectSale = function (saleId, isChecked) {
    if (isChecked) {
        selectedSaleIds.add(saleId);
    } else {
        selectedSaleIds.delete(saleId);
    }
    updateBulkSalesUI();
};

window.toggleSelectAllSales = async function (isChecked) {
    let sales = await db.sales.toArray();
    sales.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    const visibleSales = sales.slice(0, 15);

    if (isChecked) {
        visibleSales.forEach(s => selectedSaleIds.add(s.id));
    } else {
        selectedSaleIds.clear();
    }

    document.querySelectorAll('.sale-checkbox').forEach(cb => {
        cb.checked = isChecked;
    });

    updateBulkSalesUI();
};

function updateBulkSalesUI() {
    const count = selectedSaleIds.size;
    const btn = document.getElementById("bulkDeleteBtn");
    const countEl = document.getElementById("selectedSalesCount");

    if (countEl) countEl.innerText = count;

    if (btn) {
        if (count > 0 && (currentRole === "OWNER" || currentRole === "MANAGER")) {
            btn.classList.remove("hidden");
            btn.classList.add("flex");
        } else {
            btn.classList.add("hidden");
            btn.classList.remove("flex");
        }
    }
}

window.deleteSelectedSales = async function () {
    if (currentRole === "MANAGER") {
        const idsToDelete = Array.from(selectedSaleIds);
        if (idsToDelete.length === 0) return;

        pendingDeleteSaleIds = idsToDelete;
        pendingOwnerAction = "deleteSelectedSales";
        openOwnerAuthModal();
        return;
    }

    if (currentRole !== "OWNER") {
        return alert("Access Denied: Only the Owner can delete completed sales.");
    }

    await performDeleteSelectedSales();
};

async function performDeleteSelectedSales(saleIds = Array.from(selectedSaleIds)) {
    const idsToDelete = Array.from(saleIds);
    if (idsToDelete.length === 0) return;

    if (!confirm(`Are you sure you want to delete ${idsToDelete.length} selected order(s)?`)) {
        return;
    }

    const restoreStock = confirm("Would you like to return raw ingredients back into inventory for these deleted orders?");

    for (const saleId of idsToDelete) {
        const sale = await db.sales.get(saleId);
        if (sale) {
            if (restoreStock) {
                await restoreInventory(sale.items);
            }
            await db.sales.delete(saleId);
            await logAudit("SALE_DELETE", `Order #${saleId} deleted (bulk, Rs ${Number(sale.total || 0).toFixed(2)})`, saleId);
        }
    }

    selectedSaleIds.clear();

    const selectAllCb = document.getElementById("selectAllSalesCheckbox");
    if (selectAllCb) selectAllCb.checked = false;

    updateBulkSalesUI();
    await renderRecentSales();

    if (document.getElementById("stockUnlockedState") && !document.getElementById("stockUnlockedState").classList.contains("hidden")) {
        renderInventoryList();
    }

    alert(`${idsToDelete.length} order(s) deleted successfully!`);
};

window.downloadReceiptPDF = async function (saleId) {
    const sale = await db.sales.get(saleId);
    if (!sale) return alert("Sale record not found.");

    const metaBox = document.getElementById("pdfReceiptMeta");
    const itemsBox = document.getElementById("pdfReceiptItems");
    const totalsBox = document.getElementById("pdfReceiptTotals");
    const footerBox = document.getElementById("pdfReceiptFooter");

    if (!metaBox || !itemsBox || !totalsBox || !footerBox) return alert("Receipt PDF elements missing in HTML.");

    const receiptOrderType = String(sale.orderType || 'DINE_IN').toUpperCase();
    const receiptFooter = receiptOrderType === 'DELIVERY'
        ? 'Thank you for delivery Order!'
        : receiptOrderType === 'TAKEAWAY'
            ? 'Thank you for choosing takeaway!'
            : 'Thank you for dining with us!';

    metaBox.innerHTML = `
        <div class="text-center text-sm border-b pb-1 mb-1">ORDER RECEIPT</div>
        <div>Order ID: #${escapeHtml(String(sale.id))}</div>
        <div>Date: ${new Date(sale.timestamp).toLocaleString()}</div>
        <div>Server: ${escapeHtml(sale.serverUser || 'Staff')}</div>
        <div>Type: ${escapeHtml(receiptOrderType)}</div>
        ${receiptOrderType === 'DINE_IN' ? '<div>Table: Counter Service</div>' : ''}
        ${receiptOrderType === 'DELIVERY' && sale.deliveryInfo ? `<div class="border-t pt-1 mt-1">DELIVERY DETAILS</div><div>Name: ${escapeHtml(sale.deliveryInfo.name || 'N/A')}</div><div>Phone: ${escapeHtml(sale.deliveryInfo.phone || 'N/A')}</div><div>Address: ${escapeHtml(sale.deliveryInfo.address || 'N/A')}</div>` : ''}
    `;

    itemsBox.innerHTML = sale.items.map(item => `
        <div class="border-b border-black py-1">
            <div class="font-bold">${escapeHtml(item.name)}</div>
            <div class="flex justify-between"><span>Qty: ${escapeHtml(String(item.qty))}</span><span>${formatAmount(item.price * item.qty)}</span></div>
        </div>
    `).join("");

    totalsBox.innerHTML = `
        <div class="flex justify-between items-baseline gap-3 border-b border-black pb-1 mb-1">
            <span>Subtotal:</span><span class="whitespace-nowrap">${formatAmount(sale.subtotal)}</span>
        </div>
        ${sale.discountPercent > 0 ? `<div class="flex justify-between items-baseline gap-3 text-red-600"><span>Discount (${escapeHtml(String(sale.discountPercent))}%):</span><span class="whitespace-nowrap">-${formatAmount(sale.discountAmount)}</span></div>` : ''}
        ${sale.deliveryCharge > 0 ? `<div class="flex justify-between items-baseline gap-3 text-blue-700"><span>Delivery Charge:</span><span class="whitespace-nowrap">${formatAmount(sale.deliveryCharge)}</span></div>` : ''}
        ${Number(sale.packingCharge || 0) > 0 ? `<div class="flex justify-between items-baseline gap-3"><span>Packing Charge:</span><span class="whitespace-nowrap">${formatAmount(sale.packingCharge)}</span></div>` : ''}
        ${Number(sale.taxAmount || 0) > 0 ? `<div class="flex justify-between items-baseline gap-3"><span>Tax (${escapeHtml(String(sale.taxPercent || 0))}%):</span><span class="whitespace-nowrap">${formatAmount(sale.taxAmount)}</span></div>` : ''}
        ${Number(sale.otherCharge || 0) > 0 ? `<div class="flex justify-between items-baseline gap-3"><span>Other Charges:</span><span class="whitespace-nowrap">${formatAmount(sale.otherCharge)}</span></div>` : ''}
        <div class="flex min-h-[28px] justify-between items-center gap-3 border-b-2 border-black pb-1 mb-2 text-base font-black leading-tight">
            <span>GRAND TOTAL:</span><span class="whitespace-nowrap">${formatAmount(sale.total)}</span>
        </div>
    `;

    if (sale.payments && sale.payments.length > 0) {
        let paymentsHtml = '<div class="pt-1 text-xs"><strong>PAYMENTS</strong><div class="mt-1">';
        sale.payments.forEach(p => {
            if (p.method === 'Cash') {
                paymentsHtml += `<div>${escapeHtml(p.method)}: ${formatAmount(p.amount)}</div><div>Given: ${formatAmount(p.cashGiven || p.amount)}${p.change ? ` | Change: ${formatAmount(p.change)}` : ''}</div>`;
            } else {
                paymentsHtml += `<div>${escapeHtml(p.method)}: ${formatAmount(p.amount)}</div>`;
            }
        });
        paymentsHtml += '</div></div>';
        totalsBox.innerHTML += paymentsHtml;
    }

    footerBox.innerHTML = `<div>${receiptFooter}</div><div class="mt-1">HungryPOS (Made by Rehan Shafiq)</div>`;

    const pdfContainer = document.getElementById("receiptPdfWrapper");
    pdfContainer.classList.remove("hidden");

    try {
        const canvas = await html2canvas(pdfContainer, { scale: 2 });
        const imgData = canvas.toDataURL("image/png");
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({
            orientation: "portrait",
            unit: "mm",
            format: [80, Math.max(150, (canvas.height * 80) / canvas.width)]
        });

        pdf.addImage(imgData, "PNG", 0, 0, 80, (canvas.height * 80) / canvas.width);
        pdf.save(`Receipt_HungryBirds_Order_${sale.id}.pdf`);
    } catch (err) {
        console.error("PDF Export Error:", err);
        alert("Failed to export PDF: " + (err.message || err));
    } finally {
        pdfContainer.classList.add("hidden");
    }
};

window.shareReceipt = async function (saleId) {
    const sale = await db.sales.get(saleId);
    if (!sale) return alert("Sale record not found.");

    let text = `🧾 *Hungry Birds Receipt*\n`;
    text += `*Phone:* 0325-7867774\n`;
    text += `*Order ID:* #${sale.id}\n`;
    text += `*Date:* ${new Date(sale.timestamp).toLocaleString()}\n`;
    text += `*Order Type:* ${sale.orderType}\n`;
    if (sale.deliveryInfo?.address) {
        text += `*Address:* ${sale.deliveryInfo.address}\n`;
    }
    text += `--------------------------------\n`;

    sale.items.forEach(i => {
        text += `• ${i.name} x${i.qty} = Rs ${(i.price * i.qty).toFixed(2)}\n`;
    });

    text += `--------------------------------\n`;
    text += `*Grand Total: Rs ${sale.total.toFixed(2)}*\n\n`;

    if (sale.payments && sale.payments.length > 0) {
        text += `Payments:\n`;
        sale.payments.forEach(p => {
            if (p.method === 'Cash') {
                text += `• ${p.method}: Rs ${p.amount.toFixed(2)} (Given: Rs ${((p.cashGiven != null) ? p.cashGiven.toFixed(2) : p.amount.toFixed(2))}${p.change ? `, Change: Rs ${p.change.toFixed(2)}` : ''})\n`;
            } else {
                text += `• ${p.method}: Rs ${p.amount.toFixed(2)}\n`;
            }
        });
        text += `\n`;
    }

    text += sale.orderType === "DELIVERY" ? `Thanks for ordering from Hungry birds!` : `Thank you for choosing Hungry Birds!`;

    if (navigator.share) {
        try {
            await navigator.share({
                title: `Hungry Birds Receipt #${sale.id}`,
                text: text
            });
        } catch (e) {
            openWhatsAppShare(text);
        }
    } else {
        openWhatsAppShare(text);
    }
};

function openWhatsAppShare(text) {
    const encoded = encodeURIComponent(text);
    window.open(`https://api.whatsapp.com/send?text=${encoded}`, '_blank');
}

// -------------------------------------------------------------
// EDIT / RE-OPEN SALE FOR EDITING - now Owner PIN protected
// -------------------------------------------------------------
async function proceedToEditSale(saleId) {
    if (cart.length > 0) {
        if (!confirm("Your current cart is not empty. Re-opening this order will overwrite your active cart. Continue?")) {
            return;
        }
    }

    const sale = await db.sales.get(saleId);
    if (!sale) return alert("Sale record not found.");

    cart = JSON.parse(JSON.stringify(sale.items));
    currentDiscountPercent = sale.discountPercent || 0;
    const discInput = document.getElementById("discountInput");
    if (discInput) discInput.value = currentDiscountPercent;

    currentPackingCharge = Number(sale.packingCharge) || 0;
    currentTaxPercent = Number(sale.taxPercent) || 0;
    currentOtherCharge = Number(sale.otherCharge) || 0;
    syncCheckoutChargeInputs();

    setOrderType(sale.orderType || "DINE_IN");
    currentDeliveryCharge = Number(sale.deliveryCharge) || 0;
    const deliveryChargeInput = document.getElementById("deliveryChargeInput");
    if (deliveryChargeInput) deliveryChargeInput.value = currentDeliveryCharge;
    if (sale.deliveryInfo) {
        const name = document.getElementById("deliveryCustomerName");
        const phone = document.getElementById("deliveryCustomerPhone");
        const addr = document.getElementById("deliveryAddress");
        if (name) name.value = sale.deliveryInfo.name || "";
        if (phone) phone.value = sale.deliveryInfo.phone || "";
        if (addr) addr.value = sale.deliveryInfo.address || "";
    }
    restoreCartCustomerInput(sale.customer);

    await restoreInventory(sale.items);
    await db.sales.delete(saleId);
    await logAudit("SALE_EDIT", `Order #${saleId} re-opened into cart for editing`, saleId);

    renderCart();
    if (document.getElementById("stockUnlockedState") && !document.getElementById("stockUnlockedState").classList.contains("hidden")) {
        renderInventoryList();
    }

    alert(`Order #${sale.id} loaded back into cart!`);
}

window.editSale = async function (saleId) {
    if (cart.length > 0) {
        if (!confirm("Your current cart is not empty. Re-opening this order will overwrite your active cart. Continue?")) {
            return;
        }
    }

    if (currentRole === "OWNER") {
        await proceedToEditSale(saleId);
        return;
    }

    if (currentRole !== "MANAGER") {
        alert("Access Denied: Only the Owner or Manager with Owner PIN authorization can edit orders.");
        return;
    }

    pendingEditSaleId = saleId;
    pendingOwnerAction = "editSale";
    openOwnerAuthModal();
};

function openOwnerAuthModal() {
    const modal = document.getElementById("ownerAuthModal");
    if (!modal) {
        alert("Owner authorization required, but auth modal is missing.");
        return;
    }

    modal.classList.remove("hidden");
    const pinInput = document.getElementById("ownerAuthPinInput");
    if (pinInput) {
        pinInput.value = "";
        pinInput.focus();
    }
    document.getElementById("ownerAuthError")?.classList.add("hidden");
}

// Owner Auth Modal handlers
window.closeOwnerAuthModal = function () {
    document.getElementById("ownerAuthModal")?.classList.add("hidden");
    const pinInput = document.getElementById("ownerAuthPinInput");
    if (pinInput) pinInput.value = "";
    document.getElementById("ownerAuthError")?.classList.add("hidden");
    pendingEditSaleId = null;
    pendingDeleteSaleId = null;
    pendingDeleteSaleIds = null;
    pendingOwnerAction = null;
    openingCashEditAuthorized = false;
};

window.submitOwnerAuth = async function () {
    const pinInput = document.getElementById("ownerAuthPinInput");
    const enteredPin = pinInput?.value.trim();

    const ownerPin = await getOwnerPin();

    if (enteredPin === ownerPin) {
        document.getElementById("ownerAuthModal")?.classList.add("hidden");
        pinInput.value = "";
        document.getElementById("ownerAuthError")?.classList.add("hidden");

        const action = pendingOwnerAction;
        pendingOwnerAction = null;

        if (action === "openingCash") {
            openingCashEditAuthorized = true;
            await window.openShiftOpeningModal(true);
            return;
        }

        const saleId = pendingEditSaleId;
        pendingEditSaleId = null;
        if (action === "editSale" && saleId) {
            await proceedToEditSale(saleId);
            return;
        }

        if (action === "deleteSale" && pendingDeleteSaleId) {
            const deleteId = pendingDeleteSaleId;
            pendingDeleteSaleId = null;
            await performDeleteSale(deleteId);
            return;
        }

        if (action === "deleteSelectedSales" && pendingDeleteSaleIds) {
            const deleteIds = pendingDeleteSaleIds;
            pendingDeleteSaleIds = null;
            await performDeleteSelectedSales(deleteIds);
        }
    } else {
        document.getElementById("ownerAuthError")?.classList.remove("hidden");
    }
};

// -------------------------------------------------------------
// Change Owner PIN (requires owner login password to authorize)
// -------------------------------------------------------------
window.changeOwnerPin = async function () {
    if (!currentUser || currentRole !== "OWNER") {
        alert("Only the logged-in Owner account may change the Owner PIN.");
        return;
    }

    const currentPasswordInput = document.getElementById("ownerCurrentPasswordForPin");
    const newPinInput = document.getElementById("ownerNewPin");
    const confirmPinInput = document.getElementById("ownerNewPinConfirm");
    const resultEl = document.getElementById("changePinResult");

    if (!currentPasswordInput || !newPinInput || !confirmPinInput || !resultEl) return;

    const currentPassword = currentPasswordInput.value.trim();
    const newPin = newPinInput.value.trim();
    const confirmPin = confirmPinInput.value.trim();

    resultEl.classList.add("hidden");
    resultEl.innerText = "";

    if (!currentPassword || !newPin || !confirmPin) {
        resultEl.classList.remove("hidden");
        resultEl.classList.add("text-red-600");
        resultEl.innerText = "Please fill all fields.";
        return;
    }

    if (newPin !== confirmPin) {
        resultEl.classList.remove("hidden");
        resultEl.classList.add("text-red-600");
        resultEl.innerText = "New PIN and confirmation do not match.";
        return;
    }

    let validPassword = false;
    try {
        if (typeof bcrypt !== 'undefined' && currentUser.password && (currentUser.password.startsWith("$2a$") || currentUser.password.startsWith("$2b$"))) {
            validPassword = bcrypt.compareSync(currentPassword, currentUser.password);
        } else if (typeof bcrypt !== 'undefined' && currentUser.password) {
            validPassword = bcrypt.compareSync(currentPassword, currentUser.password);
        } else {
            validPassword = currentUser.password === currentPassword;
        }
    } catch (e) {
        console.warn("Error verifying owner password:", e);
        validPassword = currentUser.password === currentPassword;
    }

    if (!validPassword) {
        resultEl.classList.remove("hidden");
        resultEl.classList.add("text-red-600");
        resultEl.innerText = "Incorrect account password. PIN change not authorized.";
        return;
    }

    await setOwnerPin(newPin);

    await logAudit("OWNER_PIN_CHANGE", "Owner PIN was changed");

    resultEl.classList.remove("hidden");
    resultEl.classList.remove("text-red-600");
    resultEl.classList.add("text-emerald-700");
    resultEl.innerText = "Owner PIN updated successfully.";

    currentPasswordInput.value = "";
    newPinInput.value = "";
    confirmPinInput.value = "";
};

window.deleteSale = async function (saleId) {
    if (currentRole === "MANAGER") {
        pendingDeleteSaleId = saleId;
        pendingOwnerAction = "deleteSale";
        openOwnerAuthModal();
        return;
    }

    if (currentRole !== "OWNER") {
        return alert("Access Denied: Only the Owner can delete completed sales.");
    }

    await performDeleteSale(saleId);
};

async function performDeleteSale(saleId) {

    if (!confirm(`Are you sure you want to delete Order #${saleId}?`)) {
        return;
    }

    const sale = await db.sales.get(saleId);
    if (sale) {
        if (confirm("Would you like to return raw ingredients back into inventory?")) {
            await restoreInventory(sale.items);
        }
        await db.sales.delete(saleId);
        selectedSaleIds.delete(saleId);
        await logAudit("SALE_DELETE", `Order #${saleId} deleted (Rs ${Number(sale.total || 0).toFixed(2)})`, saleId);
    }

    if (document.getElementById("stockUnlockedState") && !document.getElementById("stockUnlockedState").classList.contains("hidden")) {
        renderInventoryList();
    }
};

// ====================================================
// Refunds (partial or full, against completed sales)
// ====================================================
window.openRefundModal = async function (saleId) {
    if (currentRole !== "OWNER" && currentRole !== "MANAGER") {
        return alert("Access Denied: Owner or Manager role required to process refunds.");
    }

    const sale = await db.sales.get(saleId);
    if (!sale) return alert("Sale record not found.");

    const remainingTotal = Number(sale.total || 0) - Number(sale.refundedAmount || 0);
    if (remainingTotal <= 0) {
        return alert("This order has already been fully refunded.");
    }

    pendingRefundSaleId = saleId;
    setText("refundModalTitle", `Refund Order #${saleId}`);

    const container = document.getElementById("refundItemsContainer");
    const reasonInput = document.getElementById("refundReasonInput");
    if (reasonInput) reasonInput.value = "";

    if (container) {
        container.innerHTML = sale.items.map((item, idx) => {
            const alreadyRefunded = Number(item.refundedQty || 0);
            const remainingQty = Number(item.qty || 0) - alreadyRefunded;
            if (remainingQty <= 0) {
                return `<div class="p-2 bg-gray-100 rounded border text-xs text-gray-400 flex justify-between"><span>${escapeHtml(item.name)}</span><span>Fully refunded</span></div>`;
            }
            return `
                <div class="p-2 bg-white rounded border flex justify-between items-center text-xs refund-item-row" data-idx="${idx}" data-price="${Number(item.price) || 0}">
                    <div>
                        <div class="font-bold text-gray-800">${escapeHtml(item.name)}</div>
                        <div class="text-[10px] text-gray-500">${formatAmount(item.price)} each • Refundable qty: ${remainingQty}</div>
                    </div>
                    <input type="number" min="0" max="${remainingQty}" value="0" class="refund-qty-input w-16 p-1 border rounded text-xs text-right" oninput="updateRefundModalTotal()">
                </div>
            `;
        }).join("");
    }

    updateRefundModalTotal();
    document.getElementById("refundModal")?.classList.remove("hidden");
};

window.closeRefundModal = function () {
    document.getElementById("refundModal")?.classList.add("hidden");
    pendingRefundSaleId = null;
};

window.updateRefundModalTotal = function () {
    let total = 0;
    document.querySelectorAll("#refundItemsContainer .refund-item-row").forEach(row => {
        const price = Number(row.dataset.price) || 0;
        const qty = Number(row.querySelector(".refund-qty-input")?.value) || 0;
        total += price * qty;
    });
    setText("refundModalTotal", formatAmount(total));
};

window.confirmRefund = async function () {
    if (!pendingRefundSaleId) return;
    const saleId = pendingRefundSaleId;

    const sale = await db.sales.get(saleId);
    if (!sale) return alert("Sale record not found.");

    const reason = document.getElementById("refundReasonInput")?.value.trim() || "";
    if (!reason) return alert("Please enter a reason for this refund.");

    const refundItems = [];
    let refundTotal = 0;

    document.querySelectorAll("#refundItemsContainer .refund-item-row").forEach(row => {
        const idx = Number(row.dataset.idx);
        const qty = Number(row.querySelector(".refund-qty-input")?.value) || 0;
        if (qty > 0) {
            const item = sale.items[idx];
            refundItems.push({ id: item.id, menuItemId: item.menuItemId, name: item.name, price: item.price, qty });
            refundTotal += (Number(item.price) || 0) * qty;
        }
    });

    if (refundItems.length === 0) return alert("Select at least one item quantity to refund.");

    // Apply refunded quantities back onto the sale's item lines
    refundItems.forEach(refundItem => {
        const originalItem = sale.items.find(i => i.id === refundItem.id);
        if (originalItem) {
            originalItem.refundedQty = Number(originalItem.refundedQty || 0) + refundItem.qty;
        }
    });

    const refundedAmount = Number(sale.refundedAmount || 0) + refundTotal;
    const fullyRefunded = sale.items.every(i => Number(i.refundedQty || 0) >= Number(i.qty || 0));

    await db.sales.update(saleId, {
        items: sale.items,
        refundedAmount,
        refundStatus: fullyRefunded ? "FULL" : "PARTIAL",
        refunds: [...(sale.refunds || []), {
            timestamp: new Date().toISOString(),
            by: currentUser?.username || "Staff",
            reason,
            amount: refundTotal,
            items: refundItems
        }]
    });

    await restoreInventory(refundItems);
    await logAudit("REFUND", `Refunded ${formatAmount(refundTotal)} from Order #${saleId}: ${reason}`, saleId);

    closeRefundModal();
    await renderRecentSales();
    alert(`Refund of ${formatAmount(refundTotal)} processed successfully.`);
};

// ====================================================
// Owner Audit Log
// ====================================================
window.openAuditLogModal = async function () {
    if (currentRole !== "OWNER") {
        return alert("Access Denied: Owner role required to view the audit log.");
    }
    await renderAuditLogList();
    document.getElementById("auditLogModal")?.classList.remove("hidden");
};

window.closeAuditLogModal = function () {
    document.getElementById("auditLogModal")?.classList.add("hidden");
};

async function renderAuditLogList() {
    const container = document.getElementById("auditLogList");
    if (!container) return;

    const logs = await db.auditLogs.orderBy("id").reverse().limit(200).toArray();

    if (logs.length === 0) {
        container.innerHTML = `<div class="text-gray-400 text-xs text-center py-4">No audit events recorded yet.</div>`;
        return;
    }

    container.innerHTML = logs.map(log => `
        <div class="p-2 bg-white rounded-lg border flex justify-between items-start gap-2">
            <div>
                <div class="font-bold text-gray-800">${escapeHtml(log.action)}</div>
                <div class="text-gray-600">${escapeHtml(log.details || "")}</div>
                <div class="text-[10px] text-gray-400 mt-0.5">By: ${escapeHtml(log.user || "Staff")} • ${new Date(log.timestamp).toLocaleString()}</div>
            </div>
        </div>
    `).join("");
}

async function renderDashboard() {
    const sales = await db.sales.toArray();
    const shiftStartTimeMs = new Date(currentShiftStartTime).getTime();
    const shiftSales = sales.filter(s => new Date(s.timestamp).getTime() >= shiftStartTimeMs);
    const totalSales = shiftSales.reduce((sum, sale) => sum + (sale.total || 0), 0);

    setText("dashboardSales", formatAmount(totalSales));
    setText("dashboardOrders", shiftSales.length);

    await renderLowStockAlert();
}

async function getLowStockThreshold() {
    const stored = await db.settings.get("lowStockThreshold");
    const value = stored ? Number(stored.value) : 5;
    return Number.isFinite(value) && value >= 0 ? value : 5;
}

window.saveLowStockThreshold = async function () {
    const input = document.getElementById("lowStockThresholdInput");
    const value = Number(input?.value);
    if (!Number.isFinite(value) || value < 0) return alert("Enter a valid non-negative threshold.");

    await db.settings.put({ key: "lowStockThreshold", value: String(value) });
    await renderInventoryList();
    await renderLowStockAlert();
    alert("Low stock threshold updated.");
};

async function renderLowStockAlert() {
    const banner = document.getElementById("lowStockBanner");
    if (!banner) return;

    const threshold = await getLowStockThreshold();
    const inventory = await db.inventory.toArray();
    const lowStockItems = inventory.filter(item => Number(item.stock) <= threshold);

    if (lowStockItems.length === 0) {
        banner.classList.add("hidden");
        return;
    }

    const names = lowStockItems.slice(0, 3).map(item => item.name).join(", ");
    const extra = lowStockItems.length > 3 ? ` +${lowStockItems.length - 3} more` : "";
    setText("lowStockBannerText", `⚠️ ${lowStockItems.length} item${lowStockItems.length === 1 ? "" : "s"} low on stock: ${names}${extra}`);
    banner.classList.remove("hidden");
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.innerText = value;
}

console.log("Hungry Birds POS v3.6 (delivery & KDS printing added) Initialized.");