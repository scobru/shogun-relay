import express, { Request, Response, Router } from 'express';
import { authConfig } from '../config';
import { loggers } from '../utils/logger';

const router: Router = express.Router();

// Route per riavviare un servizio specifico
router.post("/:service/restart", async (req: Request, res: Response) => {
    try {
        const { service } = req.params;
        loggers.services.info({ service }, 'Requesting service restart');

        // Verifica autenticazione
        const authHeader: string | undefined = req.headers["authorization"];
        const bearerToken: string | undefined = authHeader && authHeader.split(" ")[1];
        const customToken: string | string[] | undefined = req.headers["token"];
        const token: string | string[] | undefined = bearerToken || customToken;

        if (token && token !== authConfig.adminPassword) {
            return res.status(401).json({
                success: false,
                error: "Unauthorized",
            });
        }

        // Lista dei servizi supportati
        const supportedServices: Array<string> = [
            "ipfs",
            "gun",
            "relay",
            "proxy",
            "gateway"
        ];

        if (!supportedServices.includes(service)) {
            return res.status(400).json({
                success: false,
                error: `Unsupported service: ${service}`,
                supportedServices: supportedServices,
            });
        }

        // Per ora restituiamo un successo mock
        // In futuro potremmo implementare il riavvio reale dei servizi
        loggers.services.info({ service }, 'Service restart initiated');

        res.json({
            success: true,
            service: service,
            message: `Service ${service} restart initiated`,
            timestamp: Date.now(),
        });
    } catch (error: any) {
        loggers.services.error({ err: error }, 'Failed to restart service');
        res.status(500).json({
            success: false,
            error: "Failed to restart service",
            details: error.message,
        });
    }
});

// Route per ottenere lo stato di tutti i servizi
router.get("/status", async (req: Request, res: Response) => {
    try {
        loggers.services.info('Requesting all services status');

        // Per ora restituiamo lo stato mock dei servizi
        // In futuro potremmo controllare lo stato reale dei servizi
        const servicesStatus: Record<string, any> = {
            ipfs: {
                status: "running",
                uptime: "2h 15m",
                version: "0.20.0",
                peers: 12
            },
            gun: {
                status: "running",
                uptime: "2h 15m",
                connections: 8,
                nodes: 1250
            },
            relay: {
                status: "running",
                uptime: "2h 15m",
                requests: 1250,
                memory: "45 MB"
            },
            proxy: {
                status: "running",
                uptime: "2h 15m",
                forwarded: 890
            },
            gateway: {
                status: "running",
                uptime: "2h 15m",
                served: 567
            }
        };

        loggers.services.info('Returning services status');

        res.json({
            success: true,
            services: servicesStatus,
            timestamp: Date.now(),
        });
    } catch (error: any) {
        loggers.services.error({ err: error }, 'Failed to get services status');
        res.status(500).json({
            success: false,
            error: "Failed to get services status",
            details: error.message,
        });
    }
});

export default router;
