import { rateLimit } from "express-rate-limit";
import { loggers } from "../utils/logger";

/**
 * Rate limiter for authentication endpoints
 * Prevents brute force attacks and DoS
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 20, // Limit each IP to 20 requests per `window` (here, per 15 minutes)
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  handler: (req, res) => {
    loggers.server.warn({ ip: req.ip }, "Rate limit exceeded for auth endpoint");
    res.status(429).json({
      success: false,
      error: "Too many authentication attempts, please try again later.",
    });
  },
});
