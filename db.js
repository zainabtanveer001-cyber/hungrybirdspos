// ==========================================
// DEPRECATED — NOT LOADED BY index.html
// This file is superseded by app.js, which contains the
// authoritative Dexie schema (version 19) and all active code.
// It is kept for reference only; do not rely on it.
// ==========================================

// ------------------------------
// Dexie Database Initialization
// ------------------------------
const db = new Dexie("HungryBirdsPOS");

db.version(7).stores({
    tables: "++id, number, status, waiter, currentSale",
    sales: "++id, timestamp, total",
    categories: "id",
    menu: "id, categoryId",
    recipes: "++id, menuItemId, inventoryId",
    inventory: "id, name, stock",
    suppliers: "id",
    stockHistory: "++id, ingredient, created",
    customers: "id, phone",
    waiters: "id",
    kitchenOrders: "++id, saleId, tableId, status, createdAt",
    users: "++id, username, role",
    settings: "key",
    tableOrders: "++id, tableId, status, createdAt"
});

// ------------------------------
// Global Application State
// ------------------------------
let cart = [];
let currentTable = null;
let currentOrderType = "DINE_IN"; // DINE_IN | TAKEAWAY | DELIVERY
let selectedCategoryId = "ALL";
let currentCustomer = null;
let currentWaiter = "";
let currentDiscountPercent = 0;

let currentUser = null;
let currentRole = null;
let waiters = [];
let customers = [];

let bluetoothDevice = null;
let printerCharacteristic = null;

const TABLE_STATUS = {
    AVAILABLE: "AVAILABLE",
    OCCUPIED: "OCCUPIED",
    RESERVED: "RESERVED",
    CLEANING: "CLEANING"
};

const KDS_WARNING_MINUTES = 10;
const KDS_CRITICAL_MINUTES = 20;

// ------------------------------
// Application Startup
// ------------------------------
document.addEventListener("DOMContentLoaded", async () => {
    console.log("Hungry Birds POS Starting...");
    await initializeUsers();
    await initializeApplication();
    restoreSession();

    const passwordInput = document.getElementById("loginPassword");
    if (passwordInput) {
        passwordInput.addEventListener("keyup", e => {
            if (e.key === "Enter") login();
        });
    }
});

async function initializeApplication() {
    await initializeTables();
    await renderDashboard();
    await renderCategoryBar();
    await renderMenu();
    await renderTables();
    await loadWaiters();
    await loadCustomers();
    renderCart();
    initializeSearch();
    initializeButtons();
}

// ====================================================
// User Authentication & Permissions
// ====================================================
async function initializeUsers() {
    const count = await db.users.count();
    if (count > 0) return;

    // Hash passwords using SHA-256 via Web Crypto API (available from app.js).
    const defaultUsers = [
        { username: "owner", passwordPlain: "1234", role: "OWNER" },
        { username: "manager", passwordPlain: "1234", role: "MANAGER" },
        { username: "cashier", passwordPlain: "1234", role: "CASHIER" },
        { username: "waiter", passwordPlain: "1234", role: "WAITER" }
    ];

    await db.users.bulkAdd(
        await Promise.all(defaultUsers.map(async u => ({
            username: u.username,
            password: await hashPin(u.passwordPlain),
            role: u.role
        })))
    );
    console.log("Default users created.");
}

window.login = async function () {
    const usernameEl = document.getElementById("loginUsername");
    const passwordEl = document.getElementById("loginPassword");

    if (!usernameEl || !passwordEl) return;

    const username = usernameEl.value.trim();
    const password = passwordEl.value;

    try {
        const user = await db.users.where("username").equals(username).first();

        if (!user) {
            alert("User not found.");
            return;
        }

        // Compare hashed password (SHA-256 via Web Crypto API).
        const hashedInput = await hashPin(password);
        if (user.password !== hashedInput) {
            alert("Incorrect password.");
            return;
        }

        currentUser = user;
        currentRole = user.role;

        sessionStorage.setItem("loggedUser", JSON.stringify(user));

        document.getElementById("loginScreen")?.classList.add("hidden");
        document.getElementById("posScreen")?.classList.remove("hidden");
        setText("loggedUserName", user.username);
        setText("loggedUserRole", user.role);

        applyPermissions();
        renderDashboard();
        renderMenu();
        renderTables();
        renderCart();
    } catch (e) {
        console.error("Login error:", e);
        alert("Login failed — please try again. If the problem persists, refresh the page.");
    }
};

