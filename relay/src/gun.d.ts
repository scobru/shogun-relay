/**
 * Type declarations for GunDB
 * These declarations help TypeScript understand GunDB's API
 */

declare module 'gun' {
  interface IGun {
    get(key: string): IGun;
    put(data: any, callback?: (ack: any) => void): IGun;
    once(callback: (data: any, key?: string) => void): IGun;
    map(): IGun;
    on(callback: (data: any, key?: string) => void): IGun;
    user(): IUser;
    serve(server: any): void;
  }

  interface IGunInstance<T = any> extends IGun {
    get(key: string): IGunInstance<T>;
  }

  interface IUser {
    auth(keypair: any, callback: (ack: any) => void): void;
    get(key: string): IGun;
    put(data: any, callback?: (ack: any) => void): IGun;
    once(callback: (data: any, key?: string) => void): IGun;
  }

  interface GunConstructor {
    new (options?: any): IGun;
    (options?: any): IGun;
  }

  const Gun: GunConstructor;
  export default Gun;
}

