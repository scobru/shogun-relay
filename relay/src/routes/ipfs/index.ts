import { Router } from "express";
import proxyRouter from "./proxy";
import catRouter from "./cat";
import uploadRouter from "./upload";
import uploadDirectoryRouter from "./upload-directory";
import decryptRouter from "./decrypt";
import pinRouter from "./pin";
import repoRouter from "./repo";
import userUploadsRouter from "./user-uploads";

const router: Router = Router();

// Mount all IPFS sub-routers
router.use("/", proxyRouter);
router.use("/", catRouter);
router.use("/", uploadRouter);
router.use("/", uploadDirectoryRouter);
router.use("/", decryptRouter);
router.use("/", pinRouter);
router.use("/", repoRouter);
router.use("/", userUploadsRouter);

export default router;