window.restoreSession = function () {
    const saved = sessionStorage.getItem("loggedUser");
    if (!saved) return;

    currentUser = JSON.parse(saved);
    currentRole = currentUser.role;

    document.getElementById("loginScreen")?.classList.add("hidden");
    document.getElementById("posScreen")?.classList.remove("hidden");
    setText("loggedUserName", currentUser.username);
    setText("loggedUserRole", currentRole);

    applyPermissions();
    renderDashboard();
    renderMenu();
    renderTables();
};

window.logout = function () {
    if (!confirm("Logout?")) return;
    currentUser = null;
    currentRole = null;
    sessionStorage.removeItem("loggedUser");
    location.reload();
};

function hasRole(...roles) {
    return roles.includes(currentRole);
}

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

window.requireOwner = function (cb) { currentRole === "OWNER" ? cb() : alert("Owner permission required."); };
window.requireManager = function (cb) { (currentRole === "OWNER" || currentRole === "MANAGER") ? cb() : alert("Manager permission required."); };
window.requireCashier = function (cb) { ["OWNER", "MANAGER", "CASHIER"].includes(currentRole) ? cb() : alert("Cashier access required."); };
window.requireWaiter = function (cb) { cb(); };

// ====================================================
// Web Bluetooth Thermal Printer Setup
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
        alert("Printer Connected: " + bluetoothDevice.name);
    } catch (e) {
        console.error("Printer Connection Error:", e);
        alert("Failed to connect printer: " + e.message);
    }
};

function formatReceiptLine(name, qty, price, maxLineWidth = 32) {
    const rightSide = `x${qty} Rs ${(price * qty).toFixed(2)}`;
    const availableForName = maxLineWidth - rightSide.length - 1;
    let cleanName = name;
    
    if (cleanName.length > availableForName) {
        cleanName = cleanName.substring(0, availableForName - 1) + ".";
    }
    
    const spacesNeeded = Math.max(1, maxLineWidth - cleanName.length - rightSide.length);
    return cleanName + " ".repeat(spacesNeeded) + rightSide + "\n";
}

async function printReceipt(saleId, cartItems, total) {
    if (!printerCharacteristic) {
        console.warn("No printer connected.");
        return;
    }

    try {
        const encoder = new TextEncoder();
        let text = `\x1B@\x1Ba\x01\x1B!\x30HUNGRY BIRDS\n\x1B!\x00Restaurant & Fast Food\n--------------------------------\n`;
        text += `\x1Ba\x00Order ID: #${saleId}\nDate: ${new Date().toLocaleString()}\nType: ${currentOrderType}\n`;
        if (currentTable) text += `Table: ${currentTable}\n`;
        text += `--------------------------------\n`;

        cartItems.forEach(item => {
            text += formatReceiptLine(item.name, item.qty, item.price, 32);
        });

        text += `--------------------------------\n\x1Ba\x02TOTAL: Rs ${total.toFixed(2)}\n\n\x1Ba\x01Thank you for visiting!\n\n\n\x1DV\x41\x03`;
        const data = encoder.encode(text);

        for (let i = 0; i < data.length; i += 20) {
            const chunk = data.slice(i, i + 20);
            if (printerCharacteristic.writeValueWithResponse) {
                await printerCharacteristic.writeValueWithResponse(chunk);
            } else {
                await printerCharacteristic.writeValue(chunk);
                await new Promise(resolve => setTimeout(resolve, 20));
            }
        }
    } catch (err) {
        console.error("Printer transmission failed:", err);
    }
}

// ====================================================
// Restaurant Tables Management
// ====================================================
async function initializeTables() {
    const total = await db.tables.count();
    if (total > 0) return;

    const tables = [];
    for (let i = 1; i <= 20; i++) {
        tables.push({
            number: i,
            status: TABLE_STATUS.AVAILABLE,
            waiter: "",
            guests: 0,
            currentSale: null
        });
    }
    await db.tables.bulkAdd(tables);
}

