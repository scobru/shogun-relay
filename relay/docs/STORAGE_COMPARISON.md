# Storage Subscriptions vs Storage Deals

## Panoramica

Shogun Relay offre **due modelli di storage** complementari, ognuno ottimizzato per casi d'uso diversi.

## Tabella Comparativa

| Aspetto | Storage Subscriptions | Storage Deals |
|---------|----------------------|---------------|
| **Modello** | Abbonamento mensile | Contratto per-file |
| **Pricing** | Flat rate ($0.001-$0.01/mese) | Pay-per-use ($0.0001-0.0005/MB/mese) |
| **Storage** | Quota condivisa (100MB-2GB) | Per file specifico |
| **Durata** | Fissa (30 giorni) | Flessibile (7-365+ giorni) |
| **On-chain** | ❌ Solo off-chain (GunDB) | ✅ Registrazione on-chain |
| **Erasure Coding** | ❌ No | ✅ Disponibile (premium/enterprise) |
| **Multi-relay Replication** | ❌ No | ✅ Disponibile (premium/enterprise) |
| **Trust Model** | Richiede fiducia nel relay | Trustless (blockchain) |
| **Auditabilità** | Solo tramite relay | Pubblica su blockchain |
| **Verificabilità** | Off-chain | On-chain (pubblica) |

## Quando Usare Subscriptions

✅ **Ideale per:**
- Utenti finali che vogliono storage semplice e prevedibile
- App che permettono upload multipli frequenti
- Uso generale (foto, documenti, backup personali)
- Quando non serve garanzia on-chain

**Vantaggi:**
- Pagamento una volta al mese
- Quota fissa, facile da gestire
- Upload multipli senza contratti separati
- Setup semplice

**Limitazioni:**
- Solo off-chain (dipende dal relay)
- Durata fissa (30 giorni)
- Nessuna erasure coding
- Nessuna replica multi-relay

## Quando Usare Deals

✅ **Ideale per:**
- File critici che richiedono garanzie on-chain
- NFT, documenti legali, backup aziendali
- Durata personalizzata (es. 5 anni)
- File grandi (>1GB) con erasure coding
- Quando serve verificabilità pubblica

**Vantaggi:**
- Registrazione on-chain (trustless)
- Durata flessibile (7 giorni - 5 anni)
- Erasure coding disponibile
- Multi-relay replication
- Verificabile pubblicamente su blockchain

**Limitazioni:**
- Contratto separato per ogni file
- Prezzo calcolato per file
- Richiede pagamento per ogni deal

## Esempi Pratici

### Scenario 1: App di Foto Social
**Uso:** Subscriptions
**Motivo:** Utenti caricano molte foto piccole, bisogno di semplicità, non serve garanzia on-chain

### Scenario 2: NFT Art Collection
**Uso:** Deals (premium con erasure coding)
**Motivo:** File critici che devono essere sempre disponibili, serve garanzia on-chain, durata permanente

### Scenario 3: Backup Aziendale
**Uso:** Deals (enterprise)
**Motivo:** File importanti, bisogno di replica multi-relay, SLA garantito, verificabilità

### Scenario 4: Documenti Personali
**Uso:** Subscriptions
**Motivo:** Uso occasionale, quota sufficiente, costo prevedibile

## Migrazione tra Modelli

Puoi usare **entrambi simultaneamente**:
- Subscription per upload generali
- Deal per file specifici critici

Non c'è conflitto: un utente può avere una subscription attiva E dei deals attivi allo stesso tempo.

## Raccomandazioni

1. **Per utenti finali:** Inizia con subscription, passa a deal per file critici
2. **Per sviluppatori:** Usa subscription per sviluppo/testing, deal per produzione
3. **Per aziende:** Deals enterprise per dati critici, subscription per dati generici

