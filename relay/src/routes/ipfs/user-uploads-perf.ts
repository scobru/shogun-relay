import { Router } from "express";

export async function getUserUploadByHashFromGun(
  gun: any,
  userAddress: string,
  hash: string
): Promise<any> {
  return new Promise((resolve) => {
    // Timeout in case it doesn't exist or gun hangs
    const timer = setTimeout(() => resolve(null), 3000);

    gun
      .get("uploads") // Assuming GUN_PATHS.UPLOADS is 'uploads'
      .get(userAddress)
      .get(hash)
      .once((data: any) => {
        clearTimeout(timer);
        if (data && data.hash) {
          resolve({ ...data, hash: data.hash });
        } else if (data) {
          resolve({ ...data, hash });
        } else {
          resolve(null);
        }
      });
  });
}
