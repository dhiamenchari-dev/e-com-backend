import crypto from "crypto";
import { env } from "../env";

export type RefreshTokenPair = {
  token: string;
  tokenHash: string;
  expiresAt: Date;
};

export function createRefreshToken(): RefreshTokenPair {
  const token = crypto.randomBytes(64).toString("base64url");
  const tokenHash = crypto
    .createHmac("sha256", env.REFRESH_TOKEN_SECRET)
    .update(token)
    .digest("hex");
  const expiresAt = new Date(
    Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000
  );
  return { token, tokenHash, expiresAt };
}

export function hashRefreshToken(token: string): string {
  return crypto
    .createHmac("sha256", env.REFRESH_TOKEN_SECRET)
    .update(token)
    .digest("hex");
}

