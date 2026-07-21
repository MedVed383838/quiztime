import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const COOKIE_NAME = "quiztime_token";
const COOKIE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

function jwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("JWT_SECRET must contain at least 32 characters");
  }
  return secret;
}

export function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

export function toUserDto(user) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    createdAt: user.createdAt.toISOString(),
  };
}

export function setAuthCookie(response, userId) {
  const token = jwt.sign({ sub: String(userId) }, jwtSecret(), { expiresIn: "7d" });
  response.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
}

export function clearAuthCookie(response) {
  response.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
}

export function verifyToken(token) {
  return jwt.verify(token, jwtSecret());
}

export async function registerUser(prisma, input) {
  const email = normalizeEmail(input.email);
  const passwordHash = await bcrypt.hash(input.password, 12);
  try {
    return await prisma.user.create({
      data: { email, passwordHash, displayName: input.displayName.trim() },
    });
  } catch (error) {
    if (error?.code === "P2002") {
      const conflict = new Error("EMAIL_ALREADY_EXISTS");
      conflict.code = "EMAIL_ALREADY_EXISTS";
      throw conflict;
    }
    throw error;
  }
}

export async function authenticateUser(prisma, input) {
  const user = await prisma.user.findUnique({ where: { email: normalizeEmail(input.email) } });
  if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
    const error = new Error("INVALID_CREDENTIALS");
    error.code = "INVALID_CREDENTIALS";
    throw error;
  }
  return user;
}

export { COOKIE_NAME };
