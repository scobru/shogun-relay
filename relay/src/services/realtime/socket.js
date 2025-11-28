import { Server } from "socket.io";

// Track online users
const onlineUsers = new Map(); // userPub -> socket.id

// Track room presence
const roomPresence = new Map(); // roomId -> { roomType, users: Set<userPub>, lastSeen: Map<userPub, timestamp> }

export function initSocket(server) {
  console.log("🔌 Initializing Socket.IO service...");
  
  const io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"],
    },
  });

  io.on("connection", (socket) => {
    console.log(`🔌 Client connected: ${socket.id}`);

    // User joins with their pub key
    socket.on("join", (data) => {
      const userPub = data.userPub;
      console.log(`👤 Client joined: ${userPub?.substring(0, 16)}...`);
      socket.join(`user:${userPub}`);
      onlineUsers.set(userPub, socket.id);

      // Notify others that this user is online
      socket.broadcast.emit("userPresence", {
        userPub,
        isOnline: true,
        lastSeen: Date.now(),
      });
    });

    // User joins a room for presence tracking
    socket.on("joinRoom", (data) => {
      const { roomId, roomType, userPub } = data;
      if (!roomId || !roomType || !userPub) return;

      console.log(
        `🏠 User joined room: ${userPub?.substring(
          0,
          8
        )}... -> ${roomId} (${roomType})`
      );

      // Join socket room for targeted notifications
      socket.join(`room:${roomId}`);

      // Update room presence tracking
      if (!roomPresence.has(roomId)) {
        roomPresence.set(roomId, {
          roomType,
          users: new Set(),
          lastSeen: new Map(),
        });
      }

      const room = roomPresence.get(roomId);
      room.users.add(userPub);
      room.lastSeen.set(userPub, Date.now());

      // Notify room members of new presence
      socket.to(`room:${roomId}`).emit("roomPresence", {
        roomId,
        roomType,
        userPubs: Array.from(room.users),
        onlineCount: room.users.size,
        lastSeen: Object.fromEntries(room.lastSeen),
      });
    });

    // User leaves a room
    socket.on("leaveRoom", (data) => {
      const { roomId, userPub } = data;
      if (!roomId || !userPub) return;

      console.log(
        `🏠 User left room: ${userPub?.substring(0, 8)}... -> ${roomId}`
      );

      // Leave socket room
      socket.leave(`room:${roomId}`);

      // Update room presence tracking
      const room = roomPresence.get(roomId);
      if (room) {
        room.users.delete(userPub);
        room.lastSeen.set(userPub, Date.now()); // Update last seen time

        // Notify room members of presence change
        socket.to(`room:${roomId}`).emit("roomPresence", {
          roomId,
          roomType: room.roomType,
          userPubs: Array.from(room.users),
          onlineCount: room.users.size,
          lastSeen: Object.fromEntries(room.lastSeen),
        });
      }
    });

    // Update room presence status
    socket.on("updateRoomPresence", (data) => {
      const { roomId, roomType, userPub, status } = data;
      if (!roomId || !userPub) return;

      console.log(
        `🏠 Room presence update: ${userPub?.substring(
          0,
          8
        )}... -> ${roomId} (${status})`
      );

      const room = roomPresence.get(roomId);
      if (room) {
        if (status === "online") {
          room.users.add(userPub);
        } else if (status === "offline") {
          room.users.delete(userPub);
        }
        room.lastSeen.set(userPub, Date.now());

        // Notify room members
        socket.to(`room:${roomId}`).emit("roomPresence", {
          roomId,
          roomType: room.roomType,
          userPubs: Array.from(room.users),
          onlineCount: room.users.size,
          lastSeen: Object.fromEntries(room.lastSeen),
        });
      }
    });

    socket.on("disconnect", () => {
      console.log(`🔌 Client disconnected: ${socket.id}`);
      
      // Find user by socket id
      let disconnectedUserPub = null;
      for (const [userPub, socketId] of onlineUsers.entries()) {
        if (socketId === socket.id) {
          disconnectedUserPub = userPub;
          break;
        }
      }

      if (disconnectedUserPub) {
        onlineUsers.delete(disconnectedUserPub);
        
        // Notify others
        socket.broadcast.emit("userPresence", {
          userPub: disconnectedUserPub,
          isOnline: false,
          lastSeen: Date.now(),
        });
      }
    });
  });

  return io;
}
