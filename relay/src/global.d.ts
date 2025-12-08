export {};

declare global {
  // --- Tipi Primitivi (3 lettere) ---
  type str  = string;
  type num  = number;
  type bool = boolean;
  type obj  = Record<string, any>;
  type arr<T> = Array<T>;
  
  // --- Il cuore del sistema ---
  // 1. Definiamo il TIPO 'und'
  type und = undefined; 
  
  // 2. Diciamo che esiste una VARIABILE globale 'und'
  var und: undefined; 

  // --- Async & Utility ---
  type prm<T> = Promise<T>;
  type mb<T>  = T | und;     // "Maybe": T oppure undefined
  type opt<T> = Partial<T>;  // "Optional": rende i campi opzionali
}