
if (process.env.NODE_ENV !== "production") {
  require("dotenv/config");
}

const http = require("node:http");
const https = require("node:https");
const { URL } = require("node:url");
const { PrismaClient } = require("@prisma/client");
const { PrismaPg } = require("@prisma/adapter-pg");
const { Pool } = require("pg");

function requestJson(url, { method = "GET", headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: `${u.pathname}${u.search}`,
        method,
        headers,
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          let json;
          try {
            json = data ? JSON.parse(data) : null;
          } catch (e) {
            reject(
              new Error(
                `Failed to parse JSON response (${res.statusCode}) from ${url}: ${String(e)}`
              )
            );
            return;
          }
          resolve({
            status: res.statusCode ?? 0,
            ok: (res.statusCode ?? 0) >= 200 && (res.statusCode ?? 0) < 300,
            json,
          });
        });
      }
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function main() {
  const API_BASE_URL = process.env.API_BASE_URL;
  if (!API_BASE_URL) {
    throw new Error("API_BASE_URL is required");
  }
  const BASE_URL = new URL("/api", API_BASE_URL).toString().replace(/\/$/, "");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });
  let restoreProductId = null;
  let restoreProductData = null;

  console.log("=== STARTING FULL FUNCTIONAL TEST ===\n");

  try {
    console.log("0. Fetching public settings...");
    const resSettings = await requestJson(`${BASE_URL}/settings`);
    if (!resSettings.ok) throw new Error(`Failed to fetch settings: ${resSettings.status}`);
    const settings = resSettings.json?.settings;
    if (!settings) throw new Error("Missing settings in response");
    if (!("heroHeadlineColor1" in settings)) throw new Error("Missing heroHeadlineColor1 in settings");
    if (!("heroHeadlineColor2" in settings)) throw new Error("Missing heroHeadlineColor2 in settings");
    console.log("   OK. Settings loaded.");

    console.log("1. Fetching featured products...");
    const resFeatured = await requestJson(`${BASE_URL}/products/featured`);
    if (!resFeatured.ok) throw new Error(`Failed to fetch featured: ${resFeatured.status}`);
    const featured = resFeatured.json;
    const product = featured.items[0];
    if (!product) throw new Error("No featured products found");
    if (!("discountValue" in product)) throw new Error("Missing discountValue in featured product");
    if (!("discountType" in product)) throw new Error("Missing discountType in featured product");
    console.log(`   OK. Found product: ${product.name} (${product.id})`);

    const candidate = await prisma.product.findFirst({
      where: { isActive: true, stock: { gte: 2 } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        name: true,
        slug: true,
        priceCents: true,
        stock: true,
        discountValue: true,
        discountType: true,
      },
    });
    if (!candidate) throw new Error("No active in-stock product found");
    console.log(`\n2. Using product for discount test: ${candidate.name} (${candidate.id})`);

    const original = {
      discountValue: candidate.discountValue,
      discountType: candidate.discountType,
      stock: candidate.stock,
    };
    restoreProductId = candidate.id;
    restoreProductData = original;

    const testDiscountValue = 10;
    const testDiscountType = "PERCENTAGE";

    const updatedProduct = await prisma.product.update({
      where: { id: candidate.id },
      data: { discountValue: testDiscountValue, discountType: testDiscountType },
      select: { id: true, discountValue: true, discountType: true, priceCents: true, slug: true },
    });
    if (updatedProduct.discountValue !== testDiscountValue) throw new Error("Failed to set discountValue");
    if (updatedProduct.discountType !== testDiscountType) throw new Error("Failed to set discountType");

    const resProduct = await requestJson(`${BASE_URL}/products/${encodeURIComponent(updatedProduct.slug)}`);
    if (!resProduct.ok) throw new Error(`Failed to fetch product by slug: ${resProduct.status}`);
    const apiProduct = resProduct.json?.product;
    if (!apiProduct) throw new Error("Missing product in /products/:slug response");
    if (apiProduct.discountValue !== testDiscountValue) throw new Error("API did not return updated discountValue");
    if (apiProduct.discountType !== testDiscountType) throw new Error("API did not return updated discountType");

    console.log("\n3. Simulating guest checkout with discounted product...");
    const quantity = 2;
    const payload = {
      shipping: {
        fullName: "Test User",
        phone: "1234567890",
        addressLine1: "123 Test St",
        city: "Test City",
      },
      items: [{ productId: updatedProduct.id, quantity }],
    };

    const resCheckout = await requestJson(`${BASE_URL}/orders/guest-checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const checkoutData = resCheckout.json;
    if (!resCheckout.ok) {
      console.error("   Checkout failed:", JSON.stringify(checkoutData, null, 2));
      throw new Error(`Checkout failed with status ${resCheckout.status}`);
    }
    const orderId = checkoutData.order.id;
    console.log(`   OK. Order created with ID: ${orderId}`);

    console.log("\n4. Fetching order details (public)...");
    const resOrder = await requestJson(`${BASE_URL}/orders/public/${orderId}`);
    if (!resOrder.ok) throw new Error(`Failed to fetch order: ${resOrder.status}`);
    const orderData = resOrder.json;
    
    if (orderData.order.id !== orderId) throw new Error("Order ID mismatch");
    const order = orderData.order;
    const item = order.items?.[0];
    if (!item) throw new Error("Missing order items");

    const base = updatedProduct.priceCents;
    const pct = Math.max(0, Math.min(90, testDiscountValue));
    const expectedUnitPriceCents = Math.max(0, base - Math.round((base * pct) / 100));
    if (item.unitPriceCents !== expectedUnitPriceCents) {
      throw new Error(
        `Discounted unit price mismatch: expected ${expectedUnitPriceCents}, got ${item.unitPriceCents}`
      );
    }

    const expectedSubtotalCents = expectedUnitPriceCents * quantity;
    const shippingCents = settings.shippingCents ?? 0;
    const discountPercent = settings.discountPercent ?? 0;
    const discountPctClamped = Math.max(0, Math.min(90, Math.trunc(discountPercent)));
    const expectedDiscountCents = discountPctClamped
      ? Math.max(0, Math.min(expectedSubtotalCents, Math.round((expectedSubtotalCents * discountPctClamped) / 100)))
      : 0;
    const expectedTotalCents = Math.max(0, expectedSubtotalCents - expectedDiscountCents + shippingCents);

    if (order.subtotalCents !== expectedSubtotalCents) {
      throw new Error(
        `Subtotal mismatch: expected ${expectedSubtotalCents}, got ${order.subtotalCents}`
      );
    }
    if (order.discountCents !== expectedDiscountCents) {
      throw new Error(
        `Discount mismatch: expected ${expectedDiscountCents}, got ${order.discountCents}`
      );
    }
    if (order.shippingCents !== shippingCents) {
      throw new Error(
        `Shipping mismatch: expected ${shippingCents}, got ${order.shippingCents}`
      );
    }
    if (order.totalCents !== expectedTotalCents) {
      throw new Error(
        `Total mismatch: expected ${expectedTotalCents}, got ${order.totalCents}`
      );
    }

    console.log(`   OK. Fetched order: ${orderData.order.id}`);
    console.log(`   Total: ${order.totalCents} ${order.currency}`);
    console.log(`   Status: ${order.status}`);
    console.log(`   Discounted unit price: ${item.unitPriceCents} cents`);

    console.log("\n=== TEST PASSED: SYSTEM IS FULLY FUNCTIONAL ===");

  } catch (e) {
    console.error("\n=== TEST FAILED ===");
    console.error(e);
    process.exit(1);
  } finally {
    if (restoreProductId && restoreProductData) {
      try {
        await prisma.product.update({
          where: { id: restoreProductId },
          data: {
            discountValue: restoreProductData.discountValue,
            discountType: restoreProductData.discountType,
            stock: restoreProductData.stock,
          },
          select: { id: true },
        });
      } catch {}
    }
    await prisma.$disconnect();
    await pool.end();
  }
}

main();
