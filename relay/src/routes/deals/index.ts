import { Router } from "express";
import pricingRouter from "./pricing";
import uploadRouter from "./upload";
import createRouter from "./create";
import listRouter from "./list";
import statsRouter from "./stats";
import statusRouter from "./status";
import syncRouter from "./sync";

const router: Router = Router();

// Hook up all sub-routers
router.use("/", pricingRouter); // /pricing, /overhead
router.use("/", uploadRouter); // /upload
router.use("/", createRouter); // /create, /:dealId/activate (specific param route)
router.use("/", listRouter); // /list/* (actually /by-cid, /by-client, /relay/active)
router.use("/", statsRouter); // /stats, /leaderboard
router.use("/", syncRouter); // /sync
router.use("/", statusRouter); // /:dealId (generic param route - must be last)

export default router;
