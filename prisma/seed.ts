import "dotenv/config";
import { hashPassword } from "../src/lib/password";
import { prisma } from "../src/lib/prisma";
import { slugify } from "../src/utils/slug";

async function main() {
  const adminEmail = "admin@demo.com";
  const customerEmail = "customer@demo.com";

  const [adminPasswordHash, customerPasswordHash] = await Promise.all([
    hashPassword("Admin1234!"),
    hashPassword("Customer1234!"),
  ]);

  await prisma.user.upsert({
    where: { email: adminEmail },
    create: {
      name: "Admin",
      email: adminEmail,
      passwordHash: adminPasswordHash,
      role: "ADMIN",
      cart: { create: {} },
    },
    update: {},
  });

  await prisma.user.upsert({
    where: { email: customerEmail },
    create: {
      name: "Customer",
      email: customerEmail,
      passwordHash: customerPasswordHash,
      role: "CUSTOMER",
      cart: { create: {} },
    },
    update: {},
  });

  await prisma.siteSettings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton" },
    update: {},
  });

  const categories = await Promise.all(
    ["Electronics", "Fashion", "Home", "Beauty"].map((name) =>
      prisma.category.upsert({
        where: { name },
        create: { name },
        update: {},
      })
    )
  );

  const sampleProducts = [
    {
      name: "Wireless Headphones",
      description:
        "Comfortable wireless headphones with clear sound, long battery life, and fast charging.",
      price: 799.0,
      stock: 25,
      categoryName: "Electronics",
      images: [
        {
          url: "https://images.unsplash.com/photo-1518441902117-f0a7a1b1aee8?auto=format&fit=crop&w=1200&q=80",
        },
      ],
    },
    {
      name: "Classic Hoodie",
      description:
        "Soft, warm hoodie with a modern fit. Perfect for everyday wear in all seasons.",
      price: 249.0,
      stock: 60,
      categoryName: "Fashion",
      images: [
        {
          url: "https://images.unsplash.com/photo-1520975958225-1e9d995e4a3a?auto=format&fit=crop&w=1200&q=80",
        },
      ],
    },
    {
      name: "Minimal Desk Lamp",
      description:
        "Elegant desk lamp with adjustable brightness for study and work setups.",
      price: 189.0,
      stock: 40,
      categoryName: "Home",
      images: [
        {
          url: "https://images.unsplash.com/photo-1555489428-1c7a6e19b0b1?auto=format&fit=crop&w=1200&q=80",
        },
      ],
    },
    {
      name: "Skincare Starter Kit",
      description:
        "Daily essentials for cleansing, moisturizing, and gentle skincare routines.",
      price: 299.0,
      stock: 35,
      categoryName: "Beauty",
      images: [
        {
          url: "https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?auto=format&fit=crop&w=1200&q=80",
        },
      ],
    },
  ];

  for (const p of sampleProducts) {
    const category = categories.find((c: { id: string; name: string }) => c.name === p.categoryName);
    if (!category) continue;
    const slug = slugify(p.name);
    await prisma.product.upsert({
      where: { slug },
      create: {
        name: p.name,
        slug,
        description: p.description,
        priceCents: Math.round(p.price * 100),
        stock: p.stock,
        images: p.images,
        categoryId: category.id,
        isActive: true,
      },
      update: { isActive: true },
    });
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    const msg = e instanceof Error ? e.stack ?? e.message : String(e);
    process.stderr.write(msg + "\n");
    await prisma.$disconnect();
    process.exit(1);
  });
