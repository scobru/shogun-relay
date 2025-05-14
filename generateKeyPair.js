import SEA from "gun/sea.js";
import Gun from "gun";
SEA.pair().then((pair) => {
  console.log(
    'This is your secret app key pair.\nAdd this to your .dotenv file:'
  );
  console.log(`APP_KEY_PAIR='${JSON.stringify(pair)}'`);

  // registra user in gun
  const gun = Gun("http://localhost:8765/gun");

  gun.on("out", function (ctx) {
    var to = this.to;
    // Adds headers for put
    ctx.headers = {
      token: "thisIsTheTokenForReals",
    };
    to.next(ctx); // pass to next middleware
  });

  gun.user().create("app", pair, ({ err }) => {
    if (err) {
      console.error("App user creation error:", err);
    } else {
      console.log("App user created successfully"); 
    }
  });
  
});