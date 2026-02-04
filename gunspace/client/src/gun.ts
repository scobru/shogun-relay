import Gun from 'gun';
import SEA from 'gun/sea';

// Use user provided relay or local default
const peers = [
    "https://shogun-relay.scobrudot.dev/gun",
    /*  "https://gun.defucc.me/gun",
     "https://gun.o8.is/gun",
     "https://relay.peer.ooo/gun", */
];

export const gun = (Gun as any)({
    peers: peers,
    localStorage: false,
});

export const user = (gun as any).user().recall({ sessionStorage: true });

export const sea = SEA;
