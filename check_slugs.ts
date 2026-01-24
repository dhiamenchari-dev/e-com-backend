
import "dotenv/config";
import { prisma } from "./src/lib/prisma";

async function main() {
  const products = await prisma.product.findMany({
    select: { id: true, name: true, slug: true, isActive: true },
  });
  console.log("Total products:", products.length);
  
  const inactive = products.filter((p) => !p.isActive);
  console.log("Inactive products:", inactive.length);
  if (inactive.length > 0) {
    console.log("Example inactive:", inactive[0]);
  }

  // Print first 3 products
  console.log("First 3 products:", products.slice(0, 3));
}

main()
  .catch((e) => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