window.renderTables = async function () {
    const container = document.getElementById("tablesContainer");
    if (!container) return;

    const tables = await db.tables.toArray();
    container.innerHTML = tables.map(table => {
        let color = "bg-green-500";
        if (table.status === TABLE_STATUS.OCCUPIED) color = "bg-red-500";
        if (table.status === TABLE_STATUS.RESERVED) color = "bg-yellow-500";
        if (table.status === TABLE_STATUS.CLEANING) color = "bg-blue-500";
        if (currentTable === table.id) color = "bg-indigo-600";

        return `
            <div onclick="selectTable(${table.id})" class="${color} text-white rounded-xl p-4 cursor-pointer shadow text-center">
                <div class="text-lg font-bold">Table ${escapeHtml(String(table.number || ""))}</div>
                <div class="text-sm">${escapeHtml(table.status || "")}</div>
                <div class="text-xs">${escapeHtml(table.waiter || "-")}</div>
            </div>
        `;
    }).join("");
};

window.selectTable = async function (id) {
    const table = await db.tables.get(id);
    if (!table) return;

    currentTable = id;
    currentWaiter = table.waiter;

    if (table.status === TABLE_STATUS.AVAILABLE) {
        await db.tables.update(id, { status: TABLE_STATUS.OCCUPIED });
    }

    await loadTableOrder(id);
    renderTables();
    setText("selectedTable", "Table " + table.number);
};

window.openTable = async function () {
    if (!currentTable) return alert("Select table.");
    const waiter = prompt("Waiter Name");
    const guests = parseInt(prompt("Guests", "2"));

    await db.tables.update(currentTable, {
        status: TABLE_STATUS.OCCUPIED,
        waiter: waiter || "",
        guests: guests || 1
    });

    currentWaiter = waiter || "";
    renderTables();
};

window.closeTable = async function () {
    if (!currentTable) return;
    if (!confirm("Close table?")) return;

    await db.tables.update(currentTable, {
        status: TABLE_STATUS.AVAILABLE,
        waiter: "",
        guests: 0,
        currentSale: null
    });

    currentTable = null;
    cart = [];
    renderCart();
    renderTables();
};

window.transferTable = async function () {
    if (!currentTable) return alert("Select a table.");

    const target = parseInt(prompt("Transfer to table number:"));
    if (!target) return;

    const newTable = await db.tables.where("number").equals(target).first();
    if (!newTable) return alert("Table not found.");

    const order = await db.tableOrders.where("tableId").equals(currentTable).and(o => o.status === "OPEN").first();
    if (order) {
        await db.tableOrders.update(order.id, { tableId: newTable.id });
    }

    await db.tables.update(currentTable, {
        status: TABLE_STATUS.AVAILABLE,
        currentSale: null,
        waiter: "",
        guests: 0
    });

    await db.tables.update(newTable.id, { status: TABLE_STATUS.OCCUPIED });
    currentTable = newTable.id;
    renderTables();
    alert("Table transferred.");
};

// ====================================================
// Menu & Category Bar
// ====================================================
async function renderCategoryBar() {
    const categories = await db.categories.toArray();
    const container = document.getElementById("categoryFilterBar");
    if (!container) return;

    let html = categoryButton("ALL", "All");
    categories.forEach(cat => { html += categoryButton(cat.id, cat.name); });
    container.innerHTML = html;
}

function categoryButton(id, name) {
    const safeId = escapeHtml(id || "");
    const safeName = escapeHtml(name || "");
    return `
        <button onclick="selectCategory('${safeId}')" class="px-4 py-2 rounded-lg m-1 ${selectedCategoryId === id ? "bg-indigo-600 text-white" : "bg-white border"}">
            ${safeName}
        </button>
    `;
}

window.selectCategory = function (id) {
    selectedCategoryId = id;
    renderCategoryBar();
    renderMenu();
};

async function renderMenu() {
    let menu = await db.menu.toArray();

    if (selectedCategoryId !== "ALL") {
        menu = menu.filter(item => item.categoryId === selectedCategoryId);
    }

    const container = document.getElementById("menuContainer");
    if (!container) return;

    container.innerHTML = menu.map(item => `
        <div class="bg-white rounded-xl shadow border cursor-pointer hover:shadow-lg p-4" onclick="addItemToCart('${escapeHtml(item.id)}')">
            <h3 class="font-bold text-lg">${escapeHtml(item.name)}</h3>
            <p class="text-gray-500">Rs ${(parseFloat(item.price) || 0).toFixed(2)}</p>
        </div>
    `).join("");
}

