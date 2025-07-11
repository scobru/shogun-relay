import express from 'express';
import ActivitypubExpress from 'activitypub-express';
import GunStore from './gun-store.js';

/**
 * Initializes and configures the ActivityPub service.
 *
 * @param {object} gun - The root Gun instance.
 * @param {object} config - Configuration options.
 * @param {function} authMiddleware - Authentication middleware.
 * @returns {object} An Express router with ActivityPub endpoints.
 */
function setupActivityPub(gun, config, authMiddleware) {
  const app = express();

  const apex = ActivitypubExpress({
    name: config.RELAY_NAME || 'Shogun Relay',
    version: '1.0.0', // TODO: Get from package.json
    domain: new URL(config.RELAY_URL || `http://${config.RELAY_HOST}:${config.RELAY_PORT}`).hostname,
    actorParam: 'actor',
    objectParam: 'id',
    activityParam: 'id',
    store: new GunStore(gun),
    routes: {
      actor: '/u/:actor',
      object: '/o/:id',
      activity: '/s/:id',
      inbox: '/u/:actor/inbox',
      outbox: '/u/:actor/outbox',
      followers: '/u/:actor/followers',
      following: '/u/:actor/following',
      liked: '/u/:actor/liked',
    },
    endpoints: {
      proxyUrl: `${config.RELAY_URL}/proxy`,
    },
  });

  app.use(
    express.json({ type: apex.consts.jsonldTypes }),
    express.urlencoded({ extended: true }),
    apex
  );

  // Define routes
  app.route(apex.routes.inbox)
    .get(apex.net.inbox.get)
    .post(apex.net.inbox.post);

  app.route(apex.routes.outbox)
    .get(apex.net.outbox.get)
    .post(apex.net.outbox.post);

  app.get(apex.routes.actor, apex.net.actor.get);
  app.get(apex.routes.followers, apex.net.followers.get);
  app.get(apex.routes.following, apex.net.following.get);
  app.get(apex.routes.liked, apex.net.liked.get);
  app.get(apex.routes.object, apex.net.object.get);
  app.get(apex.routes.activity, apex.net.activityStream.get);

  // Well-known routes
  app.get('/.well-known/webfinger', apex.net.webfinger.get);
  app.get('/.well-known/nodeinfo', apex.net.nodeInfoLocation.get);
  app.get('/nodeinfo/:version.json', apex.net.nodeInfo.get);

  // Proxy for fetching remote objects
  app.post('/proxy', apex.net.proxy.post);

  // Custom event listeners for side-effects
  apex.on('inbox', async (activity, recipient) => {
    console.log(`[ActivityPub] INBOX for ${recipient}:`, activity);
    // Here you could trigger notifications or other actions
  });

  apex.on('outbox', async (activity, actor) => {
    console.log(`[ActivityPub] OUTBOX from ${actor}:`, activity);
    // Actions after an actor posts something
  });

  console.log('📢 ActivityPub service configured');

  return { apex, router: app };
}

export default setupActivityPub; 