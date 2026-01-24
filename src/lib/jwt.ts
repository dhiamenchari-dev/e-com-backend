import jwt from "jsonwebtoken";
import { env } from "../env";

export type AccessTokenPayload = {
  sub: string;
  role: "CUSTOMER" | "ADMIN";
};

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.ACCESS_TOKEN_SECRET, {
    algorithm: "HS256",
    expiresIn: `${env.ACCESS_TOKEN_TTL_MINUTES}m`,
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.ACCESS_TOKEN_SECRET) as AccessTokenPayload;
}

