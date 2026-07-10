import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('admin shop inventory and order controls are rendered by React from request events', () => {
  const html = `${readFileSync('admin.html', 'utf8')}\n${readFileSync('src/admin-app/admin-controller.js', 'utf8')}`;
  const main = readFileSync('src/admin-app/main.js', 'utf8');
  const shopControls = readFileSync('src/admin-app/shop-controls.js', 'utf8');
  const adminLoadProducts = html.match(/async function adminLoadProducts\(detail\) \{[\s\S]*?\n        \}/)?.[0];
  const adminLoadOrders = html.match(/async function adminLoadOrders\(detail\) \{[\s\S]*?\n        \}/)?.[0];
  const initAdmin = html.match(/function initAdmin\(\) \{[\s\S]*?adminLoadEvents\(\);\n            adminLoadCourses\(\);\n            adminLoadLeagues\(\);\n        \}/)?.[0];

  assert.match(html, /id="adminProductInventoryControlsReactApp"/);
  assert.match(html, /id="adminOrderControlsReactApp"/);
  assert.doesNotMatch(html, /id="psInvSort"|id="psInvStatus"|id="ordStatusFilter"|id="ordRefresh"/);
  assert.ok(adminLoadProducts);
  assert.match(adminLoadProducts, /adminProductInventoryControlsState\(detail\)/);
  assert.match(adminLoadProducts, /setAdminProductsListState\(\{ status: 'loading', products: \[\], inventoryStatus: status \}\)/);
  assert.doesNotMatch(adminLoadProducts, /\$\('psInvSort'\)|\$\('psInvStatus'\)/);
  assert.ok(adminLoadOrders);
  assert.match(adminLoadOrders, /adminOrderControlsState\(detail\)/);
  assert.match(adminLoadOrders, /setAdminOrdersListState\(\{ status: 'loading', orders: \[\], filterStatus: status \}\)/);
  assert.doesNotMatch(adminLoadOrders, /\$\('ordStatusFilter'\)|\$\('ordRefresh'\)/);
  assert.ok(initAdmin);
  assert.match(initAdmin, /gvdg:admin-product-inventory-controls-request/);
  assert.match(initAdmin, /adminLoadProducts\(event\.detail \|\| \{\}\)/);
  assert.match(initAdmin, /gvdg:admin-order-controls-request/);
  assert.match(initAdmin, /adminLoadOrders\(event\.detail \|\| \{\}\)/);
  assert.doesNotMatch(initAdmin, /\$\('psInvSort'\)\.addEventListener|\$\('psInvStatus'\)\.addEventListener|\$\('ordStatusFilter'\)\.addEventListener|\$\('ordRefresh'\)\.addEventListener/);

  assert.match(main, /import \{ AdminOrderControls, AdminProductInventoryControls \} from "\.\/shop-controls\.js"/);
  assert.match(main, /const productInventoryControlsMount = document\.getElementById\("adminProductInventoryControlsReactApp"\)/);
  assert.match(main, /createRoot\(productInventoryControlsMount\)\.render\(h\(AdminProductInventoryControls\)\)/);
  assert.match(main, /const orderControlsMount = document\.getElementById\("adminOrderControlsReactApp"\)/);
  assert.match(main, /createRoot\(orderControlsMount\)\.render\(h\(AdminOrderControls\)\)/);

  assert.match(shopControls, /export function AdminProductInventoryControls/);
  assert.match(shopControls, /export function AdminOrderControls/);
  assert.match(shopControls, /data-react-admin-product-inventory-controls/);
  assert.match(shopControls, /data-react-admin-order-controls/);
  assert.match(shopControls, /gvdg:admin-product-inventory-controls-request/);
  assert.match(shopControls, /gvdg:admin-order-controls-request/);
  assert.match(shopControls, /let productControlsStateSnapshot = \{\}/);
  assert.match(shopControls, /let orderControlsStateSnapshot = \{\}/);
  assert.doesNotMatch(shopControls, /window\.__gvdgAdminProductInventoryControlsState/);
  assert.doesNotMatch(shopControls, /window\.__gvdgAdminOrderControlsState/);
  assert.match(html, /let adminProductInventoryControlsSnapshot = \{\}/);
  assert.match(html, /let adminOrderControlsSnapshot = \{\}/);
  assert.doesNotMatch(html, /window\.__gvdgAdminProductInventoryControlsState/);
  assert.doesNotMatch(html, /window\.__gvdgAdminOrderControlsState/);
  assert.match(shopControls, /className: "shop-admin-toolbar"/);
  assert.match(shopControls, /className: "al-section admin-order-controls"/);
  assert.doesNotMatch(shopControls, /innerHTML|insertAdjacentHTML|replaceChildren|document\.createElement|querySelector|classList|textContent\s*=|☰|✕|🔒|🌙|☀️|🏆|⚠|⏱|—/);
});
