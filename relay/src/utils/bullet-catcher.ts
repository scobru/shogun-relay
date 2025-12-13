import Gun from "gun/gun.js";

// Interfaces for Gun context and messages
interface GunContext {
  once?: boolean;
  opt: {
    isValid: (msg: Record<string, any>) => boolean | Error;
  };
  on: (event: string, handler: (msg: Record<string, any>) => void) => void;
}

interface GunMessage {
  put?: Record<string, any>;
  "#"?: string;
}

interface GunMessageHandler {
  to: {
    next: (msg: Record<string, any>) => void;
  };
}

// Add listener
(Gun as any).on("opt", function (this: GunMessageHandler, context: GunContext) {
  if (context.once) {
    return;
  }
  // Pass to subsequent opt handlers
  this.to.next(context as unknown as Record<string, any>);

  const { isValid } = context.opt;

  if (typeof isValid !== "function") {
    throw new Error("you must pass in an isValid function");
  }

  // Check all incoming traffic
  (context as any).on(
    "in",
    function (this: GunMessageHandler, msg: GunMessage) {
      const to = this.to;
      // restrict put
      if (msg.put) {
        const isValidMsg = isValid(msg);

        if (isValidMsg instanceof Error) {
          (context as any).on("in", { "@": msg["#"], err: isValidMsg.message });
        } else {
          if (isValidMsg) {
            to.next(msg);
          }
        }
      } else {
        to.next(msg);
      }
    }
  );
});

export default Gun;
