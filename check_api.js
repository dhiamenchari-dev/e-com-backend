
const http = require("node:http");
const https = require("node:https");
const { URL } = require("node:url");

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? https : http;
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: `${u.pathname}${u.search}`,
        method: "GET",
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
          resolve({ status: res.statusCode ?? 0, json });
        });
      }
    );
    req.on("error", reject);
    req.end();
  });
}

async function main() {
  try {
    console.log("Checking /api/products/featured...");
    const resFeatured = await requestJson("http://localhost:4000/api/products/featured");
    const dataFeatured = resFeatured.json;
    console.log("Featured Status:", resFeatured.status);
    if (dataFeatured.items && dataFeatured.items.length > 0) {
      console.log("Featured First item slug:", dataFeatured.items[0].slug);
    } else {
      console.log("Featured No items");
    }

    console.log("\nChecking /api/products...");
    const resList = await requestJson("http://localhost:4000/api/products?page=1&limit=10");
    const dataList = resList.json;
    console.log("List Status:", resList.status);
    if (dataList.items && dataList.items.length > 0) {
      console.log("List First item slug:", dataList.items[0].slug);
      const missing = dataList.items.filter(i => !i.slug);
      console.log("List items missing slug:", missing.length);
    } else {
      console.log("List No items");
    }

  } catch (e) {
    console.error(e);
  }
}

main();
