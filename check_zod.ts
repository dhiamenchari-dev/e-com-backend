
import { z } from "zod";

const shippingSchema = z.object({
  fullName: z.string().min(2).max(80),
  email: z.email().optional().nullable(),
  phone: z.string().min(6).max(30),
  addressLine1: z.string().min(3).max(120),
  addressLine2: z.string().max(120).optional().nullable(),
  city: z.string().min(2).max(80),
  postalCode: z.string().min(2).max(20),
  notes: z.string().max(500).optional().nullable(),
});

const validData = {
  fullName: "John Doe",
  email: undefined,
  phone: "1234567890",
  addressLine1: "123 Main St",
  city: "New York",
  postalCode: "10001",
};

const validDataWithEmail = {
  ...validData,
  email: "test@example.com",
};

const invalidData = {
  ...validData,
  email: "not-an-email",
};

console.log("Testing undefined email:");
try {
  shippingSchema.parse(validData);
  console.log("PASS");
} catch (e: any) {
  console.log("FAIL", e.issues);
}

console.log("\nTesting valid email:");
try {
  shippingSchema.parse(validDataWithEmail);
  console.log("PASS");
} catch (e: any) {
  console.log("FAIL", e.issues);
}

console.log("\nTesting invalid email:");
try {
  shippingSchema.parse(invalidData);
  console.log("PASS");
} catch (e: any) {
  console.log("FAIL", e.issues);
}
