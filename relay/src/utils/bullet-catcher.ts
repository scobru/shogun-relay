import Gun from "gun/gun.js";

// Interfaces for Gun context and messages
interface GunContext {
  once?: bool;
  opt: {
    isValid: (msg: obj) => bool | Error;
  };
  on: (event: str, handler: (msg: obj) => void) => void;
}

interface GunMessage {
  put?: obj;
  "#"?: str;
}

interface GunMessageHandler {
  to: {
    next: (msg: obj) => void;
  };
}

// Add listener
(Gun as any).on("opt", function (this: GunMessageHandler, context: GunContext) {
  if (context.once) {
    return;
  }
  // Pass to subsequent opt handlers
  this.to.next(context as unknown as obj);

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