function initializeSearch() {
    const search = document.getElementById("menuSearch");
    if (!search) return;

    search.addEventListener("input", async () => {
        const text = search.value.toLowerCase();
        const allMenu = await db.menu.toArray();
        const filtered = allMenu.filter(item => item.name.toLowerCase().includes(text));

        const container = document.getElementById("menuContainer");
        if (!container) return;

        container.innerHTML = filtered.map(item => `
            <div class="bg-white rounded-xl shadow border cursor-pointer p-4" onclick="addItemToCart('${escapeHtml(item.id)}')">
                <h3 class="font-bold text-lg">${escapeHtml(item.name)}</h3>
                <p class="text-gray-500">Rs ${(parseFloat(item.price) || 0).toFixed(2)}</p>
            </div>
        `).join("");
    });
}

// ====================================================
// Cart Management & Calculations
// ====================================================
window.addItemToCart = async function (menuId) {
    const menuItem = await db.menu.get(isNaN(menuId) ? menuId : Number(menuId)) || await db.menu.get(String(menuId));
    if (!menuItem) return;

    const existing = cart.find(item => String(item.id) === String(menuId));
    if (existing) {
        existing.qty++;
    } else {
        cart.push({
            id: menuItem.id,
            name: menuItem.name,
            price: menuItem.price,
            qty: 1
        });
    }
    renderCart();
};

function renderCart() {
    const container = document.getElementById("cartItems");
    const totalElement = document.getElementById("cartTotal");

    if (!container) return;

    if (cart.length === 0) {
        container.innerHTML = `<div class="text-center text-gray-400 py-8">Cart is empty</div>`;
        if (totalElement) totalElement.innerText = "Rs 0.00";
        return;
    }

    container.innerHTML = cart.map(item => {
        const lineTotal = item.price * item.qty;
        return `
            <div class="border rounded-lg p-3 mb-2 bg-white">
                <div class="flex justify-between">
                    <div>
                        <div class="font-semibold">${escapeHtml(item.name)}</div>
                        <div class="text-sm text-gray-500">Rs ${(parseFloat(item.price) || 0).toFixed(2)}</div>
                    </div>
                    <div class="text-right">
                        <div class="font-bold">Rs ${(parseFloat(lineTotal) || 0).toFixed(2)}</div>
                    </div>
                </div>
                <div class="flex justify-between items-center mt-3">
                    <div class="flex gap-2">
                        <button onclick="decreaseQty('${escapeHtml(item.id)}')" class="px-3 py-1 bg-red-500 text-white rounded">-</button>
                        <span class="font-bold px-2">${item.qty}</span>
                        <button onclick="increaseQty('${escapeHtml(item.id)}')" class="px-3 py-1 bg-green-500 text-white rounded">+</button>
                    </div>
                    <button onclick="removeCartItem('${escapeHtml(item.id)}')" class="text-red-600">Remove</button>
                </div>
            </div>
        `;
    }).join("");

    const grandTotal = calculateCartTotal();
    if (totalElement) totalElement.innerText = "Rs " + grandTotal.toFixed(2);

    if (currentOrderType === "DINE_IN" && currentTable) {
        saveCurrentTableOrder();
    }
}

window.increaseQty = function (id) {
    const item = cart.find(i => String(i.id) === String(id));
    if (item) { item.qty++; renderCart(); }
};

window.decreaseQty = function (id) {
    const item = cart.find(i => String(i.id) === String(id));
    if (!item) return;
    item.qty--;
    if (item.qty <= 0) cart = cart.filter(i => String(i.id) !== String(id));
    renderCart();
};

window.removeCartItem = function (id) {
    cart = cart.filter(i => String(i.id) !== String(id));
    renderCart();
};

function calculateCartTotal() {
    const subtotal = cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
    return subtotal - (subtotal * (currentDiscountPercent / 100));
}

window.applyDiscount = function (percent) {
    if (cart.length === 0) return;
    currentDiscountPercent = percent;
    renderCart();
};

