# TypeScript Type Checking per JavaScript

Questo progetto usa TypeScript per verificare la solidità del codice JavaScript senza migrare a TypeScript.

## Come funziona

TypeScript può analizzare file JavaScript quando:
- `checkJs: true` è abilitato in `tsconfig.json`
- I file hanno annotazioni JSDoc per i tipi

## Comandi disponibili

```bash
# Verifica tutti i file una volta
yarn typecheck

# Verifica in modalità watch (rileva errori mentre modifichi il codice)
yarn typecheck:watch
```

## Aggiungere JSDoc

Per ottenere il massimo dal type checking, aggiungi JSDoc alle funzioni:

### Esempio base

```javascript
/**
 * Calcola la somma di due numeri
 * @param {number} a - Primo numero
 * @param {number} b - Secondo numero
 * @returns {number} La somma di a e b
 */
function sum(a, b) {
  return a + b;
}
```

### Esempio con Express

```javascript
/**
 * Middleware di autenticazione
 * @param {import('express').Request} req - Express request object
 * @param {import('express').Response} res - Express response object
 * @param {import('express').NextFunction} next - Express next function
 */
const authMiddleware = (req, res, next) => {
  // ...
};
```

### Esempio con tipi complessi

```javascript
/**
 * Configurazione del server
 * @typedef {Object} ServerConfig
 * @property {number} port - Porta del server
 * @property {string} host - Host del server
 * @property {boolean} [https=false] - Abilita HTTPS
 */

/**
 * Inizializza il server
 * @param {ServerConfig} config - Configurazione del server
 * @returns {Promise<import('http').Server>}
 */
async function initServer(config) {
  // ...
}
```

## Vantaggi

1. **Type Safety**: Rileva errori di tipo a compile-time
2. **Autocompletamento**: Migliora l'autocompletamento nell'IDE
3. **Refactoring sicuro**: Aiuta a identificare problemi durante il refactoring
4. **Documentazione**: JSDoc serve anche come documentazione inline

## Strategia incrementale

Non è necessario aggiungere JSDoc a tutto subito. Inizia con:

1. **Funzioni critiche**: Autenticazione, validazione, business logic
2. **API pubbliche**: Funzioni esportate, route handlers
3. **Tipi complessi**: Oggetti di configurazione, strutture dati

## Migrazione futura

Se in futuro decidi di migrare completamente a TypeScript:
- I file con JSDoc completo sono già pronti
- Puoi rinominare `.js` → `.ts` gradualmente
- TypeScript userà i JSDoc come base per i tipi

## Risoluzione errori comuni

### "Cannot find module"

Se TypeScript non trova un modulo, potrebbe essere necessario:
- Aggiungere `@types/package-name` per i pacchetti npm
- Configurare `paths` in `tsconfig.json` per alias personalizzati

### "Parameter 'x' implicitly has an 'any' type"

Aggiungi JSDoc con `@param {tipo} x` alla funzione.

### Errori su `process.env`

TypeScript non conosce le variabili d'ambiente. Puoi:
- Usare `process.env.VAR_NAME as string` quando sei sicuro del tipo
- Creare un file di dichiarazione per le env vars

