import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const COST = 32_768;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const KEY_LENGTH = 64;
const MAX_MEMORY = 64 * 1024 * 1024;
const DUMMY_SALT = Buffer.from("linkpulse-login-timing-protection");

async function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      KEY_LENGTH,
      {
        N: COST,
        r: BLOCK_SIZE,
        p: PARALLELIZATION,
        maxmem: MAX_MEMORY,
      },
      (error, derivedKey) => {
        if (error) {
          reject(error);
        } else {
          resolve(derivedKey);
        }
      },
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt);
  return [
    "scrypt",
    COST,
    BLOCK_SIZE,
    PARALLELIZATION,
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(
  password: string,
  encodedHash: string | undefined,
): Promise<boolean> {
  if (!encodedHash) {
    await deriveKey(password, DUMMY_SALT);
    return false;
  }

  const [algorithm, cost, blockSize, parallelization, saltValue, keyValue, extra] =
    encodedHash.split("$");
  if (
    algorithm !== "scrypt" ||
    cost !== String(COST) ||
    blockSize !== String(BLOCK_SIZE) ||
    parallelization !== String(PARALLELIZATION) ||
    !saltValue ||
    !keyValue ||
    extra !== undefined
  ) {
    await deriveKey(password, DUMMY_SALT);
    return false;
  }

  const salt = Buffer.from(saltValue, "base64url");
  const expectedKey = Buffer.from(keyValue, "base64url");
  if (salt.length !== 16 || expectedKey.length !== KEY_LENGTH) {
    await deriveKey(password, DUMMY_SALT);
    return false;
  }
  const actualKey = await deriveKey(password, salt);
  return timingSafeEqual(actualKey, expectedKey);
}