// ====================================================
// Checkout & Inventory Deductions
// ====================================================
window.processSale = async function () {
    if (cart.length === 0) return alert("Cart is empty.");
    if (currentOrderType === "DINE_IN" && !currentTable) return alert("Select a table first.");

    const stockOk = await verifyStock();
    if (!stockOk) return;

    const paymentMethod = prompt("Payment Method\n\nCash / Card / Online", "Cash");
    if (paymentMethod === null) return;

    const total = calculateCartTotal();
    const saleData = {
        items: [...cart],
        total,
        paymentMethod,
        orderType: currentOrderType,
        table: currentTable,
        waiter: currentWaiter,
        customer: currentCustomer,
        timestamp: new Date().toISOString()
    };

    const saleId = await saveSale(saleData);
    await sendOrderToKitchen(saleId);
    await deductInventory();

    if (currentTable) {
        await db.tables.update(currentTable, { currentSale: saleId });
        await finishTableOrder();
    }

    try {
        await printReceipt(saleId, cart, total);
    } catch (e) {
        console.error("Receipt printing error:", e);
    }

    alert("Order Completed!");
    cart = [];
    currentDiscountPercent = 0;
    renderCart();
    renderDashboard();
    renderTables();
};

async function saveSale(data) {
    return await db.sales.add(data);
}

async function verifyStock() {
    for (const cartItem of cart) {
        const itemId = isNaN(cartItem.id) ? cartItem.id : Number(cartItem.id);
        let recipes = await db.recipes.where("menuItemId").equals(itemId).toArray();
        if (recipes.length === 0) {
            recipes = await db.recipes.where("menuItemId").equals(String(cartItem.id)).toArray();
        }

        for (const recipe of recipes) {
            const ingId = isNaN(recipe.inventoryId) ? recipe.inventoryId : Number(recipe.inventoryId);
            const ingredient = await db.inventory.get(ingId) || await db.inventory.get(String(recipe.inventoryId));
            
            if (!ingredient) {
                alert("Missing ingredient ID: " + recipe.inventoryId);
                return false;
            }
            if (ingredient.stock < (recipe.qtyRequired * cartItem.qty)) {
                alert(`${ingredient.name} is out of stock.`);
                return false;
            }
        }
    }
    return true;
}

async function deductInventory() {
    for (const cartItem of cart) {
        const itemId = isNaN(cartItem.id) ? cartItem.id : Number(cartItem.id);
        let recipes = await db.recipes.where("menuItemId").equals(itemId).toArray();
        if (recipes.length === 0) {
            recipes = await db.recipes.where("menuItemId").equals(String(cartItem.id)).toArray();
        }

        for (const recipe of recipes) {
            const ingId = isNaN(recipe.inventoryId) ? recipe.inventoryId : Number(recipe.inventoryId);
            const ingredient = await db.inventory.get(ingId) || await db.inventory.get(String(recipe.inventoryId));
            
            if (!ingredient) continue;
            
            const updatedStock = ingredient.stock - (recipe.qtyRequired * cartItem.qty);
            await db.inventory.update(ingredient.id, { stock: updatedStock });
        }
    }
}

// ====================================================
// Kitchen Display System (KDS)
// ====================================================
window.sendOrderToKitchen = async function (saleId = null) {
    if (cart.length === 0) return;

    await db.kitchenOrders.add({
        saleId,
        tableId: currentTable,
        status: "PENDING",
        waiter: currentWaiter || "",
        items: [...cart],
        createdAt: new Date().toISOString()
    });

    playKitchenAlert();
    renderKitchenOrders();
};

function getKitchenCardClass(order) {
    const age = (Date.now() - new Date(order.createdAt)) / 60000;
    if (order.status === "READY") return "border-green-600 bg-green-50";
    if (age >= KDS_CRITICAL_MINUTES) return "border-red-600 bg-red-100 animate-pulse";
    if (age >= KDS_WARNING_MINUTES) return "border-yellow-500 bg-yellow-50";
    return "border-gray-300 bg-white";
}

