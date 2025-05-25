/**** storage log adapter ****/

class StorageLog {
  constructor(Gun,gun) {
    this.gun = gun;
    this.Gun = Gun;
    this.init();
  }

  init() {
    this.gun.on("get", function (WireMessage) {
      this.to.next(WireMessage);
      console.log("**⬅️** GET", WireMessage.get);
    });

    /**** put - patches the contents of a given node ****/

    this.gun.on("put", function (WireMessage) {
      this.to.next(WireMessage);
      console.log("**➡️** PUT", WireMessage.put);
    });
  }
}

export default StorageLog;
