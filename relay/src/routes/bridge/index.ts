import { Router } from "express";
import withdrawalsRouter from "./withdrawals";
import batchRouter from "./batch";
import stateRouter from "./state";
import depositsRouter from "./deposits";
import transfersRouter from "./transfers";

const router: Router = Router();

// Mount sub-routers
router.use("/", withdrawalsRouter);
router.use("/", batchRouter);
router.use("/", stateRouter);
router.use("/", depositsRouter);
router.use("/", transfersRouter);

export default router;