function kitchenTimer(createdAt) {
    const seconds = Math.floor((Date.now() - new Date(createdAt)) / 1000);
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

window.renderKitchenOrders = async function () {
    const container = document.getElementById("kitchenOrders");
    if (!container) return;

    const orders = await db.kitchenOrders.orderBy("id").reverse().toArray();
    container.innerHTML = orders.map(order => `
        <div class="rounded-xl border-2 p-4 ${getKitchenCardClass(order)}">
            <div class="flex justify-between">
                <h2 class="font-bold">${order.tableId ? "TABLE " + escapeHtml(String(order.tableId)) : "TAKE AWAY"}</h2>
                <div class="font-bold">${kitchenTimer(order.createdAt)}</div>
            </div>
            <div class="text-sm text-gray-500">${escapeHtml(order.waiter || "-")}</div>
            <hr class="my-2">
            ${order.items.map(item => `
                <div class="flex justify-between">
                    <span>${escapeHtml(item.name || "Item")}</span>
                    <strong>x${item.qty}</strong>
                </div>
            `).join("")}
            <div class="grid grid-cols-3 gap-2 mt-4">
                <button onclick="updateKitchenStatus(${order.id}, 'PREPARING')" class="bg-yellow-500 text-white rounded p-2">Preparing</button>
                <button onclick="updateKitchenStatus(${order.id}, 'READY')" class="bg-green-600 text-white rounded p-2">Ready</button>
                <button onclick="updateKitchenStatus(${order.id}, 'SERVED')" class="bg-blue-600 text-white rounded p-2">Served</button>
            </div>
        </div>
    `).join("");

    renderKitchenSummary();
};

window.updateKitchenStatus = async function (id, status) {
    await db.kitchenOrders.update(id, { status });
    renderKitchenOrders();
};

window.renderKitchenSummary = async function () {
    const orders = await db.kitchenOrders.toArray();
    setText("pendingCount", orders.filter(o => o.status === "PENDING").length);
    setText("preparingCount", orders.filter(o => o.status === "PREPARING").length);
    setText("readyCount", orders.filter(o => o.status === "READY").length);
};

window.playKitchenAlert = function () {
    try {
        const audio = new Audio("notification.mp3");
        audio.volume = 1.0;
        audio.play().catch(err => {
            console.warn("Could not play kitchen alert sound:", err);
            // Fallback to system beep if mp3 fails
            console.log('\x07');
        });
    } catch (e) {
        console.error("Kitchen alert sound error:", e);
    }
};

setInterval(() => {
    const container = document.getElementById("kitchenOrders");
    if (container && !container.closest(".hidden")) {
        renderKitchenOrders();
    }
}, 3000);

// ====================================================
// Live Table Orders Persistence
// ====================================================
async function loadTableOrder(tableId) {
    const order = await db.tableOrders.where("tableId").equals(tableId).and(o => o.status === "OPEN").first();
    if (!order) {
        cart = [];
        renderCart();
        return;
    }
    cart = order.items || [];
    renderCart();
}

async function saveCurrentTableOrder() {
    if (!currentTable) return;
    const order = await db.tableOrders.where("tableId").equals(currentTable).and(o => o.status === "OPEN").first();

    if (order) {
        await db.tableOrders.update(order.id, { items: [...cart], updatedAt: new Date().toISOString() });
    } else {
        await db.tableOrders.add({
            tableId: currentTable,
            status: "OPEN",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            items: [...cart]
        });
    }
}

async function finishTableOrder() {
    if (!currentTable) return;
    const order = await db.tableOrders.where("tableId").equals(currentTable).and(o => o.status === "OPEN").first();
    if (order) {
        await db.tableOrders.update(order.id, { status: "PAID" });
    }
}

// ====================================================
// Helpers & Initializers
// ====================================================
async function renderDashboard() {
    const todaySales = await db.sales.toArray();
    const totalSales = todaySales.reduce((sum, sale) => sum + sale.total, 0);
    const occupiedTables = await db.tables.where("status").equals(TABLE_STATUS.OCCUPIED).count();

    setText("dashboardSales", "Rs " + totalSales.toFixed(2));
    setText("dashboardOrders", todaySales.length);
    setText("dashboardTables", occupiedTables);
}

function initializeButtons() {
    document.getElementById("checkoutBtn")?.addEventListener("click", processSale);
    document.getElementById("clearCartBtn")?.addEventListener("click", () => {
        cart = [];
        currentDiscountPercent = 0;
        renderCart();
    });
}

async function loadWaiters() { waiters = await db.waiters.toArray(); }
async function loadCustomers() { customers = await db.customers.toArray(); }

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.innerText = value;
}

console.log("Hungry Birds POS Loaded Successfully.");