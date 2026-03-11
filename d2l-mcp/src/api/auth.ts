/**
 * REST API auth middleware.
 * - Cognito: verify JWT via aws-jwt-verify, set req.userId = payload.sub.
 * - Supabase: verify HS256 JWT using SUPABASE_JWT_SECRET, set req.userId = payload.sub.
 * - Dev bypass: SKIP_JWT_AUTH=1 + X-User-Id header.
 *
 * Verification order:
 *   1. Try Cognito if COGNITO_USER_POOL_ID + COGNITO_CLIENT_ID are set
 *   2. If Cognito not configured or fails, try Supabase JWT if SUPABASE_JWT_SECRET is set
 *   3. Fail with 401 if both fail
 */

import type { Request, Response, NextFunction } from "express";
import { createHmac } from "crypto";

const SKIP = process.env.SKIP_JWT_AUTH === "1" || process.env.SKIP_JWT_AUTH === "true";
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID;
const CLIENT_ID = process.env.COGNITO_CLIENT_ID;
const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET;

let cognitoVerifier: { verify: (token: string) => Promise<{ sub: string }> } | null = null;

async function initCognitoVerifier() {
  if (cognitoVerifier) return cognitoVerifier;
  if (!USER_POOL_ID || !CLIENT_ID) return null;
  const { CognitoJwtVerifier } = await import("aws-jwt-verify");
  cognitoVerifier = CognitoJwtVerifier.create({
    userPoolId: USER_POOL_ID,
    tokenUse: "id",
    clientId: CLIENT_ID,
  }) as unknown as { verify: (token: string) => Promise<{ sub: string }> };
  return cognitoVerifier;
}

/**
 * Verify a Supabase JWT (HS256, signed with SUPABASE_JWT_SECRET).
 * Returns the payload on success, throws on failure.
 */
function verifySupabaseJwt(token: string, secret: string): { sub: string; [key: string]: any } {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid JWT format");
  }

  const [headerB64, payloadB64, signatureB64] = parts;

  // Verify header declares HS256
  let header: { alg: string; typ: string };
  try {
    header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8"));
  } catch {
    throw new Error("Failed to parse JWT header");
  }

  if (header.alg !== "HS256") {
    throw new Error(`Unsupported JWT algorithm: ${header.alg}`);
  }

  // Verify signature
  const signingInput = `${headerB64}.${payloadB64}`;
  const expectedSig = createHmac("sha256", secret)
    .update(signingInput)
    .digest("base64url");

  if (signatureB64 !== expectedSig) {
    throw new Error("JWT signature verification failed");
  }

  // Parse and validate payload
  let payload: { sub: string; exp?: number; iat?: number; [key: string]: any };
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    throw new Error("Failed to parse JWT payload");
  }

  // Check expiry
  if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) {
    throw new Error("JWT has expired");
  }

  if (!payload.sub) {
    throw new Error("JWT missing sub claim");
  }

  return payload;
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (SKIP) {
    const uid = req.headers["x-user-id"] as string | undefined;
    req.userId = uid?.trim() || "dev-user";
    next();
    return;
  }

  const auth = req.headers["authorization"] || req.headers["Authorization"];
  const token = typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice(7) : null;

  if (!token) {
    res.status(401).json({ error: "Missing or invalid Authorization header" });
    return;
  }

  // 1. Try Cognito if configured
  if (USER_POOL_ID && CLIENT_ID) {
    try {
      const v = await initCognitoVerifier();
      if (v) {
        const payload = await v.verify(token);
        req.userId = payload.sub;
        next();
        return;
      }
    } catch {
      // Cognito verification failed — fall through to Supabase
    }
  }

  // 2. Try Supabase JWT if SUPABASE_JWT_SECRET is set
  if (SUPABASE_JWT_SECRET) {
    try {
      const payload = verifySupabaseJwt(token, SUPABASE_JWT_SECRET);
      req.userId = payload.sub;
      next();
      return;
    } catch (err) {
      console.error("[AUTH] Supabase JWT verification failed:", err instanceof Error ? err.message : err);
      console.error("[AUTH] Token prefix:", token.substring(0, 20));
      console.error("[AUTH] Secret length:", SUPABASE_JWT_SECRET.length);
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }
  }

  // 3. Neither auth method is configured
  res.status(503).json({
    error: "JWT verification not configured (COGNITO_USER_POOL_ID + COGNITO_CLIENT_ID or SUPABASE_JWT_SECRET required)",
  });
}
