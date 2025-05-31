const S3rver = require('s3rver');
const { fromEvent } = require('rxjs');
const { filter } = require('rxjs/operators');
const fs = require('fs');
const corsConfig = require.resolve('s3rver/example/cors.xml');
const websiteConfig = require.resolve('s3rver/example/website.xml');

const instance = new S3rver({
  port: 4569,
  address: '0.0.0.0',
  silent: false,
  directory: './buckets',
  accessKeyId:'S3RVER',
  secretAccessKey:'S3RVER',
  configureBuckets: [
    {
      name: 'test-bucket3',
      accessKeyId: 'S3RVER',
      secretAccessKey: 'S3RVER',
      cors: fs.readFileSync(corsConfig),
      website: fs.readFileSync(websiteConfig),
    },
  ],
}).run((err, { address, port } = {}) => {
  if (err) {
    console.error(err);
  } else {
    console.log('now listening at address %s and port %d', address, port);
  }
});

const s3Events = fromEvent(instance, 'event');
s3Events.subscribe((event) => console.log(event));
s3Events
  .pipe(filter((event) => event.Records[0].eventName == 'ObjectCreated:Copy'))
  .subscribe((event) => console.log(event));